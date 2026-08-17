const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const AppointedCustomer = require('../models/AppointedCustomer');
const Counter = require('../models/Counter');
const SalesOrder = require('../models/SalesOrder');
const StockItem = require('../models/StockItem');
const { renderSalesOrderPdf } = require('../services/salesOrderPdf.service');
const {
  nameKeyOf,
  checkLineAvailability,
} = require('../services/stockAvailability.service');
const { getPagination, buildMeta } = require('../utils/pagination');
const { logActivity } = require('../services/activity.service');
const { searchRegex } = require('../utils/sanitize');

/** Admins manage every order; sales execs manage only the ones they booked. */
const canManage = (user, order) =>
  user.role === 'admin' || String(order.createdBy?._id || order.createdBy) === String(user._id);

/**
 * Recomputes line amounts and the total from qty × rate, enriching each line
 * with the unit and the stock position from the Tally mirror. The mirror is
 * matched on the normalised nameKey, not the raw name — an appointed
 * customer's lines carry their frozen list's UPPERCASE name and would
 * otherwise never find their item. Names absent from the mirror are still
 * allowed (stock may lag Tally); they carry no unit and no stock figures.
 *
 * `excludeOrder` is the order being re-saved: its own lines must not count
 * against its own availability, or every edit would report itself as short.
 */
async function buildItems(items, { excludeOrder } = {}) {
  const keys = items.map((i) => nameKeyOf(i.name)).filter(Boolean);
  const [stock, { availableByKey, warnings }] = await Promise.all([
    StockItem.find({ nameKey: { $in: keys } }).lean(),
    checkLineAvailability(items, { excludeOrder }),
  ]);
  const byKey = new Map();
  for (const s of stock) {
    const seen = byKey.get(s.nameKey);
    if (!seen || String(s.name) < String(seen.name)) byKey.set(s.nameKey, s);
  }

  const built = items.map((i) => {
    const key = nameKeyOf(i.name);
    const s = byKey.get(key);
    return {
      name: i.name,
      nameKey: key,
      packSize: i.packSize || '',
      baseUnits: s?.baseUnits || '',
      qty: i.qty,
      rate: i.rate,
      amount: Math.round(i.qty * i.rate * 100) / 100,
      stockQtyAtOrder: s ? s.closingQty : null,
      availableAtOrder: availableByKey.has(key) ? availableByKey.get(key) : null,
    };
  });
  const total = Math.round(built.reduce((sum, i) => sum + i.amount, 0) * 100) / 100;
  return { built, total, warnings };
}

/**
 * Resolves an appointed (rate-frozen) customer when customerId is given and
 * enforces the freeze: every line must be on the frozen list, and the frozen
 * rate always wins over whatever rate the client sent.
 */
async function applyFrozenCustomer(customerId, items) {
  if (!customerId) return null;
  const appointed = await AppointedCustomer.findById(customerId);
  if (!appointed) throw ApiError.badRequest('Appointed customer not found');

  const frozen = new Map(appointed.items.map((i) => [i.name, i]));
  for (const it of items) {
    const f = frozen.get(String(it.name).trim().toUpperCase());
    if (!f) {
      throw ApiError.badRequest(
        `"${it.name}" is not in ${appointed.companyName}'s frozen rate list — orders for this customer can contain only their frozen items`
      );
    }
    it.name = f.name;
    it.rate = f.rate;
    it.packSize = f.packSize;
  }
  return appointed;
}

/**
 * Lines that exceed what is left to sell are reported back, never refused —
 * orders are routinely booked against goods still in production, so a hard
 * rejection would stop real work. The client surfaces them as a warning.
 */
const withWarnings = (order, warnings) => ({
  ...(order.toObject ? order.toObject() : order),
  warnings,
});

// POST /api/sales-orders
const createSalesOrder = asyncHandler(async (req, res) => {
  const { customerName, customerId, items, notes } = req.body;
  const appointed = await applyFrozenCustomer(customerId, items);
  const { built, total, warnings } = await buildItems(items);

  const year = new Date().getFullYear();
  const seq = await Counter.next(`SO-${year}`);
  const number = `SO-${year}-${String(seq).padStart(4, '0')}`;

  const order = await SalesOrder.create({
    number,
    customerName: appointed ? appointed.companyName : customerName,
    customer: appointed?._id,
    items: built,
    total,
    notes: notes || '',
    createdBy: req.user._id,
  });

  await logActivity({
    userId: req.user._id,
    action: 'SALES_ORDER_CREATED',
    entity: 'SalesOrder',
    entityId: order._id,
    details: `Created sales order ${number} for ${customerName} (${built.length} items, Rs. ${total.toLocaleString('en-IN')})`,
    ip: req.ip,
  });

  res
    .status(201)
    .json({ success: true, message: `Sales order ${number} created`, data: withWarnings(order, warnings) });
});

// GET /api/sales-orders?search=&status=&page=&limit=
const listSalesOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.search) {
    const rx = searchRegex(req.query.search);
    filter.$or = [{ number: rx }, { customerName: rx }];
  }

  const [orders, total] = await Promise.all([
    SalesOrder.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('createdBy', 'name')
      .populate('customer', 'companyName'),
    SalesOrder.countDocuments(filter),
  ]);
  res.json({ success: true, data: orders, meta: buildMeta(total, page, limit) });
});

// GET /api/sales-orders/:id
const getSalesOrder = asyncHandler(async (req, res) => {
  const order = await SalesOrder.findById(req.params.id).populate('createdBy', 'name phone');
  if (!order) throw ApiError.notFound('Sales order not found');
  res.json({ success: true, data: order });
});

// PUT /api/sales-orders/:id — full re-edit, only while the order is open
const updateSalesOrder = asyncHandler(async (req, res) => {
  const order = await SalesOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Sales order not found');
  if (!canManage(req.user, order)) throw ApiError.forbidden('You can only edit your own orders');
  if (order.status !== 'open') {
    throw ApiError.badRequest(`Only open orders can be edited — this one is ${order.status}`);
  }

  const { customerName, customerId, items, notes } = req.body;
  const appointed = await applyFrozenCustomer(customerId, items);
  const { built, total, warnings } = await buildItems(items, { excludeOrder: order._id });
  order.customerName = appointed ? appointed.companyName : customerName;
  order.customer = appointed?._id || undefined;
  order.items = built;
  order.total = total;
  order.notes = notes || '';
  await order.save();

  await logActivity({
    userId: req.user._id,
    action: 'SALES_ORDER_UPDATED',
    entity: 'SalesOrder',
    entityId: order._id,
    details: `Updated sales order ${order.number}`,
    ip: req.ip,
  });

  res.json({
    success: true,
    message: `Sales order ${order.number} updated`,
    data: withWarnings(order, warnings),
  });
});

// PUT /api/sales-orders/:id/status
const updateStatus = asyncHandler(async (req, res) => {
  const order = await SalesOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Sales order not found');
  if (!canManage(req.user, order)) throw ApiError.forbidden('You can only update your own orders');

  const { status } = req.body;
  if (order.status === status) {
    return res.json({ success: true, message: 'No change', data: withWarnings(order, []) });
  }

  // dispatchedAt is the clock that eventually releases the order's stock
  // reservation once Tally has had time to catch up; moving back to open (or
  // cancelling) restarts it from nothing.
  order.status = status;
  order.dispatchedAt = status === 'dispatched' ? new Date() : null;

  // Re-opening re-takes the reservation days later, against stock that has
  // moved since — the one transition that can book a shortfall nobody sees.
  const warnings =
    status === 'open'
      ? (await checkLineAvailability(order.items, { excludeOrder: order._id })).warnings
      : [];

  await order.save();

  await logActivity({
    userId: req.user._id,
    action: 'SALES_ORDER_STATUS',
    entity: 'SalesOrder',
    entityId: order._id,
    details: `Sales order ${order.number} marked ${status}`,
    ip: req.ip,
  });

  res.json({ success: true, message: `Order marked ${status}`, data: withWarnings(order, warnings) });
});

// DELETE /api/sales-orders/:id — admin only (route-gated)
const deleteSalesOrder = asyncHandler(async (req, res) => {
  const order = await SalesOrder.findByIdAndDelete(req.params.id);
  if (!order) throw ApiError.notFound('Sales order not found');

  await logActivity({
    userId: req.user._id,
    action: 'SALES_ORDER_DELETED',
    entity: 'SalesOrder',
    entityId: order._id,
    details: `Deleted sales order ${order.number} (${order.customerName})`,
    ip: req.ip,
  });

  res.json({ success: true, message: `Sales order ${order.number} deleted` });
});

// GET /api/sales-orders/:id/pdf
const salesOrderPdf = asyncHandler(async (req, res) => {
  const order = await SalesOrder.findById(req.params.id)
    .populate('createdBy', 'name phone')
    .populate('customer', 'companyName email gstin mobile address terms');
  if (!order) throw ApiError.notFound('Sales order not found');

  const buffer = await renderSalesOrderPdf(order, order.createdBy);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${order.number}.pdf"`);
  res.send(buffer);
});

module.exports = {
  createSalesOrder,
  listSalesOrders,
  getSalesOrder,
  updateSalesOrder,
  updateStatus,
  deleteSalesOrder,
  salesOrderPdf,
};

const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const Counter = require('../models/Counter');
const SalesOrder = require('../models/SalesOrder');
const StockItem = require('../models/StockItem');
const { renderSalesOrderPdf } = require('../services/salesOrderPdf.service');
const { getPagination, buildMeta } = require('../utils/pagination');
const { logActivity } = require('../services/activity.service');
const { searchRegex } = require('../utils/sanitize');

/** Admins manage every order; sales execs manage only the ones they booked. */
const canManage = (user, order) =>
  user.role === 'admin' || String(order.createdBy?._id || order.createdBy) === String(user._id);

/**
 * Recomputes line amounts and the total from qty × rate, enriching each line
 * with the unit and current stock level from the Tally mirror. Item names not
 * in the mirror are allowed (stock may lag Tally) — they just carry no unit.
 */
async function buildItems(items) {
  const stock = await StockItem.find({ name: { $in: items.map((i) => i.name) } }).lean();
  const byName = new Map(stock.map((s) => [s.name, s]));
  const built = items.map((i) => {
    const s = byName.get(i.name);
    return {
      name: i.name,
      baseUnits: s?.baseUnits || '',
      qty: i.qty,
      rate: i.rate,
      amount: Math.round(i.qty * i.rate * 100) / 100,
      stockQtyAtOrder: s ? s.closingQty : null,
    };
  });
  const total = Math.round(built.reduce((sum, i) => sum + i.amount, 0) * 100) / 100;
  return { built, total };
}

// POST /api/sales-orders
const createSalesOrder = asyncHandler(async (req, res) => {
  const { customerName, items, notes } = req.body;
  const { built, total } = await buildItems(items);

  const year = new Date().getFullYear();
  const seq = await Counter.next(`SO-${year}`);
  const number = `SO-${year}-${String(seq).padStart(4, '0')}`;

  const order = await SalesOrder.create({
    number,
    customerName,
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

  res.status(201).json({ success: true, message: `Sales order ${number} created`, data: order });
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
      .populate('createdBy', 'name'),
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

  const { customerName, items, notes } = req.body;
  const { built, total } = await buildItems(items);
  order.customerName = customerName;
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

  res.json({ success: true, message: `Sales order ${order.number} updated`, data: order });
});

// PUT /api/sales-orders/:id/status
const updateStatus = asyncHandler(async (req, res) => {
  const order = await SalesOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Sales order not found');
  if (!canManage(req.user, order)) throw ApiError.forbidden('You can only update your own orders');

  const { status } = req.body;
  if (order.status === status) {
    return res.json({ success: true, message: 'No change', data: order });
  }
  order.status = status;
  await order.save();

  await logActivity({
    userId: req.user._id,
    action: 'SALES_ORDER_STATUS',
    entity: 'SalesOrder',
    entityId: order._id,
    details: `Sales order ${order.number} marked ${status}`,
    ip: req.ip,
  });

  res.json({ success: true, message: `Order marked ${status}`, data: order });
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
  const order = await SalesOrder.findById(req.params.id).populate('createdBy', 'name phone');
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

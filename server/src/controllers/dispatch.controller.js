const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const SalesOrder = require('../models/SalesOrder');
const { applyTransition, announce, dispatchLabel } = require('../services/orderPipeline.service');
const { withDocumentRefs, populatePipeline } = require('./salesOrder.controller');
const { getPagination, buildMeta } = require('../utils/pagination');
const { logActivity } = require('../services/activity.service');
const { searchRegex } = require('../utils/sanitize');
const { istDayStart } = require('../utils/istDate');

/**
 * The dispatch desk. An order reaches this queue only once its Tally invoice
 * has been matched — goods leave against an invoice, never against a CRM
 * order — and leaves it when dispatch records how the consignment went.
 * Delivery itself is confirmed by the booking exec, who is the one talking
 * to the customer.
 */

const STAGES = {
  // The queue: invoiced and waiting to go, oldest invoice first.
  pending: { filter: { status: 'invoiced' }, sort: { invoicedAt: 1, createdAt: 1 } },
  // Gone, not yet confirmed delivered.
  dispatched: { filter: { status: 'dispatched' }, sort: { dispatchedAt: -1 } },
  // Confirmed delivered by the exec (feedback may still be pending).
  delivered: {
    filter: { status: { $in: ['delivered', 'closed'] }, dispatchedAt: { $ne: null } },
    sort: { deliveredAt: -1 },
  },
};

// GET /api/dispatch/queue?stage=pending|dispatched|delivered&search=&page=&limit=
const listQueue = asyncHandler(async (req, res) => {
  const stage = Object.hasOwn(STAGES, req.query.stage) ? req.query.stage : 'pending';
  const { page, limit, skip } = getPagination(req.query);
  const filter = { ...STAGES[stage].filter };
  if (req.query.search) {
    const rx = searchRegex(req.query.search);
    filter.$or = [
      { number: rx },
      { customerName: rx },
      { 'invoices.voucherNumber': rx },
      { 'dispatch.docketNumber': rx },
      { 'dispatch.vehicleNumber': rx },
    ];
  }

  const [orders, total, counts] = await Promise.all([
    SalesOrder.find(filter)
      .sort(STAGES[stage].sort)
      .skip(skip)
      .limit(limit)
      .populate('createdBy', 'name phone')
      .populate('customer', 'companyName gstin email mobile address')
      .populate('dispatch.filledBy', 'name')
      .populate('delivery.markedBy', 'name'),
    SalesOrder.countDocuments(filter),
    Promise.all(
      Object.entries(STAGES).map(async ([key, def]) => [key, await SalesOrder.countDocuments(def.filter)])
    ),
  ]);

  res.json({
    success: true,
    data: orders,
    meta: { ...buildMeta(total, page, limit), stage, counts: Object.fromEntries(counts) },
  });
});

// POST /api/dispatch/:id — how the goods went. Moves invoiced → dispatched;
// on an order already dispatched it corrects the details without moving it.
// An admin may also dispatch a confirmed order whose invoice the push has not
// brought back yet; the invoice still attaches when it arrives.
const recordDispatch = asyncHandler(async (req, res) => {
  const order = await withDocumentRefs(SalesOrder.findById(req.params.id));
  if (!order) throw ApiError.notFound('Sales order not found');

  const correcting = order.status === 'dispatched';
  const adminEarly = req.user.role === 'admin' && order.status === 'confirmed';
  if (order.status !== 'invoiced' && !correcting && !adminEarly) {
    const why = {
      open: 'has not been confirmed by sales yet',
      confirmed: 'has not been invoiced in Tally yet — accounts must key the invoice (with the order number on it) first',
      delivered: 'has already been delivered',
      closed: 'is already complete',
      cancelled: 'is cancelled',
    }[order.status];
    throw ApiError.badRequest(`Sales order ${order.number} ${why || `is ${order.status}`}`);
  }

  const b = req.body;
  order.dispatch = {
    mode: b.mode,
    carrier: b.carrier || '',
    docketNumber: b.docketNumber || '',
    vehicleNumber: b.vehicleNumber || '',
    driverName: b.driverName || '',
    driverPhone: b.driverPhone || '',
    packages: b.packages ?? null,
    weightKg: b.weightKg ?? null,
    ewayBill: b.ewayBill || '',
    dispatchedOn: b.dispatchedOn ? istDayStart(b.dispatchedOn) : order.dispatch?.dispatchedOn || new Date(),
    expectedDeliveryOn: b.expectedDeliveryOn ? istDayStart(b.expectedDeliveryOn) : null,
    remarks: b.remarks || '',
    filledBy: req.user._id,
    filledAt: new Date(),
  };

  let previousStatus = order.status;
  if (correcting) {
    order.history.push({
      from: order.status,
      to: order.status,
      by: req.user._id,
      note: `Dispatch details updated — ${dispatchLabel(order.dispatch)}`,
    });
  } else {
    previousStatus = applyTransition(order, 'dispatched', {
      user: req.user,
      note: dispatchLabel(order.dispatch) + (adminEarly ? ' (dispatched before the Tally invoice was matched)' : ''),
    });
  }
  await order.save();
  await populatePipeline(order);

  await logActivity({
    userId: req.user._id,
    action: correcting ? 'SALES_ORDER_DISPATCH_UPDATED' : 'SALES_ORDER_STATUS',
    entity: 'SalesOrder',
    entityId: order._id,
    meta: correcting ? {} : { status: 'dispatched', from: previousStatus },
    details: correcting
      ? `Dispatch details updated on ${order.number} — ${dispatchLabel(order.dispatch)}`
      : `Sales order ${order.number} marked dispatched — ${dispatchLabel(order.dispatch)}`,
    ip: req.ip,
  });
  if (!correcting) announce(order, req.user);

  res.json({
    success: true,
    message: correcting ? `Dispatch details on ${order.number} updated` : `${order.number} marked dispatched`,
    data: order,
  });
});

module.exports = { listQueue, recordDispatch };

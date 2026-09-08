const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const SalesOrder = require('../models/SalesOrder');
const StockSyncLog = require('../models/StockSyncLog');
const { linkInvoiceManually, announce, paymentLabel } = require('../services/orderPipeline.service');
const { withDocumentRefs, populatePipeline } = require('./salesOrder.controller');
const { getPagination, buildMeta } = require('../utils/pagination');
const { logActivity } = require('../services/activity.service');
const { searchRegex } = require('../utils/sanitize');
const { istDayStart } = require('../utils/istDate');

/**
 * The accounts desk's view of the pipeline. Accounts do their real work in
 * Tally — checking the payment, keying the tax invoice — so this module is a
 * queue, not a form: which confirmed orders are waiting for an invoice, with
 * the payment the exec confirmed against, and which have come back from Tally
 * matched. The one thing written here is the manual invoice link, for a
 * voucher keyed without the order number on it.
 */

const STAGES = {
  // Not yet confirmed — shown for context only; nothing to invoice yet.
  open: { filter: { status: 'open' }, sort: { createdAt: -1 } },
  // The queue: confirmed and waiting for the Tally invoice, oldest first.
  awaiting: { filter: { status: 'confirmed' }, sort: { confirmedAt: 1, createdAt: 1 } },
  // Matched from Tally (or linked by hand), newest first.
  invoiced: {
    filter: { status: { $in: ['invoiced', 'dispatched', 'delivered', 'closed'] }, invoicedAt: { $ne: null } },
    sort: { invoicedAt: -1 },
  },
};

// GET /api/invoicing/queue?stage=awaiting|invoiced|open&search=&page=&limit=
const listQueue = asyncHandler(async (req, res) => {
  const stage = Object.hasOwn(STAGES, req.query.stage) ? req.query.stage : 'awaiting';
  const { page, limit, skip } = getPagination(req.query);
  const filter = { ...STAGES[stage].filter };
  if (req.query.search) {
    const rx = searchRegex(req.query.search);
    filter.$or = [{ number: rx }, { customerName: rx }, { 'invoices.voucherNumber': rx }, { 'payment.reference': rx }];
  }

  const [orders, total, counts, lastSync] = await Promise.all([
    SalesOrder.find(filter)
      .sort(STAGES[stage].sort)
      .skip(skip)
      .limit(limit)
      .populate('createdBy', 'name phone')
      .populate('customer', 'companyName gstin email mobile address')
      .populate('accounts.verifiedBy', 'name')
      .populate('payment.recordedBy', 'name'),
    SalesOrder.countDocuments(filter),
    Promise.all(
      Object.entries(STAGES).map(async ([key, def]) => [key, await SalesOrder.countDocuments(def.filter)])
    ),
    StockSyncLog.findOne().sort({ createdAt: -1 }).select('syncedAt invoiceCount invoicesMatched ordersInvoiced source'),
  ]);

  res.json({
    success: true,
    data: orders,
    meta: {
      ...buildMeta(total, page, limit),
      stage,
      counts: Object.fromEntries(counts),
      // Whether Tally is sending invoices at all: a push with stock but zero
      // vouchers means the old TDL is still loaded on the Tally machine.
      lastSync: lastSync
        ? {
            at: lastSync.syncedAt || lastSync.createdAt,
            invoiceCount: lastSync.invoiceCount || 0,
            invoicesMatched: lastSync.invoicesMatched || 0,
            ordersInvoiced: lastSync.ordersInvoiced || [],
            source: lastSync.source,
          }
        : null,
    },
  });
});

// POST /api/invoicing/:id/verify — accounts have checked the payment against
// the bank. Optional bookkeeping; the order does not move.
const verifyPayment = asyncHandler(async (req, res) => {
  const order = await withDocumentRefs(SalesOrder.findById(req.params.id));
  if (!order) throw ApiError.notFound('Sales order not found');
  if (order.status !== 'confirmed' && order.status !== 'invoiced') {
    throw ApiError.badRequest(
      order.status === 'open'
        ? `Sales order ${order.number} has not been confirmed yet — there is no payment to verify`
        : `Sales order ${order.number} is ${order.status}`
    );
  }
  order.accounts = { verifiedAt: new Date(), verifiedBy: req.user._id, note: req.body.note || '' };
  order.history.push({
    from: order.status,
    to: order.status,
    by: req.user._id,
    note: `Payment verified by accounts${req.body.note ? ` — ${req.body.note}` : ''}`,
  });
  await order.save();
  await populatePipeline(order);

  await logActivity({
    userId: req.user._id,
    action: 'SALES_ORDER_PAYMENT_VERIFIED',
    entity: 'SalesOrder',
    entityId: order._id,
    details: `Accounts verified payment on ${order.number} (${paymentLabel(order.payment)})${req.body.note ? ` — ${req.body.note}` : ''}`,
    ip: req.ip,
  });

  res.json({ success: true, message: `Payment on ${order.number} marked verified`, data: order });
});

// POST /api/invoicing/:id/link-invoice — the Tally voucher was keyed without
// the order number (or the push has not run yet); accounts link it by hand.
const linkInvoice = asyncHandler(async (req, res) => {
  const order = await withDocumentRefs(SalesOrder.findById(req.params.id));
  if (!order) throw ApiError.notFound('Sales order not found');
  if (order.status === 'cancelled') {
    throw ApiError.badRequest(`Sales order ${order.number} is cancelled — an admin must reinstate it before it can be invoiced`);
  }
  const { voucherNumber, date, amount, note } = req.body;
  if (order.invoices.some((i) => i.voucherNumber === voucherNumber)) {
    throw ApiError.badRequest(`Invoice ${voucherNumber} is already linked to ${order.number}`);
  }

  const from = await linkInvoiceManually(
    order,
    { voucherNumber, date: date ? istDayStart(date) : null, amount: amount ?? null, note },
    req.user
  );
  await populatePipeline(order);

  await logActivity({
    userId: req.user._id,
    action: from === order.status ? 'SALES_ORDER_INVOICE_LINKED' : 'SALES_ORDER_STATUS',
    entity: 'SalesOrder',
    entityId: order._id,
    meta: from === order.status ? { voucherNumber } : { status: 'invoiced', from, source: 'manual', voucherNumber },
    details:
      from === order.status
        ? `Linked Tally invoice ${voucherNumber} to sales order ${order.number}`
        : `Sales order ${order.number} marked invoiced — Tally invoice ${voucherNumber} linked by hand` +
          (from === 'open' ? ' (invoiced while still open — never confirmed in the CRM)' : ''),
    ip: req.ip,
  });
  if (from !== order.status) announce(order, req.user);

  res.json({
    success: true,
    message:
      from !== order.status
        ? `${order.number} marked invoiced (Tally invoice ${voucherNumber})`
        : `Invoice ${voucherNumber} linked to ${order.number}`,
    data: order,
  });
});

module.exports = { listQueue, verifyPayment, linkInvoice };

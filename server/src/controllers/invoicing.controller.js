const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const SalesOrder = require('../models/SalesOrder');
const StockSyncLog = require('../models/StockSyncLog');
const TallyInvoice = require('../models/TallyInvoice');
const { linkInvoiceManually, announce, paymentLabel } = require('../services/orderPipeline.service');
const { dayRangeContext, buildWorkbook } = require('../services/report.service');
const { withDocumentRefs, populatePipeline } = require('./salesOrder.controller');
const { getPagination, buildMeta } = require('../utils/pagination');
const { logActivity } = require('../services/activity.service');
const { searchRegex } = require('../utils/sanitize');
const { istDayStart, istDateKey } = require('../utils/istDate');

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

// ---------------------------------------------------------------------------
// The Tally sales register — every sales invoice the push has mirrored
// (models/TallyInvoice.js), laid out as Tally's own register reads: date,
// party, voucher type and number, basic value (the Sales A/c amount), GST
// with round-off, gross total, and which CRM order (if any) it settled.
// ---------------------------------------------------------------------------

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Basic value before GST when the TDL sent it, else the billed total. */
const revenueOf = (i) => (Number(i.basicValue) > 0 ? Number(i.basicValue) : Number(i.amount) || 0);
const REVENUE_EXPR = { $cond: [{ $gt: ['$basicValue', 0] }, '$basicValue', '$amount'] };

/**
 * The register's window: the dates asked for, or the current IST month —
 * the way the register is normally pulled in Tally.
 */
function registerContext(query) {
  const today = istDateKey(new Date());
  return dayRangeContext({ from: query.from || `${today.slice(0, 7)}-01`, to: query.to || today });
}

function registerFilter(query, range) {
  const filter = { date: { $gte: range.from, $lte: range.to } };
  // Invoices no CRM order claimed — keyed without the order number, or for a
  // sale that never went through the CRM.
  if (query.unmatched === 'true') filter.orders = { $size: 0 };
  if (query.search) {
    const rx = searchRegex(query.search);
    filter.$or = [{ party: rx }, { voucherNumber: rx }, { reference: rx }, { orderNumbers: rx }];
  }
  return filter;
}

const registerQuery = (filter) =>
  TallyInvoice.find(filter)
    .populate({ path: 'orders', select: 'number customerName createdBy', populate: { path: 'createdBy', select: 'name' } })
    .sort({ date: 1, voucherNumber: 1 });

async function registerTotals(filter) {
  const [t] = await TallyInvoice.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        basicValue: { $sum: REVENUE_EXPR },
        amount: { $sum: '$amount' },
        matched: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$orders', []] } }, 0] }, 1, 0] } },
      },
    },
  ]);
  return {
    count: t?.count || 0,
    matched: t?.matched || 0,
    basicValue: round2(t?.basicValue),
    // GST and round-off together: what separates the Sales A/c amount from
    // the billed total. Zero for vouchers the TDL sent without a basic value.
    other: round2((t?.amount || 0) - (t?.basicValue || 0)),
    amount: round2(t?.amount),
  };
}

const registerRow = (i) => ({
  _id: i._id,
  date: i.date,
  party: i.party,
  voucherType: i.voucherType,
  voucherNumber: i.voucherNumber,
  reference: i.reference,
  basicValue: round2(revenueOf(i)),
  basicValueKnown: Number(i.basicValue) > 0,
  gstAndRoundOff: Number(i.basicValue) > 0 ? round2(i.amount - i.basicValue) : null,
  amount: round2(i.amount),
  orders: (i.orders || []).map((o) => ({
    _id: o._id,
    number: o.number,
    customerName: o.customerName,
    bookedBy: o.createdBy?.name || '',
  })),
  orderNumbers: i.orderNumbers || [],
  narration: i.narration,
  lastSeenAt: i.lastSeenAt,
});

// GET /api/invoicing/register?from=&to=&search=&unmatched=&page=&limit=
const listRegister = asyncHandler(async (req, res) => {
  const range = registerContext(req.query);
  const filter = registerFilter(req.query, range);
  const { page, limit, skip } = getPagination(req.query);
  const [rows, totals] = await Promise.all([registerQuery(filter).skip(skip).limit(limit).lean(), registerTotals(filter)]);
  res.json({
    success: true,
    data: rows.map(registerRow),
    meta: {
      ...buildMeta(totals.count, page, limit),
      totals,
      range: { from: range.fromStr, to: range.toStr, label: range.rangeLabel },
    },
  });
});

// GET /api/invoicing/register/export?from=&to=&search=&unmatched= — the same
// rows as an Excel sheet, in the register's column order.
const exportRegister = asyncHandler(async (req, res) => {
  const range = registerContext(req.query);
  const filter = registerFilter(req.query, range);
  const [rows, totals] = await Promise.all([registerQuery(filter).lean(), registerTotals(filter)]);
  const report = {
    label: 'Sales Register (Tally)',
    rangeLabel: range.rangeLabel,
    columns: [
      { key: 'date', header: 'Date', type: 'date', width: 12 },
      { key: 'party', header: 'Particulars', width: 36 },
      { key: 'voucherType', header: 'Voucher Type', width: 13 },
      { key: 'voucherNumber', header: 'Voucher No.', width: 16 },
      { key: 'reference', header: 'Voucher Ref. No.', width: 16 },
      { key: 'basicValue', header: 'Basic Value (Sales A/c)', type: 'number', width: 22 },
      { key: 'gstAndRoundOff', header: 'GST + Round Off', type: 'number', width: 16 },
      { key: 'amount', header: 'Gross Total', type: 'number', width: 14 },
      { key: 'orderNos', header: 'CRM Order', width: 18 },
      { key: 'bookedBy', header: 'Booked By', width: 18 },
    ],
    rows: rows.map(registerRow).map((r) => ({
      ...r,
      date: r.date ? new Date(r.date) : null,
      orderNos: r.orders.length ? r.orders.map((o) => o.number).join(', ') : r.orderNumbers.join(', '),
      bookedBy: r.orders.map((o) => o.bookedBy).filter(Boolean).join(', '),
    })),
    totals: { basicValue: totals.basicValue, gstAndRoundOff: totals.other, amount: totals.amount },
  };
  const buffer = await buildWorkbook([report], { rangeLabel: range.rangeLabel }, req.user.name);
  await logActivity({
    userId: req.user._id,
    action: 'SALES_REGISTER_EXPORTED',
    entity: 'TallyInvoice',
    details: `Exported the Tally sales register (${range.rangeLabel}, ${totals.count} invoices) to Excel`,
    ip: req.ip,
  });
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="mickys-sales-register_${range.fromStr}_to_${range.toStr}.xlsx"`);
  res.send(Buffer.from(buffer));
});

module.exports = { listQueue, verifyPayment, linkInvoice, listRegister, exportRegister };

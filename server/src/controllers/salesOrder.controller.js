const mongoose = require('mongoose');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const AppointedCustomer = require('../models/AppointedCustomer');
const Counter = require('../models/Counter');
const SalesOrder = require('../models/SalesOrder');
const Setting = require('../models/Setting');
const StockItem = require('../models/StockItem');
const { GST_BASES, SUPPLY_TYPES, computeLine, computeTotals, deriveSupplyType } = require('../utils/gst');
const { renderSalesOrderPdf } = require('../services/salesOrderPdf.service');
const { sendOrderEmail } = require('../services/salesOrderEmail.service');
const {
  nameKeyOf,
  checkLineAvailability,
} = require('../services/stockAvailability.service');
const {
  RESERVING,
  applyTransition,
  refusalFor,
  announce,
  paymentLabel,
  funnel,
} = require('../services/orderPipeline.service');
const { dayRangeContext } = require('../services/report.service');
const { onCustomerOrdersChanged } = require('../services/leadScore.service');
const { getPagination, buildMeta } = require('../utils/pagination');
const { logActivity } = require('../services/activity.service');
const { searchRegex } = require('../utils/sanitize');
const { istDayPassed, istDateLabel, istDayStart } = require('../utils/istDate');

/** Admins manage every order; sales execs manage only the ones they booked. */
const canManage = (user, order) =>
  user.role === 'admin' || String(order.createdBy?._id || order.createdBy) === String(user._id);

/**
 * Everything the PDF and the emails need: the booking exec (shown on the
 * document, and the reply-to when the mail goes from the shared account) and
 * the appointed customer's full details.
 */
const withDocumentRefs = (query) =>
  query
    .populate('createdBy', 'name phone email')
    .populate('customer', 'companyName email gstin mobile address terms');

/** The detail view names everyone who touched the order along the pipeline. */
const PIPELINE_REFS = [
  'emails.sentBy',
  'history.by',
  'payment.recordedBy',
  'invoices.linkedBy',
  'dispatch.filledBy',
  'delivery.markedBy',
  'feedback.submittedBy',
];
const populatePipeline = (order) => order.populate(PIPELINE_REFS.map((path) => ({ path, select: 'name' })));

/**
 * Recomputes line amounts, GST and the totals from qty × rate under the
 * order's GST basis and supply type (utils/gst.js), enriching each line
 * with the unit and the stock position from the Tally mirror. The mirror is
 * matched on the normalised nameKey, not the raw name — an appointed
 * customer's lines carry their frozen list's UPPERCASE name and would
 * otherwise never find their item. Names absent from the mirror are still
 * allowed (stock may lag Tally); they carry no unit and no stock figures.
 *
 * `excludeOrder` is the order being re-saved: its own lines must not count
 * against its own availability, or every edit would report itself as short.
 */
async function buildItems(items, { excludeOrder, basis = 'exclusive', supplyType = 'intra' } = {}) {
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
      gst: Number(i.gst) || 0,
      ...computeLine({ qty: i.qty, rate: i.rate, gst: i.gst, basis }),
      stockQtyAtOrder: s ? s.closingQty : null,
      availableAtOrder: availableByKey.has(key) ? availableByKey.get(key) : null,
    };
  });
  const totals = computeTotals(built, { supplyType });
  return { built, totals, total: totals.total, warnings };
}

/**
 * Resolves an appointed (rate-frozen) customer when customerId is given and
 * enforces the freeze: every line must be on the frozen list, and the frozen
 * rate always wins over whatever rate the client sent.
 *
 * A lapsed validity blocks the booking outright, on create and on edit alike.
 * Refusing an order is disruptive, but far less costly than invoicing a price
 * the company stopped honouring weeks ago — the way out is one edit of the
 * customer, which re-freezes the rates against a fresh date. Customers
 * appointed before validity existed carry no date and are let through.
 */
async function applyFrozenCustomer(customerId, items) {
  if (!customerId) return null;
  const appointed = await AppointedCustomer.findById(customerId);
  if (!appointed) throw ApiError.badRequest('Appointed customer not found');
  if (appointed.validUntil && istDayPassed(appointed.validUntil)) {
    throw ApiError.badRequest(
      `${appointed.companyName}'s frozen rates expired on ${istDateLabel(appointed.validUntil)} — ` +
        'edit the customer to re-freeze the rates with a new validity date before booking this order'
    );
  }

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
    // The frozen GST rate travels with the frozen price. A list frozen before
    // GST was recorded carries none; resolveGst fills the default in then.
    it.gst = f.gst ?? null;
  }
  return appointed;
}

/**
 * The GST treatment of an order (utils/gst.js) and the rate on every line.
 * An appointed customer's frozen list dictates the basis — the rates were
 * frozen exclusive or inclusive of GST, and reading them the other way would
 * re-price the order — and the supply type follows their GSTIN. A plain
 * Tally-ledger order takes the screen's choices, else Settings' defaults.
 * The supply type stays the exec's call either way (the goods may go to a
 * branch in another state); a line with no GST rate of its own gets the
 * default rate from Settings.
 */
async function resolveGst(body, appointed, items) {
  const settings = await Setting.getGlobal();
  const so = settings.salesOrder || {};
  const asked = body.gst || {};
  const basis = appointed
    ? appointed.gstBasis || 'exclusive'
    : GST_BASES.includes(asked.basis)
      ? asked.basis
      : so.gstBasis || 'exclusive';
  const supplyType = SUPPLY_TYPES.includes(asked.supplyType)
    ? asked.supplyType
    : deriveSupplyType(appointed?.gstin, settings.company?.gstNumber);
  const defaultGst = so.defaultGst ?? 5;
  for (const it of items) {
    if (it.gst == null) it.gst = defaultGst;
  }
  return { basis, supplyType };
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

// GET /api/sales-orders/gst-defaults — what a fresh voucher starts with: the
// basis typed rates are quoted on, the GST rate a new line carries, and the
// company GSTIN the supply type is judged against.
const gstDefaults = asyncHandler(async (_req, res) => {
  const settings = await Setting.getGlobal();
  const so = settings.salesOrder || {};
  res.json({
    success: true,
    data: {
      basis: so.gstBasis || 'exclusive',
      defaultGst: so.defaultGst ?? 5,
      companyGstin: settings.company?.gstNumber || '',
    },
  });
});

// POST /api/sales-orders
const createSalesOrder = asyncHandler(async (req, res) => {
  const { customerName, customerId, items, notes } = req.body;
  const appointed = await applyFrozenCustomer(customerId, items);
  const gst = await resolveGst(req.body, appointed, items);
  const { built, totals, total, warnings } = await buildItems(items, gst);

  const year = new Date().getFullYear();
  const seq = await Counter.next(`SO-${year}`);
  const number = `SO-${year}-${String(seq).padStart(4, '0')}`;

  const order = await SalesOrder.create({
    number,
    customerName: appointed ? appointed.companyName : customerName,
    customer: appointed?._id,
    items: built,
    gst,
    ...totals,
    notes: notes || '',
    createdBy: req.user._id,
    history: [{ from: '', to: 'open', by: req.user._id, note: 'Order booked' }],
  });

  await logActivity({
    userId: req.user._id,
    action: 'SALES_ORDER_CREATED',
    entity: 'SalesOrder',
    entityId: order._id,
    details: `Created sales order ${number} for ${customerName} (${built.length} items, Rs. ${total.toLocaleString('en-IN')})`,
    ip: req.ip,
  });
  // First order = "sample order bought", every later one a repeat order on the
  // lead's score card.
  await onCustomerOrdersChanged(order.customer, req.user);

  res
    .status(201)
    .json({ success: true, message: `Sales order ${number} created`, data: withWarnings(order, warnings) });
});

// GET /api/sales-orders?search=&status=a,b&mine=&execId=&sort=&page=&limit=
// `status` takes a comma-separated list so the pipeline screen can ask for
// "everything still moving" in one call.
const listSalesOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = {};
  if (req.query.status) {
    const statuses = String(req.query.status)
      .split(',')
      .map((s) => s.trim())
      .filter((s) => SalesOrder.STATUSES.includes(s));
    if (statuses.length) filter.status = statuses.length === 1 ? statuses[0] : { $in: statuses };
  }
  if (req.query.mine === 'true') filter.createdBy = req.user._id;
  else if (req.query.execId && mongoose.isValidObjectId(req.query.execId)) filter.createdBy = req.query.execId;
  // The pipeline screen lists the orders behind a funnel drawn over a booking
  // window; the same window applies here so the rows add up to the bars.
  if (req.query.from || req.query.to) {
    const range = dayRangeContext({ from: req.query.from, to: req.query.to });
    filter.createdAt = { $gte: range.from, $lte: range.to };
  }
  if (req.query.search) {
    const rx = searchRegex(req.query.search);
    filter.$or = [{ number: rx }, { customerName: rx }, { 'invoices.voucherNumber': rx }];
  }
  const sort = req.query.sort === 'oldest' ? { createdAt: 1 } : { createdAt: -1 };

  const [orders, total] = await Promise.all([
    SalesOrder.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('createdBy', 'name')
      // The customer's email and mobile ride along so the row's "email to
      // customer" and "send on WhatsApp" actions can prefill without fetching
      // the order first.
      .populate('customer', 'companyName email mobile'),
    SalesOrder.countDocuments(filter),
  ]);
  res.json({ success: true, data: orders, meta: buildMeta(total, page, limit) });
});

// GET /api/sales-orders/:id
const getSalesOrder = asyncHandler(async (req, res) => {
  const order = await withDocumentRefs(SalesOrder.findById(req.params.id));
  if (!order) throw ApiError.notFound('Sales order not found');
  await populatePipeline(order);
  res.json({ success: true, data: order });
});

// PUT /api/sales-orders/:id — full re-edit, only while the order is open
const updateSalesOrder = asyncHandler(async (req, res) => {
  const order = await SalesOrder.findById(req.params.id);
  if (!order) throw ApiError.notFound('Sales order not found');
  if (!canManage(req.user, order)) throw ApiError.forbidden('You can only edit your own orders');
  // Confirming is what locks an order: once it is agreed with the customer the
  // booking stands until an admin deliberately re-opens it.
  if (order.status !== 'open') {
    throw ApiError.badRequest(
      order.status === 'confirmed'
        ? `Sales order ${order.number} is confirmed and locked — an admin must re-open it before it can be edited`
        : `Only open orders can be edited — this one is ${order.status}`
    );
  }

  const { customerName, customerId, items, notes } = req.body;
  const previousCustomer = order.customer;
  // An edit that leaves customerId out is not permission to drop the freeze:
  // the dialog clears its frozen-customer selection the moment the typed name
  // differs by a character, and taking that at face value would re-price an
  // appointed customer's own order outside their frozen list and past their
  // validity date. The order keeps the customer it was booked for unless a
  // different name is actually typed over it.
  const keepsBookedCustomer =
    !customerId &&
    order.customer &&
    String(customerName || '').trim().toUpperCase() === order.customerName;
  const appointed = await applyFrozenCustomer(
    customerId || (keepsBookedCustomer ? order.customer : null),
    items
  );
  const gst = await resolveGst(req.body, appointed, items);
  const { built, totals, warnings } = await buildItems(items, { ...gst, excludeOrder: order._id });
  order.customerName = appointed ? appointed.companyName : customerName;
  order.customer = appointed?._id || undefined;
  order.items = built;
  order.gst = gst;
  Object.assign(order, totals);
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
  // Re-score the lead(s) involved when the order changed hands.
  if (String(previousCustomer || '') !== String(order.customer || '')) {
    await onCustomerOrdersChanged(previousCustomer, req.user);
    await onCustomerOrdersChanged(order.customer, req.user);
  }

  res.json({
    success: true,
    message: `Sales order ${order.number} updated`,
    data: withWarnings(order, warnings),
  });
});

/**
 * Records one send on the order's history. The same shape covers both
 * audiences and both outcomes, because the question the screen has to answer —
 * "did this order reach anyone, and when" — is the same either way.
 */
const recordEmail = (order, { kind, to, cc = [], subject, sentBy, messageId = '', error = '' }) => {
  order.emails.push({
    kind,
    to,
    cc,
    subject,
    sentAt: new Date(),
    sentBy,
    messageId,
    status: error ? 'failed' : 'sent',
    error,
  });
};

/**
 * Gives the accounts-email claim back, so a send that genuinely failed can go
 * out on the next confirmation instead of being mistaken for one already made.
 * Mutates the order — the caller saves once, after this returns.
 */
async function releaseAccountsClaim(order) {
  order.accountsEmailedAt = null;
  await SalesOrder.updateOne({ _id: order._id }, { $set: { accountsEmailedAt: null } }).catch(
    (err) => console.error(`[sales-order] could not release accounts claim for ${order.number}: ${err.message}`)
  );
}

/**
 * Mails the confirmed order to the accounts desk, when Settings asks for it.
 *
 * NOTHING HERE MAY THROW. Confirming is the business action; the email is a
 * side effect, and an SMTP outage must not undo an order the exec has agreed
 * with the customer. The outcome is returned so the client can say plainly
 * that the mail did not go, and it is written to the order's history either
 * way. Mutates the order — the caller saves once, after this returns.
 *
 * Returns null when nothing was attempted, otherwise { sent, to, reason }.
 */
async function emailAccountsOnConfirm(order, user) {
  let recipients = [];
  let claimed = false;
  try {
    const settings = await Setting.getGlobal();
    const cfg = settings.salesOrder || {};
    recipients = (cfg.accountsEmails || []).filter(Boolean);
    if (!cfg.emailAccountsOnConfirm || !recipients.length) return null;
    // Confirming twice over must not mail twice. The flag only reaches the
    // database with the rest of the order — long after the send — so the claim
    // is staked there first: two confirmations overlapping the send window
    // would otherwise each read a blank flag off their own copy of the order
    // and both mail accounts. It is cleared whenever the order leaves
    // confirmed, so a re-opened, edited and re-confirmed order does go again.
    const stamp = new Date();
    const won = await SalesOrder.findOneAndUpdate(
      { _id: order._id, accountsEmailedAt: null },
      { $set: { accountsEmailedAt: stamp } }
    );
    // Losing the race leaves the field untouched on this copy, so the caller's
    // save cannot wipe the stamp the winning request wrote.
    if (!won) return { sent: false, to: recipients, reason: 'already-sent' };
    claimed = true;
    order.accountsEmailedAt = stamp;

    const result = await sendOrderEmail(order, {
      kind: 'accounts',
      to: recipients,
      exec: order.createdBy,
      actingUser: user,
    });
    if (result.skipped) {
      const reason =
        result.reason === 'disabled'
          ? 'Email sending is disabled in Settings.'
          : 'No email account is available. Link your official mailbox under Email settings (user menu), or ask an admin to configure the company account.';
      recordEmail(order, {
        kind: 'accounts', to: recipients, subject: result.subject || '', sentBy: user._id, error: reason,
      });
      await releaseAccountsClaim(order);
      return { sent: false, to: recipients, reason };
    }

    recordEmail(order, {
      kind: 'accounts',
      to: recipients,
      subject: result.subject,
      sentBy: user._id,
      messageId: result.messageId || '',
    });
    return { sent: true, to: recipients };
  } catch (err) {
    console.error(`[sales-order] accounts email failed for ${order.number}: ${err.message}`);
    recordEmail(order, {
      kind: 'accounts', to: recipients, subject: '', sentBy: user._id, error: err.message,
    });
    if (claimed) await releaseAccountsClaim(order);
    return { sent: false, to: recipients, reason: err.message };
  }
}

/** A stage move's audit row; the reports read confirmation and close dates off it. */
const logStatus = (req, order, from, extraMeta = {}, extraDetails = '') =>
  logActivity({
    userId: req.user._id,
    action: 'SALES_ORDER_STATUS',
    entity: 'SalesOrder',
    entityId: order._id,
    // The order document records its own stamps, but the reports also read
    // the trail — keep the status in meta, not only in the prose
    // (services/salesReport.service.js).
    meta: { status: order.status, from, ...extraMeta },
    details: `Sales order ${order.number} marked ${order.status}${extraDetails}`,
    ip: req.ip,
  });

// PUT /api/sales-orders/:id/status — body { status, note?, payment? }
//
// The plain status move. Confirming is the booking exec's step and carries
// the payment they confirmed against; dispatching, delivering and feedback
// have their own endpoints with their own forms; invoicing is written by the
// Tally push. Anything backwards, or out of a locked status, is an admin's
// call — see orderPipeline.service.refusalFor.
const updateStatus = asyncHandler(async (req, res) => {
  const order = await withDocumentRefs(SalesOrder.findById(req.params.id));
  if (!order) throw ApiError.notFound('Sales order not found');

  const { status, note, payment } = req.body;
  if (order.status === status) {
    return res.json({ success: true, message: 'No change', data: withWarnings(order, []) });
  }
  const refusal = refusalFor(req.user, order, status);
  if (refusal) throw ApiError.forbidden(refusal);

  // Confirming means the money (or the credit approval) is in hand — that is
  // what accounts will invoice against, so it is recorded here, not remembered.
  if (status === 'confirmed') {
    if (payment?.mode) {
      order.payment = {
        mode: payment.mode,
        amount: payment.amount ?? null,
        reference: payment.reference || '',
        receivedOn: payment.receivedOn ? istDayStart(payment.receivedOn) : null,
        notes: payment.notes || '',
        recordedBy: req.user._id,
        recordedAt: new Date(),
      };
    } else if (!order.payment?.mode) {
      throw ApiError.badRequest(
        `Record how ${order.customerName} paid before confirming ${order.number} — confirming tells accounts the payment (or credit approval) is in hand`
      );
    }
  }

  const wasReserving = RESERVING.has(order.status);
  const previousStatus = applyTransition(order, status, {
    user: req.user,
    note: note || (status === 'confirmed' ? `Payment: ${paymentLabel(order.payment)}` : ''),
  });

  // Re-taking a released reservation happens days later, against stock that
  // has moved since — the one transition that can book a shortfall nobody
  // sees. Confirming an open order holds the same goods it already held.
  const warnings =
    RESERVING.has(status) && !wasReserving
      ? (await checkLineAvailability(order.items, { excludeOrder: order._id })).warnings
      : [];

  const accountsEmail = status === 'confirmed' ? await emailAccountsOnConfirm(order, req.user) : null;

  await order.save();
  await populatePipeline(order);

  await logStatus(
    req,
    order,
    previousStatus,
    status === 'confirmed' ? { payment: order.payment?.mode } : {},
    (status === 'confirmed' ? ` — payment ${paymentLabel(order.payment)}` : '') +
      (note ? ` — ${note}` : '') +
      (!accountsEmail || accountsEmail.reason === 'already-sent'
        ? ''
        : accountsEmail.sent
          ? ` — accounts emailed (${accountsEmail.to.join(', ')})`
          : ` — accounts email NOT sent: ${accountsEmail.reason}`)
  );
  announce(order, req.user);
  // Cancelling (or un-cancelling) changes what counts as an order on the
  // lead's score card.
  if (status === 'cancelled' || previousStatus === 'cancelled') {
    await onCustomerOrdersChanged(order.customer?._id || order.customer, req.user);
  }

  res.json({
    success: true,
    message: `Order marked ${status}`,
    data: { ...withWarnings(order, warnings), accountsEmail },
  });
});

// POST /api/sales-orders/:id/deliver — the booking exec confirms the customer
// has the goods. Normally from dispatched; an admin may also close the loop on
// an invoiced order that went out without dispatch filling their form.
const deliverOrder = asyncHandler(async (req, res) => {
  const order = await withDocumentRefs(SalesOrder.findById(req.params.id));
  if (!order) throw ApiError.notFound('Sales order not found');
  if (!canManage(req.user, order)) {
    throw ApiError.forbidden('Only the executive who booked this order (or an admin) can mark it delivered');
  }
  const adminShortcut = req.user.role === 'admin' && order.status === 'invoiced';
  if (order.status !== 'dispatched' && !adminShortcut) {
    throw ApiError.badRequest(
      order.status === 'delivered' || order.status === 'closed'
        ? `Sales order ${order.number} is already ${order.status}`
        : `Sales order ${order.number} is ${order.status} — it can be marked delivered once dispatch has sent it`
    );
  }

  const { deliveredOn, receivedBy, remarks } = req.body;
  order.delivery = {
    deliveredOn: deliveredOn ? istDayStart(deliveredOn) : new Date(),
    receivedBy: receivedBy || '',
    remarks: remarks || '',
    markedBy: req.user._id,
    markedAt: new Date(),
  };
  const previousStatus = applyTransition(order, 'delivered', {
    user: req.user,
    note:
      `Received by ${receivedBy || 'the customer'}` +
      (remarks ? ` — ${remarks}` : '') +
      (adminShortcut ? ' (delivered without a dispatch record)' : ''),
  });
  await order.save();
  await populatePipeline(order);

  await logStatus(req, order, previousStatus, {}, ` — received by ${receivedBy || 'the customer'}`);
  announce(order, req.user);

  res.json({ success: true, message: `${order.number} marked delivered`, data: order });
});

// POST /api/sales-orders/:id/feedback — the customer's feedback, collected by
// the booking exec. Completes the order: delivered → closed. A closed order
// takes a corrected form too, without moving.
const submitFeedback = asyncHandler(async (req, res) => {
  const order = await withDocumentRefs(SalesOrder.findById(req.params.id));
  if (!order) throw ApiError.notFound('Sales order not found');
  if (!canManage(req.user, order)) {
    throw ApiError.forbidden('Only the executive who booked this order (or an admin) can record its feedback');
  }
  if (order.status !== 'delivered' && order.status !== 'closed') {
    throw ApiError.badRequest(
      `Sales order ${order.number} is ${order.status} — feedback is collected once the order is delivered`
    );
  }

  const { rating, quality, delivery, packaging, wouldReorder, comments } = req.body;
  const resubmitted = Boolean(order.feedback?.submittedAt);
  order.feedback = {
    rating,
    quality: quality ?? null,
    delivery: delivery ?? null,
    packaging: packaging ?? null,
    wouldReorder: wouldReorder ?? null,
    comments: comments || '',
    submittedBy: req.user._id,
    submittedAt: new Date(),
  };

  const summary = `${rating}/5${wouldReorder === true ? ', would reorder' : wouldReorder === false ? ', would NOT reorder' : ''}`;
  if (order.status === 'delivered') {
    const previousStatus = applyTransition(order, 'closed', {
      user: req.user,
      note: `Feedback ${summary}${comments ? ` — ${comments.slice(0, 160)}` : ''}`,
    });
    await order.save();
    await logStatus(req, order, previousStatus, { feedback: rating }, ` — feedback ${summary}`);
  } else {
    order.history.push({
      from: order.status,
      to: order.status,
      by: req.user._id,
      note: `Feedback ${resubmitted ? 'updated' : 'recorded'} ${summary}`,
    });
    await order.save();
    await logActivity({
      userId: req.user._id,
      action: 'SALES_ORDER_FEEDBACK',
      entity: 'SalesOrder',
      entityId: order._id,
      meta: { rating },
      details: `Feedback ${resubmitted ? 'updated' : 'recorded'} on sales order ${order.number}: ${summary}`,
      ip: req.ip,
    });
  }
  await populatePipeline(order);
  // Order feedback counts as "feedback taken" on the lead's score card.
  await onCustomerOrdersChanged(order.customer?._id || order.customer, req.user);

  res.json({
    success: true,
    message: order.status === 'closed' && !resubmitted ? `Feedback saved — ${order.number} is complete` : 'Feedback saved',
    data: order,
  });
});

// GET /api/sales-orders/funnel?from=&to=&execId=&mine=
// No dates means the whole order book — a funnel that only saw the last
// thirty days would hide precisely the old orders still stuck in it.
const orderFunnel = asyncHandler(async (req, res) => {
  const { from, to, execId, mine } = req.query;
  const range = from || to ? dayRangeContext({ from, to, execId }) : null;
  if (execId && !mongoose.isValidObjectId(execId)) throw ApiError.badRequest('Invalid executive filter');
  const data = await funnel({
    from: range?.from,
    to: range?.to,
    execId: execId || null,
    mine: mine === 'true' ? req.user._id : null,
  });
  res.json({
    success: true,
    data: {
      ...data,
      range: range ? { from: range.fromStr, to: range.toStr, label: range.rangeLabel } : null,
    },
  });
});

// POST /api/sales-orders/:id/email — send the order PDF to the customer
const emailSalesOrder = asyncHandler(async (req, res) => {
  const order = await withDocumentRefs(SalesOrder.findById(req.params.id));
  if (!order) throw ApiError.notFound('Sales order not found');
  if (!canManage(req.user, order)) throw ApiError.forbidden('You can only email your own orders');
  if (order.status === 'cancelled') {
    throw ApiError.badRequest(`Sales order ${order.number} is cancelled and cannot be emailed`);
  }

  // Only an appointed customer has an address on file; an order booked against
  // a free-typed Tally ledger name has nowhere to send to until one is typed.
  const to = String(req.body.to || order.customer?.email || '').trim();
  if (!to) {
    throw ApiError.badRequest(
      `${order.customerName} has no email address on file — type the recipient address to send this order`
    );
  }
  const cc = String(req.body.cc || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);

  let result;
  try {
    result = await sendOrderEmail(order, {
      kind: 'customer',
      to: [to],
      cc,
      subject: req.body.subject,
      message: req.body.message,
      exec: order.createdBy,
      actingUser: req.user, // their linked mailbox (if any) becomes the sender
    });
  } catch (err) {
    // A refused send is still part of this order's history — the exec needs to
    // see the attempt as well as the error toast.
    recordEmail(order, {
      kind: 'customer', to: [to], cc, subject: req.body.subject || '', sentBy: req.user._id, error: err.message,
    });
    await order.save();
    throw err;
  }

  if (result.skipped) {
    const reason =
      result.reason === 'disabled'
        ? 'Email sending is disabled in Settings.'
        : 'No email account is available. Link your official mailbox under Email settings (user menu), or ask an admin to configure the company account.';
    recordEmail(order, {
      kind: 'customer', to: [to], cc, subject: result.subject || '', sentBy: req.user._id, error: reason,
    });
    await order.save();
    throw ApiError.badRequest(reason);
  }

  recordEmail(order, {
    kind: 'customer',
    to: [to],
    cc,
    subject: result.subject,
    sentBy: req.user._id,
    messageId: result.messageId || '',
  });
  await order.save();
  await order.populate('emails.sentBy', 'name');

  await logActivity({
    userId: req.user._id,
    action: 'SALES_ORDER_EMAILED',
    entity: 'SalesOrder',
    entityId: order._id,
    details: `Emailed sales order ${order.number} to ${to}${cc.length ? ` (cc ${cc.join(', ')})` : ''}`,
    ip: req.ip,
  });

  res.json({ success: true, message: `Sales order ${order.number} emailed to ${to}`, data: order });
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
  await onCustomerOrdersChanged(order.customer, req.user);

  res.json({ success: true, message: `Sales order ${order.number} deleted` });
});

// GET /api/sales-orders/:id/pdf
const salesOrderPdf = asyncHandler(async (req, res) => {
  const order = await withDocumentRefs(SalesOrder.findById(req.params.id));
  if (!order) throw ApiError.notFound('Sales order not found');

  const buffer = await renderSalesOrderPdf(order, order.createdBy);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${order.number}.pdf"`);
  res.send(buffer);
});

module.exports = {
  gstDefaults,
  createSalesOrder,
  listSalesOrders,
  getSalesOrder,
  updateSalesOrder,
  updateStatus,
  deliverOrder,
  submitFeedback,
  orderFunnel,
  deleteSalesOrder,
  salesOrderPdf,
  emailSalesOrder,
  withDocumentRefs,
  populatePipeline,
};

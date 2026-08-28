const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const AppointedCustomer = require('../models/AppointedCustomer');
const Counter = require('../models/Counter');
const SalesOrder = require('../models/SalesOrder');
const Setting = require('../models/Setting');
const StockItem = require('../models/StockItem');
const { renderSalesOrderPdf } = require('../services/salesOrderPdf.service');
const { sendOrderEmail } = require('../services/salesOrderEmail.service');
const {
  nameKeyOf,
  checkLineAvailability,
} = require('../services/stockAvailability.service');
const { getPagination, buildMeta } = require('../utils/pagination');
const { logActivity } = require('../services/activity.service');
const { searchRegex } = require('../utils/sanitize');
const { istDayPassed, istDateLabel } = require('../utils/istDate');

/** Admins manage every order; sales execs manage only the ones they booked. */
const canManage = (user, order) =>
  user.role === 'admin' || String(order.createdBy?._id || order.createdBy) === String(user._id);

/** Statuses that hold stock back — see services/stockAvailability.service.js. */
const RESERVING = new Set(['open', 'confirmed']);

/** Statuses an order is locked in once it reaches them — see models/SalesOrder.js. */
const LOCKED = new Set(['confirmed', 'closed', 'cancelled']);

/**
 * Ending a confirmed order is still the booking exec's to do: closing it once
 * the goods have gone, or cancelling it, settles the order rather than
 * reversing what was agreed. Every other move out of a locked status is an
 * admin's call.
 */
const isExecEnding = (from, to) => from === 'confirmed' && (to === 'closed' || to === 'cancelled');

/**
 * Everything the PDF and the emails need: the booking exec (shown on the
 * document, and the reply-to when the mail goes from the shared account) and
 * the appointed customer's full details.
 */
const withDocumentRefs = (query) =>
  query
    .populate('createdBy', 'name phone email')
    .populate('customer', 'companyName email gstin mobile address terms');

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
  const order = await withDocumentRefs(SalesOrder.findById(req.params.id)).populate(
    'emails.sentBy',
    'name'
  );
  if (!order) throw ApiError.notFound('Sales order not found');
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

// PUT /api/sales-orders/:id/status
const updateStatus = asyncHandler(async (req, res) => {
  const order = await withDocumentRefs(SalesOrder.findById(req.params.id));
  if (!order) throw ApiError.notFound('Sales order not found');
  if (!canManage(req.user, order)) throw ApiError.forbidden('You can only update your own orders');

  const { status } = req.body;
  if (order.status === status) {
    return res.json({ success: true, message: 'No change', data: withWarnings(order, []) });
  }
  // An exec who could un-confirm at will would make the confirmation lock
  // decorative — reversing an agreed order is an admin's call. The rule is
  // about the locked status the order sits in, not about one hop out of it:
  // guarding only confirmed → open would leave confirmed → closed → open as a
  // way straight round it, and un-cancelling would put a written-off order back
  // into edit and back onto the stock the same way.
  if (LOCKED.has(order.status) && !isExecEnding(order.status, status) && req.user.role !== 'admin') {
    throw ApiError.forbidden(
      status === 'open'
        ? `Sales order ${order.number} is ${order.status} — only an admin can re-open it for editing`
        : `Sales order ${order.number} is ${order.status} — only an admin can change it now`
    );
  }

  const previousStatus = order.status;
  const wasReserving = RESERVING.has(order.status);
  order.status = status;
  // closedAt is the clock that eventually releases the order's stock
  // reservation once Tally has had time to catch up; any move back out of
  // closed restarts it from nothing.
  order.closedAt = status === 'closed' ? new Date() : null;
  if (status !== 'confirmed') order.accountsEmailedAt = null;

  // Re-taking a released reservation happens days later, against stock that
  // has moved since — the one transition that can book a shortfall nobody
  // sees. Confirming an open order holds the same goods it already held.
  const warnings =
    RESERVING.has(status) && !wasReserving
      ? (await checkLineAvailability(order.items, { excludeOrder: order._id })).warnings
      : [];

  const accountsEmail = status === 'confirmed' ? await emailAccountsOnConfirm(order, req.user) : null;

  await order.save();
  await order.populate('emails.sentBy', 'name');

  await logActivity({
    userId: req.user._id,
    action: 'SALES_ORDER_STATUS',
    entity: 'SalesOrder',
    entityId: order._id,
    // The order document records only its own close, so this log is where the
    // reports read confirmation and cancellation dates from — keep the status
    // in meta, not only in the prose (services/salesReport.service.js).
    meta: { status, from: previousStatus },
    details:
      `Sales order ${order.number} marked ${status}` +
      (!accountsEmail || accountsEmail.reason === 'already-sent'
        ? ''
        : accountsEmail.sent
          ? ` — accounts emailed (${accountsEmail.to.join(', ')})`
          : ` — accounts email NOT sent: ${accountsEmail.reason}`),
    ip: req.ip,
  });

  res.json({
    success: true,
    message: `Order marked ${status}`,
    data: { ...withWarnings(order, warnings), accountsEmail },
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
  createSalesOrder,
  listSalesOrders,
  getSalesOrder,
  updateSalesOrder,
  updateStatus,
  deleteSalesOrder,
  salesOrderPdf,
  emailSalesOrder,
};

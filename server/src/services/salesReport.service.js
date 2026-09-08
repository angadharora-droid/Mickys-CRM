const ActivityLog = require('../models/ActivityLog');
const AppointedCustomer = require('../models/AppointedCustomer');
const SalesOrder = require('../models/SalesOrder');
const StockItem = require('../models/StockItem');
const ApiError = require('../utils/ApiError');
const { istDateKey } = require('../utils/istDate');
const { reservedByNameKey, attachAvailability, round2, round3 } = require('./stockAvailability.service');
const { dayRangeContext, buildWorkbook } = require('./report.service');

/**
 * Report engine for the Sales Order module — the same shape as the leads
 * reports in report.service.js: a registry entry per report, each with a column
 * spec and a row builder, so one definition drives the in-app preview (JSON),
 * the per-report Excel download and the all-in-one workbook.
 *
 * The date window and the Excel writer are shared with the leads engine rather
 * than reimplemented; only the queries and the columns are sales-specific.
 *
 * ROLE SCOPING. Admins see every order and may narrow to one executive; a sales
 * exec sees only the orders they booked, mirroring canManage() in
 * salesOrder.controller.js. That restriction lives in `ctx.scope` and is spread
 * into the order query itself — never applied to rows after the fact, because a
 * report that fetches everything and then hides some of it leaks through the
 * totals row the moment someone forgets a filter.
 *
 * Two reports are not order-scoped and say so on their registry entry:
 * `commitment` reads the whole order book's stock reservations and
 * `rateValidity` reads the appointed-customer list. Both are company-wide facts
 * an exec already reaches through /stock/reservations and /sales-customers, and
 * an exec who cannot see what stock is committed cannot sell. `execs` is the
 * one report gated the other way — see ADMIN_ONLY below.
 */

const STATUS_LABELS = {
  open: 'Open',
  confirmed: 'Confirmed',
  invoiced: 'Invoiced',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

const PAYMENT_LABELS = {
  upi: 'UPI', neft: 'NEFT', rtgs: 'RTGS', imps: 'IMPS', cheque: 'Cheque', cash: 'Cash', credit: 'Credit', other: 'Other',
};

const DISPATCH_LABELS = {
  courier: 'Courier', transport: 'Transport', own_vehicle: 'Own vehicle', hand_delivery: 'Hand delivery',
  customer_pickup: 'Customer pickup', other: 'Other',
};

/** Statuses that still hold stock back — see stockAvailability.service.js. */
const HOLDING = ['open', 'confirmed'];

/**
 * A cancelled order never happened, so it is left out of the sales analyses
 * (item-wise, customer-wise, day-wise value). It stays in the register, which
 * is the ledger of everything that was booked, and in the executive summary,
 * which is asked for a cancellation count.
 */
const NOT_CANCELLED = { $ne: 'cancelled' };

const yesNo = (v) => (v ? 'Yes' : 'No');

/** Whole calendar days between two instants, counted on the IST clock. */
const dayDiff = (from, to) =>
  Math.round(
    (Date.parse(`${istDateKey(to)}T00:00:00Z`) - Date.parse(`${istDateKey(from)}T00:00:00Z`)) / 86400000
  );

// ---------------------------------------------------------------------------
// Status history
//
// A sales order records only its own close (`closedAt`, and even that is
// cleared whenever it moves back out of closed). When it was confirmed or
// cancelled is not on the document at all, so the audit trail — written on
// every status change by salesOrder.controller.updateStatus — is the one place
// that knows. Reading it here keeps the reports honest without denormalising a
// timestamp onto every order.
// ---------------------------------------------------------------------------

const STATUS_ACTION = 'SALES_ORDER_STATUS';

/**
 * The status a log row records. `meta.status` is written by the controller;
 * the prose fallback covers rows logged before it was.
 */
const loggedStatus = (log) =>
  log.meta?.status ||
  (String(log.details || '').match(/\bmarked (open|confirmed|invoiced|dispatched|delivered|closed|cancelled)\b/) || [])[1] ||
  '';

/**
 * Order ids this requester may see, for the queries that cannot express the
 * scope themselves — the activity trail is keyed by order, not by exec. Every
 * run resolves the ids, an admin's whole book included, so a transition logged
 * against an order that has since been deleted is never counted: those log rows
 * outlive the order and would otherwise make an admin's day-wise counts exceed
 * anything the Order Register for the same period can account for.
 */
const scopedOrderIds = async (ctx) =>
  (await SalesOrder.find(ctx.scope).select('_id').lean()).map((o) => o._id);

/**
 * When each of the given orders last entered confirmed / closed / cancelled.
 * Scanning ascending and overwriting leaves the most recent transition, which
 * is the operative one for an order that was re-opened and confirmed again.
 */
async function statusStamps(orderIds) {
  const stamps = new Map();
  if (!orderIds.length) return stamps;

  const logs = await ActivityLog.find({
    entity: 'SalesOrder',
    action: STATUS_ACTION,
    entityId: { $in: orderIds },
  })
    .select('entityId details meta timestamp')
    .sort({ timestamp: 1 })
    .lean();

  for (const log of logs) {
    const status = loggedStatus(log);
    if (!status) continue;
    const id = String(log.entityId);
    if (!stamps.has(id)) stamps.set(id, {});
    stamps.get(id)[status] = new Date(log.timestamp);
  }
  return stamps;
}

// ---------------------------------------------------------------------------
// Row builders — each returns plain objects keyed by its report's column keys.
// Date values stay as Date objects; the JSON layer serializes them to ISO and
// the Excel layer writes them as real date cells.
// ---------------------------------------------------------------------------

const orderQuery = (ctx, extra = {}) =>
  SalesOrder.find({ ...ctx.scope, ...extra }).populate('createdBy', 'name');

async function registerRows(ctx) {
  const orders = await orderQuery(ctx, { createdAt: { $gte: ctx.from, $lte: ctx.to } })
    .select('number customerName customer items total status confirmedAt closedAt createdBy createdAt')
    .sort({ createdAt: -1 })
    .lean();

  // Orders confirmed before the document carried its own stamp are read off
  // the audit trail, as they always were.
  const stamps = await statusStamps(orders.filter((o) => !o.confirmedAt).map((o) => o._id));

  return orders.map((o) => ({
    number: o.number,
    orderDate: new Date(o.createdAt),
    customer: o.customerName,
    appointed: yesNo(o.customer),
    status: STATUS_LABELS[o.status] || o.status,
    items: (o.items || []).length,
    total: round2(o.total),
    bookedBy: o.createdBy?.name || '—',
    confirmedAt: o.confirmedAt ? new Date(o.confirmedAt) : stamps.get(String(o._id))?.confirmed || null,
    closedAt: o.closedAt ? new Date(o.closedAt) : null,
  }));
}

/** Stage stamp the order is currently sitting on. */
const STAGE_STAMP = {
  confirmed: 'confirmedAt',
  invoiced: 'invoicedAt',
  dispatched: 'dispatchedAt',
  delivered: 'deliveredAt',
  closed: 'closedAt',
  cancelled: 'cancelledAt',
};

/**
 * Every order booked in the period with the date it reached each stage and
 * the days each hand-over took — booking to payment, payment to invoice,
 * invoice to dispatch, dispatch to delivery. The row for an order still in
 * flight shows where it is and how long it has sat there.
 */
async function fulfilmentRows(ctx) {
  const orders = await orderQuery(ctx, { createdAt: { $gte: ctx.from, $lte: ctx.to } })
    .select(
      'number customerName total status createdAt confirmedAt invoicedAt dispatchedAt deliveredAt closedAt cancelledAt ' +
        'payment invoices dispatch delivery feedback createdBy'
    )
    .sort({ createdAt: -1 })
    .lean();

  const now = new Date();
  const days = (from, to) => (from && to ? Math.max(0, dayDiff(from, to)) : null);

  return orders.map((o) => {
    const invoice = (o.invoices || [])[o.invoices?.length - 1] || null;
    const stageSince = (STAGE_STAMP[o.status] && o[STAGE_STAMP[o.status]]) || o.createdAt;
    return {
      number: o.number,
      orderDate: new Date(o.createdAt),
      customer: o.customerName,
      total: round2(o.total),
      bookedBy: o.createdBy?.name || '—',
      status: STATUS_LABELS[o.status] || o.status,
      daysInStage: Math.max(0, dayDiff(stageSince, now)),
      paymentMode: PAYMENT_LABELS[o.payment?.mode] || '',
      paymentRef: o.payment?.reference || '',
      paymentAmount: o.payment?.amount != null ? round2(o.payment.amount) : null,
      confirmedAt: o.confirmedAt ? new Date(o.confirmedAt) : null,
      invoiceNo: invoice?.voucherNumber || '',
      invoiceDate: invoice?.date ? new Date(invoice.date) : null,
      invoicedAt: o.invoicedAt ? new Date(o.invoicedAt) : null,
      dispatchMode: DISPATCH_LABELS[o.dispatch?.mode] || '',
      carrier: o.dispatch?.carrier || '',
      docket: o.dispatch?.docketNumber || '',
      dispatchedAt: o.dispatchedAt ? new Date(o.dispatchedAt) : null,
      deliveredAt: o.deliveredAt ? new Date(o.deliveredAt) : null,
      receivedBy: o.delivery?.receivedBy || '',
      feedbackAt: o.feedback?.submittedAt ? new Date(o.feedback.submittedAt) : null,
      rating: o.feedback?.rating ?? null,
      wouldReorder: o.feedback?.wouldReorder == null ? '' : yesNo(o.feedback.wouldReorder),
      daysToConfirm: days(o.createdAt, o.confirmedAt),
      daysToInvoice: days(o.confirmedAt, o.invoicedAt),
      daysToDispatch: days(o.invoicedAt, o.dispatchedAt),
      daysToDeliver: days(o.dispatchedAt, o.deliveredAt),
      daysTotal: days(o.createdAt, o.deliveredAt),
    };
  });
}

async function itemRows(ctx) {
  const orders = await SalesOrder.find({
    ...ctx.scope,
    status: NOT_CANCELLED,
    createdAt: { $gte: ctx.from, $lte: ctx.to },
  })
    .select('items')
    .lean();

  // Grouped on nameKey, never on the raw name: an appointed customer's lines
  // carry their frozen list's UPPERCASE name while a plain Tally-ledger order
  // carries Tally's mixed-case one, and grouping on the raw name would split
  // one product into two rows.
  const byKey = new Map();
  for (const o of orders) {
    for (const i of o.items || []) {
      const key = i.nameKey || i.name;
      if (!key) continue;
      if (!byKey.has(key)) {
        byKey.set(key, { name: i.name, packSize: '', baseUnits: '', qty: 0, value: 0, orders: new Set() });
      }
      const row = byKey.get(key);
      row.packSize = row.packSize || i.packSize || '';
      row.baseUnits = row.baseUnits || i.baseUnits || '';
      row.qty += Number(i.qty) || 0;
      row.value += Number(i.amount) || 0;
      row.orders.add(String(o._id));
    }
  }

  return [...byKey.values()]
    .map((r) => ({
      name: r.name,
      packSize: r.packSize,
      baseUnits: r.baseUnits,
      qty: round3(r.qty),
      value: round2(r.value),
      orders: r.orders.size,
      avgRate: r.qty ? round2(r.value / r.qty) : 0,
    }))
    .sort((a, b) => b.value - a.value);
}

async function customerRows(ctx) {
  const orders = await SalesOrder.find({
    ...ctx.scope,
    status: NOT_CANCELLED,
    createdAt: { $gte: ctx.from, $lte: ctx.to },
  })
    .select('customerName customer total createdAt')
    .lean();

  // The appointed list's own name, resolved once, so an order booked before a
  // customer was renamed still lands on that customer's row. An order whose
  // appointed customer has since been deleted keeps the name it was booked
  // with — it was still an appointed booking.
  const appointedNames = new Map(
    (await AppointedCustomer.find({ _id: { $in: orders.filter((o) => o.customer).map((o) => o.customer) } })
      .select('companyName')
      .lean()).map((c) => [String(c._id), c.companyName])
  );

  // One business, one row. The same customer can be booked through the
  // appointed picker and by typing their name into a plain order, so both
  // bookings are gathered under one name rather than split into an appointed
  // row and a free-typed one that neither adds up to the customer's figure.
  const byCustomer = new Map();
  for (const o of orders) {
    const name = (o.customer && appointedNames.get(String(o.customer))) || o.customerName;
    const key = String(name || '').trim().toUpperCase();
    if (!byCustomer.has(key)) {
      byCustomer.set(key, {
        customer: name,
        appointed: false,
        orders: 0,
        total: 0,
        firstOrder: null,
        lastOrder: null,
      });
    }
    const row = byCustomer.get(key);
    const at = new Date(o.createdAt);
    // Being appointed is a fact about the customer, not about one booking.
    if (o.customer) {
      row.appointed = true;
      row.customer = name;
    }
    row.orders += 1;
    row.total += Number(o.total) || 0;
    if (!row.firstOrder || at < row.firstOrder) row.firstOrder = at;
    if (!row.lastOrder || at > row.lastOrder) row.lastOrder = at;
  }

  return [...byCustomer.values()]
    .map((r) => ({
      ...r,
      appointed: yesNo(r.appointed),
      total: round2(r.total),
      avgOrderValue: r.orders ? round2(r.total / r.orders) : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Everything still holding stock, whenever it was booked. The period is applied
 * only when the caller actually asked for one: a three-month-old unconfirmed
 * order is precisely what a pending report exists to surface, so defaulting to
 * the last thirty days would hide the rows that matter most.
 */
async function orderBookRows(ctx) {
  const booked = ctx.explicitRange ? { createdAt: { $gte: ctx.from, $lte: ctx.to } } : {};
  const orders = await orderQuery(ctx, { status: { $in: HOLDING }, ...booked })
    .select('number customerName total status createdBy createdAt')
    .sort({ createdAt: 1 })
    .lean();

  const now = new Date();
  return orders.map((o) => ({
    number: o.number,
    orderDate: new Date(o.createdAt),
    ageDays: Math.max(0, dayDiff(o.createdAt, now)),
    customer: o.customerName,
    status: STATUS_LABELS[o.status] || o.status,
    total: round2(o.total),
    bookedBy: o.createdBy?.name || '—',
  }));
}

async function execRows(ctx) {
  const orders = await orderQuery(ctx, { createdAt: { $gte: ctx.from, $lte: ctx.to } })
    .select('total status createdBy')
    .lean();

  const byExec = new Map();
  for (const o of orders) {
    const id = String(o.createdBy?._id || 'unknown');
    if (!byExec.has(id)) {
      byExec.set(id, {
        executive: o.createdBy?.name || 'Unknown',
        orders: 0, total: 0, confirmed: 0, inTransit: 0, delivered: 0, closed: 0, cancelled: 0, openValue: 0,
      });
    }
    const s = byExec.get(id);
    const value = Number(o.total) || 0;
    s.orders += 1;
    s.total += value;
    if (o.status === 'confirmed') s.confirmed += 1;
    // Invoiced and dispatched are both "on the way to the customer".
    if (o.status === 'invoiced' || o.status === 'dispatched') s.inTransit += 1;
    if (o.status === 'delivered') s.delivered += 1;
    if (o.status === 'closed') s.closed += 1;
    if (o.status === 'cancelled') s.cancelled += 1;
    // The counts partition the orders booked, so what is left over — still
    // open, neither agreed nor written off — is the value to chase.
    if (o.status === 'open') s.openValue += value;
  }

  return [...byExec.values()]
    .map((s) => ({ ...s, total: round2(s.total), openValue: round2(s.openValue) }))
    .sort((a, b) => b.total - a.total);
}

/**
 * What the order book has committed of the Tally mirror. The reservation rule
 * is not restated here: reservedByNameKey() decides which orders hold stock and
 * attachAvailability() derives the three figures, so this report can never
 * disagree with the stock screen it sits beside.
 */
async function commitmentRows() {
  const reserved = await reservedByNameKey();
  if (!reserved.size) return [];

  const keys = [...reserved.keys()];
  const stock = await StockItem.find({ nameKey: { $in: keys } })
    .select('name nameKey baseUnits closingQty closingRate')
    .lean();

  // One mirror row per key. Tally lets "CP Nuggets" and "CP NUGGETS" coexist
  // and both normalise to one key; charging each of them the same reservation
  // would count one commitment twice in every total on the sheet.
  const byKey = new Map();
  for (const s of stock) {
    const seen = byKey.get(s.nameKey);
    if (!seen || String(s.name) < String(seen.name)) byKey.set(s.nameKey, s);
  }

  const rows = (await attachAvailability([...byKey.values()], { reserved })).map((r) => ({
    name: r.name,
    baseUnits: r.baseUnits || '',
    closingQty: round3(r.closingQty),
    reservedQty: r.reservedQty,
    availableQty: r.availableQty,
    orders: r.reservedOrders,
    reservedValue: round2(r.reservedQty * (Number(r.closingRate) || 0)),
    alert: r.availableQty < 0 ? 'Oversold' : '',
  }));

  // Reservations whose item has been renamed or deleted in Tally hold real
  // goods back but appear nowhere on the mirror, so they would vanish from a
  // commitment report built only from StockItem rows.
  for (const key of keys) {
    if (byKey.has(key)) continue;
    const r = reserved.get(key);
    rows.push({
      name: r.name,
      baseUnits: '',
      closingQty: null,
      reservedQty: r.qty,
      availableQty: null,
      orders: r.orders,
      reservedValue: 0,
      alert: 'Not in Tally',
    });
  }

  return rows.sort((a, b) => b.reservedValue - a.reservedValue || b.reservedQty - a.reservedQty);
}

async function dailyRows(ctx) {
  const [orders, ids] = await Promise.all([
    SalesOrder.find({ ...ctx.scope, createdAt: { $gte: ctx.from, $lte: ctx.to } })
      .select('total status createdAt')
      .lean(),
    scopedOrderIds(ctx),
  ]);

  const days = new Map();
  const dayOf = (key) => {
    if (!days.has(key)) {
      days.set(key, { day: key, booked: 0, value: 0, confirmed: 0, closed: 0, cancelled: 0 });
    }
    return days.get(key);
  };

  for (const o of orders) {
    const d = dayOf(istDateKey(o.createdAt));
    d.booked += 1;
    // A cancelled order was still booked that day, but it is not value the
    // business won, so it is counted without being valued.
    if (o.status !== 'cancelled') d.value += Number(o.total) || 0;
  }

  // Confirmations and cancellations are transitions, not order attributes, so
  // they are counted off the audit trail on the day they happened — an order
  // booked in June and confirmed in August belongs to August's row here.
  if (ids.length) {
    const logs = await ActivityLog.find({
      entity: 'SalesOrder',
      action: STATUS_ACTION,
      timestamp: { $gte: ctx.from, $lte: ctx.to },
      entityId: { $in: ids },
    })
      .select('entityId details meta timestamp')
      .lean();

    // One order moved to the same status twice in a day is one event.
    const seen = new Set();
    for (const log of logs) {
      const status = loggedStatus(log);
      if (status !== 'confirmed' && status !== 'closed' && status !== 'cancelled') continue;
      const key = istDateKey(log.timestamp);
      const once = `${log.entityId}|${status}|${key}`;
      if (seen.has(once)) continue;
      seen.add(once);
      dayOf(key)[status] += 1;
    }
  }

  return [...days.values()]
    .map((d) => ({ ...d, value: round2(d.value) }))
    .sort((a, b) => (a.day < b.day ? 1 : -1));
}

const EXPIRING_SOON_DAYS = 30;

/**
 * Current state of every frozen rate list. Not period-scoped — an expiry is a
 * fact about today, not about the window someone happens to be looking at.
 */
async function rateValidityRows() {
  const customers = await AppointedCustomer.find({})
    .select('companyName gstin items validUntil frozenAt')
    .lean();

  const now = new Date();
  const rows = customers.map((c) => {
    // A null validUntil is a customer appointed before validity was recorded;
    // they keep trading, and the admin needs them on this list to fix that.
    const daysLeft = c.validUntil ? dayDiff(now, c.validUntil) : null;
    const validity =
      daysLeft === null
        ? 'No validity set'
        : daysLeft < 0
          ? 'Expired'
          : daysLeft <= EXPIRING_SOON_DAYS
            ? 'Expiring soon'
            : 'Valid';
    return {
      company: c.companyName,
      gstin: c.gstin || '',
      items: (c.items || []).length,
      frozenAt: c.frozenAt ? new Date(c.frozenAt) : null,
      validUntil: c.validUntil ? new Date(c.validUntil) : null,
      validity,
      daysLeft,
    };
  });

  // Attention first: the lapsed lists that are blocking orders today, then the
  // ones about to lapse, then the grandfathered rows still waiting for a date.
  const rank = { Expired: 0, 'Expiring soon': 1, 'No validity set': 2, Valid: 3 };
  return rows.sort(
    (a, b) => rank[a.validity] - rank[b.validity] || (a.daysLeft ?? 0) - (b.daysLeft ?? 0) ||
      a.company.localeCompare(b.company)
  );
}

// ---------------------------------------------------------------------------
// Registry — the single source of truth for report types, labels and columns.
// Column `type`: string | number | date | datetime ('day' = ISO day string).
// `noTotal` marks a numeric column that must not be summed — an average, an
// age, or a count of distinct orders that recurs down the rows, where one order
// spanning six items would be counted six times; `adminOnly` keeps a report out
// of an exec's catalog entirely. `periodScoped: false` marks a report that
// describes today rather than the window — see sheetRangeLabel.
// ---------------------------------------------------------------------------

const REPORTS = {
  register: {
    label: 'Order Register',
    description: 'Every order booked in the period — customer, status, value and who booked it. The plain ledger of what was sold.',
    build: registerRows,
    totals: true,
    columns: [
      { key: 'number', header: 'Order No', width: 16 },
      { key: 'orderDate', header: 'Order Date', type: 'date', width: 13 },
      { key: 'customer', header: 'Customer', width: 30 },
      { key: 'appointed', header: 'Appointed', width: 11 },
      { key: 'status', header: 'Status', width: 12 },
      { key: 'items', header: 'Items', type: 'number', width: 8 },
      { key: 'total', header: 'Order Value', type: 'number', width: 14 },
      { key: 'bookedBy', header: 'Booked By', width: 18 },
      { key: 'confirmedAt', header: 'Confirmed At', type: 'datetime', width: 18 },
      { key: 'closedAt', header: 'Closed At', type: 'datetime', width: 18 },
    ],
  },
  items: {
    label: 'Item-wise Sales',
    description: 'Top sellers: quantity and value per item across the period’s orders, highest value first. Cancelled orders are excluded.',
    build: itemRows,
    totals: true,
    columns: [
      { key: 'name', header: 'Item', width: 34 },
      { key: 'packSize', header: 'Pack Size', width: 12 },
      { key: 'baseUnits', header: 'Unit', width: 10 },
      { key: 'qty', header: 'Qty Ordered', type: 'number', width: 13 },
      { key: 'value', header: 'Order Value', type: 'number', width: 14 },
      { key: 'orders', header: 'Orders', type: 'number', width: 9, noTotal: true },
      { key: 'avgRate', header: 'Avg Rate', type: 'number', width: 11, noTotal: true },
    ],
  },
  customers: {
    label: 'Customer-wise Sales',
    description: 'One row per customer: orders, value and average order size in the period, highest value first. Cancelled orders are excluded.',
    build: customerRows,
    totals: true,
    columns: [
      { key: 'customer', header: 'Customer', width: 32 },
      { key: 'appointed', header: 'Appointed', width: 11 },
      { key: 'orders', header: 'Orders', type: 'number', width: 9 },
      { key: 'total', header: 'Total Value', type: 'number', width: 14 },
      { key: 'avgOrderValue', header: 'Avg Order Value', type: 'number', width: 16, noTotal: true },
      { key: 'firstOrder', header: 'First Order', type: 'date', width: 13 },
      { key: 'lastOrder', header: 'Last Order', type: 'date', width: 13 },
    ],
  },
  orderBook: {
    label: 'Order Book (Pending)',
    description: 'Every order still holding stock — open or confirmed — oldest first, whenever it was booked. Set a date range to limit it to orders booked in that window.',
    build: orderBookRows,
    totals: true,
    columns: [
      { key: 'number', header: 'Order No', width: 16 },
      { key: 'orderDate', header: 'Order Date', type: 'date', width: 13 },
      { key: 'ageDays', header: 'Age (days)', type: 'number', width: 11, noTotal: true },
      { key: 'customer', header: 'Customer', width: 30 },
      { key: 'status', header: 'Status', width: 12 },
      { key: 'total', header: 'Order Value', type: 'number', width: 14 },
      { key: 'bookedBy', header: 'Booked By', width: 18 },
    ],
  },
  execs: {
    label: 'Executive Performance',
    description: 'Per-executive totals for the period: orders booked, value, where those orders stand now and the value still open.',
    build: execRows,
    totals: true,
    adminOnly: true,
    columns: [
      { key: 'executive', header: 'Executive', width: 22 },
      { key: 'orders', header: 'Orders Booked', type: 'number', width: 14 },
      { key: 'total', header: 'Total Value', type: 'number', width: 14 },
      { key: 'confirmed', header: 'Confirmed', type: 'number', width: 11 },
      { key: 'inTransit', header: 'Invoiced / Dispatched', type: 'number', width: 20 },
      { key: 'delivered', header: 'Delivered', type: 'number', width: 11 },
      { key: 'closed', header: 'Completed', type: 'number', width: 11 },
      { key: 'cancelled', header: 'Cancelled', type: 'number', width: 10 },
      { key: 'openValue', header: 'Open Value', type: 'number', width: 14 },
    ],
  },
  fulfilment: {
    label: 'Order Fulfilment',
    description: 'Every order booked in the period, stage by stage: payment, Tally invoice, dispatch, delivery and feedback, with the days each hand-over took.',
    build: fulfilmentRows,
    totals: true,
    columns: [
      { key: 'number', header: 'Order No', width: 16 },
      { key: 'orderDate', header: 'Order Date', type: 'date', width: 13 },
      { key: 'customer', header: 'Customer', width: 30 },
      { key: 'total', header: 'Order Value', type: 'number', width: 14 },
      { key: 'bookedBy', header: 'Booked By', width: 18 },
      { key: 'status', header: 'Stage', width: 12 },
      { key: 'daysInStage', header: 'Days at Stage', type: 'number', width: 13, noTotal: true },
      { key: 'paymentMode', header: 'Payment', width: 10 },
      { key: 'paymentRef', header: 'Payment Ref', width: 18 },
      { key: 'paymentAmount', header: 'Paid', type: 'number', width: 12 },
      { key: 'confirmedAt', header: 'Confirmed At', type: 'datetime', width: 18 },
      { key: 'invoiceNo', header: 'Tally Invoice', width: 14 },
      { key: 'invoiceDate', header: 'Invoice Date', type: 'date', width: 13 },
      { key: 'invoicedAt', header: 'Matched At', type: 'datetime', width: 18 },
      { key: 'dispatchMode', header: 'Dispatch Mode', width: 14 },
      { key: 'carrier', header: 'Carrier', width: 18 },
      { key: 'docket', header: 'Docket / LR', width: 16 },
      { key: 'dispatchedAt', header: 'Dispatched At', type: 'datetime', width: 18 },
      { key: 'deliveredAt', header: 'Delivered At', type: 'datetime', width: 18 },
      { key: 'receivedBy', header: 'Received By', width: 18 },
      { key: 'feedbackAt', header: 'Feedback At', type: 'datetime', width: 18 },
      { key: 'rating', header: 'Rating (5)', type: 'number', width: 10, noTotal: true },
      { key: 'wouldReorder', header: 'Reorder?', width: 10 },
      { key: 'daysToConfirm', header: 'Days to Confirm', type: 'number', width: 15, noTotal: true },
      { key: 'daysToInvoice', header: 'Days to Invoice', type: 'number', width: 15, noTotal: true },
      { key: 'daysToDispatch', header: 'Days to Dispatch', type: 'number', width: 16, noTotal: true },
      { key: 'daysToDeliver', header: 'Days to Deliver', type: 'number', width: 15, noTotal: true },
      { key: 'daysTotal', header: 'Booking to Delivery', type: 'number', width: 19, noTotal: true },
    ],
  },
  commitment: {
    label: 'Stock Commitment',
    description: 'What the order book has committed of the Tally stock: reserved against closing quantity, and what is left to sell. Current state, not period-scoped.',
    build: commitmentRows,
    totals: true,
    periodScoped: false,
    columns: [
      { key: 'name', header: 'Item', width: 34 },
      { key: 'baseUnits', header: 'Unit', width: 10 },
      { key: 'closingQty', header: 'Tally Closing', type: 'number', width: 14 },
      { key: 'reservedQty', header: 'Reserved', type: 'number', width: 11 },
      { key: 'availableQty', header: 'Available', type: 'number', width: 11 },
      { key: 'orders', header: 'Orders', type: 'number', width: 9, noTotal: true },
      { key: 'reservedValue', header: 'Reserved Value', type: 'number', width: 15 },
      { key: 'alert', header: 'Alert', width: 14 },
    ],
  },
  daily: {
    label: 'Day-wise Summary',
    description: 'One row per active day: orders booked and their value, plus the orders confirmed, closed and cancelled that day. Quiet days are omitted.',
    build: dailyRows,
    totals: true,
    columns: [
      { key: 'day', header: 'Date', type: 'day', width: 13 },
      { key: 'booked', header: 'Orders Booked', type: 'number', width: 14 },
      { key: 'value', header: 'Value Booked', type: 'number', width: 15 },
      { key: 'confirmed', header: 'Confirmed', type: 'number', width: 11 },
      { key: 'closed', header: 'Closed', type: 'number', width: 9 },
      { key: 'cancelled', header: 'Cancelled', type: 'number', width: 10 },
    ],
  },
  rateValidity: {
    label: 'Rate Freeze Validity',
    description: 'Every appointed customer’s frozen rate list and how long it may still be booked against. Expired and expiring lists come first. Current state, not period-scoped.',
    build: rateValidityRows,
    periodScoped: false,
    columns: [
      { key: 'company', header: 'Customer', width: 32 },
      { key: 'gstin', header: 'GSTIN', width: 18 },
      { key: 'items', header: 'Frozen Items', type: 'number', width: 13 },
      { key: 'frozenAt', header: 'Frozen At', type: 'date', width: 13 },
      { key: 'validUntil', header: 'Valid Until', type: 'date', width: 13 },
      { key: 'validity', header: 'Validity', width: 16 },
      { key: 'daysLeft', header: 'Days Left', type: 'number', width: 11, noTotal: true },
    ],
  },
};

const REPORT_TYPES = Object.keys(REPORTS);

/** The registry entry for a type, or null — own properties only, so a request
 * for "constructor" cannot reach up the prototype chain and crash on def.build. */
const reportDef = (type) => (Object.hasOwn(REPORTS, type) ? REPORTS[type] : null);

/**
 * Executive Performance ranks the sales team against each other, which is an
 * admin's report. An exec is refused it outright rather than handed a
 * one-row version of themselves: a league table with one entry tells them
 * nothing, and quietly rewriting a report into something else is worse than
 * saying it is not theirs to run.
 */
const mayRun = (user, def) => !def.adminOnly || user.role === 'admin';

/** Types this requester may run — drives both the picker and export-all. */
const permittedTypes = (user) => REPORT_TYPES.filter((type) => mayRun(user, REPORTS[type]));

/** Catalog for the client's report picker. */
const reportCatalog = (user) =>
  permittedTypes(user).map((type) => ({
    type,
    label: REPORTS[type].label,
    description: REPORTS[type].description,
    columns: REPORTS[type].columns.map(({ key, header, type: colType }) => ({ key, header, type: colType || 'string' })),
  }));

/**
 * Sums the numeric columns — the Total row on the sheet and in the preview.
 * Columns flagged `noTotal` are left out: an average rate or an order age adds
 * up to a number that means nothing, and printing it invites someone to read it.
 */
function totalsRow(def, rows) {
  const totals = {};
  for (const c of def.columns) {
    if (c.type !== 'number' || c.noTotal) continue;
    // Rounded to three places, not two: the same helper totals money columns
    // and quantity columns, and quantities are carried to three.
    totals[c.key] = round3(rows.reduce((sum, r) => sum + (Number(r[c.key]) || 0), 0));
  }
  return totals;
}

/**
 * Builds the query context for a sales report request. The date window and its
 * validation are shared with the leads engine; what differs is the scope, which
 * restricts by the exec who booked the order (SalesOrder.createdBy) rather than
 * by the exec a lead is assigned to.
 */
function buildContext(user, query) {
  const range = dayRangeContext(query);
  const execId = user.role === 'admin' ? query.execId : '';
  return {
    ...range,
    // The pending order book falls back to the whole outstanding book unless a
    // date range was actually asked for — see orderBookRows.
    explicitRange: Boolean(query.from || query.to),
    scope: user.role === 'admin' ? (execId ? { createdBy: execId } : {}) : { createdBy: user._id },
  };
}

/**
 * The period an exported sheet is stamped with must be the period its rows
 * obey, so a file that outlives the screen it was run from cannot be misread.
 * The two current-state reports ignore the window entirely, and the pending
 * order book run without an explicit range covers everything outstanding —
 * quoting the request's default thirty days on any of them would date rows that
 * were never filtered by it. Anything else keeps the workbook's own label.
 */
const sheetRangeLabel = (type, def, ctx) => {
  if (def.periodScoped === false) return 'Current position — all dates';
  if (type === 'orderBook' && !ctx.explicitRange) return 'All outstanding orders — any booking date';
  return null;
};

async function runReport(type, ctx, user) {
  const def = reportDef(type);
  if (!def) throw ApiError.badRequest(`Unknown report type "${type}"`);
  if (!mayRun(user, def)) {
    throw ApiError.forbidden(`${def.label} covers the whole sales team — only an admin can run it`);
  }
  const rows = await def.build(ctx);
  return {
    type,
    label: def.label,
    columns: def.columns,
    rows,
    totals: def.totals ? totalsRow(def, rows) : null,
    rangeLabel: sheetRangeLabel(type, def, ctx),
  };
}

module.exports = {
  REPORTS,
  REPORT_TYPES,
  permittedTypes,
  reportCatalog,
  buildContext,
  runReport,
  buildWorkbook,
};

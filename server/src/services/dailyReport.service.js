/**
 * Daily activity digest emailed to management every morning.
 *
 * Covers the previous IST calendar day (on 12 Aug the mail reports 11 Aug):
 * the day's sales — invoices raised in Tally (the revenue figure), orders
 * confirmed and booked in the CRM, month-to-date against the monthly target —
 * then new leads and client visits user-wise, kits generated, kits delivered,
 * and lead counts for the focus cities (Nagpur, Pune, Mumbai, Delhi). Runs
 * in-process on the API's own schedule — same pattern as the Meta sheet
 * poller and FX refresher — and records the last-sent day in Settings so a
 * Railway redeploy can neither skip a day nor send it twice.
 *
 * Configure with DAILY_REPORT_ENABLED / DAILY_REPORT_TO /
 * DAILY_REPORT_HOUR_IST / DAILY_REPORT_MINUTE_IST; admins can also fire it by
 * hand via POST /api/reports/daily-email.
 */
const env = require('../config/env');
const Lead = require('../models/Lead');
const SalesOrder = require('../models/SalesOrder');
const TallyInvoice = require('../models/TallyInvoice');
const Setting = require('../models/Setting');
require('../models/User'); // registers the ref model the populates below need
const ApiError = require('../utils/ApiError');
const { sendMail } = require('./email.service');
const { istDayKey } = require('./report.service');
const { escapeHtml, escapeRegex } = require('../utils/sanitize');

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 86400000;

const FOCUS_CITIES = ['Nagpur', 'Pune', 'Mumbai', 'Delhi'];

const KIT_TYPE_LABELS = {
  distributor: 'Distributor Kit',
  stockist: 'Stockist Kit',
  institutional: 'Institutional Kit',
  export: 'Export Kit',
  b2c: 'B2C Kit',
};

const ORDER_STATUS_LABELS = {
  open: 'Open', confirmed: 'Confirmed', invoiced: 'Invoiced', dispatched: 'Dispatched',
  delivered: 'Delivered', closed: 'Completed', cancelled: 'Cancelled',
};

const PAYMENT_LABELS = {
  upi: 'UPI', neft: 'NEFT', rtgs: 'RTGS', imps: 'IMPS', cheque: 'Cheque', cash: 'Cash', credit: 'Credit', other: 'Other',
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ------------------------------------------------------------- date utils ----

/** The IST calendar day (YYYY-MM-DD) that ended most recently — "yesterday". */
const yesterdayKey = () => istDayKey(new Date(Date.now() - DAY_MS));

/** Inclusive UTC bounds of one IST calendar day. */
const dayBounds = (dayKey) => ({
  from: new Date(`${dayKey}T00:00:00.000+05:30`),
  to: new Date(`${dayKey}T23:59:59.999+05:30`),
});

const prettyDay = (dayKey) =>
  new Date(`${dayKey}T12:00:00+05:30`).toLocaleDateString('en-IN', {
    weekday: 'long', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  });

const shortDay = (dayKey) =>
  new Date(`${dayKey}T12:00:00+05:30`).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  });

const istTime = (d) =>
  new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

// ------------------------------------------------------------ data digest ----

/** Groups rows by a display name, largest group first. */
function groupBy(rows, nameOf) {
  const groups = new Map();
  for (const r of rows) {
    const name = nameOf(r) || '—';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(r);
  }
  return [...groups.entries()]
    .map(([name, items]) => ({ name, items }))
    .sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
}

/** Everything the daily email reports for one IST day, as plain data. */
async function buildDailyDigest(dayKey) {
  const { from, to } = dayBounds(dayKey);
  const inDay = (d) => {
    if (!d) return false;
    const t = new Date(d).getTime();
    return t >= from.getTime() && t <= to.getTime();
  };

  const [newLeads, visitLeads, generatedLeads, deliveredLeads, cityTotals] = await Promise.all([
    Lead.find({ leadDate: { $gte: from, $lte: to } })
      .select('refNumber businessName city businessType leadSource assignedExecId createdBy leadDate')
      .populate({ path: 'assignedExecId', select: 'name' })
      .populate({ path: 'createdBy', select: 'name' })
      .sort({ createdAt: 1 })
      .lean(),
    Lead.find({ visitReports: { $elemMatch: { visitDate: { $gte: from, $lte: to } } } })
      .select('refNumber businessName city assignedExecId visitReports')
      .populate({ path: 'assignedExecId', select: 'name' })
      .populate({ path: 'visitReports.createdBy', select: 'name' })
      .lean(),
    Lead.find({ generatedAt: { $gte: from, $lte: to } })
      .select('refNumber businessName city kitType assignedExecId generatedAt')
      .populate({ path: 'assignedExecId', select: 'name' })
      .sort({ generatedAt: 1 })
      .lean(),
    Lead.find({ 'delivery.sentAt': { $gte: from, $lte: to } })
      .select('refNumber businessName city kitType assignedExecId delivery')
      .populate({ path: 'assignedExecId', select: 'name' })
      .sort({ 'delivery.sentAt': 1 })
      .lean(),
    Promise.all(
      FOCUS_CITIES.map((c) => Lead.countDocuments({ city: new RegExp(`^\\s*${escapeRegex(c)}\\s*$`, 'i') }))
    ),
  ]);

  // Flatten each lead's visit reports into one row per visit made that day.
  const visits = [];
  for (const l of visitLeads) {
    for (const v of l.visitReports || []) {
      if (!inDay(v.visitDate)) continue;
      visits.push({
        refNumber: l.refNumber,
        businessName: l.businessName,
        city: l.city,
        visitType: v.visitType === 'call' ? 'Call' : 'Field visit',
        note: v.note || '',
        loggedBy: v.createdBy?.name || l.assignedExecId?.name || '—',
      });
    }
  }

  const cityCounts = FOCUS_CITIES.map((city, i) => ({
    city,
    newCount: newLeads.filter((l) => (l.city || '').trim().toLowerCase() === city.toLowerCase()).length,
    totalCount: cityTotals[i],
  }));

  return { dayKey, newLeads, visits, generatedLeads, deliveredLeads, cityCounts, sales: await buildSalesDigest(dayKey) };
}

/**
 * The revenue an invoice counts for: its basic value before GST — the "Basic
 * Value" column of Tally's sales register, which is how the business reads
 * its sales — falling back to the billed total for vouchers sent by a TDL
 * that did not export it.
 */
const revenueOf = (inv) => (Number(inv.basicValue) > 0 ? Number(inv.basicValue) : Number(inv.amount) || 0);
const REVENUE_EXPR = { $cond: [{ $gt: ['$basicValue', 0] }, '$basicValue', '$amount'] };

/**
 * The day's sales. Revenue is what Tally invoiced that day — every sales
 * voucher the push mirrored (models/TallyInvoice.js), dated that day, whether
 * or not it carries a CRM order number — because an invoice is a sale and an
 * order is a promise. Orders confirmed and booked in the CRM are reported
 * beside it, and everything is also totalled month-to-date so the target
 * verdict has something to stand on: month-to-date invoicing against the
 * monthly target pro-rated to the day of the month.
 */
async function buildSalesDigest(dayKey) {
  const { from, to } = dayBounds(dayKey);
  const monthStart = new Date(`${dayKey.slice(0, 7)}-01T00:00:00.000+05:30`);
  const total = (rows) => ({ count: rows[0]?.count || 0, value: round2(rows[0]?.value || 0) });
  const sumStage = (match, field) =>
    SalesOrder.aggregate([{ $match: match }, { $group: { _id: null, count: { $sum: 1 }, value: { $sum: field } } }]);
  const execRef = { path: 'createdBy', select: 'name' };

  const [
    invoices, mtdInvoiced, bookedOrders, confirmedOrders, mtdBooked, mtdConfirmed,
    dispatchedCount, deliveredCount, waitingRows, invoiceFeed, settings,
  ] = await Promise.all([
    TallyInvoice.find({ date: { $gte: from, $lte: to } })
      .populate({ path: 'orders', select: 'number customerName createdBy', populate: execRef })
      .sort({ voucherNumber: 1 })
      .lean(),
    TallyInvoice.aggregate([
      { $match: { date: { $gte: monthStart, $lte: to } } },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: REVENUE_EXPR }, billed: { $sum: '$amount' } } },
    ]),
    SalesOrder.find({ createdAt: { $gte: from, $lte: to } })
      .select('number customerName total status createdBy createdAt')
      .populate(execRef)
      .sort({ createdAt: 1 })
      .lean(),
    SalesOrder.find({ confirmedAt: { $gte: from, $lte: to } })
      .select('number customerName total payment createdBy confirmedAt')
      .populate(execRef)
      .sort({ confirmedAt: 1 })
      .lean(),
    sumStage({ createdAt: { $gte: monthStart, $lte: to }, status: { $ne: 'cancelled' } }, '$total'),
    sumStage({ confirmedAt: { $gte: monthStart, $lte: to }, status: { $ne: 'cancelled' } }, '$total'),
    SalesOrder.countDocuments({ dispatchedAt: { $gte: from, $lte: to } }),
    SalesOrder.countDocuments({ deliveredAt: { $gte: from, $lte: to } }),
    SalesOrder.aggregate([
      { $match: { status: { $in: ['confirmed', 'invoiced', 'dispatched'] } } },
      { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$total' } } },
    ]),
    TallyInvoice.estimatedDocumentCount(),
    Setting.getGlobal(),
  ]);

  const invoicedValue = round2(invoices.reduce((s, i) => s + revenueOf(i), 0));
  const billedValue = round2(invoices.reduce((s, i) => s + (Number(i.amount) || 0), 0));
  const mtd = { ...total(mtdInvoiced), billed: round2(mtdInvoiced[0]?.billed || 0) };
  // True when at least one of the day's vouchers carried a basic value — i.e.
  // the figures are on the sales-register basis rather than the billed total.
  const basicValueKnown = invoices.some((i) => Number(i.basicValue) > 0);
  const target = Number(settings.salesOrder?.monthlyRevenueTarget) || 0;
  const [year, month] = dayKey.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dayOfMonth = Number(dayKey.slice(8, 10));
  const expected = target ? round2((target * dayOfMonth) / daysInMonth) : 0;

  return {
    invoices,
    invoicedValue,
    billedValue,
    basicValueKnown,
    mtd,
    target,
    expected,
    dayOfMonth,
    daysInMonth,
    pctOfTarget: target ? Math.round((mtd.value / target) * 100) : null,
    status: !target ? 'no-target' : mtd.value >= expected ? 'on-track' : 'behind',
    bookedOrders,
    bookedValue: round2(bookedOrders.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + (o.total || 0), 0)),
    confirmedOrders,
    confirmedValue: round2(confirmedOrders.reduce((s, o) => s + (o.total || 0), 0)),
    mtdBooked: total(mtdBooked),
    mtdConfirmed: total(mtdConfirmed),
    dispatchedCount,
    deliveredCount,
    waiting: Object.fromEntries(waitingRows.map((w) => [w._id, { count: w.count, value: round2(w.value) }])),
    // False until the first push with the updated TDL lands — the report then
    // says so instead of reporting a quiet day.
    invoiceFeedLive: invoiceFeed > 0,
  };
}

// ------------------------------------------------------------ html render ----

const BRAND = '#8C2424';
const S = {
  table: 'border-collapse:collapse;width:100%;font-size:13px',
  th: `background:${BRAND};color:#ffffff;text-align:left;padding:6px 8px;font-size:12px;border:1px solid ${BRAND}`,
  group: 'background:#f6ecec;color:#5a1717;font-weight:bold;padding:6px 8px;border:1px solid #e3d2d2;font-size:13px',
  td: 'padding:6px 8px;border:1px solid #e5e5e5;vertical-align:top;color:#222',
  h2: `font-size:15px;color:${BRAND};margin:26px 0 6px`,
  empty: 'color:#777;font-size:13px;margin:6px 0 0',
};

const clip = (s, n = 220) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || '');

const headerRow = (headers) => `<tr>${headers.map((h) => `<th style="${S.th}">${h}</th>`).join('')}</tr>`;
const bodyRow = (values) => `<tr>${values.map((v) => `<td style="${S.td}">${v}</td>`).join('')}</tr>`;

function plainTable(headers, rows) {
  return `<table style="${S.table}" cellpadding="0" cellspacing="0">${headerRow(headers)}${rows
    .map(bodyRow)
    .join('')}</table>`;
}

/** A table whose rows are grouped under one shaded header row per user. */
function groupedTable(headers, groups, rowCells, unit) {
  const body = groups
    .map(
      (g) =>
        `<tr><td colspan="${headers.length}" style="${S.group}">${escapeHtml(g.name)} — ${g.items.length} ${unit}${
          g.items.length === 1 ? '' : 's'
        }</td></tr>` + g.items.map((item) => bodyRow(rowCells(item))).join('')
    )
    .join('');
  return `<table style="${S.table}" cellpadding="0" cellspacing="0">${headerRow(headers)}${body}</table>`;
}

const section = (title, inner) => `<h2 style="${S.h2}">${title}</h2>${inner}`;
const emptyNote = (text) => `<p style="${S.empty}">${text}</p>`;

function statCell(label, value) {
  return `<td style="width:25%;padding:12px 8px;border:1px solid #eee;text-align:center;background:#faf7f7">
    <div style="font-size:22px;font-weight:bold;color:${BRAND}">${value}</div>
    <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.4px">${label}</div>
  </td>`;
}

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const inr0 = (n) => `₹${Math.round(Number(n || 0)).toLocaleString('en-IN')}`;
const right = (html) => `<div style="text-align:right;white-space:nowrap">${html}</div>`;
const sub = (text) => `<div style="color:#777;font-size:11px;font-weight:normal">${text}</div>`;

const chip = (text, bg, fg) =>
  `<span style="display:inline-block;padding:3px 9px;border-radius:12px;background:${bg};color:${fg};font-size:11px;font-weight:bold;letter-spacing:.3px;white-space:nowrap">● ${text}</span>`;

/** The month's verdict: invoicing so far against the target pro-rated to the day. */
function targetStatus(s) {
  if (s.status === 'no-target') return chip('NO TARGET SET', '#f1f1f1', '#666');
  const detail = sub(`${s.pctOfTarget}% of ${inr0(s.target)} · expected ${inr0(s.expected)} by day ${s.dayOfMonth} of ${s.daysInMonth}`);
  return s.status === 'on-track'
    ? chip('ON TRACK', '#e6f4ea', '#137333') + detail
    : chip('BEHIND', '#fce8e6', '#c5221f') + detail;
}

function paymentText(p) {
  if (!p?.mode) return '—';
  return [PAYMENT_LABELS[p.mode] || p.mode, p.amount != null ? inr(p.amount) : '', p.reference].filter(Boolean).join(' · ');
}

function renderSalesHtml(d) {
  const s = d.sales;
  const day = shortDay(d.dayKey);

  const kpiHtml = `<table style="${S.table}" cellpadding="0" cellspacing="0">
    ${headerRow(['', `Yesterday (${day})`, 'Count', 'Month to date', 'Status'])}
    ${bodyRow([
      `<b>Invoiced revenue</b>${sub(
        s.basicValueKnown || !s.invoices.length
          ? 'basic value before GST, as in the Tally sales register'
          : 'invoice totals as billed — the loaded TDL sends no basic value'
      )}`,
      `<b style="color:#137333;font-size:14px">${inr(s.invoicedValue)}</b>${
        s.basicValueKnown ? sub(`${inr(s.billedValue)} billed with GST`) : ''
      }`,
      String(s.invoices.length),
      `<b>${inr(s.mtd.value)}</b>${sub(`${s.mtd.count} invoice${s.mtd.count === 1 ? '' : 's'}`)}`,
      targetStatus(s),
    ])}
    ${bodyRow([
      `<b>Orders confirmed</b>${sub('payment in hand, sent to accounts')}`,
      inr(s.confirmedValue),
      String(s.confirmedOrders.length),
      `${inr(s.mtdConfirmed.value)}${sub(`${s.mtdConfirmed.count} order${s.mtdConfirmed.count === 1 ? '' : 's'}`)}`,
      '',
    ])}
    ${bodyRow([
      `<b>Orders booked</b>${sub('new sales orders in the CRM')}`,
      inr(s.bookedValue),
      String(s.bookedOrders.length),
      `${inr(s.mtdBooked.value)}${sub(`${s.mtdBooked.count} order${s.mtdBooked.count === 1 ? '' : 's'}`)}`,
      '',
    ])}
  </table>`;

  const orderCell = (i) => {
    if (i.orders?.length) return i.orders.map((o) => escapeHtml(o.number)).join(', ');
    if (i.orderNumbers?.length) {
      return `<span style="color:#c5221f">${escapeHtml(i.orderNumbers.join(', '))}</span>${sub('no such order in the CRM')}`;
    }
    return '<span style="color:#999">no order no. on invoice</span>';
  };
  const invoicesHtml = s.invoices.length
    ? plainTable(
        ['Invoice', 'Party', 'CRM Order', 'Booked By', 'Basic Value', 'Invoice Total'],
        [
          ...s.invoices.map((i) => [
            escapeHtml(i.voucherNumber || '—'),
            escapeHtml(i.party || '—'),
            orderCell(i),
            escapeHtml((i.orders || []).map((o) => o.createdBy?.name).filter(Boolean).join(', ') || '—'),
            right(Number(i.basicValue) > 0 ? inr(i.basicValue) : '<span style="color:#999">—</span>'),
            right(inr(i.amount)),
          ]),
          ['<b>Total</b>', '', '', '', right(`<b>${inr(s.invoicedValue)}</b>`), right(`<b>${inr(s.billedValue)}</b>`)],
        ]
      )
    : emptyNote(
        s.invoiceFeedLive
          ? 'No sales invoices were raised in Tally.'
          : 'Tally has not sent any invoices to the CRM yet — load the updated Mickys Stock Export TDL on the Tally machine.'
      );

  const confirmedHtml = s.confirmedOrders.length
    ? plainTable(
        ['Time', 'Order', 'Customer', 'Value', 'Payment', 'Executive'],
        s.confirmedOrders.map((o) => [
          istTime(o.confirmedAt),
          escapeHtml(o.number),
          escapeHtml(o.customerName),
          right(inr(o.total)),
          escapeHtml(paymentText(o.payment)),
          escapeHtml(o.createdBy?.name || '—'),
        ])
      )
    : emptyNote('No orders were confirmed.');

  const bookedHtml = s.bookedOrders.length
    ? plainTable(
        ['Time', 'Order', 'Customer', 'Value', 'Executive', 'Status now'],
        s.bookedOrders.map((o) => [
          istTime(o.createdAt),
          escapeHtml(o.number),
          escapeHtml(o.customerName),
          right(inr(o.total)),
          escapeHtml(o.createdBy?.name || '—'),
          escapeHtml(ORDER_STATUS_LABELS[o.status] || o.status),
        ])
      )
    : emptyNote('No sales orders were booked.');

  const w = s.waiting;
  const waitingHtml = `<p style="font-size:13px;margin:8px 0 0;color:#333">
    <b>Waiting now:</b>
    ${w.confirmed?.count || 0} confirmed awaiting Tally invoice (${inr0(w.confirmed?.value)}) ·
    ${w.invoiced?.count || 0} invoiced awaiting dispatch (${inr0(w.invoiced?.value)}) ·
    ${w.dispatched?.count || 0} dispatched awaiting delivery (${inr0(w.dispatched?.value)})
    ${s.dispatchedCount || s.deliveredCount ? `· <b>${day}:</b> ${s.dispatchedCount} dispatched, ${s.deliveredCount} delivered` : ''}
  </p>`;

  return (
    section(`Sales — ${day}`, kpiHtml) +
    section('Invoices Raised in Tally', invoicesHtml) +
    section('Orders Confirmed (Payment Received)', confirmedHtml) +
    section('Orders Booked', bookedHtml + waitingHtml)
  );
}

function renderDigestHtml(d) {
  const leadGroups = groupBy(d.newLeads, (l) => l.createdBy?.name || l.assignedExecId?.name);
  const visitGroups = groupBy(d.visits, (v) => v.loggedBy);

  const newLeadsHtml = d.newLeads.length
    ? groupedTable(
        ['Ref', 'Business', 'City', 'Type', 'Source', 'Assigned To'],
        leadGroups,
        (l) => [
          escapeHtml(l.refNumber),
          escapeHtml(l.businessName),
          escapeHtml(l.city || '—'),
          escapeHtml(l.businessType || '—'),
          escapeHtml(l.leadSource || '—'),
          escapeHtml(l.assignedExecId?.name || '—'),
        ],
        'lead'
      )
    : emptyNote('No new leads were created.');

  const visitsHtml = d.visits.length
    ? groupedTable(
        ['Ref', 'Business', 'City', 'Type', 'Visit Note'],
        visitGroups,
        (v) => [
          escapeHtml(v.refNumber),
          escapeHtml(v.businessName),
          escapeHtml(v.city || '—'),
          escapeHtml(v.visitType),
          escapeHtml(clip(v.note)),
        ],
        'visit'
      )
    : emptyNote('No client visits were logged.');

  const generatedHtml = d.generatedLeads.length
    ? plainTable(
        ['Time', 'Ref', 'Business', 'City', 'Kit', 'Executive'],
        d.generatedLeads.map((l) => [
          istTime(l.generatedAt),
          escapeHtml(l.refNumber),
          escapeHtml(l.businessName),
          escapeHtml(l.city || '—'),
          escapeHtml(KIT_TYPE_LABELS[l.kitType] || '—'),
          escapeHtml(l.assignedExecId?.name || '—'),
        ])
      )
    : emptyNote('No kits were generated.');

  const deliveredHtml = d.deliveredLeads.length
    ? plainTable(
        ['Time', 'Ref', 'Business', 'Kit', 'Method', 'Delivered To', 'Executive'],
        d.deliveredLeads.map((l) => [
          istTime(l.delivery.sentAt),
          escapeHtml(l.refNumber),
          escapeHtml(l.businessName),
          escapeHtml(KIT_TYPE_LABELS[l.kitType] || '—'),
          escapeHtml(l.delivery?.method || '—'),
          escapeHtml(l.delivery?.sentTo || l.delivery?.note || '—'),
          escapeHtml(l.assignedExecId?.name || '—'),
        ])
      )
    : emptyNote('No kits were delivered.');

  const cityHtml = plainTable(
    ['City', `New Leads (${shortDay(d.dayKey)})`, 'Total Leads'],
    d.cityCounts.map((c) => [escapeHtml(c.city), String(c.newCount), String(c.totalCount)])
  );

  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:680px;margin:0 auto;color:#222">
    <div style="background:${BRAND};color:#fff;padding:16px 20px;border-radius:6px 6px 0 0">
      <div style="font-size:17px;font-weight:bold">Micky's CRM — Daily Report</div>
      <div style="font-size:13px;opacity:.9;margin-top:2px">${prettyDay(d.dayKey)}</div>
    </div>
    <div style="border:1px solid #eee;border-top:0;padding:16px 20px 24px;border-radius:0 0 6px 6px">
      <table style="border-collapse:collapse;width:100%;margin-top:4px" cellpadding="0" cellspacing="0">
      <tr>
        ${statCell('Invoiced (Tally)', inr0(d.sales.invoicedValue))}
        ${statCell('Invoices', d.sales.invoices.length)}
        ${statCell('Orders Booked', d.sales.bookedOrders.length)}
        ${statCell('Invoiced MTD', inr0(d.sales.mtd.value))}
      </tr>
      <tr>
        ${statCell('New Leads', d.newLeads.length)}
        ${statCell('Visits', d.visits.length)}
        ${statCell('Kits Generated', d.generatedLeads.length)}
        ${statCell('Kits Delivered', d.deliveredLeads.length)}
      </tr></table>
      ${renderSalesHtml(d)}
      ${section('New Leads — User wise', newLeadsHtml)}
      ${section('Visits — User wise', visitsHtml)}
      ${section('Kits Generated', generatedHtml)}
      ${section('Kits Delivered', deliveredHtml)}
      ${section('City-wise Leads', cityHtml)}
      <p style="color:#999;font-size:11px;margin:28px 0 0">
        Automated daily report from Micky's CRM · covers ${shortDay(d.dayKey)} (IST) · sent ${istTime(new Date())} IST
      </p>
    </div>
  </div>`;
}

// ----------------------------------------------------------------- sender ----

/**
 * Builds and emails the digest for one IST day (defaults: yesterday, to the
 * configured report inbox). Returns the send result plus the day's counts.
 */
async function sendDailyReport({ dayKey, to } = {}) {
  const day = dayKey || yesterdayKey();
  const { from } = dayBounds(day);
  if (Number.isNaN(from.getTime()) || istDayKey(from) !== day) {
    throw ApiError.badRequest('Not a valid calendar day — use YYYY-MM-DD');
  }

  const digest = await buildDailyDigest(day);
  const recipient = to || env.dailyReport.to;
  const result = await sendMail({
    to: recipient,
    subject: `Micky's CRM Daily Report — ${shortDay(day)}`,
    html: renderDigestHtml(digest),
    fromName: "Micky's CRM",
  });

  // A successful send of yesterday's digest to the standard inbox counts as
  // the day's scheduled send, so the morning job never mails a duplicate.
  if (!result.skipped && !to && day === yesterdayKey()) {
    const settings = await Setting.getGlobal();
    if ((settings.dailyReport?.lastSentDay || '') < day) {
      settings.set('dailyReport.lastSentDay', day);
      await settings.save();
    }
  }

  return {
    ...result,
    day,
    to: recipient,
    counts: {
      newLeads: digest.newLeads.length,
      visits: digest.visits.length,
      kitsGenerated: digest.generatedLeads.length,
      kitsDelivered: digest.deliveredLeads.length,
      invoices: digest.sales.invoices.length,
      invoiced: digest.sales.invoicedValue,
      ordersBooked: digest.sales.bookedOrders.length,
      ordersConfirmed: digest.sales.confirmedOrders.length,
    },
  };
}

// -------------------------------------------------------------- scheduler ----

let running = false;
let timer = null;

/** One guarded pass: sends yesterday's digest unless it already went out. */
async function runScheduledSend() {
  if (running) return;
  running = true;
  try {
    const day = yesterdayKey();
    const settings = await Setting.getGlobal();
    if ((settings.dailyReport?.lastSentDay || '') >= day) return; // already sent

    const result = await sendDailyReport({});
    if (result.skipped) {
      console.warn('[daily-report] skipped — email provider not configured');
      return;
    }
    const c = result.counts;
    console.log(
      `[daily-report] sent ${day} digest to ${result.to} ` +
        `(${c.invoices} invoices Rs. ${c.invoiced}, ${c.ordersBooked} orders booked, ${c.ordersConfirmed} confirmed; ` +
        `${c.newLeads} leads, ${c.visits} visits, ${c.kitsGenerated} generated, ${c.kitsDelivered} delivered)`
    );
  } catch (err) {
    // The lastSentDay guard makes retries duplicate-safe.
    console.error(`[daily-report] send failed: ${err.message} — retrying in 30 min`);
    setTimeout(runScheduledSend, 30 * 60 * 1000).unref();
  } finally {
    running = false;
  }
}

/** Milliseconds until the next HH:MM on the IST wall clock. */
function msUntilNextRun(hour, minute) {
  const sinceIstMidnight = (Date.now() + IST_OFFSET_MS) % DAY_MS;
  let wait = (hour * 60 + minute) * 60000 - sinceIstMidnight;
  if (wait <= 0) wait += DAY_MS;
  return wait;
}

function scheduleNext(hour, minute) {
  timer = setTimeout(async () => {
    await runScheduledSend();
    scheduleNext(hour, minute);
  }, msUntilNextRun(hour, minute));
  timer.unref(); // never hold the process open on its own
}

/**
 * Start the in-process daily mailer. Disable with DAILY_REPORT_ENABLED=false.
 */
function startDailyReport() {
  const { enabled, to, hourIst, minuteIst } = env.dailyReport;
  if (!enabled) {
    console.log('[daily-report] disabled (DAILY_REPORT_ENABLED=false)');
    return null;
  }

  const at = `${String(hourIst).padStart(2, '0')}:${String(minuteIst).padStart(2, '0')}`;
  console.log(`[daily-report] mailing yesterday's digest to ${to} daily at ${at} IST`);

  // Boot catch-up: a redeploy that overlapped today's send window must not
  // swallow the day — if we're past send time and it hasn't gone out, send now.
  setTimeout(() => {
    const sinceIstMidnight = (Date.now() + IST_OFFSET_MS) % DAY_MS;
    if (sinceIstMidnight >= (hourIst * 60 + minuteIst) * 60000) runScheduledSend();
  }, 20_000).unref();

  scheduleNext(hourIst, minuteIst);
  return timer;
}

function stopDailyReport() {
  if (timer) clearTimeout(timer);
  timer = null;
}

module.exports = {
  buildDailyDigest,
  renderDigestHtml,
  sendDailyReport,
  startDailyReport,
  stopDailyReport,
  yesterdayKey,
};

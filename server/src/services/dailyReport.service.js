/**
 * The morning email to management: yesterday's Day End Report.
 *
 * Covers the previous IST calendar day (on 12 Aug the mail reports 11 Aug)
 * with the same figures as the Day End Report page
 * (services/dayEndReport.service.js) — sales, collections and receivables,
 * the sales executives' KPI, the due customer list, production and its cost
 * per kg, closing stock by SKU family with expiry status, and the top 20% of
 * SKUs by stock value — plus the month-to-date invoicing verdict against the
 * monthly target in Sales Order Settings. Runs in-process on the API's own
 * schedule — same pattern as the Meta sheet poller and FX refresher — and
 * records the last-sent day in Settings so a Railway redeploy can neither
 * skip a day nor send it twice.
 *
 * The send time and recipients are set by an admin in the app
 * (Setting.dailyReport, edited under Sales Orders → Settings); the
 * DAILY_REPORT_* environment variables are the defaults behind a blank
 * setting, and DAILY_REPORT_ENABLED=false is the deploy-level kill switch.
 * Admins can also fire a day's report by hand via POST
 * /api/reports/daily-email (the "Send now" button).
 */
const env = require('../config/env');
const Setting = require('../models/Setting');
const ApiError = require('../utils/ApiError');
const { sendMail } = require('./email.service');
const { istDayKey } = require('./report.service');
const { buildDayEndReport } = require('./dayEndReport.service');
const { escapeHtml } = require('../utils/sanitize');

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 86400000;

/** The due list in the mail stops here; the rest is on the report page. */
const MAX_DUE_ROWS = 30;

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

/** A stored date (Tally's midnight-UTC calendar days included) as "06 Oct 2026". */
const dateText = (d) =>
  d
    ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
    : '—';

const istTime = (d) =>
  new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

const istDateTime = (d) => `${dateText(d)}, ${istTime(d)}`;

// ------------------------------------------------------------ html render ----

const BRAND = '#8C2424';
const S = {
  table: 'border-collapse:collapse;width:100%;font-size:13px',
  th: `background:${BRAND};color:#ffffff;text-align:left;padding:6px 8px;font-size:12px;border:1px solid ${BRAND}`,
  td: 'padding:6px 8px;border:1px solid #e5e5e5;vertical-align:top;color:#222',
  tdTotal: 'padding:6px 8px;border:1px solid #e5e5e5;vertical-align:top;color:#222;background:#faf7f7;font-weight:bold',
  h2: `font-size:15px;color:${BRAND};margin:26px 0 6px`,
  caption: 'color:#666;font-size:12px;margin:0 0 6px',
  empty: 'color:#777;font-size:13px;margin:6px 0 0',
};

const headerRow = (headers) => `<tr>${headers.map((h) => `<th style="${S.th}">${h}</th>`).join('')}</tr>`;
const bodyRow = (values, style = S.td) => `<tr>${values.map((v) => `<td style="${style}">${v}</td>`).join('')}</tr>`;

function plainTable(headers, rows, totalRow) {
  return `<table style="${S.table}" cellpadding="0" cellspacing="0">${headerRow(headers)}${rows
    .map((r) => bodyRow(r))
    .join('')}${totalRow ? bodyRow(totalRow, S.tdTotal) : ''}</table>`;
}

const section = (title, inner, caption = '') =>
  `<h2 style="${S.h2}">${title}</h2>${caption ? `<p style="${S.caption}">${caption}</p>` : ''}${inner}`;
const emptyNote = (text) => `<p style="${S.empty}">${text}</p>`;
const awaiting = (text) => emptyNote(`Not available — ${text}`);

function statCell(label, value) {
  return `<td style="width:25%;padding:12px 8px;border:1px solid #eee;text-align:center;background:#faf7f7">
    <div style="font-size:20px;font-weight:bold;color:${BRAND}">${value}</div>
    <div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:.4px">${label}</div>
  </td>`;
}

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const inr0 = (n) => `₹${Math.round(Number(n || 0)).toLocaleString('en-IN')}`;
const num = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const plural = (n, word, many = `${word}s`) => `${num(n)} ${Number(n) === 1 ? word : many}`;
const right = (html) => `<div style="text-align:right;white-space:nowrap">${html}</div>`;
const sub = (text) => `<div style="color:#777;font-size:11px;font-weight:normal">${text}</div>`;
const coloured = (text, colour) => `<span style="color:${colour};font-weight:bold">${text}</span>`;
const GREEN = '#137333';
const AMBER = '#b06000';
const RED = '#c5221f';
const tick = (met) => (met ? coloured('✓', GREEN) : coloured('✗', RED));

const chip = (text, bg, fg) =>
  `<span style="display:inline-block;padding:3px 9px;border-radius:12px;background:${bg};color:${fg};font-size:11px;font-weight:bold;letter-spacing:.3px;white-space:nowrap">● ${text}</span>`;

/** "₹1,23,456.00" with the count of documents under it. */
const countValue = (t, noun) => `<b>${inr(t.value)}</b>${sub(plural(t.count, noun))}`;

/**
 * The month's verdict: invoicing so far against the monthly target in Sales
 * Order Settings, pro-rated to the report day of the month.
 */
async function revenueVerdict(dayKey, mtdValue) {
  const settings = await Setting.getGlobal();
  const target = Number(settings.salesOrder?.monthlyRevenueTarget) || 0;
  if (!target) return { status: 'no-target' };
  const [year, month] = dayKey.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dayOfMonth = Number(dayKey.slice(8, 10));
  const expected = round2((target * dayOfMonth) / daysInMonth);
  return {
    status: mtdValue >= expected ? 'on-track' : 'behind',
    target,
    expected,
    dayOfMonth,
    daysInMonth,
    pctOfTarget: Math.round((mtdValue / target) * 100),
  };
}

function targetStatus(v) {
  if (v.status === 'no-target') return '';
  const detail = sub(`${v.pctOfTarget}% of ${inr0(v.target)} · expected ${inr0(v.expected)} by day ${v.dayOfMonth} of ${v.daysInMonth}`);
  return v.status === 'on-track' ? chip('ON TRACK', '#e6f4ea', GREEN) + detail : chip('BEHIND', '#fce8e6', RED) + detail;
}

/** Only CRITICAL is flagged — anything else needs no action, so it stays blank. */
function expiryChip(status, criticalItems = 0) {
  if (status !== 'critical') return '';
  return chip(criticalItems > 1 ? `CRITICAL · ${criticalItems} SKUs` : 'CRITICAL', '#fce8e6', RED);
}

function salesHtml(r, verdict) {
  const s = r.sales;
  const rec = s.receivables;
  const day = shortDay(r.date);
  const rows = [
    [
      `<b>Total Sales</b>${sub('Tally sales invoices, basic value before GST')}`,
      s.totalSales.live ? right(countValue(s.totalSales.today, 'invoice')) : 'awaiting Tally',
      s.totalSales.live ? `${right(countValue(s.totalSales.mtd, 'invoice'))}${targetStatus(verdict)}` : '',
    ],
    [
      `<b>Orders Received</b>${sub('CRM sales orders booked, incl. GST')}`,
      right(countValue(s.ordersReceived.today, 'order')),
      right(countValue(s.ordersReceived.mtd, 'order')),
    ],
    [
      `<b>Orders Dispatched</b>${sub('incl. GST')}`,
      right(countValue(s.ordersDispatched.today, 'order')),
      right(countValue(s.ordersDispatched.mtd, 'order')),
    ],
    [
      `<b>Collection Received</b>${sub('receipts credited to customer ledgers')}`,
      s.collection.live ? right(countValue(s.collection.today, 'receipt')) : 'awaiting the day-end add-on',
      s.collection.live ? right(countValue(s.collection.mtd, 'receipt')) : '',
    ],
    [
      '<b>Outstanding Receivables</b>',
      rec ? right(`<b>${inr(rec.total)}</b>${sub(plural(rec.customers, 'customer'))}`) : 'awaiting the day-end add-on',
      rec
        ? [
            rec.overdue ? `${inr(rec.overdue)} past due date` : '',
            rec.advances ? `advances ${inr(rec.advances)}` : '',
            s.receivablesAsOf ? `as on ${shortDay(s.receivablesAsOf)}` : '',
          ]
            .filter(Boolean)
            .join(' · ')
        : '',
    ],
  ];
  return plainTable(['Particular', `Yesterday (${day})`, 'Month to date / remarks'], rows);
}

function execKpiHtml(k) {
  const t = k.targets;
  if (!k.rows.length) return emptyNote('No active sales executives.');
  const rows = k.rows.map((r) => [
    escapeHtml(r.name),
    `${num(r.visits)} ${tick(r.met.visits)}`,
    `${num(r.calls)} ${tick(r.met.calls)}`,
    `${num(r.leadsMade)} / ${num(r.leadsAssigned)} ${tick(r.met.leads)}`,
  ]);
  return plainTable(
    ['Executive', `Visits (target ${t.visits})`, `Calls (target ${t.calls})`, `New leads made / assigned (target ${t.leads})`],
    rows,
    ['Total', num(k.totals.visits), num(k.totals.calls), `${num(k.totals.leadsMade)} / ${num(k.totals.leadsAssigned)}`]
  );
}

function duesHtml(d) {
  if (!d.available) return awaiting('customer balances come from the day-end add-on, which has not sent data for this day.');
  if (!d.rows.length) return emptyNote(`No customer owed anything as on ${shortDay(d.asOf)}.`);
  const shown = d.rows.slice(0, MAX_DUE_ROWS);
  const rows = shown.map((r) => [
    escapeHtml(r.name),
    right(`<b>${inr(r.amount)}</b>${r.overdue > 0 ? sub(`${inr(r.overdue)} past due`) : ''}`),
    r.oldestBillDate
      ? `${dateText(r.oldestBillDate)} · ${coloured(`${r.days} d`, r.days > 60 ? RED : r.days > 30 ? AMBER : '#444')}${sub(
          `${plural(r.bills, 'bill')} open${r.overdueDays != null ? ` · ${r.overdueDays} d past due date` : ''}`
        )}`
      : '—',
    escapeHtml(r.followUp?.status || '—'),
  ]);
  const more = d.rows.length - shown.length;
  return (
    plainTable(['Customer', 'Amount Due', 'Due Since / Days', 'Follow-up Status'], rows) +
    (more > 0 ? emptyNote(`…and ${plural(more, 'more customer')} — see the full list on the report page.`) : '')
  );
}

function productionHtml(p) {
  if (!p.live && !p.rows.length) return awaiting('production comes from the day-end add-on, which has not sent data yet.');
  if (!p.rows.length) return emptyNote('Nothing was produced or planned.');
  const rows = p.rows.map((r) => [
    `${escapeHtml(r.item)}${r.bulk ? sub('bulk cooked batch (kit)') : ''}`,
    right(r.planned != null ? `${num(r.planned)} ${escapeHtml(r.unit)}` : '—'),
    right(`${num(r.actual)} ${escapeHtml(r.unit)}${r.kg != null ? sub(`${num(r.kg)} kg`) : ''}`),
    right(
      r.achievementPct == null
        ? '—'
        : coloured(`${r.achievementPct}%`, r.achievementPct >= 100 ? GREEN : r.achievementPct >= 80 ? AMBER : RED)
    ),
  ]);
  return plainTable(['SKU', 'Planned', 'Actual', 'Achievement'], rows);
}

function costHtml(c) {
  if (!c.rows.length) return emptyNote('No production to cost.');
  const per = (r) => (r.per === 'kg' ? '/kg' : `/${escapeHtml(r.per)}`);
  const rows = c.rows.map((r) => [
    escapeHtml(r.item),
    right(r.histCost != null ? `${inr(r.histCost)}${per(r)}${r.histSource ? sub(escapeHtml(r.histSource)) : ''}` : '—'),
    right(r.todayCost != null ? `${inr(r.todayCost)}${per(r)}` : 'not valued'),
    right(
      r.variance != null
        ? coloured(`${r.variance > 0 ? '+' : r.variance < 0 ? '−' : ''}${inr(Math.abs(r.variance))}`, r.variance > 0 ? RED : GREEN) +
            sub(`${r.variancePct > 0 ? '+' : ''}${num(r.variancePct)}%`)
        : '—'
    ),
    r.ok == null ? '—' : tick(r.ok),
  ]);
  return plainTable(['SKU', 'Avg. Historical Cost', 'Yesterday’s Cost', 'Variance', 'Status'], rows);
}

/**
 * Closing stock: one line per SKU family (value and worst expiry status), then
 * only the CRITICAL SKUs — the ones needing action — never the whole list.
 */
function stockHtml(st) {
  if (!st.available) return awaiting('no closing stock has arrived from Tally for this day.');
  const groups = [...st.families, st.other].filter((g) => g && g.itemCount > 0);
  const rows = groups.map((g) => [
    `${escapeHtml(g.label)}${sub(plural(g.itemCount, 'SKU'))}`,
    right(`<b>${inr(g.value)}</b>`),
    expiryChip(g.status, g.criticalItems),
  ]);
  const familyTable = plainTable(['SKU Family', 'Closing Stock Value', 'Expiry Status'], rows, ['Total', right(inr(st.total)), '']);
  if (!st.expiry.sent) {
    return familyTable + emptyNote('Expiry status needs batch-wise stock from the day-end add-on, which has not sent it.');
  }

  const critical = groups
    .flatMap((g) => g.items.filter((i) => i.expiry?.status === 'critical').map((i) => ({ ...i, family: g.label })))
    .sort((a, b) => new Date(a.expiry.expiryDate) - new Date(b.expiry.expiryDate));
  const heading = `<p style="font-size:13px;font-weight:bold;color:#5a1717;margin:16px 0 6px">Critical SKUs — a batch expiring within ${st.expiry.warnDays} days or already expired</p>`;
  if (!critical.length) return familyTable + heading + emptyNote('No SKU is close to expiry.');
  const criticalRows = critical.map((i) => [
    `${escapeHtml(i.name)}${sub(escapeHtml([i.code, i.family].filter(Boolean).join(' · ')))}`,
    right(inr(i.value)),
    escapeHtml(i.expiry.batch || '—'),
    `${dateText(i.expiry.expiryDate)}${sub(
      i.expiry.daysLeft < 0 ? coloured(`expired ${-i.expiry.daysLeft} d ago`, RED) : coloured(`${i.expiry.daysLeft} d left`, AMBER)
    )}`,
  ]);
  return familyTable + heading + plainTable(['SKU', 'Closing Stock Value', 'Batch', 'Expiry'], criticalRows);
}

function topStockHtml(top) {
  if (!top?.rows?.length) return emptyNote('No SKU holds stock.');
  const rows = top.rows.map((i) => [
    `${escapeHtml(i.name)}${i.code ? sub(escapeHtml(i.code)) : ''}`,
    right(inr(i.value)),
    expiryChip(i.expiry?.status),
  ]);
  return (
    plainTable(['SKU', 'Closing Stock Value', 'Expiry Status'], rows, ['Total', right(inr(top.value)), '']) +
    emptyNote(`${top.count} of ${plural(top.of, 'SKU')} holding stock · ${num(top.pctOfTotal)}% of total closing stock`)
  );
}

/** Where the Tally figures stand — a stale feed is said, not hidden. */
function feedHtml(feed) {
  const parts = [
    feed.stock?.at ? `stock push ${istDateTime(feed.stock.at)}` : 'no stock push yet',
    feed.dayEnd?.at ? `day-end push ${istDateTime(feed.dayEnd.at)}` : 'day-end add-on not sending yet',
  ];
  return `<p style="color:#777;font-size:11px;margin:10px 0 0">Tally data: ${parts.join(' · ')}</p>`;
}

/** The whole mail for one day's report (services/dayEndReport.service.js buildDayEndReport). */
function renderDayEndHtml(r, verdict) {
  const s = r.sales;
  const reportUrl = `${String(env.clientUrl || '').replace(/\/$/, '')}/sales/day-end?date=${r.date}`;
  const stockCaption = r.stock.available
    ? r.stock.source === 'tally'
      ? `Tally closing stock as on ${shortDay(r.stock.asOf)}`
      : `Tally stock register for ${shortDay(r.stock.asOf)}${r.stock.settled ? '' : ' (last sync of the day)'}`
    : '';
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:720px;margin:0 auto;color:#222">
    <div style="background:${BRAND};color:#fff;padding:16px 20px;border-radius:6px 6px 0 0">
      <div style="font-size:17px;font-weight:bold">Micky’s — Day End Report</div>
      <div style="font-size:13px;opacity:.9;margin-top:2px">${prettyDay(r.date)}</div>
    </div>
    <div style="border:1px solid #eee;border-top:0;padding:16px 20px 24px;border-radius:0 0 6px 6px">
      <table style="border-collapse:collapse;width:100%;margin-top:4px" cellpadding="0" cellspacing="0"><tr>
        ${statCell('Sales (Tally)', s.totalSales.live ? inr0(s.totalSales.today.value) : '—')}
        ${statCell('Collection', s.collection.live ? inr0(s.collection.today.value) : '—')}
        ${statCell('Receivables', s.receivables ? inr0(s.receivables.total) : '—')}
        ${statCell('Closing Stock', r.stock.available ? inr0(r.stock.total) : '—')}
      </tr></table>
      ${feedHtml(r.feed)}
      ${section('Sales', salesHtml(r, verdict))}
      ${section('Sales Executive KPI', execKpiHtml(r.execKpi), 'Visits and calls from the visit reports logged that day; new leads dated that day.')}
      ${section(
        'Due Customer List',
        duesHtml(r.dues),
        r.dues.available
          ? `${plural(r.dues.rows.length, 'customer')} with a balance · as on ${shortDay(r.dues.asOf)}` +
              (r.dues.billsCaptured ? '' : ' · no bill-wise detail captured for this day')
          : ''
      )}
      ${section('Production', productionHtml(r.production))}
      ${section('Production Cost / Kg', costHtml(r.production.cost), `✗ when yesterday’s cost is more than ${num(r.production.cost.tolerancePct)}% above the average.`)}
      ${section('Closing Stock – SKU Wise', stockHtml(r.stock), stockCaption)}
      ${section('Top 20% High-Value Closing Stock', topStockHtml(r.stock.top))}
      <p style="margin:26px 0 0"><a href="${escapeHtml(reportUrl)}" style="color:${BRAND};font-weight:bold">Open the full report in the CRM →</a></p>
      <p style="color:#999;font-size:11px;margin:12px 0 0">
        Automated Day End Report from Micky’s CRM · covers ${shortDay(r.date)} (IST) · sent ${istTime(new Date())} IST
      </p>
    </div>
  </div>`;
}

// --------------------------------------------------------------- schedule ----

/**
 * The schedule in force: what the admin saved in Settings, with the
 * environment filling any blank. `enabled` needs both — the environment
 * switch is the deploy-level override, the setting is the everyday one.
 */
async function resolveSchedule() {
  const settings = await Setting.getGlobal();
  const s = settings.dailyReport || {};
  const to = (s.to || []).filter(Boolean);
  return {
    enabled: env.dailyReport.enabled && s.enabled !== false,
    envEnabled: env.dailyReport.enabled,
    to: to.length ? to : [env.dailyReport.to].filter(Boolean),
    hourIst: s.hourIst ?? env.dailyReport.hourIst,
    minuteIst: s.minuteIst ?? env.dailyReport.minuteIst,
    lastSentDay: s.lastSentDay || '',
  };
}

const hhmm = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

// ----------------------------------------------------------------- sender ----

/**
 * Builds and emails the Day End Report for one IST day (defaults: yesterday,
 * to the configured recipients). Returns the send result plus the day's
 * headline figures.
 */
async function sendDailyReport({ dayKey, to } = {}) {
  const day = dayKey || yesterdayKey();
  const { from } = dayBounds(day);
  if (Number.isNaN(from.getTime()) || istDayKey(from) !== day) {
    throw ApiError.badRequest('Not a valid calendar day — use YYYY-MM-DD');
  }

  const report = await buildDayEndReport(day);
  const verdict = await revenueVerdict(day, report.sales.totalSales.mtd.value);
  const recipient = to || (await resolveSchedule()).to;
  const result = await sendMail({
    to: recipient,
    subject: `Micky’s Day End Report — ${shortDay(day)}`,
    html: renderDayEndHtml(report, verdict),
    fromName: "Micky's CRM",
  });

  // A successful send of yesterday's report to the standard inbox counts as
  // the day's scheduled send, so the morning job never mails a duplicate.
  if (!result.skipped && !to && day === yesterdayKey()) {
    const settings = await Setting.getGlobal();
    if ((settings.dailyReport?.lastSentDay || '') < day) {
      settings.set('dailyReport.lastSentDay', day);
      await settings.save();
    }
  }

  const s = report.sales;
  return {
    ...result,
    day,
    to: [].concat(recipient).join(', '),
    counts: {
      invoices: s.totalSales.today.count,
      invoiced: s.totalSales.today.value,
      ordersReceived: s.ordersReceived.today.count,
      ordersDispatched: s.ordersDispatched.today.count,
      collection: s.collection.today.value,
      receivables: s.receivables?.total ?? null,
      dueCustomers: report.dues.rows.length,
      closingStock: report.stock.available ? report.stock.total : null,
    },
  };
}

// -------------------------------------------------------------- scheduler ----

let running = false;
let timer = null;

/** One guarded pass: sends yesterday's report unless it already went out. */
async function runScheduledSend() {
  if (running) return;
  running = true;
  try {
    const day = yesterdayKey();
    const schedule = await resolveSchedule();
    if (!schedule.enabled) return; // switched off in Settings
    if (schedule.lastSentDay >= day) return; // already sent

    const result = await sendDailyReport({});
    if (result.skipped) {
      console.warn('[daily-report] skipped — email provider not configured');
      return;
    }
    const c = result.counts;
    console.log(
      `[daily-report] sent the ${day} Day End Report to ${result.to} ` +
        `(${c.invoices} invoices Rs. ${c.invoiced}, ${c.ordersReceived} orders received, collection Rs. ${c.collection}, ` +
        `${c.dueCustomers} customers with dues)`
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

/**
 * Arms the timer for the next send at the time currently in Settings. The
 * time is re-read on every arm, so a change saved in the app takes effect
 * without a restart (rescheduleDailyReport re-arms at once). A settings read
 * that fails leaves the timer on the environment default rather than dead.
 */
async function scheduleNext() {
  let hour = env.dailyReport.hourIst;
  let minute = env.dailyReport.minuteIst;
  try {
    ({ hourIst: hour, minuteIst: minute } = await resolveSchedule());
  } catch (err) {
    console.error(`[daily-report] could not read schedule, using ${hhmm(hour, minute)} IST: ${err.message}`);
  }
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    await runScheduledSend();
    scheduleNext();
  }, msUntilNextRun(hour, minute));
  timer.unref(); // never hold the process open on its own
  return { hour, minute };
}

/** Called after an admin saves a new time — the pending timer is replaced. */
async function rescheduleDailyReport() {
  if (!env.dailyReport.enabled) return null;
  const { hour, minute } = await scheduleNext();
  const schedule = await resolveSchedule();
  console.log(
    `[daily-report] rescheduled: ${schedule.enabled ? `daily at ${hhmm(hour, minute)} IST to ${schedule.to.join(', ')}` : 'switched off in Settings'}`
  );
  // A time moved to earlier today must not skip today: if it is already past
  // and yesterday's report has not gone, send it now.
  const sinceIstMidnight = (Date.now() + IST_OFFSET_MS) % DAY_MS;
  if (schedule.enabled && sinceIstMidnight >= (hour * 60 + minute) * 60000) runScheduledSend();
  return schedule;
}

/**
 * Start the in-process daily mailer. Disable with DAILY_REPORT_ENABLED=false.
 */
function startDailyReport() {
  if (!env.dailyReport.enabled) {
    console.log('[daily-report] disabled (DAILY_REPORT_ENABLED=false)');
    return null;
  }

  // Boot catch-up: a redeploy that overlapped today's send window must not
  // swallow the day — if we're past send time and it hasn't gone out, send now.
  setTimeout(async () => {
    try {
      const { hourIst, minuteIst } = await resolveSchedule();
      const sinceIstMidnight = (Date.now() + IST_OFFSET_MS) % DAY_MS;
      if (sinceIstMidnight >= (hourIst * 60 + minuteIst) * 60000) runScheduledSend();
    } catch (err) {
      console.error(`[daily-report] boot catch-up skipped: ${err.message}`);
    }
  }, 20_000).unref();

  scheduleNext().then(async ({ hour, minute }) => {
    const schedule = await resolveSchedule().catch(() => null);
    console.log(
      `[daily-report] mailing yesterday's Day End Report daily at ${hhmm(hour, minute)} IST` +
        (schedule ? ` to ${schedule.to.join(', ')}${schedule.enabled ? '' : ' (currently switched off in Settings)'}` : '')
    );
  });
  return timer;
}

function stopDailyReport() {
  if (timer) clearTimeout(timer);
  timer = null;
}

module.exports = {
  renderDayEndHtml,
  sendDailyReport,
  resolveSchedule,
  rescheduleDailyReport,
  startDailyReport,
  stopDailyReport,
  yesterdayKey,
};

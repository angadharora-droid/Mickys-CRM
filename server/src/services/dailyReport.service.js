/**
 * Daily activity digest emailed to management every morning.
 *
 * Covers the previous IST calendar day (on 12 Aug the mail reports 11 Aug):
 * new leads and client visits user-wise, kits generated, kits delivered, and
 * lead counts for the focus cities (Nagpur, Pune, Mumbai, Delhi). Runs
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

  return { dayKey, newLeads, visits, generatedLeads, deliveredLeads, cityCounts };
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
        ['Ref', 'Business', 'City', 'Visit Note'],
        visitGroups,
        (v) => [
          escapeHtml(v.refNumber),
          escapeHtml(v.businessName),
          escapeHtml(v.city || '—'),
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
      <table style="border-collapse:collapse;width:100%;margin-top:4px" cellpadding="0" cellspacing="0"><tr>
        ${statCell('New Leads', d.newLeads.length)}
        ${statCell('Visits', d.visits.length)}
        ${statCell('Kits Generated', d.generatedLeads.length)}
        ${statCell('Kits Delivered', d.deliveredLeads.length)}
      </tr></table>
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
        `(${c.newLeads} leads, ${c.visits} visits, ${c.kitsGenerated} generated, ${c.kitsDelivered} delivered)`
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

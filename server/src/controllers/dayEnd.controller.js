const fs = require('fs');
const path = require('path');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');
const Customer = require('../models/Customer');
const StockItem = require('../models/StockItem');
const TallyReceipt = require('../models/TallyReceipt');
const TallyProduction = require('../models/TallyProduction');
const DayEndSnapshot = require('../models/DayEndSnapshot');
const ProductionPlan = require('../models/ProductionPlan');
const ReceivableFollowUp = require('../models/ReceivableFollowUp');
const {
  DAYEND_TDL_VERSION,
  HISTORY_DAYS,
  DAYEND_COMPANY,
  parseDayEndHeader,
  parseReceipts,
  parseDebtors,
  parseProduction,
  parseBatches,
  parseStockDays,
} = require('../services/tallyDayEnd.service');
const { buildDayEndReport } = require('../services/dayEndReport.service');
const { istDateKey } = require('../utils/istDate');
const { runTallyPush } = require('../utils/tallyPushQueue');

const DAY_MS = 86400000;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

const shiftKey = (key, days) => new Date(Date.parse(`${key}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * Writes the positions a push re-read from Tally as on today and each of the
 * `historyDays` days before it (TDL v2): every day's closing stock, and for
 * the earlier days each debtor's balance. A day the TDL never ran on is
 * created here. An earlier day keeps the pending bills its own pushes
 * captured — Tally cannot list bills as on a past date — now beside the
 * corrected balance; a created day has none.
 */
async function writePositionHistory({ todayKey, historyDays, debtors, stockDays, syncedAt }) {
  const keys = Array.from({ length: historyDays + 1 }, (_, k) => shiftKey(todayKey, -k));
  const existing = await DayEndSnapshot.find({ date: { $in: keys.slice(1) } }).select('date debtors').lean();
  const billsOf = new Map(existing.map((doc) => [doc.date, new Map(doc.debtors.map((d) => [d.name, d.bills || []]))]));

  await DayEndSnapshot.bulkWrite(
    keys.map((date, k) => {
      const set = {
        stock: stockDays
          .map((s) => ({ item: s.item, unit: s.unit, qty: s.days[k].qty, value: s.days[k].value }))
          .filter((r) => r.qty !== 0 || r.value !== 0),
        stockSent: true,
        positionsSyncAt: syncedAt,
      };
      if (k > 0) {
        const bills = billsOf.get(date) || new Map();
        set.debtors = debtors
          .filter((d) => d.history[k])
          .map((d) => ({ name: d.name, group: d.group, balance: d.history[k], bills: bills.get(d.name) || [] }));
      }
      return {
        updateOne: {
          filter: { date },
          update: { $set: set, $setOnInsert: { billsCaptured: false, firstSyncAt: syncedAt } },
          upsert: true,
        },
      };
    }),
    { ordered: false }
  );
  return keys;
}

/**
 * Mirrors the vouchers of one look-back window: everything the push carried
 * is upserted, and whatever the CRM holds dated inside the window but the push
 * no longer carried is removed — deleted or cancelled in Tally since. The
 * window is the TDL's look-back clipped to the Tally report period, because a
 * voucher collection only sees the period; dates outside it are left alone.
 */
async function mirrorWindow(Model, vouchers, { from, periodFrom, periodTo, today, syncedAt }) {
  if (vouchers.length) {
    await Model.bulkWrite(
      vouchers.map((v) => ({
        updateOne: {
          filter: { key: v.key },
          // $max: an older, overlapping push must never lower the stamp the
          // window delete reads (utils/tallyPushQueue.js).
          update: { $set: v, $max: { lastSeenAt: syncedAt }, $setOnInsert: { firstSeenAt: syncedAt } },
          upsert: true,
        },
      })),
      { ordered: false }
    );
  }
  if (!from || !today) return 0;
  const start = periodFrom && periodFrom > from ? periodFrom : from;
  const end = periodTo && periodTo < today ? periodTo : today;
  if (end < start) return 0;
  const gone = await Model.deleteMany({
    date: { $gte: start, $lt: new Date(end.getTime() + DAY_MS) },
    $or: [{ lastSeenAt: { $lt: syncedAt } }, { lastSeenAt: null }],
  });
  return gone.deletedCount || 0;
}

// POST /api/stock/dayend — body: the Mickys Day End Export XML (text/xml),
// pushed by mickys-dayend.tdl with the Tally sync key. Queued behind any
// other Tally push (utils/tallyPushQueue.js).
const syncDayEnd = asyncHandler((req, res) => runTallyPush(() => syncDayEndNow(req, res)));

async function syncDayEndNow(req, res) {
  const xml = typeof req.body === 'string' ? req.body : req.body?.xml;
  if (!xml || typeof xml !== 'string') throw ApiError.badRequest('No Tally XML provided');

  const head = parseDayEndHeader(xml);
  if (!head.tdlVersion && !/<(RECEIPT|DEBTOR|PRODUCTION|ITEMBATCHES|STOCKDAYS)>/.test(xml)) {
    throw ApiError.badRequest('This is not the "Mickys Day End Export" — nothing the day-end report reads was found in it');
  }
  if (head.company && !DAYEND_COMPANY.test(head.company)) {
    throw ApiError.badRequest(
      `This export is from "${head.company}" — the CRM only takes CENTRE POINT FOODS. Switch to the Mickys company in Tally and send again.`
    );
  }

  const syncedAt = new Date();
  const [customers, stock] = await Promise.all([Customer.find().select('name').lean(), StockItem.find().select('name').lean()]);
  const stockNames = new Set(stock.map((s) => s.name));
  const { historyDays } = head;
  const receipts = parseReceipts(xml, { customerNames: new Set(customers.map((c) => c.name)) });
  const production = parseProduction(xml);
  // With history the list also holds ledgers owing only on an earlier day.
  const debtors = parseDebtors(xml, { historyDays });
  const owingToday = debtors
    .filter((d) => d.balance !== 0)
    .map(({ name, group, balance, bills }) => ({ name, group, balance, bills }));
  const batchesSent = xml.includes('<ITEMBATCHES>');
  const batches = parseBatches(xml, { stockNames });
  const stockDays = historyDays ? parseStockDays(xml, { stockNames, historyDays }) : [];

  const window = { periodFrom: head.periodFrom, periodTo: head.periodTo, today: head.today, syncedAt };
  const [receiptsRemoved, productionRemoved] = await Promise.all([
    mirrorWindow(TallyReceipt, receipts, { ...window, from: head.receiptsFrom }),
    mirrorWindow(TallyProduction, production, { ...window, from: head.productionFrom }),
  ]);

  const counts = {
    receipts: receipts.length,
    production: production.length,
    debtors: owingToday.length,
    bills: owingToday.reduce((s, d) => s + d.bills.length, 0),
    batches: batches.length,
    stockItems: stockDays.length,
    historyDays,
  };
  // The day's positions: every push of the day overwrites them, so the last
  // one stands as the day's closing. Without history (a v1 copy, or one
  // served with history=0) the day carries no stock of its own and the
  // report falls back to the stock register.
  const todayKey = istDateKey(syncedAt);
  await DayEndSnapshot.updateOne(
    { date: todayKey },
    {
      $set: {
        debtors: owingToday,
        batches,
        batchesSent,
        billsCaptured: true,
        counts,
        tallyDate: head.today,
        tdlVersion: head.tdlVersion,
        lastSyncAt: syncedAt,
        ...(historyDays ? {} : { stock: [], stockSent: false }),
      },
      $setOnInsert: { firstSyncAt: syncedAt },
    },
    { upsert: true }
  );
  // Today and the 7 days before it, as Tally now has them. Dated by Tally's
  // own day, which the positions were read as on; that is today's IST day
  // unless the Tally machine's clock is off.
  const historyKeys = historyDays
    ? await writePositionHistory({
        todayKey: head.today ? head.today.toISOString().slice(0, 10) : todayKey,
        historyDays,
        debtors,
        stockDays,
        syncedAt,
      })
    : [];

  const tdlCurrent = head.tdlVersion === DAYEND_TDL_VERSION;
  const summary =
    `${counts.receipts} receipts, ${counts.debtors} customers with balances (${counts.bills} bills), ` +
    `${counts.production} production vouchers` +
    (batchesSent ? `, ${counts.batches} stock batches` : ', batches not sent') +
    (historyKeys.length
      ? `; balances and closing stock re-read for ${historyKeys[historyKeys.length - 1]} to ${historyKeys[0]}`
      : '') +
    (receiptsRemoved || productionRemoved ? `; removed ${receiptsRemoved + productionRemoved} deleted in Tally` : '');
  const tdlNote = tdlCurrent
    ? ` [day-end TDL v${DAYEND_TDL_VERSION}]`
    : ` [OLD day-end TDL ${head.tdlVersion ? `v${head.tdlVersion}` : ''} loaded - download v${DAYEND_TDL_VERSION} from the CRM, replace the file and restart Tally]`;

  if (req.tallyPush) {
    return res
      .type('text/xml')
      .send(`<RESPONSE><STATUS>1</STATUS><MESSAGE>Day end sent to Mickys CRM: ${summary}${tdlNote}</MESSAGE></RESPONSE>`);
  }
  res.json({ success: true, message: `Day end: ${summary}${tdlNote}`, data: { counts, batchesSent, tdlVersion: head.tdlVersion, tdlCurrent } });
}

// GET /api/stock/dayend/tdl?key=[&batches=0][&history=0] — the current
// day-end TDL with the sync key filled in. batches=0 leaves the batch-wise
// stock section out, history=0 the 7-day re-read of balances and closing
// stock, for a Tally release on which either misbehaves; the rest still flows.
const DAYEND_TDL_PATH = path.join(__dirname, '..', 'assets', 'mickys-dayend.tdl');
const DEBTOR_HISTORY_FIELDS = Array.from({ length: HISTORY_DAYS }, (_, i) => `, MDEDBal${i + 1}, MDEDDr${i + 1}`).join('');
const serveDayEndTdl = asyncHandler(async (req, res) => {
  if (!env.tallySyncKey) throw ApiError.badRequest('TALLY_SYNC_KEY is not configured on the server');
  const template = await fs.promises.readFile(DAYEND_TDL_PATH, 'utf8');
  const withBatches = req.query.batches !== '0';
  const withHistory = req.query.history !== '0';
  const body = template
    .replace(/\{\{TALLY_SYNC_KEY\}\}/g, env.tallySyncKey)
    .replace(/\{\{TDL_VERSION\}\}/g, DAYEND_TDL_VERSION)
    .replace(/\{\{BATCH_PART\}\}/g, withBatches ? ', MDEBatchItemPart' : '')
    .replace(/\{\{HISTORY_PART\}\}/g, withHistory ? ', MDEStockDayPart' : '')
    .replace(/\{\{HISTORY_DAYS\}\}/g, withHistory ? String(HISTORY_DAYS) : '0')
    .replace(/\{\{DEBTOR_HISTORY\}\}/g, withHistory ? DEBTOR_HISTORY_FIELDS : '')
    .replace(/\{\{DEBTOR_FILTER\}\}/g, withHistory ? 'MDEHadBalance' : 'MDEHasBalance');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="mickys-dayend.tdl"');
  res.send(body);
});

// GET /api/day-end?date=YYYY-MM-DD — the report (admin). Defaults to today (IST).
const getDayEndReport = asyncHandler(async (req, res) => {
  const today = istDateKey(new Date());
  const date = req.query.date ? String(req.query.date) : today;
  const parsed = new Date(`${date}T00:00:00Z`);
  // A real calendar day only: "2026-02-30" parses, but as 2 March.
  if (!DAY_KEY.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw ApiError.badRequest('Date must be YYYY-MM-DD');
  }
  if (date > today) throw ApiError.badRequest('The day-end report cannot be run for a future date');
  const data = await buildDayEndReport(date);
  res.json({ success: true, data });
});

// PUT /api/day-end/plan — body: { date, items: [{ item, qty }] }. Replaces the
// day's whole plan; a zero quantity drops that item.
const saveProductionPlan = asyncHandler(async (req, res) => {
  const { date, items } = req.body;
  const keep = new Map();
  for (const row of items) if (row.qty > 0) keep.set(row.item, row.qty);

  await ProductionPlan.deleteMany({ date, item: { $nin: [...keep.keys()] } });
  if (keep.size) {
    await ProductionPlan.bulkWrite(
      [...keep.entries()].map(([item, qty]) => ({
        updateOne: {
          filter: { date, item },
          update: { $set: { qty, updatedBy: req.user._id } },
          upsert: true,
        },
      })),
      { ordered: false }
    );
  }
  const data = await ProductionPlan.find({ date }).sort({ item: 1 }).lean();
  res.json({ success: true, message: `Production plan for ${date} saved`, data });
});

// PUT /api/day-end/follow-up — body: { ledger, status }. '' clears the note.
const saveFollowUp = asyncHandler(async (req, res) => {
  const { ledger, status } = req.body;
  if (!status) {
    await ReceivableFollowUp.deleteOne({ ledger });
    return res.json({ success: true, message: 'Follow-up cleared', data: null });
  }
  const doc = await ReceivableFollowUp.findOneAndUpdate(
    { ledger },
    { $set: { status, updatedBy: req.user._id } },
    { upsert: true, new: true }
  ).populate({ path: 'updatedBy', select: 'name' });
  res.json({
    success: true,
    message: 'Follow-up saved',
    data: { status: doc.status, updatedAt: doc.updatedAt, by: doc.updatedBy?.name || null },
  });
});

module.exports = { syncDayEnd, serveDayEndTdl, getDayEndReport, saveProductionPlan, saveFollowUp };

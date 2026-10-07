/**
 * The admin Day End Report for one IST day — the "MICKY'S – DAY END REPORT"
 * sheet, filled from data the CRM already holds:
 *
 *   Sales            total sales = Tally sales invoices (basic value, as the
 *                    morning email counts them); orders received / dispatched
 *                    from the CRM's own sales orders; collection received =
 *                    Tally receipts credited to customers; outstanding
 *                    receivables = Sundry Debtors balances
 *   Executive KPI    visits, calls and new leads per sales executive, against
 *                    the targets in Settings (dayEnd.targets)
 *   Due list         customers with a debit balance, their oldest pending
 *                    bill, and the follow-up note an admin keeps on them
 *   Production       items produced through stock / manufacturing journals,
 *                    against the plan an admin enters for the day
 *   Production cost  today's cost per kg against the item's 90-day production
 *                    average (Tally's own inward average until that builds up)
 *   Closing stock    Tally's closing stock as on the day (re-read for a week
 *                    by the day-end TDL), else the day-wise stock register,
 *                    by SKU family, with expiry status from batch-wise stock;
 *                    and the top 20% of SKUs by value
 *
 * Receivables and closing stock are positions, not vouchers: the day-end TDL
 * re-reads them as on each of the last 7 days on every push, so a day's
 * report takes in entries posted for it later (see dayEnd.controller).
 *
 * Tally figures arrive through two TDLs: the stock export (stock, invoices —
 * see stock.controller) and the day-end export (receipts, debtors, production,
 * batches — see dayEnd.controller). Each section says when its source has not
 * arrived yet rather than reporting zero.
 */
const Lead = require('../models/Lead');
const User = require('../models/User');
const SalesOrder = require('../models/SalesOrder');
const TallyInvoice = require('../models/TallyInvoice');
const TallyReceipt = require('../models/TallyReceipt');
const TallyProduction = require('../models/TallyProduction');
const DayEndSnapshot = require('../models/DayEndSnapshot');
const ProductionPlan = require('../models/ProductionPlan');
const ReceivableFollowUp = require('../models/ReceivableFollowUp');
const StockItem = require('../models/StockItem');
const StockSnapshot = require('../models/StockSnapshot');
const StockSyncLog = require('../models/StockSyncLog');
const Setting = require('../models/Setting');
const { SALES_VOUCHER_TYPE, TDL_VERSION } = require('./tallyStock.service');
const { DAYEND_TDL_VERSION, kgPerUnit } = require('./tallyDayEnd.service');
/**
 * The revenue an invoice counts for: its basic value before GST — the "Basic
 * Value" column of Tally's sales register, which is how the business reads
 * its sales — falling back to the billed total for vouchers sent by a TDL
 * that did not export it.
 */
const REVENUE_EXPR = { $cond: [{ $gt: ['$basicValue', 0] }, '$basicValue', '$amount'] };
const { istDateKey } = require('../utils/istDate');

const DAY_MS = 86400000;
const HISTORY_DAYS = 90;
const TOP_SHARE = 0.2;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ------------------------------------------------------------- date utils ----
// Tally dates are calendar days stored as midnight UTC; CRM timestamps are
// instants, bounded by the IST day.

const utcDay = (key) => new Date(`${key}T00:00:00.000Z`);
const shiftKey = (key, days) => new Date(utcDay(key).getTime() + days * DAY_MS).toISOString().slice(0, 10);
const monthStartKey = (key) => `${key.slice(0, 7)}-01`;
const tallyRange = (fromKey, toKey) => ({ $gte: utcDay(fromKey), $lt: utcDay(shiftKey(toKey, 1)) });
const istRange = (fromKey, toKey) => ({
  $gte: new Date(`${fromKey}T00:00:00.000+05:30`),
  $lte: new Date(`${toKey}T23:59:59.999+05:30`),
});
/** Whole days from a stored calendar date to the report day. */
const daysSince = (date, dayKey) => Math.floor((utcDay(dayKey).getTime() - new Date(date).getTime()) / DAY_MS);

const total = (rows) => ({ count: rows[0]?.count || 0, value: round2(rows[0]?.value || 0) });

// ------------------------------------------------------------------ sales ----

async function salesSection(dayKey) {
  const mtdKey = monthStartKey(dayKey);
  const salesOnly = { voucherType: SALES_VOUCHER_TYPE };
  const sumInvoices = (range) =>
    TallyInvoice.aggregate([
      { $match: { ...salesOnly, date: range } },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: REVENUE_EXPR } } },
    ]);
  const sumOrders = (field, range) =>
    SalesOrder.aggregate([
      { $match: { [field]: range, status: { $ne: 'cancelled' } } },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$total' } } },
    ]);
  const sumReceipts = (range) =>
    TallyReceipt.aggregate([
      { $match: { date: range, collected: { $gt: 0 } } },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$collected' } } },
    ]);

  const [salesDay, salesMtd, recDay, recMtd, dispDay, dispMtd, colDay, colMtd, collections, invoiceFeed, receiptFeed] =
    await Promise.all([
      sumInvoices(tallyRange(dayKey, dayKey)),
      sumInvoices(tallyRange(mtdKey, dayKey)),
      sumOrders('createdAt', istRange(dayKey, dayKey)),
      sumOrders('createdAt', istRange(mtdKey, dayKey)),
      sumOrders('dispatchedAt', istRange(dayKey, dayKey)),
      sumOrders('dispatchedAt', istRange(mtdKey, dayKey)),
      sumReceipts(tallyRange(dayKey, dayKey)),
      sumReceipts(tallyRange(mtdKey, dayKey)),
      TallyReceipt.find({ date: tallyRange(dayKey, dayKey), collected: { $gt: 0 } })
        .select('voucherNumber party customers collected')
        .sort({ collected: -1 })
        .limit(100)
        .lean(),
      TallyInvoice.estimatedDocumentCount(),
      TallyReceipt.estimatedDocumentCount(),
    ]);

  return {
    totalSales: { today: total(salesDay), mtd: total(salesMtd), live: invoiceFeed > 0 },
    ordersReceived: { today: total(recDay), mtd: total(recMtd) },
    ordersDispatched: { today: total(dispDay), mtd: total(dispMtd) },
    collection: {
      today: total(colDay),
      mtd: total(colMtd),
      live: receiptFeed > 0,
      rows: collections.map((r) => ({
        voucherNumber: r.voucherNumber,
        party: r.customers?.length ? r.customers.join(', ') : r.party,
        amount: r.collected,
      })),
    },
  };
}

// --------------------------------------------------------- executive KPI ----

/**
 * One row per active sales executive (plus any other active non-admin, such
 * as a PR manager, who logged a visit or a lead that day — an admin creating
 * and handing out leads is not an executive's KPI). A visit report counts for
 * whoever logged it;
 * a new lead counts as "made" for its creator and "assigned" for the exec it
 * was given to, when that is someone else (an admin's or a Meta Ads lead).
 */
async function execKpiSection(dayKey, targets) {
  const range = istRange(dayKey, dayKey);
  const [execs, visitRows, leads] = await Promise.all([
    User.find({ role: 'sales_exec', isActive: true }).select('name role').sort({ name: 1 }).lean(),
    Lead.aggregate([
      { $match: { visitReports: { $elemMatch: { visitDate: range } } } },
      { $unwind: '$visitReports' },
      { $match: { 'visitReports.visitDate': range } },
      {
        $group: {
          _id: { by: { $ifNull: ['$visitReports.createdBy', '$assignedExecId'] }, type: '$visitReports.visitType' },
          n: { $sum: 1 },
        },
      },
    ]),
    Lead.find({ leadDate: range }).select('createdBy assignedExecId').lean(),
  ]);

  const stats = new Map();
  const statOf = (id) => {
    const key = String(id);
    if (!stats.has(key)) stats.set(key, { visits: 0, calls: 0, made: 0, assigned: 0 });
    return stats.get(key);
  };
  for (const r of visitRows) {
    if (!r._id.by) continue;
    const s = statOf(r._id.by);
    if (r._id.type === 'call') s.calls += r.n;
    else s.visits += r.n;
  }
  for (const l of leads) {
    if (l.createdBy) statOf(l.createdBy).made += 1;
    if (l.assignedExecId && String(l.assignedExecId) !== String(l.createdBy)) statOf(l.assignedExecId).assigned += 1;
  }

  const execIds = new Set(execs.map((e) => String(e._id)));
  const otherIds = [...stats.keys()].filter((id) => !execIds.has(id));
  const others = otherIds.length
    ? await User.find({ _id: { $in: otherIds }, isActive: true, role: { $ne: 'admin' } }).select('name role').sort({ name: 1 }).lean()
    : [];

  const rows = [...execs, ...others].map((u) => {
    const s = stats.get(String(u._id)) || { visits: 0, calls: 0, made: 0, assigned: 0 };
    const leadsTotal = s.made + s.assigned;
    return {
      id: String(u._id),
      name: u.name,
      role: u.role,
      visits: s.visits,
      calls: s.calls,
      leadsMade: s.made,
      leadsAssigned: s.assigned,
      leads: leadsTotal,
      met: { visits: s.visits >= targets.visits, calls: s.calls >= targets.calls, leads: leadsTotal >= targets.leads },
    };
  });
  const sum = (k) => rows.reduce((t, r) => t + r[k], 0);
  return {
    targets,
    rows,
    totals: { visits: sum('visits'), calls: sum('calls'), leadsMade: sum('leadsMade'), leadsAssigned: sum('leadsAssigned'), leads: sum('leads') },
  };
}

// ------------------------------------------------- receivables & due list ----

async function duesSection(snapshot, dayKey) {
  if (!snapshot) return { available: false, receivables: null, rows: [] };

  const owing = snapshot.debtors.filter((d) => d.balance > 0);
  const followUps = await ReceivableFollowUp.find({ ledger: { $in: owing.map((d) => d.name) } })
    .populate({ path: 'updatedBy', select: 'name' })
    .lean();
  const noteOf = new Map(followUps.map((f) => [f.ledger, f]));
  const dayStart = utcDay(dayKey);

  const rows = owing
    .map((d) => {
      const open = (d.bills || []).filter((b) => b.amount > 0);
      const dated = open.filter((b) => b.billDate);
      const oldest = dated.length ? dated.reduce((m, b) => (b.billDate < m ? b.billDate : m), dated[0].billDate) : null;
      const overdueBills = open.filter((b) => b.dueDate && new Date(b.dueDate) < dayStart);
      const note = noteOf.get(d.name);
      return {
        name: d.name,
        group: d.group,
        amount: round2(d.balance),
        bills: open.length,
        oldestBillDate: oldest,
        days: oldest ? Math.max(0, daysSince(oldest, dayKey)) : null,
        overdue: round2(overdueBills.reduce((s, b) => s + b.amount, 0)),
        overdueDays: overdueBills.length ? Math.max(...overdueBills.map((b) => daysSince(b.dueDate, dayKey))) : null,
        dueKnown: open.some((b) => b.dueDate),
        followUp: note?.status
          ? { status: note.status, updatedAt: note.updatedAt, by: note.updatedBy?.name || null }
          : null,
      };
    })
    .sort((a, b) => b.amount - a.amount);

  const advances = snapshot.debtors.filter((d) => d.balance < 0);
  return {
    available: true,
    asOf: snapshot.date,
    lastSyncAt: snapshot.lastSyncAt,
    // When the balances were last re-read from Tally (the 7-day re-read), so
    // a past day says how fresh its figures are.
    updatedAt: snapshot.positionsSyncAt || snapshot.lastSyncAt || null,
    // false = a day the TDL never ran on: balances only, no bill-wise detail.
    billsCaptured: snapshot.billsCaptured !== false,
    billWise: snapshot.debtors.some((d) => d.bills?.length),
    receivables: {
      total: round2(owing.reduce((s, d) => s + d.balance, 0)),
      customers: owing.length,
      overdue: round2(rows.reduce((s, r) => s + r.overdue, 0)),
      advances: round2(advances.reduce((s, d) => s - d.balance, 0)),
    },
    rows,
  };
}

// ------------------------------------------------------------ production ----

/**
 * What one voucher produced: each item brought in, less the same item taken
 * out of the same voucher — a godown transfer nets to nothing, a reprocess to
 * its difference.
 */
function producedBy(voucher) {
  const byItem = new Map();
  for (const e of voucher.inEntries || []) {
    const r = byItem.get(e.item) || { qty: 0, value: 0, unit: e.unit };
    r.qty += e.qty;
    r.value += e.amount;
    byItem.set(e.item, r);
  }
  for (const e of voucher.outEntries || []) {
    const r = byItem.get(e.item);
    if (!r) continue;
    r.qty -= e.qty;
    r.value -= e.amount;
  }
  return [...byItem.entries()]
    .filter(([, r]) => r.qty > 1e-6)
    .map(([item, r]) => ({ item, qty: r.qty, value: Math.max(0, r.value), unit: r.unit }));
}

function sumProduced(vouchers, keep) {
  const out = new Map();
  for (const v of vouchers) {
    for (const p of producedBy(v)) {
      if (!keep(p.item)) continue;
      const r = out.get(p.item) || { qty: 0, value: 0, unit: p.unit, vouchers: 0 };
      r.qty += p.qty;
      r.value += p.value;
      r.vouchers += 1;
      out.set(p.item, r);
    }
  }
  return out;
}

/** "kg" when the item's pack weight is known, else the item's own unit. */
function costBasis(stock, unit) {
  const kpu = kgPerUnit({ name: stock?.name, code: stock?.code, baseUnits: stock?.baseUnits || unit });
  return kpu ? { per: 'kg', factor: kpu } : { per: stock?.baseUnits || unit || 'unit', factor: 1 };
}

async function productionSection(dayKey, { stockByName, tolerancePct, isToday }) {
  // Only Semi Finished / Finished items count as production — the same items
  // the stock mirror keeps; by-products and raw material moved in a journal
  // do not.
  const isProduct = (name) => stockByName.has(name);
  const [dayVouchers, plans, anyProduction] = await Promise.all([
    TallyProduction.find({ date: tallyRange(dayKey, dayKey) }).lean(),
    ProductionPlan.find({ date: dayKey }).lean(),
    TallyProduction.estimatedDocumentCount(),
  ]);
  const today = sumProduced(dayVouchers, isProduct);
  const planOf = new Map(plans.map((p) => [p.item, p.qty]));

  const items = [...new Set([...today.keys(), ...planOf.keys()])].sort((a, b) => a.localeCompare(b));
  const rows = items.map((item) => {
    const stock = stockByName.get(item);
    const made = today.get(item);
    const planned = planOf.has(item) ? planOf.get(item) : null;
    const actual = round2(made?.qty || 0);
    const kpu = kgPerUnit({ name: item, code: stock?.code, baseUnits: stock?.baseUnits || made?.unit });
    return {
      item,
      code: stock?.code || '',
      unit: stock?.baseUnits || made?.unit || '',
      bulk: /\bKIT\b/i.test(item) || /-KIT$/i.test(stock?.code || ''),
      planned,
      actual,
      kg: kpu ? round2(actual * kpu) : null,
      achievementPct: planned ? Math.round((actual / planned) * 100) : null,
    };
  });

  // Cost per kg: today's against the item's history — its own production
  // over the last 90 days, or, until that history exists, Tally's inward
  // average for the year (the stock push's inward value / inward quantity,
  // less today's own production when the report is for today).
  const producedItems = [...today.keys()];
  const histVouchers = producedItems.length
    ? await TallyProduction.find({
        date: { $gte: utcDay(shiftKey(dayKey, -HISTORY_DAYS)), $lt: utcDay(dayKey) },
        'inEntries.item': { $in: producedItems },
      }).lean()
    : [];
  const history = sumProduced(histVouchers, (name) => today.has(name));

  const costRows = producedItems
    .sort((a, b) => a.localeCompare(b))
    .map((item) => {
      const stock = stockByName.get(item);
      const made = today.get(item);
      const basis = costBasis(stock, made.unit);
      const todayCost = made.value > 0 ? round2(made.value / (made.qty * basis.factor)) : null;

      let histCost = null;
      let histSource = null;
      const hist = history.get(item);
      if (hist && hist.qty > 0 && hist.value > 0) {
        histCost = round2(hist.value / (hist.qty * basis.factor));
        histSource = `${HISTORY_DAYS}-day production (${hist.vouchers} voucher${hist.vouchers === 1 ? '' : 's'})`;
      } else if (stock && stock.inwardQty > 0 && stock.inwardValue > 0) {
        const qty = stock.inwardQty - (isToday ? made.qty : 0);
        const value = stock.inwardValue - (isToday ? made.value : 0);
        if (qty > 0 && value > 0) {
          histCost = round2(value / (qty * basis.factor));
          histSource = 'Tally inward average (year to date)';
        }
      }

      const variance = todayCost != null && histCost ? round2(todayCost - histCost) : null;
      const variancePct = variance != null ? round2((variance / histCost) * 100) : null;
      return {
        item,
        per: basis.per,
        histCost,
        histSource,
        todayCost,
        variance,
        variancePct,
        ok: variancePct == null ? null : variancePct <= tolerancePct,
      };
    });

  return {
    live: anyProduction > 0,
    rows,
    plannedItems: plans.length,
    cost: { tolerancePct, rows: costRows },
  };
}

// ------------------------------------------------ closing stock & expiry ----

const STATUS_RANK = { critical: 2, normal: 1, unknown: 0 };
const worstStatus = (statuses) =>
  statuses.reduce((w, s) => (STATUS_RANK[s] > STATUS_RANK[w] ? s : w), 'unknown');

/**
 * Expiry per item from the batch-wise stock: the earliest expiry among the
 * batches still holding stock. CRITICAL once that is within the warning
 * window (or already past); unknown when the item sends no batches or its
 * batches carry no expiry.
 */
function expiryIndex(snapshot, dayKey, warnDays) {
  const byItem = new Map();
  if (!snapshot?.batchesSent) return { sent: false, of: () => ({ status: 'unknown' }) };
  for (const b of snapshot.batches) {
    if (!b.expiryDate || b.qty <= 0) continue;
    const cur = byItem.get(b.item);
    if (!cur || b.expiryDate < cur.expiryDate) byItem.set(b.item, b);
  }
  const limit = utcDay(shiftKey(dayKey, warnDays)).getTime();
  return {
    sent: true,
    of: (item) => {
      const b = byItem.get(item);
      if (!b) return { status: 'unknown' };
      const daysLeft = -daysSince(b.expiryDate, dayKey);
      return {
        status: new Date(b.expiryDate).getTime() <= limit ? 'critical' : 'normal',
        expiryDate: b.expiryDate,
        daysLeft,
        batch: b.batch,
      };
    },
  };
}

/**
 * Closing stock for the day. First choice is Tally's own closing as on that
 * day, which the day-end TDL re-reads for a week (so late entries are in);
 * otherwise the stock register, where closing = the next morning's opening
 * once that exists, else the day's last sync — the same rule as the Stock
 * page's day-wise register.
 */
async function closingStockFor(dayKey, { dayDoc, stockByName, isToday }) {
  if (dayDoc?.stockSent) {
    return {
      source: 'tally',
      asOf: dayKey,
      settled: !isToday,
      updatedAt: dayDoc.positionsSyncAt || null,
      items: dayDoc.stock.map((s) => {
        const known = stockByName.get(s.item);
        return { name: s.item, code: known?.code || '', unit: s.unit || known?.baseUnits || '', qty: s.qty, value: round2(s.value) };
      }),
    };
  }
  // The register day: the report day itself, or the last day synced before
  // it when Tally sent nothing that day.
  const regDay = (await StockSnapshot.findOne({ date: { $lte: dayKey } }).sort({ date: -1 }).select('date').lean())?.date;
  if (!regDay) return null;
  const [docs, nextDocs] = await Promise.all([
    StockSnapshot.find({ date: regDay }).lean(),
    StockSnapshot.find({ date: shiftKey(regDay, 1) }).lean(),
  ]);
  const nextByName = new Map(nextDocs.map((d) => [d.name, d]));
  return {
    source: 'register',
    asOf: regDay,
    settled: nextDocs.length > 0,
    updatedAt: null,
    items: docs.map((d) => {
      const next = nextByName.get(d.name);
      return {
        name: d.name,
        code: d.code || '',
        unit: d.baseUnits,
        qty: next ? next.dayOpenQty : d.qty,
        value: round2(next ? next.dayOpenValue : d.value),
      };
    }),
  };
}

async function stockSection(dayKey, { families, warnDays, batchSnapshot, dayDoc, stockByName, isToday }) {
  const expiry = expiryIndex(batchSnapshot, dayKey, warnDays);
  const expiryInfo = { sent: expiry.sent, asOf: batchSnapshot?.date || null, warnDays };
  const closing = await closingStockFor(dayKey, { dayDoc, stockByName, isToday });
  if (!closing) {
    return { available: false, expiry: expiryInfo, families: [], other: null, total: 0, top: null };
  }
  const items = closing.items.map((i) => ({
    ...i,
    expiry: i.value > 0 ? expiry.of(i.name) : { status: 'unknown' },
  }));

  const norm = (s) => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const familyIndex = (name) => families.findIndex((f) => f.keywords.some((k) => norm(name).includes(norm(k))));
  const groups = families.map((f) => ({ label: f.label, items: [] }));
  const other = { label: 'Other SKU', items: [] };
  for (const item of items) {
    const i = familyIndex(item.name);
    (i === -1 ? other : groups[i]).items.push(item);
  }
  const summarise = (g) => {
    const held = g.items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
    const critical = held.filter((i) => i.expiry.status === 'critical');
    return {
      label: g.label,
      value: round2(held.reduce((s, i) => s + i.value, 0)),
      itemCount: held.length,
      status: worstStatus(held.map((i) => i.expiry.status)),
      criticalItems: critical.length,
      items: held,
    };
  };

  const grandTotal = round2(items.reduce((s, i) => s + i.value, 0));
  const held = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const topCount = held.length ? Math.max(1, Math.ceil(held.length * TOP_SHARE)) : 0;
  const topRows = held.slice(0, topCount);
  const topValue = round2(topRows.reduce((s, i) => s + i.value, 0));

  return {
    available: true,
    source: closing.source,
    asOf: closing.asOf,
    settled: closing.settled,
    updatedAt: closing.updatedAt,
    expiry: expiryInfo,
    families: groups.map(summarise),
    other: summarise(other),
    total: grandTotal,
    top: {
      rows: topRows,
      count: topCount,
      of: held.length,
      value: topValue,
      pctOfTotal: grandTotal ? round2((topValue / grandTotal) * 100) : 0,
    },
  };
}

// ------------------------------------------------------------- the report ----

async function feedStatus() {
  const [lastStock, lastDayEnd] = await Promise.all([
    StockSyncLog.findOne().sort({ createdAt: -1 }).lean(),
    DayEndSnapshot.findOne().sort({ lastSyncAt: -1 }).select('-debtors -batches -stock').lean(),
  ]);
  return {
    stock: lastStock
      ? {
          at: lastStock.syncedAt || lastStock.createdAt,
          tdlVersion: lastStock.tdlVersion || '',
          tdlCurrent: (lastStock.tdlVersion || '') === TDL_VERSION,
          tdlLatest: TDL_VERSION,
        }
      : null,
    dayEnd: lastDayEnd
      ? {
          at: lastDayEnd.lastSyncAt,
          tdlVersion: lastDayEnd.tdlVersion || '',
          tdlCurrent: (lastDayEnd.tdlVersion || '') === DAYEND_TDL_VERSION,
          tdlLatest: DAYEND_TDL_VERSION,
          counts: lastDayEnd.counts,
          batchesSent: lastDayEnd.batchesSent,
        }
      : { tdlLatest: DAYEND_TDL_VERSION },
  };
}

/** Everything the Day End Report shows for one IST day, as plain data. */
async function buildDayEndReport(dayKey) {
  const settings = await Setting.getGlobal();
  const cfg = settings.dayEnd?.toObject ? settings.dayEnd.toObject() : settings.dayEnd || {};
  const targets = { visits: 2, calls: 5, leads: 3, ...(cfg.targets || {}) };
  const families = (cfg.families || []).filter((f) => f.label && f.keywords?.length);
  const warnDays = cfg.expiryWarnDays ?? 30;
  const tolerancePct = cfg.costTolerancePct ?? 5;
  const todayKey = istDateKey(new Date());

  // The day's closing positions from Tally: that day's own document (its
  // last push, or the 7-day re-read of a later one), or the last one before
  // it. Batches are only ever captured "as on now", so expiry reads the last
  // push that sent them up to that day — or, for a day re-read before any
  // push carried batches, the first one after it.
  const [snapshot, batchBefore, stockItems] = await Promise.all([
    DayEndSnapshot.findOne({ date: { $lte: dayKey } }).sort({ date: -1 }).lean(),
    DayEndSnapshot.findOne({ date: { $lte: dayKey }, batchesSent: true }).sort({ date: -1 }).select('date batches batchesSent').lean(),
    StockItem.find().select('name code baseUnits inwardQty inwardValue').lean(),
  ]);
  const batchSnapshot =
    batchBefore ||
    (await DayEndSnapshot.findOne({ date: { $gt: dayKey }, batchesSent: true }).sort({ date: 1 }).select('date batches batchesSent').lean());
  const stockByName = new Map(stockItems.map((s) => [s.name, s]));
  const isToday = dayKey === todayKey;

  const [feed, sales, execKpi, dues, production, stock] = await Promise.all([
    feedStatus(),
    salesSection(dayKey),
    execKpiSection(dayKey, targets),
    duesSection(snapshot, dayKey),
    productionSection(dayKey, { stockByName, tolerancePct, isToday }),
    stockSection(dayKey, {
      families,
      warnDays,
      batchSnapshot,
      dayDoc: snapshot?.date === dayKey ? snapshot : null,
      stockByName,
      isToday,
    }),
  ]);

  return {
    date: dayKey,
    today: todayKey,
    settings: { targets, families, expiryWarnDays: warnDays, costTolerancePct: tolerancePct },
    feed,
    sales: { ...sales, receivables: dues.receivables, receivablesAsOf: dues.available ? dues.asOf : null },
    execKpi,
    dues,
    production,
    stock,
  };
}

module.exports = { buildDayEndReport, producedBy };

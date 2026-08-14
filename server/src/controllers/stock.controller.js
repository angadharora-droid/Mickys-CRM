const crypto = require('crypto');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');
const Customer = require('../models/Customer');
const StockItem = require('../models/StockItem');
const StockSnapshot = require('../models/StockSnapshot');
const StockSyncLog = require('../models/StockSyncLog');
const Vendor = require('../models/Vendor');
const {
  parseTallyStockXml,
  parseTallyVendors,
  parseTallyCustomers,
} = require('../services/tallyStock.service');
const { getPagination, buildMeta } = require('../utils/pagination');
const { logActivity } = require('../services/activity.service');
const { searchRegex } = require('../utils/sanitize');
const { authenticate, authorize } = require('../middleware/auth');

/**
 * Sync auth: either the Tally side presenting the shared key (enabled only
 * when TALLY_SYNC_KEY is set) — as an X-Tally-Key header, or as ?key= in the
 * URL because Tally's TDL HTTP Post action cannot send custom headers — or a
 * signed-in admin doing a manual XML upload from the dashboard.
 */
const tallyKeyOrAdmin = (req, res, next) => {
  const key = req.headers['x-tally-key'] || req.query.key;
  if (env.tallySyncKey && typeof key === 'string') {
    const a = Buffer.from(key);
    const b = Buffer.from(env.tallySyncKey);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      req.tallyPush = true;
      return next();
    }
    throw ApiError.unauthorized('Invalid Tally sync key');
  }
  return authenticate(req, res, (err) => {
    if (err) return next(err);
    return authorize('admin')(req, res, next);
  });
};

/**
 * Only Semi-Finished and Finished goods belong in the CRM — raw material,
 * packing material and every other Tally group is dropped at sync time.
 * Matched loosely (any group/category containing "finished", any casing) so
 * "Finished Goods", "FINISHED GOODS", "Semi Finished" and "Semi-Finished
 * Goods" all pass without depending on the exact wording in Tally.
 */
const SYNCED_GROUPS = /finished/i;

/** Business date in IST (the Tally PC's timezone), e.g. "2026-08-14". */
const istDateKey = (d) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);

/** "2026-08-14" -> "2026-08-15" */
const nextDateKey = (key) => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

// POST /api/stock/sync — body: raw XML (text/xml) or JSON { xml }
const syncStock = asyncHandler(async (req, res) => {
  const xml = typeof req.body === 'string' ? req.body : req.body?.xml;
  if (!xml || typeof xml !== 'string') {
    throw ApiError.badRequest('No Tally XML provided');
  }

  const parsed = parseTallyStockXml(xml);
  if (!parsed.length) {
    throw ApiError.badRequest(
      'No stock items found in the XML — make sure this is the "Mickys Stock Export" file exported from Tally'
    );
  }

  const items = parsed.filter(
    (item) => SYNCED_GROUPS.test(item.group) || SYNCED_GROUPS.test(item.category)
  );
  if (!items.length) {
    throw ApiError.badRequest(
      'The XML parsed fine, but no items belong to a Semi Finished or Finished stock group — the CRM only syncs those groups. Check the stock group names in Tally.'
    );
  }

  // Mirror semantics: upsert everything present, then drop whatever this sync
  // didn't touch (items deleted/renamed in Tally).
  const syncedAt = new Date();
  await StockItem.bulkWrite(
    items.map((item) => ({
      updateOne: {
        filter: { name: item.name },
        update: { $set: { ...item, syncedAt } },
        upsert: true,
      },
    })),
    { ordered: false }
  );
  const removed = await StockItem.deleteMany({
    $or: [{ syncedAt: { $lt: syncedAt } }, { syncedAt: null }],
  });

  // Day-wise register: one snapshot per item per IST day. The first sync of
  // the day freezes dayOpen* (opening position); later syncs only refresh the
  // last-known position. Items that vanish from Tally mid-day drop out of
  // today's snapshot too.
  const dateKey = istDateKey(syncedAt);
  await StockSnapshot.bulkWrite(
    items.map((item) => ({
      updateOne: {
        filter: { date: dateKey, name: item.name },
        update: {
          $set: {
            group: item.group,
            category: item.category,
            baseUnits: item.baseUnits,
            qty: item.closingQty,
            rate: item.closingRate,
            value: item.closingValue,
            lastSyncAt: syncedAt,
          },
          $setOnInsert: {
            dayOpenQty: item.closingQty,
            dayOpenRate: item.closingRate,
            dayOpenValue: item.closingValue,
            firstSyncAt: syncedAt,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false }
  );
  await StockSnapshot.deleteMany({ date: dateKey, lastSyncAt: { $lt: syncedAt } });

  // Vendors (Sundry Creditors) and customers (Sundry Debtors) ride along in
  // the same XML (updated TDL only) — mirrored the same way as stock, but a
  // list absent from the export (older TDL still loaded in Tally) leaves its
  // collection untouched.
  const mirrorLedgers = async (Model, ledgers) => {
    if (!ledgers.length) return;
    await Model.bulkWrite(
      ledgers.map((l) => ({
        updateOne: {
          filter: { name: l.name },
          update: { $set: { ...l, syncedAt } },
          upsert: true,
        },
      })),
      { ordered: false }
    );
    await Model.deleteMany({
      $or: [{ syncedAt: { $lt: syncedAt } }, { syncedAt: null }],
    });
  };
  const vendors = parseTallyVendors(xml);
  const customers = parseTallyCustomers(xml);
  await mirrorLedgers(Vendor, vendors);
  await mirrorLedgers(Customer, customers);

  const log = await StockSyncLog.create({
    itemCount: items.length,
    removedCount: removed.deletedCount || 0,
    vendorCount: vendors.length,
    customerCount: customers.length,
    source: req.tallyPush ? 'push' : 'upload',
    syncedBy: req.user?._id,
  });

  await logActivity({
    userId: req.user?._id,
    action: 'STOCK_SYNCED',
    entity: 'StockItem',
    entityId: log._id,
    details:
      `Synced ${items.length} stock items from Tally (${req.tallyPush ? 'Tally push' : 'manual upload'})` +
      (vendors.length ? `, ${vendors.length} vendors` : '') +
      (customers.length ? `, ${customers.length} customers` : '') +
      (parsed.length > items.length
        ? `; skipped ${parsed.length - items.length} outside Semi Finished/Finished groups`
        : '') +
      (removed.deletedCount ? `; removed ${removed.deletedCount} no longer in Tally` : ''),
    ip: req.ip,
  });

  // Tally's HTTP Post action expects an XML response body; the dashboard
  // upload gets the usual JSON envelope.
  const summary = [
    `${items.length} stock items`,
    vendors.length ? `${vendors.length} vendors` : '',
    customers.length ? `${customers.length} customers` : '',
  ]
    .filter(Boolean)
    .join(', ');
  if (req.tallyPush) {
    return res
      .type('text/xml')
      .send(`<RESPONSE><STATUS>1</STATUS><MESSAGE>Synced ${summary} to Mickys CRM</MESSAGE></RESPONSE>`);
  }
  res.json({
    success: true,
    message: `Synced ${summary}`,
    data: {
      itemCount: items.length,
      vendorCount: vendors.length,
      customerCount: customers.length,
      removedCount: removed.deletedCount || 0,
      syncedAt,
    },
  });
});

// GET /api/stock?search=&group=&inStock=&page=&limit=
const listStock = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = {};
  if (req.query.group) filter.group = req.query.group;
  if (req.query.inStock === 'true') filter.closingQty = { $gt: 0 };
  if (req.query.search) {
    const rx = searchRegex(req.query.search);
    filter.$or = [{ name: rx }, { group: rx }, { category: rx }];
  }

  const [items, total] = await Promise.all([
    StockItem.find(filter).sort({ name: 1 }).skip(skip).limit(limit),
    StockItem.countDocuments(filter),
  ]);
  res.json({ success: true, data: items, meta: buildMeta(total, page, limit) });
});

// GET /api/stock/daily?date=YYYY-MM-DD — day-wise opening/closing register.
// Opening = position at the day's first sync (morning auto-push); closing =
// next day's opening when that snapshot exists (settled), else the day's
// last-sync position (still provisional).
const dailyStock = asyncHandler(async (req, res) => {
  const dates = (await StockSnapshot.distinct('date')).sort().reverse();
  if (!dates.length) {
    return res.json({ success: true, data: { date: null, dates: [], items: [] } });
  }

  const date = dates.includes(req.query.date) ? req.query.date : dates[0];
  const [docs, nextDocs] = await Promise.all([
    StockSnapshot.find({ date }).sort({ name: 1 }).lean(),
    StockSnapshot.find({ date: nextDateKey(date) }).lean(),
  ]);
  const nextByName = new Map(nextDocs.map((d) => [d.name, d]));

  const items = docs.map((d) => {
    const next = nextByName.get(d.name);
    return {
      name: d.name,
      group: d.group,
      category: d.category,
      baseUnits: d.baseUnits,
      openingQty: d.dayOpenQty,
      openingValue: d.dayOpenValue,
      closingQty: next ? next.dayOpenQty : d.qty,
      closingValue: next ? next.dayOpenValue : d.value,
      settled: Boolean(next),
    };
  });

  res.json({ success: true, data: { date, dates: dates.slice(0, 90), items } });
});

// GET /api/stock/vendors?search= and GET /api/stock/customers?search=
const listLedgerMirror = (Model) =>
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.search) {
      const rx = searchRegex(req.query.search);
      filter.$or = [{ name: rx }, { group: rx }];
    }
    const ledgers = await Model.find(filter).sort({ name: 1 }).limit(1000);
    res.json({ success: true, data: ledgers });
  });
const listVendors = listLedgerMirror(Vendor);
const listCustomers = listLedgerMirror(Customer);

// GET /api/stock/groups
const listGroups = asyncHandler(async (_req, res) => {
  const groups = await StockItem.distinct('group');
  res.json({ success: true, data: groups.filter(Boolean).sort() });
});

// GET /api/stock/summary — dashboard stats + last-sync banner
const stockSummary = asyncHandler(async (_req, res) => {
  const [totals, byGroup, lastSync] = await Promise.all([
    StockItem.aggregate([
      {
        $group: {
          _id: null,
          items: { $sum: 1 },
          inStock: { $sum: { $cond: [{ $gt: ['$closingQty', 0] }, 1, 0] } },
          closingValue: { $sum: '$closingValue' },
          inwardValue: { $sum: '$inwardValue' },
          outwardValue: { $sum: '$outwardValue' },
        },
      },
    ]),
    StockItem.aggregate([
      {
        $group: {
          _id: { $ifNull: ['$group', ''] },
          items: { $sum: 1 },
          inStock: { $sum: { $cond: [{ $gt: ['$closingQty', 0] }, 1, 0] } },
          closingValue: { $sum: '$closingValue' },
        },
      },
      { $sort: { closingValue: -1 } },
    ]),
    StockSyncLog.findOne().sort({ createdAt: -1 }).populate('syncedBy', 'name'),
  ]);

  res.json({
    success: true,
    data: {
      totals: totals[0] || { items: 0, inStock: 0, closingValue: 0, inwardValue: 0, outwardValue: 0 },
      byGroup: byGroup.map((g) => ({ group: g._id || 'Ungrouped', ...g, _id: undefined })),
      lastSync: lastSync
        ? {
            at: lastSync.createdAt,
            itemCount: lastSync.itemCount,
            source: lastSync.source,
            by: lastSync.syncedBy?.name || null,
          }
        : null,
    },
  });
});

module.exports = {
  tallyKeyOrAdmin,
  syncStock,
  listStock,
  dailyStock,
  listVendors,
  listCustomers,
  listGroups,
  stockSummary,
};

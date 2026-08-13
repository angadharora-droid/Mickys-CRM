const crypto = require('crypto');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');
const StockItem = require('../models/StockItem');
const StockSyncLog = require('../models/StockSyncLog');
const { parseTallyStockXml } = require('../services/tallyStock.service');
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

// POST /api/stock/sync — body: raw XML (text/xml) or JSON { xml }
const syncStock = asyncHandler(async (req, res) => {
  const xml = typeof req.body === 'string' ? req.body : req.body?.xml;
  if (!xml || typeof xml !== 'string') {
    throw ApiError.badRequest('No Tally XML provided');
  }

  const items = parseTallyStockXml(xml);
  if (!items.length) {
    throw ApiError.badRequest(
      'No stock items found in the XML — make sure this is the "Mickys Stock Export" file exported from Tally'
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

  const log = await StockSyncLog.create({
    itemCount: items.length,
    removedCount: removed.deletedCount || 0,
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
      (removed.deletedCount ? `; removed ${removed.deletedCount} no longer in Tally` : ''),
    ip: req.ip,
  });

  // Tally's HTTP Post action expects an XML response body; the dashboard
  // upload gets the usual JSON envelope.
  if (req.tallyPush) {
    return res
      .type('text/xml')
      .send(`<RESPONSE><STATUS>1</STATUS><MESSAGE>Synced ${items.length} stock items to Mickys CRM</MESSAGE></RESPONSE>`);
  }
  res.json({
    success: true,
    message: `Synced ${items.length} stock items`,
    data: { itemCount: items.length, removedCount: removed.deletedCount || 0, syncedAt },
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

module.exports = { tallyKeyOrAdmin, syncStock, listStock, listGroups, stockSummary };

const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const RateItem = require('../models/RateItem');
const Lead = require('../models/Lead');
const { getPagination, buildMeta } = require('../utils/pagination');
const { logActivity } = require('../services/activity.service');
const { searchRegex } = require('../utils/sanitize');

/**
 * Lead rate lines are snapshots of the master taken when rates were confirmed.
 * Prices are intentionally frozen, but the descriptive fields (name, pack size,
 * category) should always reflect the current master — so a SKU rename shows up
 * on every lead, even old ones. Pushes the new values into all matching snapshot
 * lines and flags already-generated leads so their PDFs are rebuilt (name only)
 * on next download/email. Returns how many leads were touched.
 */
async function syncRateItemToLeads(rateItem) {
  const match = { 'rates.rateItemId': rateItem._id };
  const [snapshotRes] = await Promise.all([
    Lead.updateMany(
      match,
      {
        $set: {
          'rates.$[elem].productName': rateItem.productName,
          'rates.$[elem].packSize': rateItem.packSize || '',
          'rates.$[elem].category': rateItem.category || '',
        },
      },
      { arrayFilters: [{ 'elem.rateItemId': rateItem._id }] }
    ),
    // Only leads whose kit has actually been generated have stale PDFs to rebuild.
    Lead.updateMany(
      { ...match, generatedAt: { $ne: null } },
      { $set: { pdfStale: true } }
    ),
  ]);
  return snapshotRes.modifiedCount || 0;
}

// GET /api/rate-items?kitType=&search=&category=&isActive=&page=&limit=
const listRateItems = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = {};
  if (req.query.kitType) filter.kitType = req.query.kitType;
  if (req.query.category) filter.category = req.query.category;
  if (req.query.isActive !== undefined && req.query.isActive !== '') {
    filter.isActive = req.query.isActive === 'true';
  }
  if (req.query.search) {
    const rx = searchRegex(req.query.search);
    filter.$or = [{ productName: rx }, { sku: rx }, { category: rx }];
  }

  const [items, total] = await Promise.all([
    RateItem.find(filter).sort({ productName: 1 }).skip(skip).limit(limit),
    RateItem.countDocuments(filter),
  ]);
  res.json({ success: true, data: items, meta: buildMeta(total, page, limit) });
});

// GET /api/rate-items/categories
const listCategories = asyncHandler(async (req, res) => {
  const filter = { isActive: true };
  if (req.query.kitType) filter.kitType = req.query.kitType;
  const categories = await RateItem.distinct('category', filter);
  res.json({ success: true, data: categories.filter(Boolean).sort() });
});

// GET /api/rate-items/:id
const getRateItem = asyncHandler(async (req, res) => {
  const item = await RateItem.findById(req.params.id);
  if (!item) throw ApiError.notFound('Rate item not found');
  res.json({ success: true, data: item });
});

function assertBounds(body) {
  if (Number(body.netRate) > Number(body.mrp)) {
    throw ApiError.badRequest('Net rate cannot exceed MRP');
  }
}

// POST /api/rate-items
const createRateItem = asyncHandler(async (req, res) => {
  assertBounds(req.body);
  const sku = req.body.sku.toUpperCase();
  const exists = await RateItem.findOne({ sku, kitType: req.body.kitType });
  if (exists) throw ApiError.conflict('A rate item with this SKU already exists in this rate master');

  const item = await RateItem.create({ ...req.body, sku, createdBy: req.user._id });
  await logActivity({
    userId: req.user._id, action: 'RATE_ITEM_CREATED', entity: 'RateItem', entityId: item._id,
    details: `Created ${item.kitType} rate "${item.productName}" (${item.sku})`, ip: req.ip,
  });
  res.status(201).json({ success: true, data: item });
});

// PUT /api/rate-items/:id
const updateRateItem = asyncHandler(async (req, res) => {
  const current = await RateItem.findById(req.params.id);
  if (!current) throw ApiError.notFound('Rate item not found');
  assertBounds({ ...current.toObject(), ...req.body });

  const item = await RateItem.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });

  // If the descriptive fields changed, propagate them to every lead's snapshot
  // (incl. previously generated ones) so the name/pack/category stay in sync.
  const descriptiveChanged =
    item.productName !== current.productName ||
    (item.packSize || '') !== (current.packSize || '') ||
    (item.category || '') !== (current.category || '');
  let syncedLeads = 0;
  if (descriptiveChanged) {
    syncedLeads = await syncRateItemToLeads(item);
  }

  const renamed = item.productName !== current.productName;
  await logActivity({
    userId: req.user._id, action: 'RATE_ITEM_UPDATED', entity: 'RateItem', entityId: item._id,
    details:
      `Updated rate "${item.productName}" (${item.kitType})` +
      (renamed ? ` — renamed from "${current.productName}"` : '') +
      (syncedLeads ? `; synced to ${syncedLeads} lead(s)` : ''),
    ip: req.ip,
  });
  res.json({ success: true, data: item });
});

// DELETE /api/rate-items/:id (soft delete)
const deleteRateItem = asyncHandler(async (req, res) => {
  const item = await RateItem.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  if (!item) throw ApiError.notFound('Rate item not found');
  await logActivity({
    userId: req.user._id, action: 'RATE_ITEM_DEACTIVATED', entity: 'RateItem', entityId: item._id,
    details: `Deactivated rate "${item.productName}" (${item.kitType})`, ip: req.ip,
  });
  res.json({ success: true, message: 'Rate item deactivated', data: item });
});

module.exports = {
  listRateItems,
  listCategories,
  getRateItem,
  createRateItem,
  updateRateItem,
  deleteRateItem,
};

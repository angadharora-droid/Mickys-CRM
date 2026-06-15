const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const RateItem = require('../models/RateItem');
const { getPagination, buildMeta } = require('../utils/pagination');
const { logActivity } = require('../services/activity.service');
const { searchRegex } = require('../utils/sanitize');

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
  if (Number(body.floorPrice) > Number(body.netRate)) {
    throw ApiError.badRequest('Floor price cannot exceed the standard net rate');
  }
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
  await logActivity({
    userId: req.user._id, action: 'RATE_ITEM_UPDATED', entity: 'RateItem', entityId: item._id,
    details: `Updated rate "${item.productName}" (${item.kitType})`, ip: req.ip,
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

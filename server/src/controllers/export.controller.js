const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const ExportCountry = require('../models/ExportCountry');
const ExchangeRate = require('../models/ExchangeRate');
const Setting = require('../models/Setting');
const exportKit = require('../services/exportKit.service');
const fx = require('../services/fx.service');
const { logActivity } = require('../services/activity.service');

// GET /api/export/config — container options + rate-card terms. Readable by
// every role (the builder needs it); editing goes through the admin settings.
const getExportConfig = asyncHandler(async (_req, res) => {
  const settings = await Setting.getGlobal();
  res.json({ success: true, data: settings.export });
});

// ---------------- Destination countries ----------------

// GET /api/export/countries?isActive=
const listCountries = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.isActive !== undefined && req.query.isActive !== '') {
    filter.isActive = req.query.isActive === 'true';
  }
  const countries = await ExportCountry.find(filter).sort({ name: 1 });
  res.json({ success: true, data: countries });
});

// POST /api/export/countries
const createCountry = asyncHandler(async (req, res) => {
  const exists = await ExportCountry.findOne({ name: req.body.name }).collation({ locale: 'en', strength: 2 });
  if (exists) throw ApiError.conflict('This destination country already exists');
  const country = await ExportCountry.create({ ...req.body, createdBy: req.user._id });
  await logActivity({
    userId: req.user._id, action: 'EXPORT_COUNTRY_CREATED', entity: 'ExportCountry', entityId: country._id,
    details: `Added export destination "${country.name}" (CIR ${country.cirPercent}%, part-load Rs. ${country.partLoadFreightPerKg}/kg)`, ip: req.ip,
  });
  res.status(201).json({ success: true, data: country });
});

// PUT /api/export/countries/:id
const updateCountry = asyncHandler(async (req, res) => {
  const country = await ExportCountry.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!country) throw ApiError.notFound('Destination country not found');
  await logActivity({
    userId: req.user._id, action: 'EXPORT_COUNTRY_UPDATED', entity: 'ExportCountry', entityId: country._id,
    details: `Updated export destination "${country.name}" (CIR ${country.cirPercent}%, part-load Rs. ${country.partLoadFreightPerKg}/kg)`, ip: req.ip,
  });
  res.json({ success: true, data: country });
});

// DELETE /api/export/countries/:id (soft delete)
const deleteCountry = asyncHandler(async (req, res) => {
  const country = await ExportCountry.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  if (!country) throw ApiError.notFound('Destination country not found');
  await logActivity({
    userId: req.user._id, action: 'EXPORT_COUNTRY_DEACTIVATED', entity: 'ExportCountry', entityId: country._id,
    details: `Deactivated export destination "${country.name}"`, ip: req.ip,
  });
  res.json({ success: true, message: 'Destination deactivated', data: country });
});

// ---------------- Exchange rates ----------------

// GET /api/export/exchange-rates
const getExchangeRates = asyncHandler(async (_req, res) => {
  const doc = await ExchangeRate.getGlobal();
  res.json({ success: true, data: doc });
});

// POST /api/export/exchange-rates/refresh — pull the live feed now
const refreshExchangeRates = asyncHandler(async (req, res) => {
  const doc = await fx.refreshRates();
  await logActivity({
    userId: req.user._id, action: 'FX_RATES_REFRESHED', entity: 'ExchangeRate', entityId: doc._id,
    details: `Refreshed export exchange rates from ${doc.source} (USD ${doc.inrPer.USD} · EUR ${doc.inrPer.EUR} · GBP ${doc.inrPer.GBP})`, ip: req.ip,
  });
  res.json({ success: true, data: doc });
});

// PUT /api/export/exchange-rates — manual admin override (marked source: manual)
const updateExchangeRates = asyncHandler(async (req, res) => {
  const doc = await ExchangeRate.getGlobal();
  doc.inrPer = { ...doc.inrPer.toObject?.() ?? doc.inrPer, ...req.body.inrPer };
  doc.fetchedAt = new Date();
  doc.source = 'manual';
  await doc.save();
  await logActivity({
    userId: req.user._id, action: 'FX_RATES_UPDATED', entity: 'ExchangeRate', entityId: doc._id,
    details: `Manually set export exchange rates (USD ${doc.inrPer.USD} · EUR ${doc.inrPer.EUR} · GBP ${doc.inrPer.GBP})`, ip: req.ip,
  });
  res.json({ success: true, data: doc });
});

// ---------------- Rate card preview ----------------

// POST /api/export/rate-card/preview — computed card as JSON. The live preview
// behind the lead export step; actual document generation runs through the
// lead pipeline so every export kit is tracked on its lead.
const previewRateCard = asyncHandler(async (req, res) => {
  const card = await exportKit.computeRateCard(req.body);
  res.json({ success: true, data: card });
});

module.exports = {
  getExportConfig,
  listCountries,
  createCountry,
  updateCountry,
  deleteCountry,
  getExchangeRates,
  refreshExchangeRates,
  updateExchangeRates,
  previewRateCard,
};

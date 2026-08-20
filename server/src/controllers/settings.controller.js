const asyncHandler = require('../utils/asyncHandler');
const Setting = require('../models/Setting');
const { sendMail } = require('../services/email.service');
const { logActivity } = require('../services/activity.service');
const ApiError = require('../utils/ApiError');
const { parseSheetUrl, syncMetaLeads } = require('../services/metaSync.service');

// GET /api/settings
const getSettings = asyncHandler(async (_req, res) => {
  const settings = await Setting.getGlobal();
  const obj = settings.toObject();
  if (obj.email?.pass) obj.email.pass = '********'; // never expose the SMTP password
  res.json({ success: true, data: obj });
});

// PUT /api/settings
const updateSettings = asyncHandler(async (req, res) => {
  const settings = await Setting.getGlobal();
  const { email, company, kit, salesOrder, export: exportCfg } = req.body;

  if (email) {
    // Keep the stored password when the client sends back the mask
    if (email.pass === '********') delete email.pass;
    settings.email = { ...settings.email.toObject(), ...email };
  }
  if (company) settings.company = { ...settings.company.toObject(), ...company };
  if (kit) settings.kit = { ...settings.kit.toObject(), ...kit };
  if (salesOrder) settings.salesOrder = { ...settings.salesOrder.toObject(), ...salesOrder };
  if (exportCfg) {
    // Containers merge per size so a partial edit doesn't wipe the other fields.
    const current = settings.export.toObject();
    settings.export = {
      ...current,
      ...exportCfg,
      containers: {
        ft20: { ...current.containers.ft20, ...(exportCfg.containers?.ft20 || {}) },
        ft40: { ...current.containers.ft40, ...(exportCfg.containers?.ft40 || {}) },
      },
    };
  }
  await settings.save();

  await logActivity({
    userId: req.user._id, action: 'SETTINGS_UPDATED', entity: 'Setting', entityId: settings._id,
    details: 'Updated system settings', ip: req.ip,
  });

  const obj = settings.toObject();
  if (obj.email?.pass) obj.email.pass = '********';
  res.json({ success: true, data: obj });
});

// POST /api/settings/test-email — sends a test message to the current admin
const testEmail = asyncHandler(async (req, res) => {
  const result = await sendMail({
    to: req.user.email,
    subject: "Micky's Sales CRM — test email",
    html: '<p>Your SMTP configuration is working correctly. 🎉</p>',
  });
  if (result.skipped) throw ApiError.badRequest('Email is not configured or disabled (check .env or Settings)');
  res.json({ success: true, message: `Test email sent to ${req.user.email}` });
});

// ---------------------------------------------------- Meta Ads sheets ----
// The Meta lead-form sheets the sync job (services/metaSync.service.js) polls.
// An admin manages the list here instead of an env var + redeploy, so a new
// ad form's sheet starts feeding the CRM within one sync interval of being added.

// GET /api/settings/meta-sheets
const listMetaSheets = asyncHandler(async (_req, res) => {
  const settings = await Setting.getGlobal();
  res.json({ success: true, data: settings.metaSheets });
});

// POST /api/settings/meta-sheets
const createMetaSheet = asyncHandler(async (req, res) => {
  const { label = '', url, enabled } = req.body;
  const parsed = parseSheetUrl(url);
  if (!parsed) {
    throw ApiError.badRequest("That doesn't look like a Google Sheets link — copy it from the sheet's address bar and try again");
  }

  const settings = await Setting.getGlobal();
  settings.metaSheets.push({
    label: label.trim(),
    url,
    sheetId: parsed.sheetId,
    gid: parsed.gid,
    enabled: enabled ?? true,
  });
  await settings.save();
  const sheet = settings.metaSheets[settings.metaSheets.length - 1];

  await logActivity({
    userId: req.user._id, action: 'SETTINGS_UPDATED', entity: 'Setting', entityId: settings._id,
    details: `Added Meta Ads sheet "${sheet.label || sheet.sheetId}"`, ip: req.ip,
  });

  res.status(201).json({ success: true, data: sheet });
});

// PUT /api/settings/meta-sheets/:id
const updateMetaSheet = asyncHandler(async (req, res) => {
  const settings = await Setting.getGlobal();
  const sheet = settings.metaSheets.id(req.params.id);
  if (!sheet) throw ApiError.notFound('Sheet not found');

  const { label, url, enabled } = req.body;
  if (url !== undefined) {
    const parsed = parseSheetUrl(url);
    if (!parsed) {
      throw ApiError.badRequest("That doesn't look like a Google Sheets link — copy it from the sheet's address bar and try again");
    }
    sheet.url = url;
    sheet.sheetId = parsed.sheetId;
    sheet.gid = parsed.gid;
  }
  if (label !== undefined) sheet.label = label.trim();
  if (enabled !== undefined) sheet.enabled = enabled;
  await settings.save();

  await logActivity({
    userId: req.user._id, action: 'SETTINGS_UPDATED', entity: 'Setting', entityId: settings._id,
    details: `Updated Meta Ads sheet "${sheet.label || sheet.sheetId}"`, ip: req.ip,
  });

  res.json({ success: true, data: sheet });
});

// DELETE /api/settings/meta-sheets/:id
const deleteMetaSheet = asyncHandler(async (req, res) => {
  const settings = await Setting.getGlobal();
  const sheet = settings.metaSheets.id(req.params.id);
  if (!sheet) throw ApiError.notFound('Sheet not found');
  const label = sheet.label || sheet.sheetId;

  sheet.deleteOne();
  await settings.save();

  await logActivity({
    userId: req.user._id, action: 'SETTINGS_UPDATED', entity: 'Setting', entityId: settings._id,
    details: `Removed Meta Ads sheet "${label}"`, ip: req.ip,
  });

  res.json({ success: true, data: settings.metaSheets });
});

// POST /api/settings/meta-sheets/sync-now — pulls every enabled sheet
// immediately instead of waiting for the next scheduled pass, so an admin can
// confirm a newly-added sheet actually works.
const syncMetaSheetsNow = asyncHandler(async (req, res) => {
  const stats = await syncMetaLeads({ apply: true });

  await logActivity({
    userId: req.user._id, action: 'SETTINGS_UPDATED', entity: 'Setting', entityId: null,
    details: `Manually synced Meta Ads sheets: ${stats.imported} imported, ${stats.existing} already present`, ip: req.ip,
  });

  res.json({ success: true, data: stats });
});

module.exports = {
  getSettings,
  updateSettings,
  testEmail,
  listMetaSheets,
  createMetaSheet,
  updateMetaSheet,
  deleteMetaSheet,
  syncMetaSheetsNow,
};

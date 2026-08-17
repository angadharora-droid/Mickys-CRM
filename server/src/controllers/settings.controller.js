const asyncHandler = require('../utils/asyncHandler');
const Setting = require('../models/Setting');
const { sendMail } = require('../services/email.service');
const { logActivity } = require('../services/activity.service');
const ApiError = require('../utils/ApiError');

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

module.exports = { getSettings, updateSettings, testEmail };

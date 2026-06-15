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
  const { email, company, kit } = req.body;

  if (email) {
    // Keep the stored password when the client sends back the mask
    if (email.pass === '********') delete email.pass;
    settings.email = { ...settings.email.toObject(), ...email };
  }
  if (company) settings.company = { ...settings.company.toObject(), ...company };
  if (kit) settings.kit = { ...settings.kit.toObject(), ...kit };
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

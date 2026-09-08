const asyncHandler = require('../utils/asyncHandler');
const Setting = require('../models/Setting');
const { sendMail } = require('../services/email.service');
const { logActivity } = require('../services/activity.service');
const ApiError = require('../utils/ApiError');
const { parseSheetUrl, syncMetaLeads } = require('../services/metaSync.service');
const { resolveSchedule, rescheduleDailyReport } = require('../services/dailyReport.service');
const { recomputeAllScores, RULES: SCORE_RULES } = require('../services/leadScore.service');

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * The daily report's schedule as it will actually run — the saved values
 * with the environment filling the blanks — so the settings screen can say
 * "currently 12:00 to report@…" beside fields that may be empty.
 */
async function withReportSchedule(obj) {
  try {
    const s = await resolveSchedule();
    obj.dailyReport = {
      ...(obj.dailyReport || {}),
      effective: {
        enabled: s.enabled,
        envEnabled: s.envEnabled,
        to: s.to,
        hourIst: s.hourIst,
        minuteIst: s.minuteIst,
        time: `${pad2(s.hourIst)}:${pad2(s.minuteIst)}`,
      },
    };
  } catch (err) {
    console.error(`[settings] could not resolve the daily report schedule: ${err.message}`);
  }
  return obj;
}

/** The score-card rule list rides along so the settings screen can label the
 *  weights without a copy of the rules on the client. */
const withScoreRules = (obj) => {
  obj.leadScore = {
    ...(obj.leadScore || {}),
    rules: SCORE_RULES.map(({ key, label, defaultPoints, perEvent }) => ({ key, label, defaultPoints, perEvent: Boolean(perEvent) })),
  };
  return obj;
};

// GET /api/settings
const getSettings = asyncHandler(async (_req, res) => {
  const settings = await Setting.getGlobal();
  const obj = settings.toObject();
  if (obj.email?.pass) obj.email.pass = '********'; // never expose the SMTP password
  res.json({ success: true, data: withScoreRules(await withReportSchedule(obj)) });
});

// PUT /api/settings
const updateSettings = asyncHandler(async (req, res) => {
  const settings = await Setting.getGlobal();
  const { email, company, kit, salesOrder, dailyReport, leadScore, export: exportCfg } = req.body;

  let scoresRecomputed = null;
  if (leadScore) {
    const current = settings.leadScore.toObject();
    settings.leadScore = {
      ...current,
      ...leadScore,
      points: { ...current.points, ...(leadScore.points || {}) },
    };
  }

  if (email) {
    // Keep the stored password when the client sends back the mask
    if (email.pass === '********') delete email.pass;
    settings.email = { ...settings.email.toObject(), ...email };
  }
  if (company) settings.company = { ...settings.company.toObject(), ...company };
  if (kit) settings.kit = { ...settings.kit.toObject(), ...kit };
  if (salesOrder) settings.salesOrder = { ...settings.salesOrder.toObject(), ...salesOrder };
  // lastSentDay is the mailer's own bookkeeping and rides through the merge
  // untouched — the schema strips it if a client ever sends it.
  if (dailyReport) settings.dailyReport = { ...settings.dailyReport.toObject(), ...dailyReport };
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

  // A new send time takes effect at once — the pending timer is re-armed
  // from the saved settings, no restart needed.
  if (dailyReport) {
    await rescheduleDailyReport().catch((err) =>
      console.error(`[settings] daily report reschedule failed: ${err.message}`)
    );
  }
  // New weights apply to every lead straight away, not just the next one
  // touched — the stored totals are what lists and dashboards sort on.
  if (leadScore) {
    scoresRecomputed = await recomputeAllScores().catch((err) => {
      console.error(`[settings] lead score recompute failed: ${err.message}`);
      return null;
    });
  }

  await logActivity({
    userId: req.user._id, action: 'SETTINGS_UPDATED', entity: 'Setting', entityId: settings._id,
    details:
      'Updated system settings' +
      (dailyReport
        ? ` — daily report ${dailyReport.enabled === false ? 'switched off' : `at ${pad2(settings.dailyReport.hourIst ?? '--')}:${pad2(settings.dailyReport.minuteIst ?? '--')} IST`}`
        : '') +
      (scoresRecomputed ? ` — lead score weights changed, ${scoresRecomputed.updated} of ${scoresRecomputed.leads} lead scores updated` : ''),
    ip: req.ip,
  });

  const obj = settings.toObject();
  if (obj.email?.pass) obj.email.pass = '********';
  res.json({
    success: true,
    message: scoresRecomputed
      ? `Settings saved — ${scoresRecomputed.updated} of ${scoresRecomputed.leads} lead scores updated`
      : 'Settings saved',
    data: withScoreRules(await withReportSchedule(obj)),
  });
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

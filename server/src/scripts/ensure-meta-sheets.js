/**
 * One-time seed for Setting.metaSheets (see models/Setting.js and
 * services/metaSync.service.js).
 *
 * Before this feature, the Meta Ads sync watched exactly one sheet, picked
 * from META_SHEET_ID/META_SHEET_GID or the hardcoded default. Now that sheets
 * are managed from Settings -> Meta Ads instead, this runs once on first boot
 * after the deploy to carry that sheet into the new list — so nothing already
 * flowing into the CRM goes quiet — and adds the second lead-form sheet
 * (added 2026-08-20) alongside it so it starts being watched immediately.
 *
 * Idempotent: it only acts while metaSheets is still empty, so once an admin
 * has configured anything from the UI (including removing everything on
 * purpose) this never runs again.
 */
const Setting = require('../models/Setting');
const env = require('../config/env');
const { parseSheetUrl } = require('../services/metaSync.service');

// The sheet the sync originally shipped with.
const ORIGINAL_SHEET_ID = '1-StC2nI4qDDPc1OP9czHkPC5vYTjD1dULE9mWmn79Jg';
// The new lead-form sheet.
const NEW_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1PfiS0Zf1n3bb0_NnaJEdwt05JSrNJ1dcRpGvkaWRaio/edit';

async function ensureMetaSheets() {
  const settings = await Setting.getGlobal();
  if (settings.metaSheets.length) return 0;

  const originalId = env.metaSync.sheetId || ORIGINAL_SHEET_ID;
  settings.metaSheets.push({
    label: 'Meta Ads form 1',
    url: `https://docs.google.com/spreadsheets/d/${originalId}/edit`,
    sheetId: originalId,
    gid: env.metaSync.gid || '0',
    enabled: true,
  });

  const parsedNew = parseSheetUrl(NEW_SHEET_URL);
  if (parsedNew && parsedNew.sheetId !== originalId) {
    settings.metaSheets.push({
      label: 'Meta Ads form 2',
      url: NEW_SHEET_URL,
      sheetId: parsedNew.sheetId,
      gid: parsedNew.gid,
      enabled: true,
    });
  }

  await settings.save();
  return settings.metaSheets.length;
}

if (require.main === module) {
  require('dotenv').config();
  const mongoose = require('mongoose');

  (async () => {
    await mongoose.connect(env.mongoUri);
    console.log(`[meta-sheets] connected to ${mongoose.connection.name}`);
    const n = await ensureMetaSheets();
    console.log(n ? `[meta-sheets] seeded ${n} sheet(s)` : '[meta-sheets] already configured — nothing to do');
    await mongoose.disconnect();
  })().catch((err) => {
    console.error('[meta-sheets] seed failed:', err.message);
    process.exit(1);
  });
}

module.exports = { ensureMetaSheets };

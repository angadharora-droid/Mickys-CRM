const app = require('./app');
const env = require('./config/env');
const connectDB = require('./config/db');
const { startMetaSync } = require('./services/metaSync.service');
const { startFxSync } = require('./services/fx.service');
const { startDailyReport } = require('./services/dailyReport.service');
const { backfillLeadStates } = require('./scripts/backfill-states');
const { backfillMetaUsage } = require('./scripts/backfill-meta-usage');
const { ensureMetaSheets } = require('./scripts/ensure-meta-sheets');
const { ensureFobCatalogue } = require('./scripts/ensure-fob-catalogue');
const { updateRateCardTerms } = require('./scripts/update-rate-card-terms');

async function main() {
  try {
    await connectDB();
    app.listen(env.port, () => {
      console.log(`[server] Mickys PO API running on http://localhost:${env.port} (${env.nodeEnv})`);
    });
    // Carry the sync's original single sheet (plus the newly added one) into
    // Setting.metaSheets before the poller's first pass, so it starts reading
    // the configured list rather than the env/default fallback. No-op once
    // metaSheets already has anything in it.
    const seededSheets = await ensureMetaSheets();
    if (seededSheets) console.log(`[meta-sheets] seeded ${seededSheets} sheet(s) into Settings -> Meta Ads`);
    // Poll every configured Meta Ads lead sheet in-process, so new leads arrive
    // on their own.
    startMetaSync();
    // Refresh the export-kit exchange rates daily, so cards never use stale FX.
    startFxSync();
    // Email yesterday's activity digest to the report inbox every morning.
    startDailyReport();
    // Heal legacy data: derive each lead's state from its city (idempotent, so
    // it costs nothing once the data is in shape). New leads set it on create.
    backfillLeadStates()
      .then((n) => n && console.log(`[states] backfilled state on ${n} lead(s)`))
      .catch((err) => console.error('[states] backfill failed:', err.message));
    // Same for old Meta leads: lift the gravy/paste usage answer out of the
    // note into dailyUsage. New imports store it directly.
    backfillMetaUsage()
      .then((n) => n && console.log(`[usage] backfilled dailyUsage on ${n} Meta lead(s)`))
      .catch((err) => console.error('[usage] backfill failed:', err.message));
    // First run only: load the FOB cost master (export kit) from the workbook
    // transcription, since the manual seed script is kept local-only.
    ensureFobCatalogue()
      .then((n) => n && console.log(`[fob] seeded ${n} FOB cost item(s)`))
      .catch((err) => console.error('[fob] catalogue seed failed:', err.message));
    // Rate-card terms changed (no exchange-rate clause, 48-hour validity):
    // rewrite the old default clauses still stored in settings / lead terms.
    updateRateCardTerms()
      .then((n) => n && console.log(`[terms] rewrote rate-card terms on ${n} document(s)`))
      .catch((err) => console.error('[terms] terms update failed:', err.message));
  } catch (err) {
    console.error('[server] failed to start:', err.message);
    process.exit(1);
  }
}

process.on('unhandledRejection', (err) => {
  console.error('[server] unhandled rejection:', err);
});

main();

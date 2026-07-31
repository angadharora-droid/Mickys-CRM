/**
 * Run the Meta Ads lead-sheet sync by hand.
 *
 * The API already polls the sheet on its own (see services/metaSync.service.js,
 * disable with META_SYNC_ENABLED=false). This is the manual entry point for a
 * first import, a one-off catch-up, or checking what a sheet would produce
 * before committing to it.
 *
 * Usage:
 *   node src/scripts/sync-meta-leads.js                        # dry run — reports, writes nothing
 *   node src/scripts/sync-meta-leads.js --apply                # import new rows
 *   node src/scripts/sync-meta-leads.js --apply --interval=15  # keep running, re-check every 15 min
 *   node src/scripts/sync-meta-leads.js --apply --file=leads.csv   # import a downloaded CSV
 *
 * Options:
 *   --apply                  persist (without it nothing is written)
 *   --interval=<minutes>     stay running and re-sync on that cadence
 *   --file=<path>            read a local CSV export instead of fetching the sheet
 *   --url=<csv url>          fetch an explicit CSV url
 *   --sheet=<id> --gid=<id>  point at a different spreadsheet / tab
 *   --allow-duplicate-phone  import even when the phone already exists on another lead
 */
const mongoose = require('mongoose');
const env = require('../config/env');
const { syncMetaLeads, sheetCsvUrl } = require('../services/metaSync.service');

const ARGS = process.argv.slice(2).reduce((acc, arg) => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  acc[key] = value === undefined ? true : value;
  return acc;
}, {});

const APPLY = Boolean(ARGS.apply);
const INTERVAL_MIN = Number(ARGS.interval) || 0;

const options = {
  apply: APPLY,
  allowDuplicatePhone: Boolean(ARGS['allow-duplicate-phone']),
  file: ARGS.file ? String(ARGS.file) : undefined,
  csvUrl: ARGS.url ? String(ARGS.url) : undefined,
  sheetId: ARGS.sheet ? String(ARGS.sheet) : undefined,
  gid: ARGS.gid ? String(ARGS.gid) : undefined,
  log: (line) => console.log(`  ${line}`),
};

async function once() {
  const s = await syncMetaLeads(options);
  console.log(
    `[meta-sync] ${s.rows} row(s): ${s.imported} ${APPLY ? 'imported' : 'would import'}, ` +
      `${s.existing} already imported, ${s.dupPhone} duplicate phone, ${s.skipped} not a lead`
  );
}

async function run() {
  await mongoose.connect(env.mongoUri);
  console.log(`[meta-sync] connected to ${mongoose.connection.name} (${APPLY ? 'APPLY' : 'DRY RUN'})`);
  console.log(`[meta-sync] source: ${options.file || sheetCsvUrl(options)}`);
  if (!APPLY) console.log('[meta-sync] dry run — re-run with --apply to write these leads');

  await once();

  if (!INTERVAL_MIN) {
    await mongoose.disconnect();
    return;
  }

  console.log(`[meta-sync] watching the sheet — next check in ${INTERVAL_MIN} min (Ctrl+C to stop)`);
  const tick = async () => {
    // A transient fetch failure must not kill a long-running watcher.
    try { await once(); } catch (err) { console.error(`[meta-sync] ${err.message}`); }
    setTimeout(tick, INTERVAL_MIN * 60 * 1000);
  };
  setTimeout(tick, INTERVAL_MIN * 60 * 1000);
}

run().catch((err) => { console.error(err); process.exit(1); });

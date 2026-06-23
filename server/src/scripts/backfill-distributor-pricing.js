/**
 * One-time backfill for distributor lead rate snapshots created before the
 * Basic/DLP/DSP model existed. The old snapshot stored the Basic value in
 * `netRate`, so for each line we:
 *   - set `basic` = the old stored netRate (preserves any exec customisation),
 *   - set `dsp`   = the product's institutional rate (matched by SKU),
 *   - set `netRate` (= DLP) = Basic + GST rounded to ₹10,
 *   - set `standardNetRate` = the master's default DLP (for deviation display).
 *
 * Idempotent — skips lines that already carry `basic`, and 0-priced lines
 * (e.g. Tamarind Chutney) which stay "TBD".
 *
 * Usage:
 *   node src/scripts/backfill-distributor-pricing.js          # dry run (no writes)
 *   node src/scripts/backfill-distributor-pricing.js --apply  # persist changes
 */
const mongoose = require('mongoose');
const env = require('../config/env');
const Lead = require('../models/Lead');
const RateItem = require('../models/RateItem');

const roundTo10 = (n) => Math.round((Number(n) || 0) / 10) * 10;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const APPLY = process.argv.includes('--apply');

async function run() {
  await mongoose.connect(env.mongoUri);
  console.log(`[backfill] connected to ${mongoose.connection.name} (${APPLY ? 'APPLY' : 'DRY RUN'})`);

  const [distItems, instItems] = await Promise.all([
    RateItem.find({ kitType: 'distributor' }).select('_id sku netRate').lean(),
    RateItem.find({ kitType: 'institutional' }).select('sku netRate').lean(),
  ]);
  const distById = new Map(distItems.map((i) => [String(i._id), i]));
  const distBySku = new Map(distItems.map((i) => [i.sku, i]));
  const dspBySku = new Map(instItems.map((i) => [i.sku, i.netRate]));

  const leads = await Lead.find({ kitType: 'distributor' });
  let leadsChanged = 0;
  let linesChanged = 0;

  for (const lead of leads) {
    let touched = false;
    for (const line of lead.rates || []) {
      if (line.basic) continue; // already migrated
      // The old snapshot held the Basic value in netRate; preserve it (incl. any
      // exec customisation) as `basic` and derive the DLP from it.
      const basic = Number(line.netRate) || 0;
      if (!basic) continue; // 0-priced line (e.g. Tamarind Chutney) — stays TBD
      const master = distById.get(String(line.rateItemId)) || distBySku.get(line.sku);
      line.basic = basic;
      line.dsp = dspBySku.get(line.sku) || 0;
      const dlp = roundTo10(basic * (1 + line.gst / 100));
      line.netRate = dlp;
      line.netInclGst = round2(dlp);
      line.standardNetRate = roundTo10((master ? master.netRate : basic) * (1 + line.gst / 100));
      touched = true;
      linesChanged += 1;
    }
    if (touched) {
      leadsChanged += 1;
      if (APPLY) await lead.save();
      console.log(`  ${lead.refNumber}: ${lead.rates.length} line(s)${lead.locked ? ' [locked]' : ''}`);
    }
  }

  console.log(`[backfill] ${leadsChanged} lead(s), ${linesChanged} line(s) ${APPLY ? 'updated' : 'would update'}`);
  await mongoose.disconnect();
}

run().catch((err) => { console.error(err); process.exit(1); });

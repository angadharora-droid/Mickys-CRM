/**
 * One-time backfill for stockist lead rate snapshots created before the
 * Stockist Price became the editable line value. The old snapshot stored the
 * distributor-style DLP (Basic + GST rounded to ₹10) in `netRate`; the price
 * card derived Stockist Price = DLP × 0.95 at render time. Now the snapshot
 * itself carries the Stockist Price (exact DLP × 0.95), so for each line we:
 *   - set `standardNetRate` = the standard Stockist Price from `basic`,
 *   - set `netRate` = the standard Stockist Price, or — if the exec had
 *     overridden the DLP — that override × 0.95 (preserves the discount),
 *   - set `netInclGst` = the new netRate (Stockist Price includes GST),
 *   - recompute `deviationPct` against the new standard.
 *
 * Idempotent — skips lines whose standardNetRate already matches the new
 * Stockist Price formula, and 0-priced "TBD" lines (e.g. Tamarind Chutney).
 *
 * Usage:
 *   node src/scripts/backfill-stockist-pricing.js          # dry run (no writes)
 *   node src/scripts/backfill-stockist-pricing.js --apply  # persist changes
 */
const mongoose = require('mongoose');
const env = require('../config/env');
const Lead = require('../models/Lead');
const { stockistDlp, stockistPrice } = require('../config/kitContent');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const roundTo10 = (n) => Math.round((Number(n) || 0) / 10) * 10;
const APPLY = process.argv.includes('--apply');

async function run() {
  await mongoose.connect(env.mongoUri);
  console.log(`[backfill] connected to ${mongoose.connection.name} (${APPLY ? 'APPLY' : 'DRY RUN'})`);

  const leads = await Lead.find({ kitType: 'stockist' });
  let leadsChanged = 0;
  let linesChanged = 0;

  for (const lead of leads) {
    let touched = false;
    for (const line of lead.rates || []) {
      const basic = Number(line.basic) || 0;
      if (!basic) continue; // 0-priced line (e.g. Tamarind Chutney) — stays TBD
      const newStandard = stockistPrice(stockistDlp(basic, line.gst));
      if (line.standardNetRate === newStandard) continue; // already migrated
      const legacyStandard = roundTo10(basic * (1 + line.gst / 100));
      // An unmodified line held the standard DLP; an overridden one held the
      // exec's DLP — carry the override through at the same 5% stockist factor.
      line.netRate =
        line.netRate === line.standardNetRate || line.netRate === legacyStandard
          ? newStandard
          : stockistPrice(round2(line.netRate));
      line.standardNetRate = newStandard;
      line.netInclGst = line.netRate;
      line.deviationPct =
        newStandard > 0 && line.netRate < newStandard
          ? round2(((newStandard - line.netRate) / newStandard) * 100)
          : 0;
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

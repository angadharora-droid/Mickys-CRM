/**
 * Backfill `dailyUsage` on previously imported Meta Ads leads. The sync has
 * always folded the form's "how much gravy/paste do you use daily?" answer
 * into the internal note as "Daily gravy/paste usage: <answer>"; new imports
 * now also store it in the dedicated `dailyUsage` field, and this lifts the
 * answer out of the note for the leads imported before that field existed.
 *
 * Idempotent (only touches Meta leads whose dailyUsage is still blank), so it
 * also runs at server boot (see server.js) and old data heals on deploy.
 *
 *   node src/scripts/backfill-meta-usage.js           # dry run (report only)
 *   node src/scripts/backfill-meta-usage.js --apply   # write the field
 */
const Lead = require('../models/Lead');

const USAGE_RX = /^Daily gravy\/paste usage:\s*(.+)$/m;

/** Fill dailyUsage from the note on Meta leads that lack it. Returns count. */
async function backfillMetaUsage({ apply = true, log = () => {} } = {}) {
  const leads = await Lead.find({
    metaLeadId: { $type: 'string', $gt: '' },
    $or: [{ dailyUsage: '' }, { dailyUsage: { $exists: false } }],
  }).select('refNumber internalNotes');

  let touched = 0;
  for (const lead of leads) {
    const usage = (String(lead.internalNotes || '').match(USAGE_RX) || [])[1]?.trim();
    if (!usage) continue;
    touched += 1;
    log(`  ${lead.refNumber} -> "${usage}"`);
    if (apply) await Lead.updateOne({ _id: lead._id }, { $set: { dailyUsage: usage } });
  }
  return touched;
}

if (require.main === module) {
  require('dotenv').config();
  const mongoose = require('mongoose');
  const env = require('../config/env');

  (async () => {
    const apply = process.argv.includes('--apply');
    await mongoose.connect(env.mongoUri);
    console.log(`[usage] connected to ${env.mongoUri}${apply ? '' : '  (dry run — pass --apply to write)'}`);
    const touched = await backfillMetaUsage({ apply, log: console.log });
    console.log(
      touched
        ? `[usage] ${touched} Meta lead(s) ${apply ? 'updated' : 'would be updated'}`
        : '[usage] nothing to backfill'
    );
    await mongoose.disconnect();
  })().catch((err) => {
    console.error('[usage] failed:', err.message);
    process.exit(1);
  });
}

module.exports = { backfillMetaUsage };

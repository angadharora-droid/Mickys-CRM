/**
 * Finds and removes duplicate Meta Ads leads: two (or more) Lead documents
 * that carry the same `metaLeadId`.
 *
 * These should be impossible — Lead.js has a unique partial index on
 * metaLeadId — but on 2026-08-20 two concurrent sync runs (the 10-second
 * boot pass racing an admin's "Sync now" click, see metaSync.service.js's
 * `inFlight` lock, added the same day) each snapshotted "already imported"
 * before the other had written anything, so both imported the same rows.
 * Whether the unique index was ever actually built on this deployment is
 * worth checking too — see server.js's Lead.syncIndexes() log line at boot.
 *
 * For each duplicate group, the copy to keep is chosen by:
 *   - if exactly one copy has been worked (status changed, or more than the
 *     auto-import entry in statusHistory), keep that one and drop the
 *     untouched copies;
 *   - if more than one copy has been worked, the group is left alone and
 *     printed for manual review — a script shouldn't guess which is real;
 *   - otherwise (nothing worked on either copy) keep the earliest-created
 *     copy and drop the rest.
 *
 *   node src/scripts/dedupe-meta-leads.js            # dry run (report only)
 *   node src/scripts/dedupe-meta-leads.js --apply    # delete the duplicates
 */
const Lead = require('../models/Lead');

function isUntouched(lead) {
  return lead.status === 'new' && (lead.statusHistory || []).length <= 1;
}

/** Finds duplicate metaLeadId groups and (optionally) deletes the extra copies. */
async function dedupeMetaLeads({ apply = false, log = () => {} } = {}) {
  const leads = await Lead.find({ metaLeadId: { $type: 'string', $gt: '' } })
    .select('refNumber businessName mobileNumber metaLeadId status statusHistory assignedExecId createdAt')
    .sort({ createdAt: 1 })
    .lean();

  const byMetaId = new Map();
  for (const lead of leads) {
    const group = byMetaId.get(lead.metaLeadId) || [];
    group.push(lead);
    byMetaId.set(lead.metaLeadId, group);
  }

  let groupsFound = 0;
  let deleted = 0;
  let needsReview = 0;

  for (const [metaLeadId, group] of byMetaId) {
    if (group.length < 2) continue;
    groupsFound += 1;

    const touched = group.filter((l) => !isUntouched(l));
    if (touched.length > 1) {
      needsReview += 1;
      log(`? ${metaLeadId}: ${group.length} copies, ${touched.length} already worked — skipping, review by hand:`);
      group.forEach((l) => log(`    ${l.refNumber}  ${l.businessName}  ${l.mobileNumber}  status=${l.status}`));
      continue;
    }

    const keep = touched[0] || group[0]; // group[0] is earliest (sorted by createdAt above)
    const toDelete = group.filter((l) => l._id.toString() !== keep._id.toString());

    log(`- ${metaLeadId}: keeping ${keep.refNumber} (${keep.businessName}), dropping ${toDelete.map((l) => l.refNumber).join(', ')}`);
    if (apply) {
      await Lead.deleteMany({ _id: { $in: toDelete.map((l) => l._id) } });
    }
    deleted += toDelete.length;
  }

  return { groupsFound, deleted, needsReview };
}

if (require.main === module) {
  require('dotenv').config();
  const mongoose = require('mongoose');
  const env = require('../config/env');

  (async () => {
    const apply = process.argv.includes('--apply');
    await mongoose.connect(env.mongoUri);
    console.log(`[dedupe-meta] connected to ${mongoose.connection.name}${apply ? '' : '  (dry run — pass --apply to delete)'}`);
    const { groupsFound, deleted, needsReview } = await dedupeMetaLeads({ apply, log: console.log });
    console.log(
      `[dedupe-meta] ${groupsFound} duplicate group(s) found, ` +
        `${deleted} lead(s) ${apply ? 'deleted' : 'would be deleted'}` +
        (needsReview ? `, ${needsReview} group(s) need manual review (already worked on both copies)` : '')
    );
    await mongoose.disconnect();
  })().catch((err) => {
    console.error('[dedupe-meta] failed:', err.message);
    process.exit(1);
  });
}

module.exports = { dedupeMetaLeads };

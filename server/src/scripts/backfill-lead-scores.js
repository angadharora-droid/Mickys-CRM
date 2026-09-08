/**
 * One-time backfill for the lead status funnel + score card. Leads captured
 * before these existed carry no `stage` and a zero `score`. This script:
 *
 *   - infers each lead's stage from what the CRM already knows about it:
 *       client       an appointed customer points at the lead (clientMadeAt =
 *                    the appointment date)
 *       live         the kit pipeline moved past "new", or a visit / call /
 *                    sample / feedback is on record
 *       new          otherwise
 *     Leads that already have a stage are left alone.
 *   - recomputes every lead's stored score from the current weights.
 *
 * Idempotent — a second run finds nothing to do.
 *
 * Usage:
 *   node src/scripts/backfill-lead-scores.js          # dry run (no writes)
 *   node src/scripts/backfill-lead-scores.js --apply  # persist changes
 */
const mongoose = require('mongoose');
const env = require('../config/env');
const Lead = require('../models/Lead');
const AppointedCustomer = require('../models/AppointedCustomer');
const { recomputeAllScores } = require('../services/leadScore.service');

const APPLY = process.argv.includes('--apply');

async function run() {
  await mongoose.connect(env.mongoUri);
  console.log(`[backfill] connected to ${mongoose.connection.name} (${APPLY ? 'APPLY' : 'DRY RUN'})`);

  // Raw query on purpose: Mongoose would apply the schema default ("new") to a
  // missing stage on the way in, hiding exactly the leads this is for.
  const leads = await Lead.collection
    .find({ stage: { $exists: false } }, { projection: { refNumber: 1, status: 1, visitReports: 1, samples: 1, feedbacks: 1 } })
    .toArray();
  console.log(`[backfill] ${leads.length} lead(s) without a funnel stage`);

  const customers = await AppointedCustomer.find({ lead: { $in: leads.map((l) => l._id) } })
    .select('lead frozenAt createdAt')
    .lean();
  const customerOfLead = new Map(customers.map((c) => [String(c.lead), c]));

  const counts = { new: 0, live: 0, client: 0 };
  const ops = [];
  for (const l of leads) {
    const customer = customerOfLead.get(String(l._id));
    const worked =
      (l.status && l.status !== 'new') ||
      (l.visitReports || []).length > 0 ||
      (l.samples || []).length > 0 ||
      (l.feedbacks || []).length > 0;
    const stage = customer ? 'client' : worked ? 'live' : 'new';
    counts[stage] += 1;
    const set = { stage };
    const history = [];
    if (stage !== 'new') {
      history.push({
        from: 'new',
        to: stage,
        reason: customer ? 'Backfilled: appointed as customer' : 'Backfilled: lead already being worked',
        source: 'system',
        at: customer ? customer.frozenAt || customer.createdAt : new Date(),
      });
    }
    if (customer) set.clientMadeAt = customer.frozenAt || customer.createdAt || new Date();
    ops.push({ updateOne: { filter: { _id: l._id }, update: { $set: set, $push: { stageHistory: { $each: history } } }, timestamps: false } });
  }
  console.log(`[backfill] stages to set — new: ${counts.new}, live: ${counts.live}, client: ${counts.client}`);

  if (APPLY) {
    if (ops.length) await Lead.bulkWrite(ops, { ordered: false });
    const result = await recomputeAllScores();
    console.log(`[backfill] scores recomputed: ${result.updated} of ${result.leads} lead(s) changed`);
  } else {
    console.log('[backfill] dry run — re-run with --apply to write the stages and recompute scores');
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[backfill] failed:', err);
  process.exit(1);
});

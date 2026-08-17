/**
 * One-time migration for the sales order confirmation flow. The old status set
 * was open | dispatched | cancelled; it is now open | confirmed | closed |
 * cancelled, where 'closed' is the manual "goods gone, invoice in Tally"
 * signal that 'dispatched' used to be. 'dispatched' is no longer in the schema
 * enum, so until this has run those orders read as a status the app knows
 * nothing about — they render blank on the list and, worse, stop reserving
 * stock through the closed-order settle window. Run it as the new code
 * deploys. It touches:
 *
 *   - SalesOrder.status       — 'dispatched' becomes 'closed'.
 *   - SalesOrder.dispatchedAt — becomes closedAt, the same reservation-release
 *     clock under its new name. Orders with no dispatch timestamp keep none,
 *     which reads (correctly) as "settled long ago".
 *
 * Open and cancelled orders are untouched; a leftover dispatchedAt field on
 * them is dropped, since nothing reads it any more.
 *
 * Idempotent — a second run finds nothing to do.
 *
 * Usage:
 *   node src/scripts/migrate-sales-order-status.js          # dry run (no writes)
 *   node src/scripts/migrate-sales-order-status.js --apply  # persist changes
 */
const mongoose = require('mongoose');
const env = require('../config/env');
const SalesOrder = require('../models/SalesOrder');

const APPLY = process.argv.includes('--apply');

async function run() {
  await mongoose.connect(env.mongoUri);
  console.log(`[migrate] connected to ${mongoose.connection.name} (${APPLY ? 'APPLY' : 'DRY RUN'})`);

  // Queried straight off the collection: 'dispatched' is no longer a valid
  // enum value, so it must not go through the schema's casting on the way in.
  const collection = SalesOrder.collection;
  const dispatched = await collection.countDocuments({ status: 'dispatched' });
  if (APPLY && dispatched) {
    await collection.updateMany(
      { status: 'dispatched' },
      { $set: { status: 'closed' }, $rename: { dispatchedAt: 'closedAt' } }
    );
  }

  // Anything still carrying the old field is an order that was never
  // dispatched; the value is meaningless now and only invites confusion. The
  // status guard keeps the dry-run count honest — without it, the orders the
  // step above renames would be counted here a second time.
  const staleFilter = { dispatchedAt: { $exists: true }, status: { $ne: 'dispatched' } };
  const stale = await collection.countDocuments(staleFilter);
  if (APPLY && stale) {
    await collection.updateMany(staleFilter, { $unset: { dispatchedAt: '' } });
  }

  console.log(
    `[migrate] ${dispatched} dispatched order(s) ${APPLY ? 'moved to' : 'would move to'} closed; ` +
      `${stale} leftover dispatchedAt field(s) ${APPLY ? 'dropped' : 'would be dropped'}`
  );
  await mongoose.disconnect();
}

run().catch((err) => { console.error(err); process.exit(1); });

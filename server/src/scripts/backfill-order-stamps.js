/**
 * One-time backfill for the order pipeline. Orders booked before the pipeline
 * existed carry no stage stamps (confirmedAt, cancelledAt) and no history —
 * the funnel would count every old confirmed order as never confirmed. The
 * audit trail (ActivityLog SALES_ORDER_STATUS rows) knows when each move
 * happened, so it is replayed onto the order document:
 *
 *   - confirmedAt / closedAt / cancelledAt from the latest logged move into
 *     that status, where the order is still in it and the stamp is blank.
 *   - history[] rebuilt from the logged moves for orders whose history is
 *     empty, with the booking as the first row.
 *
 * Orders with no trail at all keep blank stamps: an order confirmed at an
 * unknown time is reported as such, not invented.
 *
 * Idempotent — a second run finds nothing to do.
 *
 * Usage:
 *   node src/scripts/backfill-order-stamps.js          # dry run (no writes)
 *   node src/scripts/backfill-order-stamps.js --apply  # persist changes
 */
const mongoose = require('mongoose');
const env = require('../config/env');
const SalesOrder = require('../models/SalesOrder');
const ActivityLog = require('../models/ActivityLog');

const APPLY = process.argv.includes('--apply');

const STAMP = { confirmed: 'confirmedAt', closed: 'closedAt', cancelled: 'cancelledAt' };

const loggedStatus = (log) =>
  log.meta?.status ||
  (String(log.details || '').match(/\bmarked (open|confirmed|invoiced|dispatched|delivered|closed|cancelled)\b/) || [])[1] ||
  '';

async function run() {
  await mongoose.connect(env.mongoUri);
  console.log(`[backfill] connected to ${mongoose.connection.name} (${APPLY ? 'APPLY' : 'DRY RUN'})`);

  const orders = await SalesOrder.find({
    $or: [
      { status: 'confirmed', confirmedAt: null },
      { status: 'cancelled', cancelledAt: null },
      { status: 'closed', closedAt: null },
      { history: { $size: 0 } },
    ],
  }).select('number status createdAt createdBy confirmedAt closedAt cancelledAt history');
  console.log(`[backfill] ${orders.length} order(s) to look at`);

  const logs = await ActivityLog.find({
    entity: 'SalesOrder',
    action: 'SALES_ORDER_STATUS',
    entityId: { $in: orders.map((o) => o._id) },
  })
    .select('entityId userId details meta timestamp')
    .sort({ timestamp: 1 })
    .lean();
  const trail = new Map();
  for (const log of logs) {
    const id = String(log.entityId);
    if (!trail.has(id)) trail.set(id, []);
    trail.get(id).push(log);
  }

  let stamped = 0;
  let historied = 0;
  for (const order of orders) {
    const moves = (trail.get(String(order._id)) || [])
      .map((l) => ({ to: loggedStatus(l), from: l.meta?.from || '', at: l.timestamp, by: l.userId }))
      .filter((m) => m.to);

    const field = STAMP[order.status];
    if (field && !order[field]) {
      const last = [...moves].reverse().find((m) => m.to === order.status);
      if (last) {
        order[field] = last.at;
        stamped += 1;
        console.log(`  ${order.number}: ${field} ← ${last.at.toISOString()}`);
      } else {
        console.log(`  ${order.number}: ${order.status} with no logged move — left blank`);
      }
    }

    if (!order.history.length) {
      order.history = [
        { from: '', to: 'open', at: order.createdAt, by: order.createdBy, note: 'Order booked (backfilled)' },
        ...moves.map((m) => ({ from: m.from, to: m.to, at: m.at, by: m.by, note: 'Backfilled from activity log' })),
      ];
      historied += 1;
    }

    if (APPLY && order.isModified()) await order.save();
  }

  console.log(
    `[backfill] ${stamped} stamp(s) ${APPLY ? 'written' : 'would be written'}; ` +
      `${historied} history trail(s) ${APPLY ? 'rebuilt' : 'would be rebuilt'}`
  );
  await mongoose.disconnect();
}

run().catch((err) => { console.error(err); process.exit(1); });

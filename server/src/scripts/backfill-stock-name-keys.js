/**
 * One-time backfill for the stock reservation layer. Everything that joins a
 * sales order to the Tally mirror now goes through `nameKey` (the item name
 * trimmed, upper-cased and with inner whitespace collapsed), and rows without
 * one are dropped from the join on purpose — so until this has run, orders
 * read as reserving nothing, which looks exactly like the pre-feature
 * behaviour and is therefore invisible. Run it before deploying the code that
 * reads the key. It touches:
 *
 *   - StockItem.nameKey        — set from the mirrored Tally name.
 *   - SalesOrder.items[].nameKey — set from each line's stored name (an
 *     appointed customer's line carries their frozen UPPERCASE name, which is
 *     precisely why the raw name never matched).
 *   - SalesOrder.closedAt      — set to updatedAt on already-closed orders, so
 *     they read as long settled rather than as a missing field.
 *   - StockSyncLog.syncedAt    — set to createdAt on historic sync rows, which
 *     is the closest record those rows have of their data cut-off.
 *
 * Also reports nameKey collisions in the mirror: two Tally items differing
 * only in case or spacing share one key and would each be charged the full
 * reserved quantity. Nothing is repaired automatically — the fix is to rename
 * one of them in Tally.
 *
 * Idempotent — only fills in what is missing.
 *
 * Usage:
 *   node src/scripts/backfill-stock-name-keys.js          # dry run (no writes)
 *   node src/scripts/backfill-stock-name-keys.js --apply  # persist changes
 */
const mongoose = require('mongoose');
const env = require('../config/env');
const SalesOrder = require('../models/SalesOrder');
const StockItem = require('../models/StockItem');
const StockSyncLog = require('../models/StockSyncLog');
const { nameKeyOf } = require('../services/stockAvailability.service');

const APPLY = process.argv.includes('--apply');

async function run() {
  await mongoose.connect(env.mongoUri);
  console.log(`[backfill] connected to ${mongoose.connection.name} (${APPLY ? 'APPLY' : 'DRY RUN'})`);

  const items = await StockItem.find().select('name nameKey').lean();
  const byKey = new Map();
  let itemsChanged = 0;
  const itemOps = [];
  for (const item of items) {
    const key = nameKeyOf(item.name);
    byKey.set(key, [...(byKey.get(key) || []), item.name]);
    if (item.nameKey === key) continue;
    itemsChanged += 1;
    itemOps.push({ updateOne: { filter: { _id: item._id }, update: { $set: { nameKey: key } } } });
  }
  if (APPLY && itemOps.length) await StockItem.bulkWrite(itemOps, { ordered: false });

  const collisions = [...byKey.entries()].filter(([, names]) => names.length > 1);
  for (const [key, names] of collisions) {
    console.log(`  ! collision on "${key}": ${names.join(' | ')} — both will show the same reserved qty`);
  }

  const orders = await SalesOrder.find();
  let ordersChanged = 0;
  let linesChanged = 0;
  for (const order of orders) {
    let touched = false;
    for (const line of order.items || []) {
      const key = nameKeyOf(line.name);
      if (line.nameKey === key) continue;
      line.nameKey = key;
      linesChanged += 1;
      touched = true;
    }
    // A close that happened before this shipped has long since been invoiced
    // in Tally; updatedAt is the closest timestamp we have and puts the order
    // safely past the settle window. (Run migrate:order-status first — that is
    // what turns the old 'dispatched' orders into closed ones.)
    if (order.status === 'closed' && !order.closedAt) {
      order.closedAt = order.updatedAt;
      touched = true;
    }
    if (!touched) continue;
    ordersChanged += 1;
    if (APPLY) await order.save();
  }

  const logs = await StockSyncLog.find({ syncedAt: null }).select('createdAt');
  if (APPLY && logs.length) {
    await StockSyncLog.bulkWrite(
      logs.map((l) => ({
        updateOne: { filter: { _id: l._id }, update: { $set: { syncedAt: l.createdAt } } },
      })),
      { ordered: false }
    );
  }

  console.log(
    `[backfill] ${itemsChanged} stock item(s), ${ordersChanged} order(s) / ${linesChanged} line(s), ` +
      `${logs.length} sync log(s) ${APPLY ? 'updated' : 'would update'}` +
      (collisions.length ? `; ${collisions.length} name collision(s) need fixing in Tally` : '')
  );
  await mongoose.disconnect();
}

run().catch((err) => { console.error(err); process.exit(1); });

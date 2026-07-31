/**
 * Backfill every lead's `state` from its stored city (config/indianCities.js
 * knows which state each canonical city belongs to). Cities off the Indian
 * list (foreign cities on export leads) are left alone, so a hand-entered
 * state survives there.
 *
 * Idempotent and cheap — one updateMany per distinct city, each matching only
 * leads whose state is missing or wrong — so it also runs automatically at
 * server boot (see server.js) and existing data heals itself on deploy.
 *
 *   node src/scripts/backfill-states.js           # dry run (report only)
 *   node src/scripts/backfill-states.js --apply   # write the states
 */
const Lead = require('../models/Lead');
const { stateForCity } = require('../config/indianCities');

/** Set state-from-city on every lead that is missing it or has it wrong.
 *  Returns the number of leads updated. */
async function backfillLeadStates({ apply = true, log = () => {} } = {}) {
  const cities = (await Lead.distinct('city')).filter(Boolean);
  let touched = 0;
  for (const city of cities.sort((a, b) => a.localeCompare(b))) {
    const state = stateForCity(city);
    if (!state) continue;
    const filter = { city, state: { $ne: state } };
    if (!apply) {
      const count = await Lead.countDocuments(filter);
      if (count) {
        touched += count;
        log(`  "${city}" -> ${state}  (${count} lead${count === 1 ? '' : 's'})`);
      }
      continue;
    }
    const res = await Lead.updateMany(filter, { $set: { state } });
    if (res.modifiedCount) {
      touched += res.modifiedCount;
      log(`  "${city}" -> ${state}  (${res.modifiedCount} lead${res.modifiedCount === 1 ? '' : 's'})`);
    }
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
    console.log(`[states] connected to ${env.mongoUri}${apply ? '' : '  (dry run — pass --apply to write)'}`);
    const touched = await backfillLeadStates({ apply, log: console.log });
    console.log(
      touched
        ? `[states] ${touched} lead(s) ${apply ? 'updated' : 'would be updated'}`
        : '[states] every lead already carries the right state'
    );
    await mongoose.disconnect();
  })().catch((err) => {
    console.error('[states] failed:', err.message);
    process.exit(1);
  });
}

module.exports = { backfillLeadStates };

/**
 * One-off migration: snap every lead's stored city onto the canonical
 * Indian-city spelling (config/indianCities.js) — fixing typos, case drift and
 * old names ("mumbay", "NAGPUR", "Bombay" all become "Mumbai"/"Nagpur").
 * Values that don't match any known city (e.g. foreign cities on export leads)
 * are only tidied to Title Case, never dropped.
 *
 * Ref numbers embed a city code from creation time; they are identifiers and
 * are intentionally left untouched.
 *
 *   node src/scripts/normalize-cities.js           # dry run (report only)
 *   node src/scripts/normalize-cities.js --apply   # write the corrections
 */
require('dotenv').config();
const mongoose = require('mongoose');
const env = require('../config/env');
const Lead = require('../models/Lead');
const { canonicalCity, isKnownCity } = require('../config/indianCities');

async function main() {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(env.mongoUri);
  console.log(`[cities] connected to ${env.mongoUri}${apply ? '' : '  (dry run — pass --apply to write)'}`);

  const distinct = (await Lead.distinct('city')).filter(Boolean);
  let changed = 0;
  let touchedLeads = 0;
  const unknown = [];

  for (const value of distinct.sort((a, b) => a.localeCompare(b))) {
    const fixed = canonicalCity(value);
    if (!isKnownCity(fixed)) unknown.push(fixed);
    if (fixed === value) continue;

    changed += 1;
    const count = await Lead.countDocuments({ city: value });
    console.log(`  "${value}" -> "${fixed}"  (${count} lead${count === 1 ? '' : 's'})`);
    if (apply) {
      const res = await Lead.updateMany({ city: value }, { $set: { city: fixed } });
      touchedLeads += res.modifiedCount || 0;
    }
  }

  if (!changed) console.log('[cities] every stored city already matches its canonical spelling');
  else console.log(`[cities] ${changed} distinct value(s) ${apply ? 'corrected' : 'would be corrected'}${apply ? ` across ${touchedLeads} lead(s)` : ''}`);
  if (unknown.length) {
    console.log(
      `[cities] not on the Indian list (kept as-is, still selectable in the dropdown): ${[...new Set(unknown)].join(', ')}`
    );
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[cities] failed:', err.message);
  process.exit(1);
});

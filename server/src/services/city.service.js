const City = require('../models/City');
const Lead = require('../models/Lead');
const ApiError = require('../utils/ApiError');
const { logActivity } = require('./activity.service');
const {
  INDIAN_CITIES,
  canonicalCity,
  cityKey,
  setCustomCities,
  addCustomCity,
  checkNewCity,
} = require('../config/indianCities');

// User-added cities are cached in config/indianCities.js so canonicalCity()
// stays synchronous. Re-read at most once a minute; a city added on this
// instance is registered immediately, so the TTL only matters for another
// instance's additions.
const TTL_MS = 60 * 1000;
let loadedAt = 0;

/** Load (or refresh) the user-added cities into canonicalCity()'s lookup. */
async function ensureCustomCities({ force = false } = {}) {
  if (!force && Date.now() - loadedAt < TTL_MS) return;
  const rows = await City.find({}, 'name').lean();
  setCustomCities(rows.map((r) => r.name));
  loadedAt = Date.now();
}

/**
 * The city dropdown's options: the Indian list, then user-added cities, then
 * any other city stored on a lead (legacy or foreign values). One entry per
 * city key, so spelling variants of the same city never appear twice.
 */
async function cityOptions() {
  await ensureCustomCities({ force: true });
  const [custom, onLeads] = await Promise.all([
    City.find({}, 'name').lean(),
    Lead.distinct('city'),
  ]);
  const byKey = new Map();
  for (const name of [...INDIAN_CITIES, ...custom.map((c) => c.name), ...onLeads]) {
    const key = cityKey(name);
    if (key && !byKey.has(key)) byKey.set(key, name);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * Add a city to the dropdown, refusing duplicates. Returns one of:
 *   { city, created: true }            — added
 *   { city, created: false }           — already listed (any spelling, old
 *                                        name or alias); use this one
 *   { name, similar, created: false }  — a near-miss of a listed city; the
 *                                        caller confirms with force=true
 */
async function addCity(input, { force = false, user, ip } = {}) {
  const tidy = String(input || '').replace(/\s+/g, ' ').trim();
  if (cityKey(tidy).length < 2) throw ApiError.badRequest('Enter a city name');

  await ensureCustomCities({ force: true });
  const onLeads = (await Lead.distinct('city')).filter(Boolean);
  const check = checkNewCity(tidy, onLeads);

  if (check.existing) {
    // A legacy lead value that canonicalCity() would rewrite on save (e.g. a
    // foreign city one typo away from an Indian one) is registered so picking
    // it keeps it as shown.
    if (canonicalCity(check.existing) !== check.existing) await saveCity(check.existing, user);
    return { city: check.existing, created: false };
  }
  if (check.state) throw ApiError.badRequest(`${check.state} is a state — pick a city in it`);
  if (check.similar && !force) return { name: check.name, similar: check.similar, created: false };

  const saved = await saveCity(check.name, user);
  if (saved.created) {
    await logActivity({
      userId: user?._id, action: 'CITY_ADDED', entity: 'City', entityId: saved.id,
      details: `Added city "${saved.name}"`, ip,
    });
  }
  return { city: saved.name, created: saved.created };
}

/** Insert a City row; a concurrent insert of the same key wins quietly. */
async function saveCity(name, user) {
  const key = cityKey(name);
  try {
    const row = await City.create({ name, key, createdBy: user?._id });
    addCustomCity(row.name);
    return { name: row.name, id: row._id, created: true };
  } catch (err) {
    if (err.code !== 11000) throw err;
    const row = await City.findOne({ key }).lean();
    addCustomCity(row.name);
    return { name: row.name, id: row._id, created: false };
  }
}

module.exports = { ensureCustomCities, cityOptions, addCity };

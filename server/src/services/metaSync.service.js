/**
 * Meta (Facebook/Instagram) lead-form sync.
 *
 * Leads captured by the Meta lead form land in a Google Sheet. This reads that
 * sheet and turns each row into a normal `new` lead, created by — and parked on
 * — a dedicated "Meta Ads" account, so an admin can hand each one to a sales
 * exec with the usual reassign action.
 *
 * Only the columns the CRM has a home for are mapped onto lead fields; the
 * campaign/ad metadata and the form's gravy/paste answer are folded into the
 * lead's internal note so nothing from the sheet is lost.
 *
 *   full_name      -> contactPerson        company_name -> businessName
 *   phone_number   -> mobileNumber         email        -> email
 *   city           -> city                 business_type_ -> businessType (enum)
 *   created_time   -> leadDate             id           -> metaLeadId (dedupe key)
 *   "how much gravy…" -> dailyUsage (also echoed into the note)
 *   platform / campaign_name / ad_name / form_name -> internalNotes
 *
 * The sync is idempotent: rows are keyed on the Meta lead id, so it can be run
 * repeatedly — on the API's own schedule or from the CLI — and only ever adds
 * rows it has not imported before. A unique index on `metaLeadId` backs this up,
 * so even two runs racing each other cannot produce a duplicate lead.
 *
 * The sheet is read through Google's CSV export endpoint and so must be readable
 * without a login (Share -> "Anyone with the link"). No API key or service
 * account is involved.
 *
 * More than one ad form can be running at once, each landing leads in its own
 * sheet. Which sheets to watch is normally configured by an admin in Settings
 * -> Meta Ads (Setting.metaSheets, see models/Setting.js) rather than in
 * environment variables, so a new form can be added without a redeploy. The
 * env vars (META_SHEET_ID / META_SHEET_GID / META_SHEET_CSV_URL) still work as
 * a fallback for a deploy that hasn't configured any sheet in the DB yet.
 */
const fs = require('fs');
const crypto = require('crypto');
const env = require('../config/env');
const Lead = require('../models/Lead');
const User = require('../models/User');
const Counter = require('../models/Counter');
const Setting = require('../models/Setting');
const { logActivity } = require('./activity.service');
const { canonicalCity, stateForCity } = require('../config/indianCities');

// The Meta Ads lead-form sheet this sync was originally built against. Used
// only when no sheet has been configured yet (fresh deploy, no DB config) and
// no env override is set either.
const DEFAULT_SHEET_ID = '1-StC2nI4qDDPc1OP9czHkPC5vYTjD1dULE9mWmn79Jg';

// The pseudo-account every imported lead is created by and assigned to. It is
// created inactive: nobody logs in as it, and it never shows up as a target in
// the "reassign to exec" picker — it only labels where the lead came from.
const META_USER = {
  name: 'Meta Ads',
  email: 'meta-ads@mickys.local',
  role: 'sales_exec',
  employeeCode: 'META',
};

// ----------------------------------------------------------------- csv ----

/** Minimal RFC 4180 reader — handles quoted fields, embedded commas/newlines. */
function parseCsv(text) {
  const rows = [];
  const src = text.replace(/^﻿/, '');
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (src[i + 1] === '"') { field += '"'; i += 1; } // escaped quote
      else quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** "“how_much_gravy/paste_do_you_use_daily?”" -> "how_much_gravy_paste_do_you_use_daily" */
const headerKey = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

/**
 * Turn CSV rows into objects. The header row is located by content rather than
 * position, so leading blank rows (and re-pasted header rows further down, as
 * happens when tabs are merged) don't break the mapping.
 */
function toRecords(rows) {
  const headerIdx = rows.findIndex((r) => {
    const keys = r.map(headerKey);
    return keys.includes('id') && keys.includes('created_time');
  });
  if (headerIdx === -1) return { headers: [], records: [] };

  const headers = rows[headerIdx].map(headerKey);
  const records = [];
  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const cells = rows[i];
    if (!cells.some((c) => String(c).trim())) continue; // blank spacer row
    const rec = {};
    headers.forEach((h, idx) => { if (h) rec[h] = String(cells[idx] ?? '').trim(); });
    // A repeated header row (second tab pasted below the first) is not data.
    if (headerKey(rec.id) === 'id') continue;
    records.push(rec);
  }
  return { headers, records };
}

/** First non-empty value among columns whose key matches any of `patterns`. */
function pick(rec, ...patterns) {
  for (const p of patterns) {
    for (const [key, value] of Object.entries(rec)) {
      const hit = typeof p === 'string' ? key === p : p.test(key);
      if (hit && value) return value;
    }
  }
  return '';
}

// --------------------------------------------------------- normalising ----

/** Meta prefixes ids with a type tag: `p:+9198…`, `l:1065…`, `ag:1202…`. */
const stripTag = (v) => String(v || '').replace(/^[a-z]{1,3}:\s*/i, '').trim();

const cleanPhone = (v) => stripTag(v).replace(/[^\d+]/g, '');

/** Last 10 digits — how two spellings of the same Indian number are compared. */
const phoneKey = (v) => cleanPhone(v).replace(/\D/g, '').slice(-10);

/** Collapse whitespace; capitalise only if the value arrived all lowercase. */
function tidy(v) {
  const s = String(v || '').replace(/\s+/g, ' ').trim();
  if (!s || s !== s.toLowerCase()) return s;
  return s.replace(/(^|\s)([a-z])/g, (_, sep, c) => sep + c.toUpperCase());
}

/**
 * Meta's multiple-choice answers arrive underscored and, when the option had an
 * emoji, with the emoji mangled by the sheet export ("50+_kg_(high_volume_🔥)").
 * These options are always ASCII, so anything outside it is dropped.
 */
function cleanAnswer(v) {
  return String(v || '')
    .replace(/[^\x20-\x7E–—]/g, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([)\]])/g, '$1')
    .replace(/\(\s*\)/g, '')
    .trim();
}

/**
 * Map the form's business-type option onto the CRM enum. Matching is loose on
 * purpose: the options are authored in Ads Manager and drift ("cloud_kitchen_",
 * "qsr_/_fast_food", "hotel_kitchen", and the live typo "disteributor").
 */
function mapBusinessType(v) {
  const s = String(v || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  if (!s) return 'Other';
  if (s.includes('cloud')) return 'Cloud Kitchen';
  if (s.includes('qsr') || s.includes('fast food')) return 'QSR';
  if (s.includes('cater')) return 'Caterer';
  if (s.includes('hotel')) return 'Hotel';
  if (s.includes('restaurant')) return 'Restaurant';
  if (s.startsWith('dist') || s.includes('ributor')) return 'Distributor';
  if (s.includes('institut') || s.includes('school') || s.includes('hospital')) return 'Institution';
  return 'Other';
}

const PLATFORMS = { fb: 'Facebook', ig: 'Instagram', msg: 'Messenger', an: 'Audience Network' };
const platformName = (v) => PLATFORMS[String(v || '').toLowerCase()] || tidy(v);

const isTestRow = (rec) => Object.values(rec).some((v) => /<test lead:/i.test(v));

/** Builds the next quotation reference: MKY-[CITY3]-[DDMMYY]-[###]. */
async function nextRefNumber(city, when) {
  const code = String(city || '')
    .replace(/[^a-zA-Z]/g, '')
    .slice(0, 3)
    .toUpperCase()
    .padEnd(3, 'X');
  const d = when instanceof Date && !Number.isNaN(when.getTime()) ? when : new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  const key = `MKY-${code}-${dd}${mm}${yy}`;
  return `${key}-${String(await Counter.next(key)).padStart(3, '0')}`;
}

// ------------------------------------------------------------ mapping ----

/** One sheet row -> the lead fields we can fill, or null if it isn't a lead. */
function toLead(rec) {
  const metaLeadId = String(rec.id || '').trim();
  if (!metaLeadId || isTestRow(rec)) return null;

  const contactPerson = tidy(pick(rec, 'full_name', /full_name|^name$/));
  const companyName = tidy(pick(rec, 'company_name', /company/));
  const mobileNumber = cleanPhone(pick(rec, 'phone_number', /phone/));
  const city = tidy(pick(rec, 'city', /^city/));

  // Both name columns are free text and either can be blank; each falls back to
  // the other so the two required identity fields are always populated.
  const businessName = companyName || contactPerson;
  const person = contactPerson || companyName;
  if (!businessName || !mobileNumber) return null;

  const createdRaw = pick(rec, 'created_time', /created/);
  const createdAt = new Date(createdRaw);
  const leadDate = Number.isNaN(createdAt.getTime()) ? new Date() : createdAt;

  const platform = platformName(pick(rec, 'platform'));
  const usage = cleanAnswer(pick(rec, /gravy|paste|daily/));
  const campaign = tidy(pick(rec, 'campaign_name', /campaign_name/));
  const adName = tidy(pick(rec, 'ad_name', /^ad_name/));
  const formName = tidy(pick(rec, 'form_name', /form_name/));
  const organic = String(pick(rec, 'is_organic')).toLowerCase() === 'true';

  const notes = ['Imported from the Meta Ads lead form.'];
  if (usage) notes.push(`Daily gravy/paste usage: ${usage}`);
  const origin = [
    platform && `Platform: ${organic ? `${platform} (organic)` : platform}`,
    campaign && `Campaign: ${campaign}`,
    adName && `Ad: ${adName}`,
    formName && `Form: ${formName}`,
  ].filter(Boolean);
  if (origin.length) notes.push(origin.join(' · '));
  // Pinned to IST so the note reads the same whatever timezone the server runs in.
  const submitted = leadDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
  notes.push(`Meta lead id: ${metaLeadId} · Submitted: ${submitted} IST`);

  return {
    metaLeadId,
    businessName,
    contactPerson: person,
    mobileNumber,
    email: String(pick(rec, 'email', /email/)).toLowerCase(),
    // Snapped to the canonical Indian-city spelling so form typos ("mumbay")
    // land on the same value as hand-entered leads. The state follows the city.
    city: canonicalCity(city) || 'Unknown',
    state: stateForCity(city),
    businessType: mapBusinessType(pick(rec, 'business_type', /business_type/)),
    leadSource: 'Meta Ads',
    leadDate,
    // The form's usage answer gets its own field (shown on the lead list);
    // the note keeps a copy so the import trail stays complete.
    dailyUsage: usage,
    internalNotes: notes.join('\n'),
  };
}

// ------------------------------------------------------------- source ----

function sheetCsvUrl({ sheetId, gid, csvUrl } = {}) {
  if (csvUrl || env.metaSync.csvUrl) return csvUrl || env.metaSync.csvUrl;
  const id = sheetId || env.metaSync.sheetId || DEFAULT_SHEET_ID;
  const tab = gid || env.metaSync.gid || '0';
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${tab}`;
}

async function fetchCsv(opts = {}) {
  if (opts.file) return fs.readFileSync(opts.file, 'utf8');

  const res = await fetch(sheetCsvUrl(opts), { redirect: 'follow' });
  if (!res.ok) throw new Error(`sheet fetch failed: HTTP ${res.status} ${res.statusText}`);
  const body = await res.text();
  // Google answers an unauthorised export with a sign-in HTML page, not a 4xx.
  if (/^\s*</.test(body)) {
    throw new Error(
      'the sheet is not publicly readable — open it, then Share -> General access -> ' +
        '"Anyone with the link" (Viewer)'
    );
  }
  return body;
}

/**
 * Pulls the spreadsheet id (and tab gid, if the link points at a specific tab)
 * out of whatever a person pastes: the browser's edit URL, a share link, the
 * CSV export URL, or the bare id. Returns null if nothing id-shaped is found.
 */
function parseSheetUrl(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  const pathMatch = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const sheetId = pathMatch ? pathMatch[1] : (/^[a-zA-Z0-9-_]{20,60}$/.test(s) ? s : null);
  if (!sheetId) return null;
  const gidMatch = s.match(/[#&?]gid=(\d+)/);
  return { sheetId, gid: gidMatch ? gidMatch[1] : '0' };
}

/**
 * The sheets to poll on this pass: every enabled row an admin has configured
 * in Settings -> Meta Ads (Setting.metaSheets). Falls back to the single
 * env-configured / default sheet only when none has been configured yet, so
 * an existing deploy doesn't go quiet the moment this feature ships.
 */
async function listSheetSources() {
  const settings = await Setting.getGlobal();
  const configured = (settings.metaSheets || []).filter((s) => s.enabled !== false && s.sheetId);
  if (configured.length) {
    return configured.map((s) => ({
      id: String(s._id),
      label: s.label || s.url || s.sheetId,
      sheetId: s.sheetId,
      gid: s.gid || '0',
    }));
  }
  return [
    {
      id: null,
      label: 'Default',
      sheetId: env.metaSync.sheetId || DEFAULT_SHEET_ID,
      gid: env.metaSync.gid || '0',
      csvUrl: env.metaSync.csvUrl || undefined,
    },
  ];
}

/** Find (or create, once) the "Meta Ads" account leads are attributed to. */
async function getMetaUser({ create = true } = {}) {
  const existing = await User.findOne({ email: META_USER.email });
  if (existing || !create) return existing;
  return User.create({
    ...META_USER,
    // Never used to sign in — the account is created inactive.
    password: crypto.randomBytes(24).toString('hex'),
    isActive: false,
  });
}

// --------------------------------------------------------------- sync ----

// Every caller — the boot-time pass, the 15-minute scheduler tick, and an
// admin's "Sync now" click — goes through this one lock. Without it, two
// overlapping runs each snapshot `existingIds` before the other has written
// anything, so both import the same rows as "new": exactly what happened the
// day this sheet-management feature shipped, producing 154 duplicate leads
// from one race between the boot sync and a manual sync-now.
let inFlight = null;

/**
 * Import every sheet row not already in the CRM, across every configured
 * Meta Ads sheet.
 *
 * @param {object}   opts
 * @param {boolean}  opts.apply                 persist (false = report only)
 * @param {boolean}  opts.allowDuplicatePhone   import even if the number is on another lead
 * @param {string}   opts.file                  read a local CSV instead of fetching (single-source override)
 * @param {string}   opts.csvUrl                explicit CSV url (single-source override)
 * @param {string}   opts.sheetId               explicit sheet id (single-source override)
 * @param {string}   opts.gid                   explicit tab gid (single-source override)
 * @param {function} opts.log                   per-lead / per-sheet reporter
 * @returns {Promise<object>} counts of what happened, plus a `bySource` breakdown
 */
function syncMetaLeads(opts = {}) {
  // A run already in progress covers this call too — join it rather than
  // starting a second pass with a stale view of what's already imported.
  if (inFlight) return inFlight;
  inFlight = runSync(opts).finally(() => { inFlight = null; });
  return inFlight;
}

async function runSync(opts = {}) {
  const { apply = false, allowDuplicatePhone = false, log = () => {} } = opts;

  // Explicit overrides (CLI flags, or "test this link before saving it") point
  // at exactly one sheet and skip the configured list entirely.
  const explicit = opts.file || opts.csvUrl || opts.sheetId;
  const sources = explicit
    ? [{ id: null, label: opts.label || 'Explicit source', file: opts.file, csvUrl: opts.csvUrl, sheetId: opts.sheetId, gid: opts.gid }]
    : await listSheetSources();

  const metaUser = apply ? await getMetaUser() : await getMetaUser({ create: false });

  // Loaded once and shared across every sheet so a lead already imported from
  // (or a phone number already on) one sheet is correctly recognised while
  // reading the next — otherwise two forms sharing a contact would double-book it.
  const existingIds = new Set(
    (await Lead.find({ metaLeadId: { $type: 'string', $gt: '' } }).select('metaLeadId').lean())
      .map((l) => l.metaLeadId)
  );
  const phoneIndex = new Map(
    (await Lead.find().select('mobileNumber refNumber').lean())
      .map((l) => [phoneKey(l.mobileNumber), l.refNumber])
  );
  const seen = new Set();

  const stats = { rows: 0, imported: 0, existing: 0, skipped: 0, dupPhone: 0, bySource: [] };
  const tagSource = sources.length > 1;

  for (const source of sources) {
    const s = { id: source.id, label: source.label, rows: 0, imported: 0, existing: 0, skipped: 0, dupPhone: 0, error: null };

    let records;
    try {
      const csv = await fetchCsv(source);
      records = toRecords(parseCsv(csv)).records;
    } catch (err) {
      s.error = err.message;
      log(`✗ ${source.label}: ${err.message}`);
      await recordSheetSyncResult(source, s, apply);
      stats.bySource.push(s);
      continue; // one unreadable sheet must not stop the others
    }
    s.rows = records.length;

    for (const rec of records) {
      const mapped = toLead(rec);
      if (!mapped) { s.skipped += 1; continue; }
      if (existingIds.has(mapped.metaLeadId) || seen.has(mapped.metaLeadId)) {
        s.existing += 1;
        continue;
      }

      const key = phoneKey(mapped.mobileNumber);
      if (key && phoneIndex.has(key) && !allowDuplicatePhone) {
        s.dupPhone += 1;
        log(`~ ${mapped.businessName} (${mapped.mobileNumber}) — already on ${phoneIndex.get(key)}, skipped`);
        continue;
      }

      seen.add(mapped.metaLeadId);

      if (!apply) {
        s.imported += 1;
        log(`+ [${source.label}] ${mapped.businessName} · ${mapped.contactPerson} · ${mapped.city} · ${mapped.businessType}`);
        continue;
      }

      let lead;
      try {
        lead = await Lead.create({
          ...mapped,
          internalNotes: tagSource ? `${mapped.internalNotes}\nSheet: ${source.label}` : mapped.internalNotes,
          refNumber: await nextRefNumber(mapped.city, mapped.leadDate),
          assignedExecId: metaUser._id,
          status: 'new',
          statusHistory: [{ from: null, to: 'new', changedBy: metaUser._id, note: 'Imported from Meta Ads' }],
          createdBy: metaUser._id,
          modifiedBy: metaUser._id,
        });
      } catch (err) {
        // The unique index on metaLeadId is the backstop when two runs overlap:
        // whoever loses the race simply counts the row as already imported.
        if (err.code === 11000) { s.existing += 1; continue; }
        throw err;
      }

      s.imported += 1;
      if (key) phoneIndex.set(key, lead.refNumber);

      await logActivity({
        userId: metaUser._id,
        action: 'LEAD_CREATED',
        entity: 'Lead',
        entityId: lead._id,
        details: `Imported lead ${lead.refNumber} for "${lead.businessName}" (${lead.city}) from Meta Ads`,
        meta: { source: 'meta-sheet-sync', metaLeadId: lead.metaLeadId, sheetLabel: source.label },
      });
      log(`+ [${source.label}] ${lead.refNumber} · ${lead.businessName} · ${lead.city} · ${lead.businessType}`);
    }

    await recordSheetSyncResult(source, s, apply);

    stats.rows += s.rows;
    stats.imported += s.imported;
    stats.existing += s.existing;
    stats.skipped += s.skipped;
    stats.dupPhone += s.dupPhone;
    stats.bySource.push(s);
  }

  return stats;
}

/**
 * Stamps a configured sheet with the outcome of the sync attempt just made
 * against it, so the Settings UI can show "last synced …" / the last error
 * without the admin having to run it and watch. No-op for sheets that aren't
 * DB-configured (the env/default fallback, or an explicit CLI override) and
 * for dry runs, which write nothing anywhere.
 */
async function recordSheetSyncResult(source, s, apply) {
  if (!apply || !source.id) return;
  const update = s.error
    ? { 'metaSheets.$.lastError': s.error }
    : {
        'metaSheets.$.lastResult': `${s.imported} imported · ${s.rows} row(s) read`,
        'metaSheets.$.lastError': '',
      };
  await Setting.updateOne({ key: 'global', 'metaSheets._id': source.id }, { $set: { ...update, 'metaSheets.$.lastSyncAt': new Date() } });
}

// ---------------------------------------------------------- scheduler ----

let timer = null;

/** One scheduled pass. Never throws — a bad sheet must not disturb the API. */
async function runScheduledSync() {
  try {
    // Joins whatever's already in flight (e.g. an admin's "Sync now") rather
    // than racing it — see the `inFlight` lock on syncMetaLeads above.
    const stats = await syncMetaLeads({ apply: true });
    // Only worth a line when something actually changed; otherwise this would
    // print every few minutes forever.
    if (stats.imported || stats.dupPhone) {
      console.log(
        `[meta-sync] ${stats.imported} new lead(s) imported, ${stats.existing} already present` +
          (stats.dupPhone ? `, ${stats.dupPhone} skipped as duplicate phone` : '')
      );
    }
    for (const s of stats.bySource) {
      if (s.error) console.error(`[meta-sync] ${s.label}: ${s.error}`);
    }
  } catch (err) {
    console.error(`[meta-sync] sync failed: ${err.message}`);
  }
}

/**
 * Start the in-process sheet poller. Runs shortly after boot and then on the
 * configured interval, so new Meta leads reach the CRM without any external
 * scheduler. Disable with META_SYNC_ENABLED=false.
 */
function startMetaSync() {
  const { enabled, intervalMin } = env.metaSync;
  if (!enabled) {
    console.log('[meta-sync] disabled (META_SYNC_ENABLED=false)');
    return null;
  }
  if (!(intervalMin > 0)) {
    console.log('[meta-sync] disabled (META_SYNC_INTERVAL_MIN must be greater than 0)');
    return null;
  }

  console.log(`[meta-sync] watching the Meta Ads sheet every ${intervalMin} min`);
  // Give the API a moment to finish coming up before the first pass.
  setTimeout(runScheduledSync, 10_000).unref();
  timer = setInterval(runScheduledSync, intervalMin * 60 * 1000);
  timer.unref(); // never hold the process open on its own
  return timer;
}

function stopMetaSync() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  syncMetaLeads,
  startMetaSync,
  stopMetaSync,
  sheetCsvUrl,
  parseSheetUrl,
  listSheetSources,
  getMetaUser,
  // exported for tests / the CLI
  parseCsv,
  toRecords,
  toLead,
  mapBusinessType,
  cleanAnswer,
  cleanPhone,
  tidy,
  META_USER,
};

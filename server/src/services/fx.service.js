/**
 * Daily exchange-rate sync for the Export Kit.
 *
 * Rates are quoted as INR per 1 unit of foreign currency (USD / EUR / GBP) and
 * stored in the ExchangeRate singleton, so rate cards always convert from a
 * known, dated rate rather than a hardcoded one. The refresher runs in-process
 * on the API's own schedule (same pattern as the Meta Ads sheet poller): once
 * shortly after boot when the stored rates are stale, then daily.
 *
 * The default source is the keyless open.er-api.com endpoint; point elsewhere
 * with FX_API_URL (any JSON body with a `rates` object keyed by currency code,
 * quoted against an INR base). A failed fetch never disturbs the API — the
 * previous day's stored rates simply stay in effect, and an admin can always
 * set rates by hand from the Export Kit screen.
 */
const env = require('../config/env');
const ExchangeRate = require('../models/ExchangeRate');

const QUOTED = ['USD', 'EUR', 'GBP'];

/** Fetches the feed and returns { inrPer, source } or throws. */
async function fetchLiveRates() {
  const url = env.fxSync.apiUrl;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`FX fetch failed: HTTP ${res.status} ${res.statusText}`);
  const body = await res.json();
  const rates = body.rates || body.conversion_rates;
  if (!rates) throw new Error('FX response has no rates object');

  // The feed quotes against an INR base ("1 INR = 0.0114 USD"); invert to get
  // INR per unit so the stored figure reads the way an admin would quote it.
  const inrPer = {};
  for (const cur of QUOTED) {
    const perInr = Number(rates[cur]);
    if (!(perInr > 0)) throw new Error(`FX response missing a usable ${cur} rate`);
    inrPer[cur] = Math.round((1 / perInr) * 10000) / 10000;
  }
  return { inrPer, source: new URL(url).host };
}

/** Fetches fresh rates and stores them. Returns the updated document. */
async function refreshRates() {
  const { inrPer, source } = await fetchLiveRates();
  const doc = await ExchangeRate.getGlobal();
  doc.inrPer = inrPer;
  doc.fetchedAt = new Date();
  doc.source = source;
  await doc.save();
  return doc;
}

// ---------------------------------------------------------- scheduler ----

let running = false;
let timer = null;

/** One scheduled pass. Never throws — a bad feed must not disturb the API. */
async function runScheduledRefresh() {
  if (running) return;
  running = true;
  try {
    const doc = await refreshRates();
    const quote = QUOTED.map((c) => `${c} ${doc.inrPer[c]}`).join(' · ');
    console.log(`[fx-sync] rates updated (INR per unit): ${quote}`);
  } catch (err) {
    console.error(`[fx-sync] refresh failed, keeping stored rates: ${err.message}`);
  } finally {
    running = false;
  }
}

/**
 * Start the in-process daily refresher. The boot pass only fires when the
 * stored rates are older than a day, so a restart loop doesn't hammer the feed.
 * Disable with FX_SYNC_ENABLED=false.
 */
function startFxSync() {
  const { enabled, intervalHours } = env.fxSync;
  if (!enabled) {
    console.log('[fx-sync] disabled (FX_SYNC_ENABLED=false)');
    return null;
  }

  console.log(`[fx-sync] refreshing export exchange rates every ${intervalHours} h`);
  setTimeout(async () => {
    try {
      const doc = await ExchangeRate.getGlobal();
      const ageMs = doc.fetchedAt ? Date.now() - doc.fetchedAt.getTime() : Infinity;
      if (ageMs > intervalHours * 60 * 60 * 1000) await runScheduledRefresh();
    } catch (err) {
      console.error(`[fx-sync] boot check failed: ${err.message}`);
    }
  }, 15_000).unref();
  timer = setInterval(runScheduledRefresh, intervalHours * 60 * 60 * 1000);
  timer.unref(); // never hold the process open on its own
  return timer;
}

function stopFxSync() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { fetchLiveRates, refreshRates, startFxSync, stopFxSync };

/**
 * RATE CARD <-> TALLY ITEM LINKS
 *
 * The rate cards and Tally name the same product differently: the card says
 * "Boiled Toor Dal", 1000 gms, SKU CPF-PD-01, while Tally's stock item is
 * "BOILED TOOR DAL 1KG SFG" (alias SFG-006-1000). An appointed customer's
 * frozen list, and so every order line booked from it, carries the card's
 * name, which never matched Tally's stock on name alone.
 *
 * The link lives on the rate master: RateItem.tallyItem (the exact Tally stock
 * item name) and RateItem.tallyCode (its product code / alias, when it has
 * one). One SKU is one product whichever master it sits in, so a link saved on
 * one master row is written to every row with that SKU.
 *
 * Resolution for an order line, first hit wins:
 *   1. the line's SKU -> linked code -> the stock item carrying that code
 *      (survives a rename in Tally, since the alias stays put)
 *   2. the line's SKU -> linked Tally name
 *   3. the line's own name (lines picked straight from Tally stock)
 * The resolved Tally name's nameKey is what the line stores, and nameKey is
 * the one thing stock availability, reservations and the Tally order push
 * join on — so fixing the key here fixes all three.
 */
const RateItem = require('../models/RateItem');
const StockItem = require('../models/StockItem');
const AppointedCustomer = require('../models/AppointedCustomer');
const SalesOrder = require('../models/SalesOrder');
const Customer = require('../models/Customer');
const Setting = require('../models/Setting');
const { nameKeyOf } = require('./stockAvailability.service');

const cleanSku = (s) => String(s || '').trim().toUpperCase();

/** SKU -> { tallyItem, tallyCode } for every linked SKU (or just the given ones). */
async function linksBySku(skus) {
  const filter = { tallyItem: { $nin: ['', null] } };
  if (skus) filter.sku = { $in: [...new Set(skus.map(cleanSku).filter(Boolean))] };
  const rows = await RateItem.find(filter).select('sku tallyItem tallyCode').lean();
  const map = new Map();
  for (const r of rows) if (!map.has(r.sku)) map.set(r.sku, { tallyItem: r.tallyItem, tallyCode: r.tallyCode || '' });
  return map;
}

/**
 * Resolves lines ({ sku, name }) to their Tally stock item. Returns, per line
 * in order, { nameKey, tallyItem } — tallyItem is '' when the line is not
 * linked (its own name is then the key, as before).
 */
async function resolveLines(lines) {
  const list = lines || [];
  const links = await linksBySku(list.map((l) => l.sku).filter(Boolean));
  const codes = [...new Set([...links.values()].map((l) => l.tallyCode).filter(Boolean))];
  const byCode = new Map();
  if (codes.length) {
    const rows = await StockItem.find({ code: { $in: codes } }).select('name code').lean();
    for (const r of rows) if (!byCode.has(r.code)) byCode.set(r.code, r.name);
  }
  return list.map((l) => {
    const link = links.get(cleanSku(l.sku));
    const tallyItem = link ? byCode.get(link.tallyCode) || link.tallyItem : '';
    return { nameKey: nameKeyOf(tallyItem || l.name), tallyItem: tallyItem || '' };
  });
}

/** Adds `tallyItem` to each frozen item of the given customers (for the order dialog). */
async function withTallyItems(customers) {
  const all = customers.flatMap((c) => c.items || []);
  const resolved = await resolveLines(all);
  let i = 0;
  for (const c of customers) {
    c.items = (c.items || []).map((it) => ({ ...it, tallyItem: resolved[i++].tallyItem }));
  }
  return customers;
}

/**
 * Re-points the lines of every order still holding stock (open / confirmed)
 * at their linked Tally item. Run after links change, so orders booked before
 * the link existed start reserving the right stock at once. Old lines carry no
 * SKU; it is recovered from the customer's frozen list by name.
 */
async function relinkOpenOrders() {
  const orders = await SalesOrder.find({ status: { $in: ['open', 'confirmed'] } })
    .select('customer items')
    .lean();
  const customerIds = [...new Set(orders.map((o) => o.customer).filter(Boolean).map(String))];
  const customers = await AppointedCustomer.find({ _id: { $in: customerIds } }).select('items').lean();
  const skuByCustomerName = new Map();
  for (const c of customers) {
    for (const it of c.items || []) if (it.sku) skuByCustomerName.set(`${c._id}|${nameKeyOf(it.name)}`, it.sku);
  }

  let changed = 0;
  for (const o of orders) {
    const lines = (o.items || []).map((it) => ({
      sku: it.sku || (o.customer ? skuByCustomerName.get(`${o.customer}|${nameKeyOf(it.name)}`) : '') || '',
      name: it.name,
    }));
    const resolved = await resolveLines(lines);
    const set = {};
    o.items.forEach((it, idx) => {
      const r = resolved[idx];
      if (it.nameKey !== r.nameKey) set[`items.${idx}.nameKey`] = r.nameKey;
      if ((it.tallyItem || '') !== r.tallyItem) set[`items.${idx}.tallyItem`] = r.tallyItem;
      if (!it.sku && lines[idx].sku) set[`items.${idx}.sku`] = lines[idx].sku;
    });
    if (Object.keys(set).length) {
      await SalesOrder.updateOne({ _id: o._id }, { $set: set });
      changed += 1;
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Auto-match suggestions
// ---------------------------------------------------------------------------

/** Tally spellings and card wordings that mean the same product. */
const SYNONYMS = [
  [/\bKIDNEY BEANS?\b/g, 'RAJMA'],
  [/\bCHH?OLE?Y?S?\b/g, 'CHOLE'],
  [/\b(?:MAKHNAI|MAKHNI|MAKANI)\b/g, 'MAKHANI'],
  [/\bMALABH?AR[I]?\b/g, 'MALABAR'],
  [/\bTAMRIND\b/g, 'TAMARIND'],
  [/\bB[R]?IR?YANI\b|\bBRIYANI\b/g, 'BIRYANI'],
  [/\bCONCASSE?\b/g, 'CONCASSE'],
  [/\bCONC\b/g, 'CONCENTRATE'],
];
/** Words that say nothing about which product it is. */
const NOISE = new Set(['SFG', 'FG', 'KIT', 'PACK', 'PKT', 'THE', 'AND', 'OF', 'WITH', 'GM', 'GMS', 'G', 'KG', 'MG', 'GMN', 'ML', 'LTR', 'L', 'NOS']);

/** Grams from "1000 gms", "1 KG", "250GM", "350Gm", "250MG" (a Tally typo for GM); null if none. */
function gramsOf(text) {
  const m = String(text || '').toUpperCase().match(/(\d+(?:\.\d+)?)\s*(KGS?|GMS?|GMN|GRAMS?|G|MG|ML|LTRS?|L)\b/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2];
  if (/^KG|^LTR|^L$/.test(unit)) return Math.round(n * 1000);
  return Math.round(n);
}

function tokensOf(text) {
  let s = ` ${String(text || '').toUpperCase()} `
    .replace(/\(.*?\)/g, (m) => m.replace(/[()]/g, ' '))
    .replace(/(\d+(?:\.\d+)?)\s*(KGS?|GMS?|GMN|GRAMS?|G|MG|ML|LTRS?|L)\b/g, ' ')
    .replace(/[^A-Z0-9 ]+/g, ' ');
  for (const [rx, to] of SYNONYMS) s = s.replace(rx, to);
  return new Set(s.split(/\s+/).filter((w) => w && !NOISE.has(w) && !/^\d+$/.test(w)));
}

function score(rate, stock) {
  const a = rate.tokens;
  const b = stock.tokens;
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const w of a) if (b.has(w)) common += 1;
  if (!common) return 0;
  let s = common / new Set([...a, ...b]).size;
  // Pack weight must agree when both sides state one; a KIT (bulk, no weight)
  // only fits a card line that has no weight either.
  if (rate.grams != null && stock.grams != null) s = rate.grams === stock.grams ? s + 0.3 : s * 0.3;
  else if (rate.grams != null && stock.grams == null) s *= 0.5;
  return Math.round(Math.min(s, 1) * 100) / 100;
}

/**
 * One row per distinct SKU across the masters: its current link, the best
 * suggestion and a short candidate list, for the link-review screen.
 */
async function suggestLinks() {
  const [rates, stock] = await Promise.all([
    RateItem.find({}).select('sku productName packSize kitType tallyItem tallyCode isActive').sort({ productName: 1 }).lean(),
    StockItem.find({}).select('name code group closingQty baseUnits').lean(),
  ]);
  const stockRows = stock.map((s) => ({ ...s, tokens: tokensOf(s.name), grams: gramsOf(s.name) }));

  const bySku = new Map();
  for (const r of rates) {
    const row = bySku.get(r.sku);
    if (row) {
      row.kitTypes.push(r.kitType);
      if (!row.tallyItem && r.tallyItem) Object.assign(row, { tallyItem: r.tallyItem, tallyCode: r.tallyCode || '' });
      continue;
    }
    bySku.set(r.sku, {
      sku: r.sku,
      productName: r.productName,
      packSize: r.packSize || '',
      kitTypes: [r.kitType],
      active: r.isActive !== false,
      tallyItem: r.tallyItem || '',
      tallyCode: r.tallyCode || '',
    });
  }

  const rows = [];
  for (const row of bySku.values()) {
    const probe = { tokens: tokensOf(row.productName), grams: gramsOf(row.packSize) ?? gramsOf(row.productName) };
    const candidates = stockRows
      .map((s) => ({ s, score: score(probe, s) }))
      .filter((c) => c.score > 0)
      .sort((x, y) => y.score - x.score || (y.s.closingQty || 0) - (x.s.closingQty || 0))
      .slice(0, 8)
      .map(({ s, score: sc }) => ({ name: s.name, code: s.code || '', group: s.group || '', closingQty: s.closingQty, baseUnits: s.baseUnits || '', score: sc }));
    const best = candidates[0];
    rows.push({
      ...row,
      linkedInStock: row.tallyItem ? stockRows.some((s) => s.name === row.tallyItem || (row.tallyCode && s.code === row.tallyCode)) : false,
      // Only a confident match (names largely agree AND weights agree) is
      // pre-selected; anything weaker is offered but left for a person.
      suggestion: best && best.score >= 0.75 ? best : null,
      candidates,
    });
  }
  return rows;
}

/**
 * Saves links ({ sku, tallyItem }) — tallyItem '' removes one. The code is
 * taken from the mirror at save time. Every master row with the SKU gets it.
 */
async function saveLinks(links) {
  const names = [...new Set(links.map((l) => l.tallyItem).filter(Boolean))];
  const stock = await StockItem.find({ name: { $in: names } }).select('name code').lean();
  const codeByName = new Map(stock.map((s) => [s.name, s.code || '']));
  const unknown = names.filter((n) => !codeByName.has(n));

  let saved = 0;
  for (const l of links) {
    const sku = cleanSku(l.sku);
    if (!sku) continue;
    const tallyItem = String(l.tallyItem || '').trim();
    if (tallyItem && !codeByName.has(tallyItem)) continue;
    const r = await RateItem.updateMany(
      { sku },
      { $set: { tallyItem, tallyCode: tallyItem ? codeByName.get(tallyItem) : '' } }
    );
    saved += r.modifiedCount || 0;
  }
  const ordersRelinked = await relinkOpenOrders();
  return { saved, unknown, ordersRelinked };
}

// ---------------------------------------------------------------------------
// Appointed customer <-> Tally ledger links (manual, with suggestions)
// ---------------------------------------------------------------------------

/** Words that do not tell two companies apart. */
const PARTY_NOISE = new Set([
  'M', 'S', 'MS', 'THE', 'AND', 'PVT', 'PRIVATE', 'LTD', 'LIMITED', 'LLP', 'CO', 'COMPANY', 'CORP', 'INC', 'OPC',
]);

function partyTokens(name) {
  return new Set(
    String(name || '')
      .toUpperCase()
      .replace(/&/g, ' AND ')
      .replace(/[^A-Z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !PARTY_NOISE.has(w))
  );
}

function partyScore(a, b) {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const w of a) if (b.has(w)) common += 1;
  return Math.round((common / new Set([...a, ...b]).size) * 100) / 100;
}

/**
 * One row per appointed customer: the linked ledger (and whether it is still
 * in Tally), a suggestion and candidates from the Sundry Debtors mirror.
 * Nothing is linked without a person saving it.
 */
async function suggestCustomerLinks() {
  const [customers, allLedgers, settings] = await Promise.all([
    AppointedCustomer.find({}).select('companyName gstin tallyLedger').sort({ companyName: 1 }).lean(),
    Customer.find({}).select('name group').lean(),
    Setting.getGlobal(),
  ]);
  // The dummy ledger test orders go to in Tally is nobody's customer.
  const testLedger = settings.tallyOrders?.testLedger || '';
  const ledgers = allLedgers.filter((l) => !testLedger || l.name !== testLedger);
  const ledgerRows = ledgers.map((l) => ({ ...l, tokens: partyTokens(l.name) }));
  const names = new Set(ledgers.map((l) => l.name));
  // A ledger already linked to one customer is not suggested for another.
  const taken = new Set(customers.map((c) => c.tallyLedger).filter(Boolean));

  return customers.map((c) => {
    const probe = partyTokens(c.companyName);
    const candidates = ledgerRows
      .map((l) => ({ name: l.name, group: l.group || '', score: partyScore(probe, l.tokens) }))
      .filter((x) => x.score > 0)
      .sort((x, y) => y.score - x.score || x.name.localeCompare(y.name))
      .slice(0, 8);
    const best = candidates.find((x) => !taken.has(x.name) || x.name === c.tallyLedger);
    return {
      id: String(c._id),
      companyName: c.companyName,
      gstin: c.gstin || '',
      tallyLedger: c.tallyLedger || '',
      linkedInTally: c.tallyLedger ? names.has(c.tallyLedger) : false,
      suggestion: best && best.score >= 0.75 ? best : null,
      candidates,
    };
  });
}

/** Saves customer links ({ id, tallyLedger }); '' unlinks. Unknown ledgers are skipped. */
async function saveCustomerLinks(links) {
  const wanted = [...new Set(links.map((l) => String(l.tallyLedger || '').trim()).filter(Boolean))];
  const known = new Set((await Customer.find({ name: { $in: wanted } }).select('name').lean()).map((l) => l.name));
  const unknown = wanted.filter((n) => !known.has(n));
  let saved = 0;
  for (const l of links) {
    const tallyLedger = String(l.tallyLedger || '').trim();
    if (tallyLedger && !known.has(tallyLedger)) continue;
    const r = await AppointedCustomer.updateOne({ _id: l.id }, { $set: { tallyLedger } });
    saved += r.modifiedCount || 0;
  }
  return { saved, unknown };
}

/** Marks each customer's link as live or stale against the ledger mirror (list screens). */
async function withLedgerStatus(customers) {
  const linked = [...new Set(customers.map((c) => c.tallyLedger).filter(Boolean))];
  const known = new Set((await Customer.find({ name: { $in: linked } }).select('name').lean()).map((l) => l.name));
  for (const c of customers) c.tallyLedgerInTally = c.tallyLedger ? known.has(c.tallyLedger) : false;
  return customers;
}

module.exports = {
  suggestCustomerLinks,
  saveCustomerLinks,
  withLedgerStatus,
  resolveLines,
  withTallyItems,
  relinkOpenOrders,
  suggestLinks,
  saveLinks,
  gramsOf,
  tokensOf,
};

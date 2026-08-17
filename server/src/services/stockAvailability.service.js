const mongoose = require('mongoose');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const SalesOrder = require('../models/SalesOrder');
const StockItem = require('../models/StockItem');
const StockSyncLog = require('../models/StockSyncLog');

/**
 * Availability = what the CRM may still promise a customer, as opposed to
 * closingQty, which is what Tally physically holds. Three numbers per item:
 *
 *   closingQty   physical quantity mirrored from Tally, never touched here
 *   reservedQty  quantity committed on orders that are still holding stock
 *   availableQty closingQty − reservedQty, and it may be negative — a negative
 *                figure means the business has oversold and is shown as such,
 *                never clamped, because hiding a shortfall is how a customer
 *                gets promised goods nobody has.
 *
 * WHICH ORDERS HOLD STOCK
 * Open and confirmed orders always reserve: the goods are still sitting in
 * Tally, so Tally's closingQty still counts them and only the CRM knows they
 * are spoken for. Confirming changes nothing here — it locks the order against
 * edits, it does not move any goods. A cancelled order never reserves. A
 * closed order is the awkward one. Closing is the operator's signal that the
 * goods have gone, and the tax invoice is keyed into Tally afterwards,
 * sometimes hours afterwards; until that invoice exists, Tally still counts
 * the goods, so releasing the reservation the moment the status changes would
 * promise the same stock twice.
 *
 * So a closed order keeps reserving until a stock sync lands whose data
 * cut-off is later than the close plus a settle window (CLOSE_SETTLE_MINUTES,
 * two hours by default). The window is what makes the rule mean anything: an
 * operator who closes an order and immediately presses sync to refresh the
 * screen has not yet written the invoice, and without the window that refresh
 * would release stock Tally is still showing. The comparison is against
 * StockSyncLog.syncedAt — the moment the sync began — not createdAt, which is
 * written once the upserts finish and would tilt every borderline case towards
 * over-promising.
 *
 * Two guards sit around that rule. A closed order older than
 * CLOSE_RESERVE_MAX_DAYS stops reserving regardless of sync evidence, so one
 * stuck order (or a lost StockSyncLog collection) cannot quietly hold stock
 * back for months. And a closed order with no closedAt at all — everything
 * dispatched before this feature shipped — counts as released, because Tally
 * caught up long ago; the predicate expresses that by requiring closedAt to be
 * present and recent rather than by comparing against a missing field.
 *
 * The opposite ordering (invoice keyed into Tally first, order closed later)
 * briefly subtracts the goods twice. That direction under-promises, which is
 * the safe way to be wrong, and is the accepted trade-off.
 *
 * NAME MATCHING
 * Everything joins on nameKey — the item name trimmed, upper-cased and with
 * inner whitespace collapsed — never on the raw name. Tally names are mixed
 * case while an appointed customer's frozen list is stored UPPERCASE and that
 * frozen name is what lands on the order line, so a raw-name join silently
 * misses exactly the orders that matter most. Rows on either side without a
 * key are dropped rather than grouped together, since a shared null bucket
 * would hand every keyless order line's quantity to every keyless item.
 *
 * A reservation whose nameKey matches no mirror row (item renamed or deleted
 * in Tally while orders were open) is an orphan: it is reported separately by
 * orphanReservations() and never injected into the stock list, which is a
 * mirror of Tally and must only show what Tally has. An order line with no key
 * at all is the mirror image of that and is reported by unkeyedReservations();
 * it holds nothing back, which on screen reads exactly like "nobody ordered
 * anything", and unlike the mirror — rewritten in full by every sync — that
 * side never repairs itself.
 *
 * Two Tally items can also normalise to one key ("CP Nuggets" / "CP NUGGETS"),
 * and a key is only ever charged to one of them (collisionOwners): handing both
 * rows the same reserved quantity subtracts it twice and makes every figure
 * that sums across rows — the committed value on the dashboard above all —
 * count one commitment once per spelling.
 *
 * NOTHING IS DENORMALISED. Reserved quantities are aggregated at read time.
 * A stored figure on StockItem would go stale on every order edit, status
 * change and delete, and every sync overwrites the whole mirror document
 * anyway. At a few hundred orders correctness is worth far more than the
 * saved query.
 */

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Order lines and mirror items only ever meet through this. */
const nameKeyOf = (name) => String(name || '').trim().toUpperCase().replace(/\s+/g, ' ');

const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const uniqueKeys = (names) => [...new Set((names || []).map(nameKeyOf).filter(Boolean))];

/**
 * The order being saved must not be counted against itself — re-saving an
 * unchanged order would otherwise report every line as short. A non-ObjectId
 * id is rejected outright: `$ne` against a plain string matches every
 * document, which turns the self-exclusion off with nothing to show for it.
 */
const excludeId = (excludeOrder) => {
  if (!excludeOrder) return null;
  if (!mongoose.isValidObjectId(excludeOrder)) {
    throw ApiError.badRequest('excludeOrder must be a valid order id');
  }
  return new mongoose.Types.ObjectId(String(excludeOrder));
};

/**
 * The reserving predicate — the one place the rule above is expressed. Every
 * caller goes through it, so the drill-down dialog can never list a different
 * set of orders from the row it was opened from.
 */
async function reservingFilter({ excludeOrder } = {}) {
  const log = await StockSyncLog.findOne({ syncedAt: { $ne: null } })
    .sort({ syncedAt: -1 })
    .select('syncedAt')
    .lean();
  const lastSyncAt = log?.syncedAt || null;

  const now = Date.now();
  const capCutoff = new Date(now - env.stock.closeReserveMaxDays * DAY_MS);
  const settleCutoff = lastSyncAt
    ? new Date(lastSyncAt.getTime() - env.stock.closeSettleMinutes * MINUTE_MS)
    : null;
  // No sync evidence at all leaves only the hard cap; otherwise whichever of
  // the two releases the order sooner wins.
  const cutoff = settleCutoff && settleCutoff > capCutoff ? settleCutoff : capCutoff;

  const filter = {
    $or: [
      { status: { $in: ['open', 'confirmed'] } },
      { status: 'closed', closedAt: { $gte: cutoff } },
    ],
  };
  const id = excludeId(excludeOrder);
  if (id) filter._id = { $ne: id };
  return { filter, lastSyncAt, cutoff };
}

/**
 * Reserved quantity per nameKey. Pass the names on the current page to scope
 * the aggregation; omit them for the whole book (the summary endpoint).
 * Returns Map<nameKey, { name, qty, orders }> where `name` is the name as an
 * order line spelled it — the only name an orphaned reservation has left.
 */
async function reservedByNameKey(names, options = {}) {
  const keys = names ? uniqueKeys(names) : null;
  if (keys && !keys.length) return new Map();

  const { filter } = await reservingFilter(options);
  const rows = await SalesOrder.aggregate([
    { $match: filter },
    { $unwind: '$items' },
    { $match: { 'items.nameKey': keys ? { $in: keys } : { $type: 'string', $ne: '' } } },
    {
      $group: {
        _id: '$items.nameKey',
        name: { $first: '$items.name' },
        qty: { $sum: '$items.qty' },
        orders: { $addToSet: '$_id' },
      },
    },
  ]);

  return new Map(
    rows.map((r) => [r._id, { name: r.name, qty: round3(r.qty), orders: r.orders.length }])
  );
}

const NO_RESERVATION = { qty: 0, orders: 0 };

/**
 * Decorates plain mirror rows (lean docs) with the three reservation fields.
 * Pass a pre-built map when the caller already resolved one, so a request
 * never runs the aggregation twice.
 */
async function attachAvailability(items, options = {}) {
  const rows = items || [];
  if (!rows.length) return [];
  const reserved =
    options.reserved || (await reservedByNameKey(rows.map((i) => i.nameKey || i.name), options));

  return rows.map((item) => {
    const r = reserved.get(item.nameKey || nameKeyOf(item.name)) || NO_RESERVATION;
    return {
      ...item,
      reservedQty: r.qty,
      reservedOrders: r.orders,
      availableQty: round3((Number(item.closingQty) || 0) - r.qty),
    };
  });
}

/**
 * Aggregation stages that carry a reserved map into a StockItem pipeline, for
 * the two places that must filter or count on the derived figure and so
 * cannot do it in JavaScript after the fact. Adds `reservedQty`,
 * `reservedOrders` and `availableQty`; the caller drops `reservedIdx` before
 * returning documents.
 */
function reservedStages(reserved) {
  const keys = [...reserved.keys()];
  const qtys = keys.map((k) => reserved.get(k).qty);
  const counts = keys.map((k) => reserved.get(k).orders);
  return [
    {
      $addFields: {
        reservedIdx: { $indexOfArray: [{ $literal: keys }, { $ifNull: ['$nameKey', ''] }] },
      },
    },
    {
      $addFields: {
        reservedQty: {
          $cond: [{ $gte: ['$reservedIdx', 0] }, { $arrayElemAt: [{ $literal: qtys }, '$reservedIdx'] }, 0],
        },
        reservedOrders: {
          $cond: [{ $gte: ['$reservedIdx', 0] }, { $arrayElemAt: [{ $literal: counts }, '$reservedIdx'] }, 0],
        },
      },
    },
    { $addFields: { availableQty: { $round: [{ $subtract: ['$closingQty', '$reservedQty'] }, 3] } } },
  ];
}

/**
 * Picks one mirror row per nameKey. Two Tally items can normalise to the same
 * key ("CP Nuggets" / "CP NUGGETS"); the alphabetically first name wins so the
 * choice is at least stable between requests.
 */
const stockByKey = (rows) => {
  const map = new Map();
  for (const row of rows) {
    const key = row.nameKey || nameKeyOf(row.name);
    const seen = map.get(key);
    if (!seen || String(row.name) < String(seen.name)) map.set(key, row);
  }
  return map;
};

/**
 * Batch lookup behind the order dialog. Names absent from the mirror come back
 * with closingQty and availableQty null rather than 0 — a shortfall cannot be
 * asserted against an item nobody has a stock figure for, and calling it 0
 * would report every free-typed line as oversold by its own quantity.
 */
async function availabilityForNames(names, options = {}) {
  const requested = (names || []).map((n) => String(n));
  const keys = uniqueKeys(requested);
  if (!keys.length) return [];

  const [rows, reserved] = await Promise.all([
    StockItem.find({ nameKey: { $in: keys } })
      .select('name nameKey baseUnits closingQty')
      .lean(),
    reservedByNameKey(keys, options),
  ]);
  const byKey = stockByKey(rows);

  return requested.map((name) => {
    const key = nameKeyOf(name);
    const s = byKey.get(key);
    const r = reserved.get(key) || NO_RESERVATION;
    return {
      name: s ? s.name : name,
      nameKey: key,
      baseUnits: s?.baseUnits || '',
      closingQty: s ? s.closingQty : null,
      reservedQty: r.qty,
      availableQty: s ? round3(s.closingQty - r.qty) : null,
    };
  });
}

/**
 * Drill-down behind a stock row: which orders are holding this item, oldest
 * first. Only orders that actually reserve appear, so the quantities listed
 * always add up to the reservedQty shown on the row that opened it.
 */
async function reservationsForName(name) {
  const key = nameKeyOf(name);
  if (!key) return { item: null, orders: [] };

  const { filter } = await reservingFilter();
  const [rows, orders] = await Promise.all([
    StockItem.find({ nameKey: key }).select('name nameKey baseUnits closingQty').lean(),
    SalesOrder.find({ ...filter, 'items.nameKey': key })
      .sort({ createdAt: 1 })
      .select('number customerName status items createdAt')
      .lean(),
  ]);
  const s = stockByKey(rows).get(key);

  const lines = orders.map((o) => ({
    _id: o._id,
    number: o.number,
    customerName: o.customerName,
    status: o.status,
    qty: round3(
      (o.items || [])
        .filter((i) => (i.nameKey || nameKeyOf(i.name)) === key)
        .reduce((sum, i) => sum + (Number(i.qty) || 0), 0)
    ),
    createdAt: o.createdAt,
  }));
  const reservedQty = round3(lines.reduce((sum, l) => sum + l.qty, 0));

  return {
    item: {
      name: s ? s.name : name,
      baseUnits: s?.baseUnits || '',
      closingQty: s ? s.closingQty : null,
      reservedQty,
      availableQty: s ? round3(s.closingQty - reservedQty) : null,
    },
    orders: lines,
  };
}

/**
 * Reservations whose item is no longer in the mirror — renamed or deleted in
 * Tally while orders were still holding it. They are invisible on the stock
 * list by design (that page shows Tally, not the CRM's opinion of Tally), so
 * they are surfaced here instead; the new name shows its full quantity as
 * available until someone re-points the orders.
 */
async function orphanReservations() {
  const reserved = await reservedByNameKey();
  if (!reserved.size) return { items: 0, qty: 0, list: [] };

  const known = new Set((await StockItem.distinct('nameKey')).filter(Boolean));
  const list = [...reserved.entries()]
    .filter(([key]) => !known.has(key))
    .map(([nameKey, r]) => ({ nameKey, name: r.name, qty: r.qty, orders: r.orders }))
    .sort((a, b) => b.qty - a.qty);

  return {
    items: list.length,
    qty: round3(list.reduce((sum, o) => sum + o.qty, 0)),
    list,
  };
}

/**
 * Availability check for the lines of an order being saved, computed with that
 * order excluded. Lines that exceed what is left produce a warning, never a
 * rejection: this business books orders against goods still in production, and
 * a hard block would stop real work. Lines whose item is not in the mirror are
 * skipped — an unknown quantity cannot be short.
 */
async function checkLineAvailability(items, options = {}) {
  const rows = (items || []).filter((i) => nameKeyOf(i.name));
  if (!rows.length) return { availableByKey: new Map(), warnings: [] };

  const keys = uniqueKeys(rows.map((i) => i.name));
  const [stock, reserved] = await Promise.all([
    StockItem.find({ nameKey: { $in: keys } }).select('name nameKey closingQty').lean(),
    reservedByNameKey(keys, options),
  ]);
  const byKey = stockByKey(stock);

  const availableByKey = new Map();
  for (const key of keys) {
    const s = byKey.get(key);
    if (!s) continue;
    availableByKey.set(key, round3(s.closingQty - (reserved.get(key)?.qty || 0)));
  }

  // Two lines of the same item on one order compete for the same stock, so
  // they are warned about together rather than each measured on its own.
  const requestedByKey = new Map();
  for (const i of rows) {
    const key = nameKeyOf(i.name);
    requestedByKey.set(key, round3((requestedByKey.get(key) || 0) + (Number(i.qty) || 0)));
  }

  const warnings = [];
  for (const [key, requested] of requestedByKey) {
    if (!availableByKey.has(key)) continue;
    const available = availableByKey.get(key);
    if (requested <= available) continue;
    warnings.push({
      name: byKey.get(key).name,
      requested,
      available,
      short: round3(requested - available),
    });
  }

  return { availableByKey, warnings };
}

module.exports = {
  nameKeyOf,
  reservingFilter,
  reservedByNameKey,
  reservedStages,
  attachAvailability,
  availabilityForNames,
  reservationsForName,
  orphanReservations,
  checkLineAvailability,
  round2,
  round3,
};

/**
 * Parser for the "Mickys Stock Export" XML produced by tally/mickys-stock.tdl
 * (report MickysStockReport). Format quirks, confirmed against a real export
 * from the company's TallyPrime:
 *
 *  - Zero/absent figures export as EMPTY tags (<OPENINGVALUE></OPENINGVALUE>).
 *  - Values carry Tally's accounting sign (inward/closing negative, outward
 *    positive) — consumers want magnitudes, so amounts are abs()'d.
 *  - Quantities include the unit ("360.00 KG"), rates the unit suffix
 *    ("78.00/KG"); file export has no thousands separators.
 *  - Tally prefixes reserved names with a  control char ("&#4; Primary",
 *    "&#4; Not Applicable") — those mean "no group/category".
 */

const TAG_NAMES = [
  'NAME', 'GROUP', 'CATEGORY', 'BASEUNITS',
  'OPENINGQTY', 'OPENINGRATE', 'OPENINGVALUE',
  'INWARDQTY', 'INWARDVALUE', 'OUTWARDQTY', 'OUTWARDVALUE',
  'CLOSINGQTY', 'CLOSINGRATE', 'CLOSINGVALUE',
  'STANDARDCOST', 'STANDARDPRICE',
  'LASTSALEPRICE', 'LASTPURCHASECOST',
];

/** Marks Tally's reserved names ("Primary", "Not Applicable"). */
const RESERVED_FLAG = String.fromCharCode(4);

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Reserved placeholders become ''; real names pass through trimmed. */
function cleanName(raw) {
  if (raw.includes(RESERVED_FLAG)) return '';
  return raw.trim();
}

/** "360.00 KG" | "78.00/KG" | "" -> number (0 when empty/unparseable). */
function toNumber(raw) {
  const n = parseFloat(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Amounts keep Tally's accounting sign; we only care about the magnitude. */
function toAmount(raw) {
  return Math.abs(toNumber(raw));
}

function tagValue(block, name) {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? decodeEntities(m[1]).trim() : '';
}

/**
 * Parses the full export (any wrapper — Tally's HTTP response envelope or the
 * bare <MICKYSSTOCK> file) into plain stock objects. Items without a name are
 * dropped; duplicate names keep the last occurrence.
 */
function parseTallyStockXml(xml) {
  if (typeof xml !== 'string' || !xml.includes('<STOCKITEM>')) return [];

  const blocks = xml.match(/<STOCKITEM>[\s\S]*?<\/STOCKITEM>/g) || [];
  const byName = new Map();

  for (const block of blocks) {
    const raw = {};
    for (const t of TAG_NAMES) raw[t] = tagValue(block, t);

    const name = cleanName(raw.NAME);
    if (!name) continue;

    const item = {
      name,
      group: cleanName(raw.GROUP),
      category: cleanName(raw.CATEGORY),
      baseUnits: raw.BASEUNITS.trim(),
      openingQty: toNumber(raw.OPENINGQTY),
      openingRate: toNumber(raw.OPENINGRATE),
      openingValue: toAmount(raw.OPENINGVALUE),
      inwardQty: toNumber(raw.INWARDQTY),
      inwardValue: toAmount(raw.INWARDVALUE),
      outwardQty: toNumber(raw.OUTWARDQTY),
      outwardValue: toAmount(raw.OUTWARDVALUE),
      closingQty: toNumber(raw.CLOSINGQTY),
      closingRate: toNumber(raw.CLOSINGRATE),
      closingValue: toAmount(raw.CLOSINGVALUE),
      standardCost: toNumber(raw.STANDARDCOST),
      standardPrice: toNumber(raw.STANDARDPRICE),
      lastSalePrice: toNumber(raw.LASTSALEPRICE),
      lastPurchaseCost: toNumber(raw.LASTPURCHASECOST),
    };

    // Tally sometimes exports an empty rate tag even when qty and value are
    // both present — derive the per-unit rate so consumers always get one.
    if (!item.closingRate && item.closingQty > 0 && item.closingValue > 0) {
      item.closingRate = Math.round((item.closingValue / item.closingQty) * 100) / 100;
    }
    if (!item.openingRate && item.openingQty > 0 && item.openingValue > 0) {
      item.openingRate = Math.round((item.openingValue / item.openingQty) * 100) / 100;
    }

    byName.set(name, item);
  }

  return [...byName.values()];
}

/**
 * Parses ledger elements (<VENDOR> = Sundry Creditors, <CUSTOMER> = Sundry
 * Debtors) that the updated TDL appends after the stock items. Older TDL
 * versions don't send them — callers should treat an empty result as "not in
 * this export" rather than "none exist".
 */
function parseLedgers(xml, tag) {
  if (typeof xml !== 'string' || !xml.includes(`<${tag}>`)) return [];

  const blocks = xml.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'g')) || [];
  const byName = new Map();

  for (const block of blocks) {
    const name = cleanName(tagValue(block, 'NAME'));
    if (!name) continue;
    byName.set(name, { name, group: cleanName(tagValue(block, 'GROUP')) });
  }

  return [...byName.values()];
}

const parseTallyVendors = (xml) => parseLedgers(xml, 'VENDOR');
const parseTallyCustomers = (xml) => parseLedgers(xml, 'CUSTOMER');

/**
 * The <COMPANY> element names the company that produced the export. Older
 * TDL versions don't send it — '' then means "unknown", not "no company".
 */
const parseTallyCompany = (xml) =>
  typeof xml === 'string' ? tagValue(xml, 'COMPANY') : '';

module.exports = {
  parseTallyStockXml,
  parseTallyVendors,
  parseTallyCustomers,
  parseTallyCompany,
};

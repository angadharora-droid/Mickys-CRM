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

const MONTHS ={ jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/**
 * A Tally date as the TDL exports it. The field asks for the universal
 * "YYYYMMDD" form, but a release that ignores the format keyword falls back
 * to its display form ("1-Sep-26", "01-Sep-2026"), so both are read. The
 * result is midnight UTC of that calendar day — a date, not an instant.
 */
function parseTallyDate(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month === undefined) return null;
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return new Date(Date.UTC(year, month, Number(m[1])));
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return null;
}

/**
 * Sales vouchers (<SALESINVOICE>) that the updated TDL appends after the
 * ledgers: the invoice's number, date, party and the three free-text fields an
 * accountant can write the CRM order number into. Older TDL versions send
 * none — an empty result means "not in this export". Duplicate GUIDs keep the
 * last occurrence, like the stock items.
 */
function parseTallyInvoices(xml) {
  if (typeof xml !== 'string' || !xml.includes('<SALESINVOICE>')) return [];

  const blocks = xml.match(/<SALESINVOICE>[\s\S]*?<\/SALESINVOICE>/g) || [];
  const seen = new Map();

  for (const block of blocks) {
    const inv = {
      guid: tagValue(block, 'GUID'),
      voucherNumber: tagValue(block, 'VOUCHERNUMBER'),
      voucherType: cleanName(tagValue(block, 'VOUCHERTYPE')),
      date: parseTallyDate(tagValue(block, 'DATE')),
      party: cleanName(tagValue(block, 'PARTY')),
      reference: tagValue(block, 'REFERENCE'),
      orderNos: tagValue(block, 'ORDERNOS'),
      narration: tagValue(block, 'NARRATION'),
      // As billed (GST and round-off included) and the pre-GST basic value —
      // the sales register's "Basic Value", which is what revenue is reported
      // on. 0 when the TDL in use predates the field.
      amount: toAmount(tagValue(block, 'AMOUNT')),
      basicValue: toAmount(tagValue(block, 'BASICVALUE')),
    };
    // A voucher with neither a number nor a GUID cannot be told apart from
    // the next one and is dropped.
    if (!inv.guid && !inv.voucherNumber) continue;
    seen.set(inv.guid || `${inv.voucherNumber}|${inv.date ? inv.date.toISOString() : ''}`, inv);
  }

  return [...seen.values()];
}

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
  parseTallyInvoices,
  parseTallyDate,
};

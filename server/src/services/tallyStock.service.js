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
 * Only vouchers of the voucher type named exactly "Sales" are sales. Tally's
 * own $$IsSales also says yes to every voucher type created under Sales —
 * this company keeps RENTAL INCOME and FILLING & RETORTING INCOME there —
 * and those are not product sales, so they are dropped here whatever the
 * TDL sent.
 */
const SALES_VOUCHER_TYPE = /^\s*sales\s*$/i;
const isSalesVoucher = (inv) => SALES_VOUCHER_TYPE.test(inv?.voucherType || '');

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
 * The version of the TDL template in this repo. Served into the file as
 * {{TDL_VERSION}}, sent back by every push as <TDLVERSION>, and compared on
 * arrival — the reply Tally shows, the sync log and the Invoicing page all
 * say whether the copy loaded on the Tally machine is the current one. Bump
 * it whenever the template changes.
 */
const TDL_VERSION = '4';

const parseTallyTdlVersion = (xml) => (typeof xml === 'string' ? tagValue(xml, 'TDLVERSION') : '');

/**
 * Classifying a voucher's ledger entries without trusting any Tally total:
 * an entry under Sales Accounts (by top-level group, group, or a ledger
 * simply named "Sales…") is basic value; one under Duties & Taxes or named
 * for GST is tax. The party (Sundry Debtors), round-off and discount
 * ledgers fall in neither and are left alone.
 */
const isSalesEntry = (e) =>
  /sales/i.test(e.primaryGroup || '') || /sales/i.test(e.group || '') || /^\s*sales\b/i.test(e.name || '');
const isTaxEntry = (e) =>
  /duties/i.test(e.primaryGroup || '') || /duties/i.test(e.group || '') || /\b(c|s|i|ut)?gst\b/i.test(e.name || '');

const sumEntries = (entries, pick) =>
  Math.round(entries.filter(pick).reduce((s, e) => s + (Number(e.amount) || 0), 0) * 100) / 100;

/**
 * The invoice's basic value before GST — the sales register's "Basic Value"
 * (Sales A/c) column. The TDL sends it several ways, since which one a
 * TallyPrime release evaluates correctly is not something the CRM can know:
 * the Sales Accounts ledger total, the item-line total, the CRM's own sum of
 * the exploded ledger entries, and the GST total (from which basic = billed −
 * GST). A candidate is trusted only when it is positive and no more than the
 * billed total; where candidates disagree the lower wins, because the known
 * failure mode is a filter that summed too much, not too little. 0 means
 * none arrived — callers fall back to the billed total and say so.
 */
function pickBasicValue({ salesLedgerValue, itemValue, entryBasic, tax, entryTax, amount }) {
  const billed = Number(amount) || 0;
  const usable = [salesLedgerValue, itemValue, entryBasic]
    .map((v) => Number(v) || 0)
    .filter((v) => v > 0 && (billed === 0 || v <= billed + 1));
  if (usable.length) return Math.round(Math.min(...usable) * 100) / 100;
  const gst = Number(tax) || Number(entryTax) || 0;
  if (gst > 0 && gst < billed) return Math.round((billed - gst) * 100) / 100;
  return 0;
}

/** The <LEDGERENTRY> children of one <SALESINVOICE> block. */
function parseLedgerEntries(block) {
  const blocks = block.match(/<LEDGERENTRY>[\s\S]*?<\/LEDGERENTRY>/g) || [];
  return blocks
    .map((b) => ({
      name: cleanName(tagValue(b, 'NAME')),
      group: cleanName(tagValue(b, 'GROUP')),
      primaryGroup: cleanName(tagValue(b, 'PRIMARYGROUP')),
      amount: toAmount(tagValue(b, 'AMOUNT')),
    }))
    .filter((e) => e.name);
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
    // The voucher's own tags sit before its nested <LEDGERENTRY> children,
    // whose NAME/AMOUNT tags must not be mistaken for the voucher's.
    const head = block.split('<LEDGERENTRY>')[0];
    const ledgerEntries = parseLedgerEntries(block);
    const inv = {
      guid: tagValue(head, 'GUID'),
      voucherNumber: tagValue(head, 'VOUCHERNUMBER'),
      voucherType: cleanName(tagValue(head, 'VOUCHERTYPE')),
      date: parseTallyDate(tagValue(head, 'DATE')),
      party: cleanName(tagValue(head, 'PARTY')),
      reference: tagValue(head, 'REFERENCE'),
      orderNos: tagValue(head, 'ORDERNOS'),
      narration: tagValue(head, 'NARRATION'),
      // As billed (GST and round-off included), the figures the TDL offers
      // for the pre-GST basic value, and the one the CRM settles on (see
      // pickBasicValue). All 0 when the TDL in use predates the fields.
      amount: toAmount(tagValue(head, 'AMOUNT')),
      salesLedgerValue: toAmount(tagValue(head, 'BASICVALUE')),
      itemValue: toAmount(tagValue(head, 'ITEMVALUE')),
      tax: toAmount(tagValue(head, 'TAX')),
      ledgerEntries,
      entryBasic: sumEntries(ledgerEntries, isSalesEntry),
      entryTax: sumEntries(ledgerEntries, isTaxEntry),
    };
    inv.basicValue = pickBasicValue(inv);
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
  parseTallyTdlVersion,
  pickBasicValue,
  isSalesVoucher,
  SALES_VOUCHER_TYPE,
  TDL_VERSION,
};

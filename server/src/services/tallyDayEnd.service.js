/**
 * Parser for the "Mickys Day End Export" XML produced by
 * assets/mickys-dayend.tdl (report MickysDayEndReport): receipts, debtor
 * balances with their pending bills, production journals and batch-wise
 * closing stock. Same export conventions as the stock TDL (see
 * tallyStock.service.js) — empty tags for zero, quantities with their unit,
 * dates as YYYYMMDD — with one difference: ledger amounts keep their sign
 * here, because a debtor's side matters (Dr = owes us, Cr = paid in advance).
 * Every ledger figure therefore arrives with an ISDR Yes/No beside it, and the
 * sign of the number is only the fallback when that flag is missing.
 */
const { tagValue, cleanName, parseTallyDate } = require('./tallyStock.service');

/**
 * The version of the day-end TDL template in this repo. Served into the file
 * as {{TDL_VERSION}}, sent back by every push as <TDLVERSION>, and shown on
 * the report so "is the current copy loaded in Tally?" is never a guess. Bump
 * it whenever the template changes.
 */
const DAYEND_TDL_VERSION = '2';

/**
 * How many days before today the TDL re-reads closing positions for (debtor
 * balances, closing stock). Served into the file as {{HISTORY_DAYS}} and sent
 * back as <HISTORYDAYS>; the TDL carries one field per day, so changing this
 * means changing the template too.
 */
const HISTORY_DAYS = 7;

/** Same rule as the stock sync: only CENTRE POINT* may feed the CRM. */
const DAYEND_COMPANY = /^CENTRE POINT/i;

/** Only Semi Finished / Finished goods are reported on, as on the stock page. */
const FINISHED_GROUP = /finished/i;

const DAY_MS = 86400000;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** "-1234.50" | "1,234.50" | "" -> signed number (0 when empty). */
function toSigned(raw) {
  const n = parseFloat(String(raw || '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** "120.00 KG" -> { qty: 120, unit: 'KG' }; quantities are magnitudes. */
function toQty(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^(-?[\d,]*\.?\d+)\s*(.*)$/);
  if (!m) return { qty: 0, unit: '' };
  return { qty: Math.abs(toSigned(m[1])), unit: m[2].trim() };
}

/** "78.00/KG" -> 78 */
const toRate = (raw) => Math.abs(toSigned(String(raw || '').split('/')[0]));

/** Tally's Logical export: "Yes" / "No"; null when the tag is absent. */
function toFlag(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'yes' || s === 'true') return true;
  if (s === 'no' || s === 'false') return false;
  return null;
}

/** Debit side of a ledger figure: the ISDR flag, else the sign (Dr < 0). */
const isDebit = (amount, flag) => (flag === null ? amount < 0 : flag);

const addDays = (date, days) => new Date(date.getTime() + days * DAY_MS);

function addMonths(date, months) {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/**
 * A due date or expiry as Tally prints a "Due Date" value: either a date
 * ("15-Oct-26", "20261015") or a period counted from a base date ("30 Days",
 * "6 Months", "1 Year"). null when neither form reads.
 */
function parseDueText(raw, base) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const asDate = parseTallyDate(s);
  if (asDate) return asDate;
  if (!base) return null;
  const m = s.match(/^(\d+)\s*(d|days?|m|mon|mths?|months?|y|yrs?|years?)\.?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit.startsWith('d')) return addDays(base, n);
  if (unit.startsWith('m')) return addMonths(base, n);
  return addMonths(base, n * 12);
}

const blocksOf = (xml, tag) => xml.match(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'g')) || [];

/** The part of a block before its first nested child, so a child's NAME /
 *  AMOUNT tags are never read as the parent's. */
function headOf(block, childTags) {
  let cut = block.length;
  for (const t of childTags) {
    const i = block.indexOf(`<${t}>`);
    if (i !== -1 && i < cut) cut = i;
  }
  return block.slice(0, cut);
}

/**
 * Header: company, TDL copy, the Tally machine's date and the windows.
 * historyDays is how many earlier days the push re-reads positions for — 0
 * from a v1 copy or one served with history=0.
 */
function parseDayEndHeader(xml) {
  const head = headOf(xml, ['RECEIPT', 'DEBTOR', 'PRODUCTION', 'ITEMBATCHES', 'STOCKDAYS']);
  const historyDays = Math.trunc(Number(tagValue(head, 'HISTORYDAYS')) || 0);
  return {
    company: tagValue(head, 'COMPANY'),
    tdlVersion: tagValue(head, 'TDLVERSION'),
    today: parseTallyDate(tagValue(head, 'TODAY')),
    periodFrom: parseTallyDate(tagValue(head, 'PERIODFROM')),
    periodTo: parseTallyDate(tagValue(head, 'PERIODTO')),
    receiptsFrom: parseTallyDate(tagValue(head, 'RECEIPTSFROM')),
    productionFrom: parseTallyDate(tagValue(head, 'PRODUCTIONFROM')),
    historyDays: Math.min(Math.max(historyDays, 0), HISTORY_DAYS),
  };
}

/** A key for vouchers that arrive without a GUID. */
const voucherKey = (v) => v.guid || `${v.voucherType}|${v.voucherNumber}|${v.date ? v.date.toISOString().slice(0, 10) : ''}`;

/**
 * Receipt vouchers. `collected` is what the receipt credited to customer
 * ledgers — entries under Sundry Debtors (by group or top-level group), or a
 * ledger the stock push lists as a customer — so a loan or interest receipt
 * counts for nothing. A receipt whose entries did not arrive falls back to
 * its own amount when its party is a known customer.
 */
function parseReceipts(xml, { customerNames = new Set() } = {}) {
  if (typeof xml !== 'string' || !xml.includes('<RECEIPT>')) return [];
  const isCustomer = (e) =>
    /sundry\s+debtors/i.test(e.primaryGroup) || /sundry\s+debtors/i.test(e.group) || customerNames.has(e.name);

  const byKey = new Map();
  for (const block of blocksOf(xml, 'RECEIPT')) {
    const head = headOf(block, ['LEDGERENTRY']);
    const ledgerEntries = blocksOf(block, 'LEDGERENTRY')
      .map((b) => {
        const amount = toSigned(tagValue(b, 'AMOUNT'));
        return {
          name: cleanName(tagValue(b, 'NAME')),
          group: cleanName(tagValue(b, 'GROUP')),
          primaryGroup: cleanName(tagValue(b, 'PRIMARYGROUP')),
          amount: Math.abs(amount),
          isDr: isDebit(amount, toFlag(tagValue(b, 'ISDR'))),
        };
      })
      .filter((e) => e.name);

    const v = {
      guid: tagValue(head, 'GUID'),
      voucherNumber: tagValue(head, 'VOUCHERNUMBER'),
      voucherType: cleanName(tagValue(head, 'VOUCHERTYPE')),
      date: parseTallyDate(tagValue(head, 'DATE')),
      party: cleanName(tagValue(head, 'PARTY')),
      amount: Math.abs(toSigned(tagValue(head, 'AMOUNT'))),
      narration: tagValue(head, 'NARRATION'),
      ledgerEntries,
    };
    if (!v.date || (!v.guid && !v.voucherNumber)) continue;

    const credits = ledgerEntries.filter((e) => !e.isDr && isCustomer(e));
    if (ledgerEntries.length) {
      v.collected = round2(credits.reduce((s, e) => s + e.amount, 0));
      v.customers = [...new Set(credits.map((e) => e.name))];
    } else {
      const known = customerNames.has(v.party);
      v.collected = known ? v.amount : 0;
      v.customers = known ? [v.party] : [];
    }
    v.key = voucherKey(v);
    byKey.set(v.key, v);
  }
  return [...byKey.values()];
}

/** A ledger figure as a receivable: Dr positive, Cr (advance) negative. */
const receivable = (rawText, flagText) => {
  const raw = toSigned(rawText);
  return isDebit(raw, toFlag(flagText)) ? Math.abs(raw) : -Math.abs(raw);
};

/**
 * Sundry Debtors ledgers with a balance. `balance` is the receivable — a debit
 * balance positive, an advance (credit balance) negative — and each pending
 * bill carries the same sign rule. Due dates given as a period ("30 Days")
 * are counted from the bill date.
 *
 * With history (`historyDays` > 0), `history[k]` is the balance as on k days
 * before today (k = 1..historyDays), from <BALk>/<ISDRk>; an empty tag is a
 * nil balance, as everywhere in a Tally export. A ledger may then arrive with
 * no balance today, having owed on one of those days.
 */
function parseDebtors(xml, { historyDays = 0 } = {}) {
  if (typeof xml !== 'string' || !xml.includes('<DEBTOR>')) return [];
  const byName = new Map();
  for (const block of blocksOf(xml, 'DEBTOR')) {
    const head = headOf(block, ['BILL']);
    const name = cleanName(tagValue(head, 'NAME'));
    if (!name) continue;
    const balance = receivable(tagValue(head, 'BALANCE'), tagValue(head, 'ISDR'));
    const history = {};
    for (let k = 1; k <= historyDays; k += 1) {
      history[k] = round2(receivable(tagValue(head, `BAL${k}`), tagValue(head, `ISDR${k}`)));
    }

    const bills = blocksOf(block, 'BILL')
      .map((b) => {
        const amt = toSigned(tagValue(b, 'AMOUNT'));
        const billDate = parseTallyDate(tagValue(b, 'BILLDATE'));
        const dueText = tagValue(b, 'DUE');
        return {
          ref: cleanName(tagValue(b, 'NAME')),
          billDate,
          dueText,
          dueDate: parseDueText(dueText, billDate),
          amount: round2(isDebit(amt, toFlag(tagValue(b, 'ISDR'))) ? Math.abs(amt) : -Math.abs(amt)),
        };
      })
      .filter((b) => b.amount !== 0);

    byName.set(name, { name, group: cleanName(tagValue(head, 'GROUP')), balance: round2(balance), bills, history });
  }
  return [...byName.values()];
}

function parseInventoryLines(block, tag) {
  return blocksOf(block, tag)
    .map((b) => {
      const actual = toQty(tagValue(b, 'QTY'));
      const billed = toQty(tagValue(b, 'BILLEDQTY'));
      const q = actual.qty ? actual : billed;
      return {
        item: cleanName(tagValue(b, 'ITEM')),
        qty: q.qty,
        unit: q.unit || actual.unit || billed.unit,
        rate: toRate(tagValue(b, 'RATE')),
        amount: Math.abs(toSigned(tagValue(b, 'AMOUNT'))),
      };
    })
    .filter((e) => e.item);
}

/** Stock / manufacturing journals: items produced (IN) and consumed (OUT). */
function parseProduction(xml) {
  if (typeof xml !== 'string' || !xml.includes('<PRODUCTION>')) return [];
  const byKey = new Map();
  for (const block of blocksOf(xml, 'PRODUCTION')) {
    const head = headOf(block, ['IN', 'OUT']);
    const v = {
      guid: tagValue(head, 'GUID'),
      voucherNumber: tagValue(head, 'VOUCHERNUMBER'),
      voucherType: cleanName(tagValue(head, 'VOUCHERTYPE')),
      date: parseTallyDate(tagValue(head, 'DATE')),
      narration: tagValue(head, 'NARRATION'),
      inEntries: parseInventoryLines(block, 'IN'),
      outEntries: parseInventoryLines(block, 'OUT'),
    };
    if (!v.date || (!v.guid && !v.voucherNumber)) continue;
    v.key = voucherKey(v);
    byKey.set(v.key, v);
  }
  return [...byKey.values()];
}

/**
 * Batch-wise closing stock of the Semi Finished / Finished items (by the
 * item's stock group, or by being in the CRM's stock mirror). Expiry may be a
 * date or a period counted from the mfg date.
 */
function parseBatches(xml, { stockNames = new Set() } = {}) {
  if (typeof xml !== 'string' || !xml.includes('<ITEMBATCHES>')) return [];
  const rows = [];
  for (const block of blocksOf(xml, 'ITEMBATCHES')) {
    const head = headOf(block, ['BATCH']);
    const item = cleanName(tagValue(head, 'NAME'));
    const group = cleanName(tagValue(head, 'GROUP'));
    if (!item || !(FINISHED_GROUP.test(group) || stockNames.has(item))) continue;
    for (const b of blocksOf(block, 'BATCH')) {
      const { qty, unit } = toQty(tagValue(b, 'QTY'));
      const mfgDate = parseTallyDate(tagValue(b, 'MFGDATE'));
      const expiryText = tagValue(b, 'EXPIRY');
      rows.push({
        item,
        batch: cleanName(tagValue(b, 'NAME')) || cleanName(tagValue(b, 'BATCHNAME')),
        godown: cleanName(tagValue(b, 'GODOWN')),
        mfgDate,
        expiryText,
        expiryDate: parseDueText(expiryText, mfgDate),
        qty,
        unit,
        value: Math.abs(toSigned(tagValue(b, 'VALUE'))),
      });
    }
  }
  return rows.filter((r) => r.qty > 0);
}

/**
 * A closing quantity keeping its sign — stock can run negative in Tally —
 * whether printed "-5 KG" or "(-)5 KG".
 */
function toSignedQty(raw) {
  const s = String(raw || '').trim();
  const negative = /^\(-\)/.test(s) || /^-/.test(s);
  const { qty, unit } = toQty(s.replace(/^\(-\)\s*/, '').replace(/^-/, ''));
  return { qty: negative ? -qty : qty, unit };
}

/**
 * Closing stock as on today and each of the `historyDays` days before it
 * (<STOCKDAYS> rows: <Qk>/<Vk>, k = 0 today), for the Semi Finished /
 * Finished items — the same filter as the batches. Returns
 * [{ item, unit, days: [{ qty, value }, …] }] with days[k] = k days back.
 */
function parseStockDays(xml, { stockNames = new Set(), historyDays = 0 } = {}) {
  if (typeof xml !== 'string' || !xml.includes('<STOCKDAYS>')) return [];
  const byItem = new Map();
  for (const block of blocksOf(xml, 'STOCKDAYS')) {
    const item = cleanName(tagValue(block, 'NAME'));
    const group = cleanName(tagValue(block, 'GROUP'));
    if (!item || !(FINISHED_GROUP.test(group) || stockNames.has(item))) continue;
    let unit = tagValue(block, 'UNIT');
    const days = [];
    for (let k = 0; k <= historyDays; k += 1) {
      const q = toSignedQty(tagValue(block, `Q${k}`));
      if (!unit && q.unit) unit = q.unit;
      days.push({ qty: round2(q.qty), value: round2(toSigned(tagValue(block, `V${k}`))) });
    }
    byItem.set(item, { item, unit, days });
  }
  return [...byItem.values()];
}

/**
 * Kilograms in one unit of an item, so production cost compares per kg
 * across pack sizes: 1 when the item is kept in KG, else the pack weight from
 * its product code (SFG-006-250 = 250 g) or its name ("1KG", "250GM",
 * "10K- FG", "350Gm"). null when neither says.
 */
function kgPerUnit({ name = '', code = '', baseUnits = '' } = {}) {
  if (/^\s*kgs?\.?\s*$/i.test(baseUnits)) return 1;
  const c = String(code).match(/-(\d{2,5})$/);
  if (c) return Number(c[1]) / 1000;
  const n = String(name).toUpperCase();
  const kg = n.match(/(\d+(?:\.\d+)?)\s*(?:KGS?|K)(?![A-Z])/);
  if (kg) return Number(kg[1]);
  // Grams, including the catalogue's "GMN" and "MG" typos for GM.
  const g = n.match(/(\d+(?:\.\d+)?)\s*(?:GMS?|GMN|GRAMS?|G|MG)(?![A-Z])/);
  if (g) return Number(g[1]) / 1000;
  return null;
}

module.exports = {
  DAYEND_TDL_VERSION,
  HISTORY_DAYS,
  DAYEND_COMPANY,
  FINISHED_GROUP,
  parseDayEndHeader,
  parseReceipts,
  parseDebtors,
  parseProduction,
  parseBatches,
  parseStockDays,
  parseDueText,
  kgPerUnit,
};

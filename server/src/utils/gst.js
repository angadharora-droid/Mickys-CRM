/**
 * GST arithmetic for sales orders, in one place so the order, its PDF, its
 * emails and the screen never disagree by a paisa. client/src/lib/gst.js is
 * the same logic for the browser — keep the two in step.
 *
 * Every line carries its own GST rate (%), because the rate is a property of
 * the product (5% on most of the range, 12% or 18% on some). Whether a line's
 * RATE already contains that GST is a property of the price list instead —
 * the distributor and institutional rate cards quote exclusive of GST, the
 * B2C MRP card quotes inclusive — so the basis sits on the order, not the
 * line, and an appointed customer's frozen list dictates it.
 *
 * Intra-state supply splits the GST into CGST + SGST halves; inter-state
 * supply is IGST for the whole amount. Which applies is read off the
 * customer's GSTIN (its first two characters are the state code) against the
 * company's own.
 */

const GST_BASES = ['exclusive', 'inclusive'];
const SUPPLY_TYPES = ['intra', 'inter'];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * One line's money: `amount` is qty × rate exactly as quoted; `taxable` and
 * `lineTotal` are that amount with the GST taken out or put on, depending on
 * the basis; `gstAmount` is their difference — computed as the difference so
 * taxable + GST equals the line total to the paisa, whatever the rounding.
 */
function computeLine({ qty, rate, gst = 0, basis = 'exclusive' }) {
  const amount = round2((Number(qty) || 0) * (Number(rate) || 0));
  const factor = 1 + Math.max(0, Number(gst) || 0) / 100;
  const taxable = basis === 'inclusive' ? round2(amount / factor) : amount;
  const lineTotal = basis === 'inclusive' ? amount : round2(amount * factor);
  return { amount, taxable, gstAmount: round2(lineTotal - taxable), lineTotal };
}

/** The order's totals from its computed lines, with the GST split by supply type. */
function computeTotals(lines, { supplyType = 'intra' } = {}) {
  const sum = (key) => round2(lines.reduce((s, l) => s + (Number(l[key]) || 0), 0));
  const taxableTotal = sum('taxable');
  const gstTotal = sum('gstAmount');
  const total = sum('lineTotal');
  const inter = supplyType === 'inter';
  const cgst = inter ? 0 : round2(gstTotal / 2);
  return {
    taxableTotal,
    gstTotal,
    cgst,
    sgst: inter ? 0 : round2(gstTotal - cgst), // the other half, to the paisa
    igst: inter ? gstTotal : 0,
    total,
  };
}

/** The two-digit state code a GSTIN starts with, or '' when there is no usable GSTIN. */
function stateCodeOf(gstin) {
  const code = String(gstin || '').trim().slice(0, 2);
  return /^\d{2}$/.test(code) ? code : '';
}

/**
 * Intra-state unless both GSTINs are known and name different states. A
 * customer without a GSTIN (a walk-in, a plain Tally ledger) is taken as
 * local; the screen lets the exec say otherwise.
 */
function deriveSupplyType(customerGstin, companyGstin) {
  const customer = stateCodeOf(customerGstin);
  const company = stateCodeOf(companyGstin);
  return customer && company && customer !== company ? 'inter' : 'intra';
}

/** The distinct GST rates on an order's lines, e.g. "5%" or "5% / 12%"; '' when none. */
function gstRateLabel(lines) {
  const rates = [...new Set((lines || []).map((l) => Number(l.gst) || 0).filter((r) => r > 0))].sort((a, b) => a - b);
  return rates.map((r) => `${r}%`).join(' / ');
}

module.exports = { GST_BASES, SUPPLY_TYPES, round2, computeLine, computeTotals, stateCodeOf, deriveSupplyType, gstRateLabel };

/**
 * GST arithmetic for the order screens — the same rules as the server's
 * utils/gst.js, so the total the exec sees while typing is the total the
 * server saves. Keep the two in step.
 *
 * Each line carries its own GST rate (%); whether the typed rates already
 * contain GST (the basis) is a property of the price list and sits on the
 * order. Intra-state supply splits GST into CGST + SGST, inter-state is IGST.
 */

export const GST_BASIS_OPTIONS = [
  { value: 'exclusive', label: 'Exclusive of GST', short: 'excl. GST', hint: 'GST is added on top of the rates' },
  { value: 'inclusive', label: 'Inclusive of GST', short: 'incl. GST', hint: 'The rates already contain GST' },
];
export const GST_BASIS_LABELS = Object.fromEntries(GST_BASIS_OPTIONS.map((o) => [o.value, o.label]));

export const SUPPLY_TYPE_OPTIONS = [
  { value: 'intra', label: 'CGST + SGST', hint: 'Supply within the state' },
  { value: 'inter', label: 'IGST', hint: 'Supply to another state' },
];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** One line: amount = qty × rate as typed; taxable / lineTotal under the basis; GST = the difference. */
export function computeLine({ qty, rate, gst = 0, basis = 'exclusive' }) {
  const amount = round2((Number(qty) || 0) * (Number(rate) || 0));
  const factor = 1 + Math.max(0, Number(gst) || 0) / 100;
  const taxable = basis === 'inclusive' ? round2(amount / factor) : amount;
  const lineTotal = basis === 'inclusive' ? amount : round2(amount * factor);
  return { amount, taxable, gstAmount: round2(lineTotal - taxable), lineTotal };
}

/** Order totals from computed lines, GST split by supply type. */
export function computeTotals(lines, { supplyType = 'intra' } = {}) {
  const sum = (key) => round2(lines.reduce((s, l) => s + (Number(l[key]) || 0), 0));
  const taxableTotal = sum('taxable');
  const gstTotal = sum('gstAmount');
  const total = sum('lineTotal');
  const inter = supplyType === 'inter';
  const cgst = inter ? 0 : round2(gstTotal / 2);
  return { taxableTotal, gstTotal, cgst, sgst: inter ? 0 : round2(gstTotal - cgst), igst: inter ? gstTotal : 0, total };
}

/** The two-digit state code a GSTIN starts with, or ''. */
export const stateCodeOf = (gstin) => {
  const code = String(gstin || '').trim().slice(0, 2);
  return /^\d{2}$/.test(code) ? code : '';
};

/** Intra-state unless both GSTINs are known and name different states. */
export function deriveSupplyType(customerGstin, companyGstin) {
  const customer = stateCodeOf(customerGstin);
  const company = stateCodeOf(companyGstin);
  return customer && company && customer !== company ? 'inter' : 'intra';
}

/** The distinct GST rates on the lines, e.g. "5%" or "5% / 12%"; '' when none. */
export function gstRateLabel(lines) {
  const rates = [...new Set((lines || []).map((l) => Number(l.gst) || 0).filter((r) => r > 0))].sort((a, b) => a - b);
  return rates.map((r) => `${r}%`).join(' / ');
}

/**
 * The totals an order document carries, with the fallbacks an order booked
 * before GST was recorded needs: it has a total and nothing else.
 */
export function orderTotals(o) {
  const gstTotal = Number(o?.gstTotal) || 0;
  return {
    taxableTotal: gstTotal > 0 ? Number(o.taxableTotal) || 0 : Number(o?.total) || 0,
    gstTotal,
    cgst: Number(o?.cgst) || 0,
    sgst: Number(o?.sgst) || 0,
    igst: Number(o?.igst) || 0,
    total: Number(o?.total) || 0,
    basis: o?.gst?.basis || 'exclusive',
    supplyType: o?.gst?.supplyType || 'intra',
  };
}

/**
 * Currencies the export kit can quote in. INR is the base: every stored rate
 * is "INR per 1 unit" of a quoted currency (e.g. USD: 96.88 means $1 = ₹96.88).
 *
 * Adding a currency here adds it to the daily FX sync, the manual-rate form,
 * the lead's export config and the rate-card PDFs. The client mirror is
 * client/src/lib/currencies.js — keep the two lists in step.
 *
 * `seed` is the starting rate on a fresh database (replaced by the first feed
 * refresh). A currency added later has none: the existing rates document gets
 * it from the next refresh, which runs at boot while any rate is missing.
 * `pdf` is the PDF price prefix — PDFKit's built-in fonts carry $ £ € but
 * not ₹, hence "Rs.".
 */
const QUOTED_CURRENCIES = [
  { code: 'USD', name: 'US Dollar', pdf: '$', seed: 96 },
  { code: 'EUR', name: 'Euro', pdf: '€', seed: 109 },
  { code: 'GBP', name: 'British Pound', pdf: '£', seed: 127 },
  { code: 'BND', name: 'Brunei Dollar', pdf: 'B$' },
];

const QUOTED_CODES = QUOTED_CURRENCIES.map((c) => c.code);
const EXPORT_CURRENCIES = [...QUOTED_CODES, 'INR'];

/** "USD 96.88 · EUR 108.37 · …" for logs and activity details. */
const describeRates = (inrPer) => QUOTED_CODES.map((c) => `${c} ${inrPer?.[c] ?? '—'}`).join(' · ');

module.exports = { QUOTED_CURRENCIES, QUOTED_CODES, EXPORT_CURRENCIES, describeRates };

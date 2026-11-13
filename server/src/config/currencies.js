/**
 * Currencies the export kit can quote in. INR is the base: every stored rate
 * is "INR per 1 unit" of a quoted currency (e.g. USD: 96.88 means $1 = ₹96.88).
 *
 * Adding a currency here adds it to the daily FX sync, the manual-rate form,
 * the lead's export config and the rate-card PDFs. The client mirror is
 * client/src/lib/currencies.js — keep the two lists in step. Check the FX feed
 * carries the code first: one missing code fails the whole refresh.
 *
 * `seed` is the starting rate on a fresh database (replaced by the first feed
 * refresh). A currency added later has none: the existing rates document gets
 * it from the next refresh, which runs at boot while any rate is missing.
 * `pdf` is the PDF price prefix — PDFKit's built-in fonts carry $ £ € ¥ but
 * not ₹ or the Gulf symbols, hence "Rs." and the ISO-code prefixes.
 * `decimals` is how many decimal places a price carries (default 2). The Gulf
 * dinars and the Omani rial are worth ₹250–300 and are divided into
 * thousandths, so a 2-place price would be out by up to ₹1.50 a pack.
 */
const QUOTED_CURRENCIES = [
  { code: 'USD', name: 'US Dollar', pdf: '$', seed: 96 },
  { code: 'EUR', name: 'Euro', pdf: '€', seed: 109 },
  { code: 'GBP', name: 'British Pound', pdf: '£', seed: 127 },
  // Gulf
  { code: 'AED', name: 'UAE Dirham', pdf: 'AED ' },
  { code: 'SAR', name: 'Saudi Riyal', pdf: 'SAR ' },
  { code: 'QAR', name: 'Qatari Riyal', pdf: 'QAR ' },
  { code: 'KWD', name: 'Kuwaiti Dinar', pdf: 'KWD ', decimals: 3 },
  { code: 'OMR', name: 'Omani Rial', pdf: 'OMR ', decimals: 3 },
  { code: 'BHD', name: 'Bahraini Dinar', pdf: 'BHD ', decimals: 3 },
  // Asia-Pacific
  { code: 'SGD', name: 'Singapore Dollar', pdf: 'S$' },
  { code: 'BND', name: 'Brunei Dollar', pdf: 'B$' },
  { code: 'MYR', name: 'Malaysian Ringgit', pdf: 'RM ' },
  { code: 'AUD', name: 'Australian Dollar', pdf: 'A$' },
  { code: 'NZD', name: 'New Zealand Dollar', pdf: 'NZ$' },
  { code: 'JPY', name: 'Japanese Yen', pdf: '¥' },
  { code: 'CNY', name: 'Chinese Yuan', pdf: 'CN¥' },
  { code: 'HKD', name: 'Hong Kong Dollar', pdf: 'HK$' },
  // Rest of world
  { code: 'CAD', name: 'Canadian Dollar', pdf: 'C$' },
  { code: 'CHF', name: 'Swiss Franc', pdf: 'CHF ' },
  { code: 'ZAR', name: 'South African Rand', pdf: 'ZAR ' },
];

const QUOTED_CODES = QUOTED_CURRENCIES.map((c) => c.code);
const EXPORT_CURRENCIES = [...QUOTED_CODES, 'INR'];

const DECIMALS = Object.fromEntries(QUOTED_CURRENCIES.map((c) => [c.code, c.decimals ?? 2]));
/** Decimal places a price in `code` is quoted to (INR and anything unlisted: 2). */
const currencyDecimals = (code) => DECIMALS[code] ?? 2;

/** "USD 96.88 · EUR 108.37 · …" for logs and activity details. */
const describeRates = (inrPer) => QUOTED_CODES.map((c) => `${c} ${inrPer?.[c] ?? '—'}`).join(' · ');

module.exports = { QUOTED_CURRENCIES, QUOTED_CODES, EXPORT_CURRENCIES, currencyDecimals, describeRates };

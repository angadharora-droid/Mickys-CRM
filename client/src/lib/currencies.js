// Export-kit currencies — mirror of server/src/config/currencies.js; keep the
// two lists in step. INR is the base every stored rate is quoted against.
// `symbol` matches the PDF prefix (ISO code + space where the PDF font has no
// glyph); `decimals` is the price precision when it isn't 2.
export const QUOTED_CURRENCIES = [
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  // Gulf
  { code: 'AED', symbol: 'AED ', name: 'UAE Dirham' },
  { code: 'SAR', symbol: 'SAR ', name: 'Saudi Riyal' },
  { code: 'QAR', symbol: 'QAR ', name: 'Qatari Riyal' },
  { code: 'KWD', symbol: 'KWD ', name: 'Kuwaiti Dinar', decimals: 3 },
  { code: 'OMR', symbol: 'OMR ', name: 'Omani Rial', decimals: 3 },
  { code: 'BHD', symbol: 'BHD ', name: 'Bahraini Dinar', decimals: 3 },
  // Asia-Pacific
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar' },
  { code: 'BND', symbol: 'B$', name: 'Brunei Dollar' },
  { code: 'MYR', symbol: 'RM ', name: 'Malaysian Ringgit' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'NZD', symbol: 'NZ$', name: 'New Zealand Dollar' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
  { code: 'CNY', symbol: 'CN¥', name: 'Chinese Yuan' },
  { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar' },
  // Rest of world
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
  { code: 'CHF', symbol: 'CHF ', name: 'Swiss Franc' },
  { code: 'ZAR', symbol: 'ZAR ', name: 'South African Rand' },
];

export const EXPORT_CURRENCIES = [...QUOTED_CURRENCIES.map((c) => c.code), 'INR'];

export const CUR_SYMBOL = {
  ...Object.fromEntries(QUOTED_CURRENCIES.map((c) => [c.code, c.symbol])),
  INR: '₹',
};

const DECIMALS = Object.fromEntries(QUOTED_CURRENCIES.map((c) => [c.code, c.decimals ?? 2]));
/** Decimal places a price in `code` is quoted to (INR and anything unlisted: 2). */
export const currencyDecimals = (code) => DECIMALS[code] ?? 2;

// Export-kit currencies — mirror of server/src/config/currencies.js; keep the
// two lists in step. INR is the base every stored rate is quoted against.
export const QUOTED_CURRENCIES = [
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'BND', symbol: 'B$', name: 'Brunei Dollar' },
];

export const EXPORT_CURRENCIES = [...QUOTED_CURRENCIES.map((c) => c.code), 'INR'];

export const CUR_SYMBOL = {
  ...Object.fromEntries(QUOTED_CURRENCIES.map((c) => [c.code, c.symbol])),
  INR: '₹',
};

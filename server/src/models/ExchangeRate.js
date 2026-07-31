const mongoose = require('mongoose');

// Currencies the export kit can quote in. INR is the base — every stored rate
// is "INR per 1 unit of the foreign currency" (e.g. USD: 87.5 means $1 = ₹87.50),
// which is also how an admin would sanity-check the number.
const EXPORT_CURRENCIES = ['USD', 'EUR', 'GBP', 'INR'];

/**
 * Singleton document (key = "global") holding the day's exchange rates.
 * Refreshed daily by the in-process FX sync (fx.service); `source` records
 * where the current numbers came from ('seed' until the first successful
 * fetch, then the API host, or 'manual' after an admin override).
 */
const exchangeRateSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'global', unique: true },
    base: { type: String, default: 'INR' },
    inrPer: {
      USD: { type: Number, min: 0, default: 96 },
      EUR: { type: Number, min: 0, default: 109 },
      GBP: { type: Number, min: 0, default: 127 },
    },
    fetchedAt: { type: Date, default: null },
    source: { type: String, default: 'seed' },
  },
  { timestamps: true }
);

exchangeRateSchema.statics.getGlobal = async function () {
  let doc = await this.findOne({ key: 'global' });
  if (!doc) doc = await this.create({ key: 'global' });
  return doc;
};

const ExchangeRate = mongoose.model('ExchangeRate', exchangeRateSchema);
ExchangeRate.EXPORT_CURRENCIES = EXPORT_CURRENCIES;
module.exports = ExchangeRate;

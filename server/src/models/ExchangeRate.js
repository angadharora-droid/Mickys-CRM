const mongoose = require('mongoose');
const { QUOTED_CURRENCIES, EXPORT_CURRENCIES } = require('../config/currencies');

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
    // INR per 1 unit of each quoted currency (config/currencies.js).
    inrPer: Object.fromEntries(
      QUOTED_CURRENCIES.map((c) => [
        c.code,
        { type: Number, min: 0, ...(c.seed ? { default: c.seed } : {}) },
      ])
    ),
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

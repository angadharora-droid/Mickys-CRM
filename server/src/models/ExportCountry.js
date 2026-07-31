const mongoose = require('mongoose');

/**
 * A destination country the Export Kit can quote. Holds the per-country
 * commercial inputs the rate engine needs:
 *
 *  - cirPercent: Container Insurance Rate, applied as a percentage of the
 *    shipment's goods value (insurance is quoted against value, not weight).
 *  - partLoadFreightPerKg: INR per kg used to build part-load freight
 *    (freight = rate × chargeable shipment weight).
 *
 * Container port-transportation costs are not per-country — they live in the
 * export section of Settings.
 */
const exportCountrySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, trim: true, uppercase: true, default: '' }, // ISO-ish short code, display only
    cirPercent: { type: Number, required: true, min: 0, max: 100 },
    partLoadFreightPerKg: { type: Number, required: true, min: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

exportCountrySchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

module.exports = mongoose.model('ExportCountry', exportCountrySchema);

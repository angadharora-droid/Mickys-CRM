const mongoose = require('mongoose');

const entrySchema = new mongoose.Schema(
  {
    item: { type: String, required: true },
    qty: { type: Number, default: 0 },
    unit: { type: String, default: '' },
    rate: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
  },
  { _id: false }
);

/**
 * Stock / manufacturing journals mirrored from Tally by the day-end TDL — the
 * source of "Production" and "Production Cost" on the Day End Report. Kept
 * raw (items in and out, as Tally holds them); the report nets an item that
 * appears on both sides of one voucher, so a godown transfer produces
 * nothing.
 *
 * Each push carries the last 10 days, mirrored inside that window the same
 * way as receipts; older vouchers are kept as the history the average cost
 * per kg is worked out from.
 */
const tallyProductionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    guid: { type: String, default: '' },
    voucherNumber: { type: String, default: '' },
    voucherType: { type: String, default: '' },
    date: { type: Date, required: true, index: true },
    narration: { type: String, default: '' },
    inEntries: { type: [entrySchema], default: [] },
    outEntries: { type: [entrySchema], default: [] },
    firstSeenAt: { type: Date, default: null },
    lastSeenAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

tallyProductionSchema.index({ 'inEntries.item': 1, date: 1 });

module.exports = mongoose.model('TallyProduction', tallyProductionSchema);

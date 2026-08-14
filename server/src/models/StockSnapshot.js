const mongoose = require('mongoose');

/**
 * One row per stock item per day (IST) — the day-wise opening/closing
 * register behind GET /stock/daily, written as a side effect of every sync.
 *
 * dayOpen* hold the position at the FIRST sync of the day. The Tally-side
 * auto-push fires when the company is opened in the morning, before the
 * day's entries, so this is effectively the day's opening stock. qty/rate/
 * value track the LAST sync of the day. A day's closing is therefore the
 * NEXT day's dayOpen* when that snapshot exists, falling back to the same
 * day's last-sync position until then.
 */
const stockSnapshotSchema = new mongoose.Schema(
  {
    date: { type: String, required: true }, // 'YYYY-MM-DD' in IST
    name: { type: String, required: true, trim: true },
    group: { type: String, trim: true, default: '' },
    category: { type: String, trim: true, default: '' },
    baseUnits: { type: String, trim: true, default: '' },

    // Position at the first sync of `date` (the day's opening).
    dayOpenQty: { type: Number, default: 0 },
    dayOpenRate: { type: Number, default: 0 },
    dayOpenValue: { type: Number, default: 0 },

    // Position at the last sync of `date`.
    qty: { type: Number, default: 0 },
    rate: { type: Number, default: 0 },
    value: { type: Number, default: 0 },

    firstSyncAt: { type: Date },
    lastSyncAt: { type: Date, index: true },
  },
  { timestamps: true }
);

stockSnapshotSchema.index({ date: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('StockSnapshot', stockSnapshotSchema);

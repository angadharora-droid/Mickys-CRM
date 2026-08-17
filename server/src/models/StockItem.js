const mongoose = require('mongoose');

/**
 * A stock item mirrored from Tally (via the Mickys Stock Export TDL). This
 * collection is a read-only replica: every sync upserts the full Tally list
 * and removes items that disappeared from Tally — it is never edited by hand.
 * Quantities are in `baseUnits`; opening figures are "as on" the sync period's
 * from-date, closing figures "as on" its to-date.
 *
 * `nameKey` is the normalised item name (trimmed, upper-cased, inner runs of
 * whitespace collapsed) and is the only thing sales orders join on — order
 * lines for appointed customers carry the frozen list's UPPERCASE name, which
 * never matches Tally's mixed-case name directly. It is deliberately not
 * unique: Tally allows "CP Nuggets" and "CP NUGGETS" to coexist, and a unique
 * index would make the whole sync fail rather than surface the clash.
 */
const stockItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    nameKey: { type: String, trim: true, default: '', index: true },
    group: { type: String, trim: true, default: '', index: true },
    category: { type: String, trim: true, default: '' },
    baseUnits: { type: String, trim: true, default: '' },

    openingQty: { type: Number, default: 0 },
    openingRate: { type: Number, default: 0 },
    openingValue: { type: Number, default: 0 },
    inwardQty: { type: Number, default: 0 },
    inwardValue: { type: Number, default: 0 },
    outwardQty: { type: Number, default: 0 },
    outwardValue: { type: Number, default: 0 },
    closingQty: { type: Number, default: 0, index: true },
    closingRate: { type: Number, default: 0 },
    closingValue: { type: Number, default: 0 },
    standardCost: { type: Number, default: 0 },
    standardPrice: { type: Number, default: 0 },
    // Rates from the item's most recent sale/purchase voucher — the
    // practical selling price when standard rates aren't maintained.
    lastSalePrice: { type: Number, default: 0 },
    lastPurchaseCost: { type: Number, default: 0 },

    syncedAt: { type: Date, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('StockItem', stockItemSchema);

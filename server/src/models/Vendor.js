const mongoose = require('mongoose');

/**
 * A vendor (supplier) mirrored from Tally — ledgers under Sundry Creditors,
 * sent as <VENDOR> elements by the Mickys Stock Export TDL. Like StockItem,
 * this is a read-only replica: each sync that carries vendors upserts the
 * full list and removes vendors that disappeared from Tally.
 */
const vendorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    group: { type: String, trim: true, default: '' },
    syncedAt: { type: Date, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Vendor', vendorSchema);

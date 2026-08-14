const mongoose = require('mongoose');

/**
 * A customer (buyer) mirrored from Tally — ledgers under Sundry Debtors,
 * sent as <CUSTOMER> elements by the Mickys Stock Export TDL. Like Vendor,
 * this is a read-only replica: each sync that carries customers upserts the
 * full list and removes customers that disappeared from Tally.
 */
const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    group: { type: String, trim: true, default: '' },
    syncedAt: { type: Date, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Customer', customerSchema);

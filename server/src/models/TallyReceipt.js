const mongoose = require('mongoose');

/**
 * Receipt vouchers mirrored from Tally by the day-end TDL — the source of
 * "Collection Received" on the Day End Report. `collected` is the part of the
 * receipt credited to customer (Sundry Debtors) ledgers; the rest of a receipt
 * (a loan, interest, a refund from a vendor) is not a collection.
 *
 * Each push carries the last 40 days. Receipts in that window are upserted,
 * and any receipt dated inside the window that the push no longer carries is
 * removed — it was deleted or cancelled in Tally. Older receipts are kept.
 */
const tallyReceiptSchema = new mongoose.Schema(
  {
    // Tally's GUID, or type|number|date for exports that carry no GUID.
    key: { type: String, required: true, unique: true },
    guid: { type: String, default: '' },
    voucherNumber: { type: String, default: '' },
    voucherType: { type: String, default: '' },
    date: { type: Date, required: true, index: true },
    party: { type: String, default: '', index: true },
    amount: { type: Number, default: 0 },
    collected: { type: Number, default: 0 },
    customers: { type: [String], default: [] },
    narration: { type: String, default: '' },
    ledgerEntries: {
      type: [
        {
          _id: false,
          name: { type: String, default: '' },
          group: { type: String, default: '' },
          primaryGroup: { type: String, default: '' },
          amount: { type: Number, default: 0 },
          isDr: { type: Boolean, default: false },
        },
      ],
      default: [],
    },
    firstSeenAt: { type: Date, default: null },
    lastSeenAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('TallyReceipt', tallyReceiptSchema);

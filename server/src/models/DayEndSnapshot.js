const mongoose = require('mongoose');

/**
 * One document per IST day, rewritten by every day-end push of that day: the
 * positions Tally reports "as on now" — what each customer owes (with their
 * pending bills) and the batch-wise stock with expiry dates. The last push of
 * a day is therefore that day's closing position, which is what lets the Day
 * End Report be read back for an earlier date.
 */
const snapshotSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true }, // 'YYYY-MM-DD' in IST

    // balance: the receivable (debit balance +, advance received −).
    debtors: {
      type: [
        {
          _id: false,
          name: { type: String, required: true },
          group: { type: String, default: '' },
          balance: { type: Number, default: 0 },
          bills: {
            type: [
              {
                _id: false,
                ref: { type: String, default: '' },
                billDate: { type: Date, default: null },
                dueDate: { type: Date, default: null },
                dueText: { type: String, default: '' },
                amount: { type: Number, default: 0 },
              },
            ],
            default: [],
          },
        },
      ],
      default: [],
    },

    batches: {
      type: [
        {
          _id: false,
          item: { type: String, required: true },
          batch: { type: String, default: '' },
          godown: { type: String, default: '' },
          mfgDate: { type: Date, default: null },
          expiryDate: { type: Date, default: null },
          expiryText: { type: String, default: '' },
          qty: { type: Number, default: 0 },
          unit: { type: String, default: '' },
          value: { type: Number, default: 0 },
        },
      ],
      default: [],
    },
    // False when the push came from the copy without the batch section
    // (…/dayend/tdl?batches=0) — expiry is then "not sent", not "none".
    batchesSent: { type: Boolean, default: false },

    counts: {
      receipts: { type: Number, default: 0 },
      production: { type: Number, default: 0 },
      debtors: { type: Number, default: 0 },
      bills: { type: Number, default: 0 },
      batches: { type: Number, default: 0 },
    },
    tallyDate: { type: Date, default: null }, // the Tally machine's own date
    tdlVersion: { type: String, default: '' },
    firstSyncAt: { type: Date },
    lastSyncAt: { type: Date, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('DayEndSnapshot', snapshotSchema);

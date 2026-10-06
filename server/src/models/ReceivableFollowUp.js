const mongoose = require('mongoose');

/**
 * The latest follow-up on a customer's dues, keyed by their Tally ledger name
 * — the "Follow-up Status" column of the Day End Report's due list. Kept apart
 * from the day snapshots so a note made today still shows tomorrow.
 */
const receivableFollowUpSchema = new mongoose.Schema(
  {
    ledger: { type: String, required: true, trim: true, unique: true },
    status: { type: String, trim: true, default: '', maxlength: 300 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ReceivableFollowUp', receivableFollowUpSchema);

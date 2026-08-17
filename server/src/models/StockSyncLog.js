const mongoose = require('mongoose');

/**
 * One entry per Tally stock sync — the latest row drives the "last synced"
 * banner in the Sales Order dashboard, older rows are the sync history.
 *
 * `syncedAt` is the moment the sync started, i.e. the cut-off the mirrored
 * figures are true "as on". It is stamped separately from createdAt, which is
 * written after the upserts and snapshots finish and is therefore later than
 * the data it describes — the reservation release rule compares against this
 * field precisely because every minute of that difference would release stock
 * Tally may not have booked out yet.
 */
const stockSyncLogSchema = new mongoose.Schema(
  {
    syncedAt: { type: Date, index: true },
    itemCount: { type: Number, required: true },
    removedCount: { type: Number, default: 0 },
    vendorCount: { type: Number, default: 0 },
    customerCount: { type: Number, default: 0 },
    // 'upload' = XML file uploaded in the CRM; 'push' = sent by Tally itself.
    source: { type: String, enum: ['upload', 'push'], required: true },
    syncedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('StockSyncLog', stockSyncLogSchema);

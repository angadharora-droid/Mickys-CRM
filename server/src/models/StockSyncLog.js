const mongoose = require('mongoose');

/**
 * One entry per Tally stock sync — the latest row drives the "last synced"
 * banner in the Sales Order dashboard, older rows are the sync history.
 */
const stockSyncLogSchema = new mongoose.Schema(
  {
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

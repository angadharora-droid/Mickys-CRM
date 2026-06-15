const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    action: { type: String, required: true, index: true },
    entity: { type: String, required: true, index: true },
    entityId: { type: mongoose.Schema.Types.ObjectId },
    details: { type: String, default: '' },
    meta: { type: Object, default: {} },
    ip: { type: String, default: '' },
  },
  { timestamps: { createdAt: 'timestamp', updatedAt: false } }
);

activityLogSchema.index({ timestamp: -1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);

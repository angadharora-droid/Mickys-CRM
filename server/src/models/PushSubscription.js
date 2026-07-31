const mongoose = require('mongoose');

// One document per browser/device push registration. A user may hold several
// (phone, desktop, tablet); the endpoint is globally unique per subscription,
// so a shared device always notifies whoever registered it most recently.
const pushSubscriptionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    userAgent: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);

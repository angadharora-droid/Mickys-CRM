const mongoose = require('mongoose');

// Singleton document holding the server's VAPID key pair, auto-generated on
// first use so web push works with zero configuration. Set VAPID_PUBLIC_KEY /
// VAPID_PRIVATE_KEY env vars to pin the pair instead — note that changing keys
// invalidates every existing browser subscription.
const vapidConfigSchema = new mongoose.Schema({
  publicKey: { type: String, required: true },
  privateKey: { type: String, required: true },
});

module.exports = mongoose.model('VapidConfig', vapidConfigSchema);

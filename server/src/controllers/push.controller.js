const asyncHandler = require('../utils/asyncHandler');
const push = require('../services/push.service');

// GET /api/push/public-key — VAPID public key the browser subscribes with.
const publicKey = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { publicKey: await push.getPublicKey() } });
});

// POST /api/push/subscribe — register this browser/device for the caller.
const subscribe = asyncHandler(async (req, res) => {
  await push.saveSubscription(req.user._id, req.body.subscription, req.headers['user-agent']);
  res.status(201).json({ success: true, message: 'Notifications enabled on this device' });
});

// POST /api/push/unsubscribe — drop this browser/device for the caller.
const unsubscribe = asyncHandler(async (req, res) => {
  await push.removeSubscription(req.user._id, req.body.endpoint);
  res.json({ success: true, message: 'Notifications disabled on this device' });
});

module.exports = { publicKey, subscribe, unsubscribe };

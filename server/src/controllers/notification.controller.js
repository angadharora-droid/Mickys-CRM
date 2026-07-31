const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const Notification = require('../models/Notification');

// GET /api/notifications — the bell menu's data: the newest notifications for
// the signed-in user plus their total unread count (the badge).
const listNotifications = asyncHandler(async (req, res) => {
  const [items, unread] = await Promise.all([
    Notification.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50),
    Notification.countDocuments({ userId: req.user._id, read: false }),
  ]);
  res.json({ success: true, data: items, meta: { unread } });
});

// POST /api/notifications/read-all — clear the badge in one tap.
const markAllRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ userId: req.user._id, read: false }, { $set: { read: true } });
  res.json({ success: true, message: 'All notifications marked read' });
});

// POST /api/notifications/:id/read — opening a notification marks it read.
const markRead = asyncHandler(async (req, res) => {
  const n = await Notification.findOneAndUpdate(
    { _id: req.params.id, userId: req.user._id },
    { $set: { read: true } },
    { new: true }
  );
  if (!n) throw ApiError.notFound('Notification not found');
  res.json({ success: true, data: n });
});

module.exports = { listNotifications, markAllRead, markRead };

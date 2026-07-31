const mongoose = require('mongoose');

// One in-app notification for one user — the persistent copy of every push
// sent via notifyUser(), so the bell menu shows "what's new" even on devices
// that never enabled (or don't support) web push. `url` is the in-app route
// the notification opens; `read` flips when the user opens or clears it.
const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    url: { type: String, default: '/' },
    tag: { type: String, default: '' },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// The bell shows a short recent list and an unread count — both per user.
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, read: 1 });
// Old notifications expire on their own; 60 days is far past "what's new".
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });

module.exports = mongoose.model('Notification', notificationSchema);

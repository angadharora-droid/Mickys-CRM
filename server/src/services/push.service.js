const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');
const VapidConfig = require('../models/VapidConfig');
const Notification = require('../models/Notification');

// Contact address the push services may use to reach the server operator.
const PUSH_CONTACT = process.env.WEB_PUSH_CONTACT || 'sales@mickys.in';

// A user rarely has more than a phone, a desktop and a tablet; anything past
// this is stale registrations from cleared browsers, so the oldest are dropped.
const MAX_SUBSCRIPTIONS_PER_USER = 10;

let vapidReady = null;

/**
 * VAPID keys identify this server to the browsers' push services. Env vars win
 * (pin the pair across environments); otherwise a pair is generated once and
 * persisted to the DB so subscriptions survive restarts and redeploys.
 */
function ensureVapid() {
  if (!vapidReady) {
    vapidReady = (async () => {
      let publicKey = process.env.VAPID_PUBLIC_KEY || '';
      let privateKey = process.env.VAPID_PRIVATE_KEY || '';
      if (!publicKey || !privateKey) {
        const keys = webpush.generateVAPIDKeys();
        // Atomic upsert so two racing instances can't persist different pairs —
        // the first write wins and the loser reads that pair back.
        const doc = await VapidConfig.findOneAndUpdate(
          {},
          { $setOnInsert: { publicKey: keys.publicKey, privateKey: keys.privateKey } },
          { new: true, upsert: true }
        );
        publicKey = doc.publicKey;
        privateKey = doc.privateKey;
      }
      webpush.setVapidDetails(`mailto:${PUSH_CONTACT}`, publicKey, privateKey);
      return { publicKey, privateKey };
    })().catch((err) => {
      vapidReady = null; // let the next call retry (e.g. transient DB error)
      throw err;
    });
  }
  return vapidReady;
}

async function getPublicKey() {
  const { publicKey } = await ensureVapid();
  return publicKey;
}

/** Register (or re-register) a device against a user, capped per user. */
async function saveSubscription(userId, subscription, userAgent) {
  await PushSubscription.findOneAndUpdate(
    { endpoint: subscription.endpoint },
    {
      userId,
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
      userAgent: String(userAgent || '').slice(0, 300),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const extras = await PushSubscription.find({ userId })
    .sort({ updatedAt: -1 })
    .skip(MAX_SUBSCRIPTIONS_PER_USER)
    .select('_id');
  if (extras.length) {
    await PushSubscription.deleteMany({ _id: { $in: extras.map((d) => d._id) } });
  }
}

async function removeSubscription(userId, endpoint) {
  await PushSubscription.deleteOne({ userId, endpoint });
}

/**
 * Push a notification to every device registered to a user. Dead subscriptions
 * (permission revoked, PWA uninstalled — the push service answers 404/410) are
 * pruned as they're discovered. Never throws: callers fire-and-forget so a push
 * hiccup can't fail the request that triggered it.
 */
async function notifyUser(userId, { title, body, url, tag }) {
  try {
    // Every notification also lands in the user's in-app inbox (the header
    // bell) — before the subscription check, so users who never enabled web
    // push on a device still see what's new.
    await Notification.create({
      userId,
      title,
      body: body || '',
      url: url || '/',
      tag: tag || '',
    }).catch((err) => console.error('[push] inbox save failed:', err.message));

    await ensureVapid();
    const subs = await PushSubscription.find({ userId });
    if (!subs.length) return;
    const payload = JSON.stringify({ title, body: body || '', url: url || '/', tag: tag || '' });
    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
            payload,
            { TTL: 24 * 60 * 60 }
          );
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            await PushSubscription.deleteOne({ _id: sub._id }).catch(() => {});
          } else {
            console.error(`[push] send failed: ${err.statusCode || ''} ${err.message}`);
          }
        }
      })
    );
  } catch (err) {
    console.error('[push] notifyUser failed:', err.message);
  }
}

module.exports = { getPublicKey, saveSubscription, removeSubscription, notifyUser };

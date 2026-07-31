import api from '@/lib/api';

/**
 * Web-push helpers. The same flow serves every platform: desktop browsers and
 * Android Chrome subscribe directly; iOS Safari only exposes the Push API once
 * the app is installed to the Home Screen (iOS 16.4+), which the UI detects
 * via iosNeedsInstall() and answers with install instructions.
 */

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function isIos() {
  // iPadOS masquerades as macOS; the touch check catches it.
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

/** True when this is iOS Safari and push needs an Add-to-Home-Screen first. */
export function iosNeedsInstall() {
  return isIos() && !isStandalone() && !pushSupported();
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  return navigator.serviceWorker.register('/sw.js').catch(() => null);
}

// PushManager.subscribe wants the VAPID key as a Uint8Array.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * 'unsupported' | 'blocked' | 'enabled' | 'disabled' for the current browser.
 */
export async function getPushStatus() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    return sub ? 'enabled' : 'disabled';
  } catch {
    return 'disabled';
  }
}

/** Ask permission, subscribe this browser and register it with the server. */
export async function enablePush() {
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted');

  const { data } = await api.get('/push/public-key');
  const applicationServerKey = urlBase64ToUint8Array(data.data.publicKey);

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
  }
  await api.post('/push/subscribe', { subscription: sub.toJSON() });
  return sub;
}

/** Unsubscribe this browser and drop its registration on the server. */
export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}

/**
 * Quietly re-register an existing subscription after login so the device
 * always notifies the account currently signed in on it.
 */
export async function syncPushSubscription() {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await api.post('/push/subscribe', { subscription: sub.toJSON() });
  } catch {
    /* best-effort only */
  }
}

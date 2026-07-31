/* Micky's CRM service worker — receives web-push events and deep-links
 * notification taps. No caching/offline logic: the app stays network-served. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Micky's CRM", {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      tag: data.tag || undefined,
      data: { url: data.url || '/' },
    })
  );
});

// Tap → open the lead (or list) the push points at, reusing an open tab when
// one exists.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of wins) {
        if ('focus' in client) {
          await client.focus();
          if (client.url !== url && 'navigate' in client) {
            try { await client.navigate(url); } catch { await self.clients.openWindow(url); }
          }
          return;
        }
      }
      await self.clients.openWindow(url);
    })()
  );
});

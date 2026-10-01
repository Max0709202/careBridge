/*
 * CareBridge driver web — the service worker, for background notifications only.
 * No caching, no offline: it exists to show a push and open the right screen.
 *
 * Pushes are content-free by policy (FOUNDATION §9): a title like "New
 * message" and a body that asks the person to open the app. The data carries
 * ids for routing and nothing else.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const data = payload.data || {};
  event.waitUntil(
    self.registration.showNotification(payload.title || 'CareBridge', {
      body: payload.body || 'Something changed. Open CareBridge to see it.',
      icon: '/icons/Icon-192.png',
      // One notification per thread or trip, replaced rather than stacked.
      tag: data.conversationId || data.rideId || data.kind || 'carebridge',
      renotify: true,
      data,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = urlFor(event.notification.data || {});
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ('focus' in client) {
          return client.navigate(url).then((c) => (c || client).focus());
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

function urlFor(data) {
  if (data.conversationId) return '/messages/' + encodeURIComponent(data.conversationId);
  if (data.rideId) return '/job/' + encodeURIComponent(data.rideId);
  return '/today';
}

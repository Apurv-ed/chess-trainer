// sw.js -- service worker for the daily 6pm reminder (Today tab).
// The page registers it when the user taps "Turn on 6pm reminder"; the GitHub
// Action scripts/send-reminder.js pushes a message only on days the set isn't done.
self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  event.waitUntil(self.registration.showNotification(data.title || 'Chess: your 10 puzzles', {
    body: data.body || "Do today's 10 puzzles or you'll lose your streak.",
    icon: 'img/pieces/wN.png',
    badge: 'img/pieces/wN.png',
    tag: 'daily-reminder',
    data: { url: self.registration.scope }
  }));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (wins) {
    for (var i = 0; i < wins.length; i++) if (wins[i].url.indexOf(url) === 0 && 'focus' in wins[i]) return wins[i].focus();
    return self.clients.openWindow(url);
  }));
});

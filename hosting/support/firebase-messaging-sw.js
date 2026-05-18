importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyC0AQ3rkH-fhxlThobjDDtrvxttAfFLXTE",
  authDomain: "bayango-315c6.firebaseapp.com",
  projectId: "bayango-315c6",
  storageBucket: "bayango-315c6.firebasestorage.app",
  messagingSenderId: "199013441811",
  appId: "1:199013441811:web:315a38f03ddc9b676e3ae6",
  measurementId: "G-1EEGFZWB7E",
  databaseURL: "https://bayango-315c6-default-rtdb.asia-southeast1.firebasedatabase.app",
});

const messaging = firebase.messaging();
const SUPPORT_APP_URL = '/index.html';

function resolveClickUrl(rawUrl) {
  try {
    if (rawUrl) return new URL(rawUrl, self.location.origin).toString();
  } catch (err) {
    console.warn('Invalid support notification click URL. Falling back.', err);
  }
  return `${SUPPORT_APP_URL}#tickets`;
}

messaging.onBackgroundMessage((payload) => {
  if (payload?.notification) return;

  const data = payload?.data || {};
  const title = data.title || 'BayanGo Support';
  const clickUrl = resolveClickUrl(data.link || data.click_action);

  self.registration.showNotification(title, {
    body: data.body || 'May bagong support update.',
    icon: 'https://i.imgur.com/wL8wcBB.jpeg',
    tag: data.type || 'support-update',
    renotify: true,
    data: {
      ...data,
      clickUrl,
    },
    vibrate: [200, 120, 200, 120, 280],
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = resolveClickUrl(event.notification?.data?.clickUrl);
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes('/index.html') && 'focus' in client) {
          if ('navigate' in client) {
            return client.navigate(target).then(() => client.focus());
          }
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});

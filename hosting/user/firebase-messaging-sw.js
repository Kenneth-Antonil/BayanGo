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
const USER_APP_URL = '/app.html';
const RIDER_APP_URL = '/app.html';
const ADMIN_APP_URL = '/app.html';

function resolveClickUrl(rawUrl, type) {
  try {
    if (rawUrl) return new URL(rawUrl, self.location.origin).toString();
  } catch (err) {
    console.warn('Invalid notification click URL. Falling back.', err);
  }

  if (type === 'order_status' || type === 'broadcast' || type === 'gcash_payment_reminder' || type === 'batch_reminder') {
    return `${USER_APP_URL}?section=notifications`;
  }

  return USER_APP_URL;
}

messaging.onBackgroundMessage((payload) => {
  const data = payload?.data || {};
  const title = data.title || 'BayanGo';
  const type = payload?.data?.type || '';

  const clickUrl = resolveClickUrl(payload?.data?.link || payload?.data?.click_action, type);

  const options = {
    body: data.body || 'May bagong update ka.',
    icon: 'https://i.imgur.com/wL8wcBB.jpeg',
    tag: 'bayango-update',
    renotify: true,
    data: {
      ...data,
      clickUrl,
    },
    vibrate: [200, 120, 200, 120, 280],
  };
  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = resolveClickUrl(
    event.notification?.data?.clickUrl,
    event.notification?.data?.type || ''
  );
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes('/app.html') && 'focus' in client) {
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

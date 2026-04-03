/* eslint-disable no-undef */
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyC0AQ3rkH-fhxlThobjDDtrvxttAfFLXTE',
  authDomain: 'bayango-315c6.firebaseapp.com',
  databaseURL: 'https://bayango-315c6-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'bayango-315c6',
  storageBucket: 'bayango-315c6.firebasestorage.app',
  messagingSenderId: '199013441811',
  appId: '1:199013441811:web:315a38f03ddc9b676e3ae6',
  measurementId: 'G-1EEGFZWB7E',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || 'BayanGo';
  const body = payload?.notification?.body || 'May bagong update ka.';

  const options = {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: {
      click_action: payload?.data?.link || payload?.fcmOptions?.link || '/',
      ...(payload?.data || {}),
    },
    vibrate: [200, 100, 200],
    requireInteraction: true,
  };

  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification?.data?.click_action || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }

      return undefined;
    })
  );
});

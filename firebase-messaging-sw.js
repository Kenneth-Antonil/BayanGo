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

messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || 'BayanGo';
  const clickUrl = payload?.data?.link || payload?.data?.click_action || 'https://bayango.ph/bayango-rider.html';
  const options = {
    body: payload?.notification?.body || 'May bagong update ka.',
    icon: 'https://i.imgur.com/wL8wcBB.jpeg',
    data: {
      ...(payload?.data || {}),
      clickUrl,
    },
    sound: 'https://audio.com/kenneth-antonil/audio/universfield-new-notification-022-370046',
    vibrate: [200, 120, 200, 120, 280],
  };
  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification?.data?.clickUrl || 'https://bayango.ph/bayango-rider.html';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
    for (const client of windowClients) {
      if (client.url.includes('bayango-rider') && 'focus' in client) return client.focus();
    }
    if (clients.openWindow) return clients.openWindow(target);
  }));
});

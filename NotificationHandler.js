import { useEffect } from 'react';
import { ref, set, serverTimestamp } from 'firebase/database';
import { getToken, onMessage } from 'firebase/messaging';
import { db, WEB_PUSH_VAPID_KEY, getMessagingIfSupported } from './firebase-config';

/**
 * React hook/component for FCM setup.
 * - Requests notification permission
 * - Registers firebase-messaging-sw.js for background notifications
 * - Saves token at users/{userId}/fcmToken in Realtime Database
 * - Listens to foreground notifications via onMessage
 */
export default function NotificationHandler({ userId, onForegroundMessage }) {
  useEffect(() => {
    let unsubscribeOnMessage;

    async function setupPush() {
      if (!userId) return;
      if (!('serviceWorker' in navigator) || !('Notification' in window)) return;

      const messaging = await getMessagingIfSupported();
      if (!messaging) return;

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;

      const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');

      const token = await getToken(messaging, {
        vapidKey: WEB_PUSH_VAPID_KEY,
        serviceWorkerRegistration: registration,
      });

      if (token) {
        await set(ref(db, `users/${userId}/fcmToken`), {
          token,
          updatedAt: serverTimestamp(),
          platform: 'web',
        });
      }

      unsubscribeOnMessage = onMessage(messaging, (payload) => {
        if (typeof onForegroundMessage === 'function') {
          onForegroundMessage(payload);
        } else if (Notification.permission === 'granted') {
          const { title = 'BayanGo', body = 'May bagong update ka.' } = payload.notification || {};
          new Notification(title, { body, icon: '/icons/icon-192.png' });
        }
      });
    }

    setupPush().catch((err) => {
      console.error('[FCM] setup failed:', err);
    });

    return () => {
      if (typeof unsubscribeOnMessage === 'function') unsubscribeOnMessage();
    };
  }, [userId, onForegroundMessage]);

  return null;
}

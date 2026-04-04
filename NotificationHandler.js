import { useEffect, useRef } from 'react';
import { ref, set, serverTimestamp } from 'firebase/database';
import { getToken, onMessage } from 'firebase/messaging';
import toast from 'react-hot-toast';
import { db, WEB_PUSH_VAPID_KEY, getMessagingIfSupported } from './firebase-config';

/**
 * React hook/component for FCM setup.
 * - Requests notification permission
 * - Registers firebase-messaging-sw.js for background notifications
 * - Saves token at users/{userId}/fcmToken in Realtime Database
 * - Listens to foreground notifications via onMessage
 */
export default function NotificationHandler({ userId, onForegroundMessage }) {
  const foregroundCallbackRef = useRef(onForegroundMessage);

  useEffect(() => {
    foregroundCallbackRef.current = onForegroundMessage;
  }, [onForegroundMessage]);

  useEffect(() => {
    let isDisposed = false;
    let unsubscribeOnMessage = () => {};

    const readDataPayload = (payload) => {
      const data = payload?.data || {};
      return {
        title: data.title || 'BayanGo',
        body: data.body || 'May bagong update ka.',
      };
    };

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

      const unsubscribe = onMessage(messaging, (payload) => {
        if (typeof foregroundCallbackRef.current === 'function') {
          foregroundCallbackRef.current(payload);
          return;
        }

        const { title, body } = readDataPayload(payload);
        toast(
          `${title}: ${body}`,
          {
            id: 'bayango-foreground-toast',
            icon: '🔔',
            duration: 5000,
          }
        );
      });

      if (isDisposed) {
        unsubscribe();
        return;
      }

      unsubscribeOnMessage = unsubscribe;
    }

    setupPush().catch((err) => {
      console.error('[FCM] setup failed:', err);
    });

    return () => {
      isDisposed = true;
      unsubscribeOnMessage();
    };
  }, [userId]);

  return null;
}

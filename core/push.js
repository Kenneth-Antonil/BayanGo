/**
 * BayanGo Core — Client-Side Push Notification Engine
 * Handles FCM token registration, permission requests, foreground notifications,
 * and token rotation for both user and rider apps.
 */
(function () {
  /**
   * Enable push notifications for the User app.
   * Registers service worker, gets FCM token, saves to RTDB, handles foreground messages.
   *
   * @param {Object} user - Firebase Auth user object
   * @param {Object} options
   * @param {Object} options.fbApp - Firebase app instance
   * @param {Object} options.fbDb - Firebase database instance
   * @param {Function} options.resolveVapidKey - Async function that returns the VAPID key
   * @param {boolean} [options.requestPermission=true]
   */
  async function enablePushForUser(user, { fbApp, fbDb, resolveVapidKey, requestPermission = true } = {}) {
    if (!user?.uid) return;
    if (!("serviceWorker" in navigator) || !("Notification" in window)) return;
    try {
      const supported = typeof firebase.messaging.isSupported === "function"
        ? await firebase.messaging.isSupported()
        : true;
      if (!supported) return;
    } catch (_) { return; }

    const sanitizeTokenKey = window.BayanGoCore.sanitizeTokenKey;

    try {
      let permission = Notification.permission;
      if (permission !== "granted" && requestPermission) {
        permission = await Notification.requestPermission();
      }
      if (permission !== "granted") return;

      const swReg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
      await navigator.serviceWorker.ready;
      const messaging = firebase.messaging(fbApp);
      const webPushVapidKey = resolveVapidKey ? await resolveVapidKey() : "";
      let token = null;
      const getTokenOptions = { serviceWorkerRegistration: swReg };
      if (webPushVapidKey) {
        getTokenOptions.vapidKey = webPushVapidKey;
      }
      try {
        token = await messaging.getToken(getTokenOptions);
      } catch (err) {
        const vapidErr = String(err?.code || "").includes("vapid") || String(err?.message || "").toLowerCase().includes("vapid");
        if (!vapidErr || !webPushVapidKey) throw err;
        console.warn("VAPID key rejected. Retrying getToken without explicit vapidKey.");
        token = await messaging.getToken({ serviceWorkerRegistration: swReg });
      }
      if (!token) return;

      const saveToken = async (t) => {
        const tokenKey = sanitizeTokenKey(t);
        await fbDb.ref(`push_tokens/${user.uid}/${tokenKey}`).set({
          token: t,
          uid: user.uid,
          userEmail: user.email || null,
          userName: user.displayName || null,
          role: "user",
          platform: navigator.userAgent || "web",
          updatedAt: Date.now(),
          enabled: true,
        });
      };
      const persistLatestToken = async (freshToken, { removeOld = true } = {}) => {
        if (!freshToken) return;
        if (removeOld && token && token !== freshToken) {
          const oldKey = sanitizeTokenKey(token);
          fbDb.ref(`push_tokens/${user.uid}/${oldKey}`).remove().catch(() => {});
        }
        token = freshToken;
        await saveToken(freshToken);
      };
      await persistLatestToken(token, { removeOld: false });

      if (typeof messaging.onTokenRefresh === "function") {
        messaging.onTokenRefresh(async () => {
          try {
            const freshToken = await messaging.getToken(getTokenOptions);
            if (freshToken && freshToken !== token) {
              console.log("FCM token rotated (onTokenRefresh), updating...");
              await persistLatestToken(freshToken);
            }
          } catch (err) {
            console.warn("Token refresh listener error:", err);
          }
        });
      }

      messaging.onMessage((payload) => {
        messaging.getToken(getTokenOptions).then((freshToken) => {
          if (freshToken && freshToken !== token) {
            console.log("FCM token rotated, updating...");
            persistLatestToken(freshToken).catch((err) => console.error("Token refresh save error:", err));
          }
        }).catch(() => {});

        const title = payload?.notification?.title || payload?.data?.title || "BayanGo";
        const body = payload?.notification?.body || payload?.data?.body || "May bagong update ka.";
        if (Notification.permission === "granted") {
          const targetLink = payload?.data?.link || payload?.data?.click_action || "";
          const n = new Notification(title, {
            body,
            icon: "https://i.imgur.com/wL8wcBB.jpeg",
            data: payload?.data || {},
          });
          n.onclick = () => {
            window.focus();
            n.close();
            if (targetLink) {
              window.location.href = targetLink;
            } else {
              window.location.search = "?section=orders";
            }
          };
        }
      });
    } catch (err) {
      console.error("Push notification setup error:", err);
      if (String(err?.code || "").includes("vapid") || String(err?.message || "").toLowerCase().includes("vapid")) {
        console.error("Missing/invalid Web Push VAPID key. Set window.BAYANGO_WEB_PUSH_VAPID_KEY before loading the app.");
      }
    }
  }

  /**
   * Enable push notifications for the Rider app.
   * Similar to enablePushForUser but saves tokens with role: "rider".
   *
   * @param {Object} user - Firebase Auth user object
   * @param {Object} options
   * @param {Object} options.fbApp - Firebase app instance
   * @param {Object} options.fbDb - Firebase database instance
   * @param {string} options.vapidKey - Web Push VAPID key
   * @param {Function} [options.onForegroundNotify] - Callback for foreground notifications
   */
  async function enablePushForRider(user, { fbApp, fbDb, vapidKey, onForegroundNotify } = {}) {
    if (!user?.uid) return;
    if (!("serviceWorker" in navigator) || !("Notification" in window)) return;
    try {
      const supported = typeof firebase.messaging.isSupported === "function"
        ? await firebase.messaging.isSupported()
        : true;
      if (!supported) return;
    } catch (_) { return; }

    const sanitizeTokenKey = window.BayanGoCore.sanitizeTokenKey;

    try {
      let permission = Notification.permission;
      if (permission !== "granted") {
        permission = await Notification.requestPermission();
      }
      if (permission !== "granted") return;

      const swReg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
      await navigator.serviceWorker.ready;
      const messaging = firebase.messaging(fbApp);
      let token = null;
      const getTokenOptions = { serviceWorkerRegistration: swReg };
      if (vapidKey) {
        getTokenOptions.vapidKey = vapidKey;
      }
      try {
        token = await messaging.getToken(getTokenOptions);
      } catch (err) {
        const vapidErr = String(err?.code || "").includes("vapid") || String(err?.message || "").toLowerCase().includes("vapid");
        if (!vapidErr || !vapidKey) throw err;
        console.warn("VAPID key rejected. Retrying getToken without explicit vapidKey.");
        token = await messaging.getToken({ serviceWorkerRegistration: swReg });
      }
      if (!token) return;

      const saveToken = async (t) => {
        const tokenKey = sanitizeTokenKey(t);
        await fbDb.ref(`push_tokens/${user.uid}/${tokenKey}`).set({
          token: t,
          uid: user.uid,
          riderEmail: user.email || null,
          riderName: user.displayName || null,
          role: "rider",
          platform: navigator.userAgent || "web",
          updatedAt: Date.now(),
          enabled: true,
        });
      };
      const persistLatestToken = async (freshToken, { removeOld = true } = {}) => {
        if (!freshToken) return;
        if (removeOld && token && token !== freshToken) {
          const oldKey = sanitizeTokenKey(token);
          fbDb.ref(`push_tokens/${user.uid}/${oldKey}`).remove().catch(() => {});
        }
        token = freshToken;
        await saveToken(freshToken);
      };
      await persistLatestToken(token, { removeOld: false });

      if (typeof messaging.onTokenRefresh === "function") {
        messaging.onTokenRefresh(async () => {
          try {
            const freshToken = await messaging.getToken(getTokenOptions);
            if (freshToken && freshToken !== token) {
              await persistLatestToken(freshToken);
            }
          } catch (err) {
            console.warn("Token refresh listener error:", err);
          }
        });
      }

      messaging.onMessage((payload) => {
        messaging.getToken(getTokenOptions).then((freshToken) => {
          if (freshToken && freshToken !== token) {
            persistLatestToken(freshToken).catch(() => {});
          }
        }).catch(() => {});

        if (onForegroundNotify) onForegroundNotify(payload);

        const title = payload?.notification?.title || payload?.data?.title || "BayanGo Rider";
        const body = payload?.notification?.body || payload?.data?.body || "";
        if (Notification.permission === "granted") {
          new Notification(title, {
            body,
            icon: "https://i.imgur.com/wL8wcBB.jpeg",
            data: payload?.data || {},
          });
        }
      });
    } catch (err) {
      console.error("Rider push notification setup error:", err);
    }
  }

  window.BayanGoCore = window.BayanGoCore || {};
  Object.assign(window.BayanGoCore, {
    enablePushForUser,
    enablePushForRider,
  });
})();

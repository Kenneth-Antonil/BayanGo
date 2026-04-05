/**
 * BayanGo Backend Core — Push Notification Engine
 *
 * The core FCM notification system. Handles:
 * - Token management (fetching customer, rider, admin tokens)
 * - Batch multicast sending with 500-token chunking
 * - Automatic cleanup of expired/invalid tokens
 * - Fallback to user_notifications in RTDB
 *
 * This is the ENGINE — do not modify unless changing notification behavior.
 */

const { getDatabase } = require("firebase-admin/database");
const { getMessaging } = require("firebase-admin/messaging");
const { USER_APP_URL } = require("./constants");

/**
 * Fetch all FCM tokens for customers (non-riders, non-admins).
 */
async function getAllCustomerTokens() {
  const db = getDatabase();
  const [tokensSnap, adminsSnap] = await Promise.all([
    db.ref("push_tokens").get(),
    db.ref("admins").get(),
  ]);
  if (!tokensSnap.exists()) return [];

  const adminUidSet = new Set();
  if (adminsSnap.exists()) {
    adminsSnap.forEach((adminSnap) => {
      if (adminSnap.val() === true) adminUidSet.add(adminSnap.key);
    });
  }

  const tokens = [];
  tokensSnap.forEach((userSnap) => {
    if (adminUidSet.has(userSnap.key)) return;
    userSnap.forEach((tokenSnap) => {
      const data = tokenSnap.val();
      if (
        data?.token &&
        data?.enabled !== false &&
        data?.role !== "rider"
      ) {
        tokens.push({ uid: userSnap.key, tokenKey: tokenSnap.key, token: data.token });
      }
    });
  });

  const seen = new Set();
  return tokens.filter((t) => {
    if (seen.has(t.token)) return false;
    seen.add(t.token);
    return true;
  });
}

/**
 * Fetch FCM tokens for a specific user.
 */
async function getUserTokens(uid, { excludeRole } = {}) {
  if (!uid) return [];
  const db = getDatabase();
  const snap = await db.ref(`push_tokens/${uid}`).get();
  if (!snap.exists()) return [];
  const entries = [];
  snap.forEach((t) => {
    const d = t.val();
    if (d?.token && d?.enabled !== false) {
      if (excludeRole && d?.role === excludeRole) return;
      entries.push({ uid, tokenKey: t.key, token: d.token });
    }
  });
  return entries;
}

/**
 * Fetch all FCM tokens for riders.
 */
async function getAllRiderTokens() {
  const db = getDatabase();
  const snap = await db.ref("push_tokens").get();
  if (!snap.exists()) return [];
  const entries = [];
  snap.forEach((userSnap) => {
    userSnap.forEach((tokenSnap) => {
      const data = tokenSnap.val();
      if (data?.token && data?.enabled !== false && data?.role === "rider") {
        entries.push({ uid: userSnap.key, tokenKey: tokenSnap.key, token: data.token });
      }
    });
  });
  const seen = new Set();
  return entries.filter((t) => {
    if (seen.has(t.token)) return false;
    seen.add(t.token);
    return true;
  });
}

/**
 * Fetch all FCM tokens for admins (based on admins/$uid === true).
 */
async function getAllAdminTokens() {
  const db = getDatabase();
  const [adminsSnap, tokensSnap] = await Promise.all([
    db.ref("admins").get(),
    db.ref("push_tokens").get(),
  ]);

  if (!adminsSnap.exists() || !tokensSnap.exists()) return [];

  const adminUidSet = new Set();
  adminsSnap.forEach((adminSnap) => {
    if (adminSnap.val() === true) adminUidSet.add(adminSnap.key);
  });
  if (!adminUidSet.size) return [];

  const entries = [];
  tokensSnap.forEach((userSnap) => {
    if (!adminUidSet.has(userSnap.key)) return;
    userSnap.forEach((tokenSnap) => {
      const data = tokenSnap.val();
      if (data?.token && data?.enabled !== false && data?.role !== "rider") {
        entries.push({ uid: userSnap.key, tokenKey: tokenSnap.key, token: data.token });
      }
    });
  });

  const seen = new Set();
  return entries.filter((t) => {
    if (seen.has(t.token)) return false;
    seen.add(t.token);
    return true;
  });
}

/**
 * Send multicast FCM notification to multiple tokens.
 * Automatically removes invalid/expired tokens from the database.
 * Also writes fallback entries to user_notifications/ in RTDB.
 */
async function sendBatchNotification(tokenEntries, { title, body, type, link }) {
  const db = getDatabase();
  const uniqueUids = [...new Set(tokenEntries.map((entry) => entry.uid).filter(Boolean))];
  if (uniqueUids.length) {
    const now = Date.now();
    try {
      await Promise.all(
        uniqueUids.map((uid) =>
          db.ref(`user_notifications/${uid}`).push({
            title: title || "BayanGo",
            body: body || "",
            type: type || "batch_reminder",
            link: link || USER_APP_URL,
            createdAt: now,
          })
        )
      );
    } catch (err) {
      console.error("Error writing to user_notifications:", err);
    }
  }

  if (!tokenEntries.length) {
    console.log("Walang tokens. Skipping send.");
    return { sent: 0, failed: 0 };
  }

  const messaging = getMessaging();
  let totalSent = 0;
  let totalFailed = 0;

  const resolvedLink = link || USER_APP_URL;

  // FCM multicast limit: 500 tokens per call
  const CHUNK_SIZE = 500;
  for (let i = 0; i < tokenEntries.length; i += CHUNK_SIZE) {
    const chunk = tokenEntries.slice(i, i + CHUNK_SIZE);
    const tokens = chunk.map((t) => t.token);

    try {
      const response = await messaging.sendEachForMulticast({
        tokens,
        notification: {
          title: title || "BayanGo",
          body: body || "",
        },
        android: {
          priority: "high",
          ttl: 60 * 60 * 1000,
          notification: {
            channelId: "default",
            sound: "default",
            priority: "max",
            visibility: "public",
          },
        },
        apns: {
          headers: {
            "apns-priority": "10",
            "apns-push-type": "alert",
          },
          payload: {
            aps: {
              sound: "default",
              badge: 1,
              "content-available": 1,
            },
          },
        },
        webpush: {
          headers: {
            Urgency: "high",
            TTL: "3600",
          },
          notification: {
            icon: "https://i.imgur.com/wL8wcBB.jpeg",
            tag: type || "bayango-update",
            renotify: true,
          },
          fcm_options: {
            link: resolvedLink,
          },
        },
        data: {
          title: title || "BayanGo",
          body: body || "",
          type: type || "batch_reminder",
          link: resolvedLink,
          timestamp: String(Date.now()),
        },
      });

      totalSent += response.successCount;
      totalFailed += response.failureCount;

      // Remove expired/invalid tokens from database
      const deletePromises = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errCode = resp.error?.code;
          if (
            errCode === "messaging/invalid-registration-token" ||
            errCode === "messaging/registration-token-not-registered" ||
            errCode === "messaging/mismatched-sender-id"
          ) {
            const { uid, tokenKey } = chunk[idx];
            if (uid && tokenKey) {
              deletePromises.push(
                db.ref(`push_tokens/${uid}/${tokenKey}`).remove()
              );
            }
          }
        }
      });

      if (deletePromises.length) {
        await Promise.all(deletePromises);
        console.log(`Natanggal ang ${deletePromises.length} expired token(s).`);
      }
    } catch (err) {
      console.error(`Error sa chunk ${i}-${i + CHUNK_SIZE}:`, err);
      totalFailed += chunk.length;
    }
  }

  return { sent: totalSent, failed: totalFailed };
}

module.exports = {
  getAllCustomerTokens,
  getUserTokens,
  getAllRiderTokens,
  getAllAdminTokens,
  sendBatchNotification,
};

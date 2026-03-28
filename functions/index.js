const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onValueCreated } = require("firebase-functions/v2/database");
const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();

const APP_ICON = "https://i.imgur.com/wL8wcBB.jpeg";
const USER_APP_URL = "https://bayango.ph/bayango-user.html";

/**
 * Kuha lahat ng FCM tokens ng mga customer (hindi riders).
 * Nag-filter ng tokens na may enabled !== false at walang role na "rider".
 */
async function getAllCustomerTokens() {
  const db = getDatabase();
  const snap = await db.ref("push_tokens").get();
  if (!snap.exists()) return [];

  const tokens = [];
  snap.forEach((userSnap) => {
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

  // Deduplicate by token value
  const seen = new Set();
  return tokens.filter((t) => {
    if (seen.has(t.token)) return false;
    seen.add(t.token);
    return true;
  });
}

/**
 * Magpadala ng multicast FCM notification sa maraming tokens.
 * Awtomatikong nagtatanggal ng mga invalid/expired tokens sa database.
 */
async function sendBatchNotification(tokenEntries, { title, body, type }) {
  if (!tokenEntries.length) {
    console.log("Walang tokens. Skipping send.");
    return { sent: 0, failed: 0 };
  }

  const messaging = getMessaging();
  const db = getDatabase();
  let totalSent = 0;
  let totalFailed = 0;

  // FCM multicast limit: 500 tokens per call
  const CHUNK_SIZE = 500;
  for (let i = 0; i < tokenEntries.length; i += CHUNK_SIZE) {
    const chunk = tokenEntries.slice(i, i + CHUNK_SIZE);
    const tokens = chunk.map((t) => t.token);

    try {
      const response = await messaging.sendEachForMulticast({
        tokens,
        notification: { title, body },
        webpush: {
          notification: {
            title,
            body,
            icon: APP_ICON,
            badge: APP_ICON,
            requireInteraction: false,
            vibrate: [200, 100, 200],
          },
          fcm_options: {
            link: USER_APP_URL,
          },
        },
        data: {
          type: type || "batch_reminder",
          link: USER_APP_URL,
          timestamp: String(Date.now()),
        },
      });

      totalSent += response.successCount;
      totalFailed += response.failureCount;

      // Tanggalin ang mga expired/invalid tokens sa database
      const deletePromises = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errCode = resp.error?.code;
          if (
            errCode === "messaging/invalid-registration-token" ||
            errCode === "messaging/registration-token-not-registered"
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

// ─────────────────────────────────────────────────────────────────────────────
// RTDB-TRIGGERED: notification_queue
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Kapag may bagong entry sa notification_queue, ipadala ang FCM sa tamang user
 * at tanggalin ang queue entry pagkatapos.
 */
exports.processNotificationQueue = onValueCreated(
  { ref: "notification_queue/{pushId}", region: "us-central1" },
  async (event) => {
    const data = event.data.val();
    if (!data) return;

    const { uid, title, body, link } = data;
    const pushId = event.params.pushId;
    const db = getDatabase();

    if (!uid || !title || !body) {
      console.warn(`[notif_queue/${pushId}] Missing required fields. Skipping.`);
      await db.ref(`notification_queue/${pushId}`).remove();
      return;
    }

    // Fetch push tokens for this specific user
    const tokenSnap = await db.ref(`push_tokens/${uid}`).get();
    const tokenEntries = [];
    if (tokenSnap.exists()) {
      tokenSnap.forEach((t) => {
        const d = t.val();
        if (d?.token && d?.enabled !== false) {
          tokenEntries.push({ uid, tokenKey: t.key, token: d.token });
        }
      });
    }

    if (tokenEntries.length === 0) {
      console.log(`[notif_queue/${pushId}] No tokens for uid=${uid}. Skipping.`);
    } else {
      const result = await sendBatchNotification(tokenEntries, {
        title,
        body,
        type: "gcash_payment_reminder",
      });
      console.log(`[notif_queue/${pushId}] uid=${uid} Sent:${result.sent} Failed:${result.failed}`);
    }

    // Clean up queue entry
    await db.ref(`notification_queue/${pushId}`).remove();
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULED NOTIFICATIONS (Philippines Time / Asia/Manila)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 8:00 AM — Bukas na ang AM Batch, mag-order na para sa tanghalian.
 * Cut-off: 10:00 AM | Delivery: 11:00 AM
 */
exports.notifyAmBatchOpen = onSchedule(
  { schedule: "0 8 * * *", timeZone: "Asia/Manila" },
  async () => {
    const tokens = await getAllCustomerTokens();
    const result = await sendBatchNotification(tokens, {
      title: "BayanGo — Pabili para sa Tanghalian!",
      body: "Mag-order na ngayon. Cut-off sa 10:00 AM, delivery sa 11:00 AM.",
      type: "batch_reminder_am_open",
    });
    console.log(`[AM Batch Open 8AM] Sent: ${result.sent}, Failed: ${result.failed}`);
  }
);

/**
 * 9:00 AM — 1 oras na lang bago mag-cut-off ng AM Batch.
 * Cut-off: 10:00 AM | Delivery: 11:00 AM
 */
exports.notifyAmBatchWarning = onSchedule(
  { schedule: "0 9 * * *", timeZone: "Asia/Manila" },
  async () => {
    const tokens = await getAllCustomerTokens();
    const result = await sendBatchNotification(tokens, {
      title: "1 Oras Na Lang! — AM Batch",
      body: "Mag-order na agad! Cut-off sa 10:00 AM, delivery sa 11:00 AM ngayon.",
      type: "batch_reminder_am_warning",
    });
    console.log(`[AM Batch 1hr Warning 9AM] Sent: ${result.sent}, Failed: ${result.failed}`);
  }
);

/**
 * 12:00 PM — Bukas na ang PM Batch, puwede nang mag-order para sa hapon.
 * Cut-off: 3:00 PM | Delivery: 4:00 PM
 */
exports.notifyPmBatchOpen = onSchedule(
  { schedule: "0 12 * * *", timeZone: "Asia/Manila" },
  async () => {
    const tokens = await getAllCustomerTokens();
    const result = await sendBatchNotification(tokens, {
      title: "BayanGo — Pabili para sa Hapon!",
      body: "Mag-order na ngayon. Cut-off sa 3:00 PM, delivery sa 4:00 PM.",
      type: "batch_reminder_pm_open",
    });
    console.log(`[PM Batch Open 12PM] Sent: ${result.sent}, Failed: ${result.failed}`);
  }
);

/**
 * 2:00 PM — 1 oras na lang bago mag-cut-off ng PM Batch.
 * Cut-off: 3:00 PM | Delivery: 4:00 PM
 */
exports.notifyPmBatchWarning = onSchedule(
  { schedule: "0 14 * * *", timeZone: "Asia/Manila" },
  async () => {
    const tokens = await getAllCustomerTokens();
    const result = await sendBatchNotification(tokens, {
      title: "1 Oras Na Lang! — PM Batch",
      body: "Mag-order na agad! Cut-off sa 3:00 PM, delivery sa 4:00 PM ngayon.",
      type: "batch_reminder_pm_warning",
    });
    console.log(`[PM Batch 1hr Warning 2PM] Sent: ${result.sent}, Failed: ${result.failed}`);
  }
);

/**
 * 8:00 PM — Pre-order na para bukas.
 * Delivery: 11:00 AM bukas (AM Batch)
 */
exports.notifyPreorder = onSchedule(
  { schedule: "0 20 * * *", timeZone: "Asia/Manila" },
  async () => {
    const tokens = await getAllCustomerTokens();
    const result = await sendBatchNotification(tokens, {
      title: "BayanGo — Pre-order para Bukas!",
      body: "Mag-order na ngayon para ma-deliver bukas ng 11:00 AM. Huwag makalimot!",
      type: "batch_reminder_preorder",
    });
    console.log(`[Pre-order Reminder 8PM] Sent: ${result.sent}, Failed: ${result.failed}`);
  }
);

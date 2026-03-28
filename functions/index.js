const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onValueCreated } = require("firebase-functions/v2/database");
const { onRequest } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { getMessaging } = require("firebase-admin/messaging");
const crypto = require("crypto");

initializeApp();

const APP_ICON = "https://i.imgur.com/wL8wcBB.jpeg";
const USER_APP_URL = "https://bayango.ph/bayango-user.html";
const PAYMONGO_WEBHOOK_SECRET = process.env.PAYMONGO_WEBHOOK_SECRET || "";

function asBuffer(rawBody, fallback) {
  if (Buffer.isBuffer(rawBody)) return rawBody;
  if (typeof rawBody === "string") return Buffer.from(rawBody, "utf8");
  if (rawBody && typeof rawBody === "object") return Buffer.from(JSON.stringify(rawBody), "utf8");
  if (typeof fallback === "string") return Buffer.from(fallback, "utf8");
  return Buffer.from("", "utf8");
}

/**
 * PayMongo signature can include different key names depending on version.
 * We support common timestamp fields (t, ts, timestamp) and signature fields (v1, sig, signature).
 */
function parsePaymongoSignature(signatureHeader = "") {
  const entries = signatureHeader
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  let timestamp = "";
  const signatures = [];

  for (const item of entries) {
    const [rawKey, ...rest] = item.split("=");
    const key = (rawKey || "").trim().toLowerCase();
    const value = rest.join("=").trim();
    if (!value) continue;

    if (["t", "ts", "timestamp"].includes(key)) {
      timestamp = value;
    }
    if (["v1", "sig", "signature"].includes(key)) {
      signatures.push(value);
    }
  }

  return { timestamp, signatures };
}

function verifyPaymongoSignature({ rawBody, signatureHeader, secret }) {
  if (!secret) return { valid: false, reason: "missing_secret" };
  if (!signatureHeader) return { valid: false, reason: "missing_signature_header" };

  const { timestamp, signatures } = parsePaymongoSignature(signatureHeader);
  if (!timestamp || signatures.length === 0) {
    return { valid: false, reason: "invalid_signature_format" };
  }

  const payload = `${timestamp}.${asBuffer(rawBody).toString("utf8")}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");

  const valid = signatures.some((sig) => {
    try {
      return crypto.timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"));
    } catch (err) {
      return false;
    }
  });

  return { valid, reason: valid ? null : "signature_mismatch" };
}

function extractOrderId(eventData = {}) {
  const attrs = eventData?.attributes || {};
  const metadata = attrs?.metadata || {};
  const source = attrs?.source || {};
  const pi = attrs?.payment_intent || {};
  const billing = attrs?.billing || {};

  return (
    metadata.orderId ||
    metadata.order_id ||
    metadata.orderRef ||
    metadata.reference ||
    attrs.orderId ||
    attrs.order_id ||
    attrs.reference_number ||
    source.reference_number ||
    pi.id ||
    billing.name ||
    null
  );
}

function derivePaymentState(eventType = "", attrs = {}) {
  const status = String(attrs?.status || "").toLowerCase();
  if (eventType.includes("paid") || eventType.includes("succeeded") || status === "paid") return "paid";
  if (eventType.includes("failed") || status === "failed") return "failed";
  if (eventType.includes("cancel") || status === "cancelled") return "cancelled";
  return "pending";
}

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
async function sendBatchNotification(tokenEntries, { title, body, type, link }) {
  if (!tokenEntries.length) {
    console.log("Walang tokens. Skipping send.");
    return { sent: 0, failed: 0 };
  }

  const messaging = getMessaging();
  const db = getDatabase();
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
            link: resolvedLink,
          },
        },
        data: {
          type: type || "batch_reminder",
          link: resolvedLink,
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
        link,
      });
      console.log(`[notif_queue/${pushId}] uid=${uid} Sent:${result.sent} Failed:${result.failed}`);
    }

    // Clean up queue entry
    await db.ref(`notification_queue/${pushId}`).remove();
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// HTTPS: PAYMONGO WEBHOOK (PAYMENT EVENTS)
// ─────────────────────────────────────────────────────────────────────────────
exports.paymongoWebhook = onRequest(
  { region: "us-central1", cors: true },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Method Not Allowed" });
      return;
    }

    const signatureHeader = req.get("paymongo-signature") || "";
    const signatureCheck = verifyPaymongoSignature({
      rawBody: req.rawBody,
      signatureHeader,
      secret: PAYMONGO_WEBHOOK_SECRET,
    });

    if (!signatureCheck.valid) {
      console.warn("PayMongo signature verification failed:", signatureCheck.reason);
      res.status(401).json({ ok: false, error: "Unauthorized webhook signature" });
      return;
    }

    const payload = req.body || {};
    const eventData = payload?.data || {};
    const eventType = String(eventData?.attributes?.type || payload?.type || "unknown");
    const attrs = eventData?.attributes?.data?.attributes || eventData?.attributes || {};
    const resourceData = eventData?.attributes?.data || {};
    const paymentState = derivePaymentState(eventType, attrs);
    const orderId = extractOrderId(resourceData?.attributes ? resourceData : eventData);

    const db = getDatabase();
    const logRef = db.ref("payment_webhooks").push();
    await logRef.set({
      provider: "paymongo",
      eventType,
      paymentState,
      orderId: orderId || null,
      resourceId: resourceData?.id || eventData?.id || null,
      receivedAt: Date.now(),
      payload,
    });

    if (!orderId) {
      console.log("PayMongo webhook received without orderId metadata.");
      res.status(200).json({ ok: true, logged: true, orderUpdated: false });
      return;
    }

    const orderRef = db.ref(`orders/${orderId}`);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists()) {
      console.log(`PayMongo webhook order not found: ${orderId}`);
      res.status(200).json({ ok: true, logged: true, orderUpdated: false, reason: "order_not_found" });
      return;
    }

    const order = orderSnap.val() || {};
    const updates = {
      paymentProvider: "paymongo",
      paymentStatus: paymentState,
      paymentUpdatedAt: Date.now(),
      paymongoEventType: eventType,
      paymongoResourceId: resourceData?.id || eventData?.id || null,
    };

    if (paymentState === "paid") {
      updates.gcashPaymentConfirmed = true;
      updates.paidAt = Date.now();
    }

    await orderRef.update(updates);

    if (order?.uid) {
      let title = "Payment Update";
      let body = "Na-receive namin ang payment update mo.";

      if (paymentState === "paid") {
        title = "✅ Bayad Confirmed";
        body = `Order #${String(orderId).slice(-6)} paid na. Ihahanda na namin ito ngayon!`;
      } else if (paymentState === "failed") {
        title = "⚠️ Payment Failed";
        body = `Order #${String(orderId).slice(-6)} payment failed. Subukan ulit ang payment method.`;
      }

      await db.ref("notification_queue").push({
        uid: order.uid,
        title,
        body,
        link: `${USER_APP_URL}#orders`,
        createdAt: Date.now(),
      });
    }

    res.status(200).json({ ok: true, logged: true, orderUpdated: true, orderId, paymentState });
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

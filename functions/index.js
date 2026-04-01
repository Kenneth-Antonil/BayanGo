const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onValueCreated, onValueUpdated } = require("firebase-functions/v2/database");
const { onRequest } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getDatabase } = require("firebase-admin/database");
const { getMessaging } = require("firebase-admin/messaging");
const { getStorage } = require("firebase-admin/storage");
const crypto = require("crypto");

initializeApp();

const APP_ICON = "https://i.imgur.com/wL8wcBB.jpeg";
const USER_APP_URL = "https://bayango.store/bayango-user.html";
const RIDER_APP_URL = "https://bayango.store/bayango-rider.html";
const ADMIN_APP_URL = "https://bayango.store/bayango-admin.html";

const ORDER_STATUS_LABELS = {
  pending:   "Nai-receive na ang order",
  buying:    "Now buying from the market",
  otw:       "On the way to you",
  in_boat:   "Nasa bangka na",
  delivered: "Delivered!",
  cancelled: "Na-cancel ang order",
};
const PAYMONGO_WEBHOOK_SECRET = process.env.PAYMONGO_WEBHOOK_SECRET || "";
const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY || "";
const ADMIN_ALLOWED_ORIGINS = [
  "https://bayango.store",
  "https://www.bayango.store",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
];

function normalizeOrigin(origin = "") {
  return String(origin || "").trim().toLowerCase().replace(/\/+$/, "");
}

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

function setCors(res, origin = "") {
  const normalizedOrigin = normalizeOrigin(origin);
  const allowedOriginSet = new Set(ADMIN_ALLOWED_ORIGINS.map(normalizeOrigin));
  const allowedOrigin = allowedOriginSet.has(normalizedOrigin) ? normalizedOrigin : ADMIN_ALLOWED_ORIGINS[0];
  res.set("Access-Control-Allow-Origin", allowedOrigin);
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
}

function toPublicDownloadUrl(bucketName, objectPath, token) {
  const encodedPath = encodeURIComponent(objectPath);
  const encodedToken = encodeURIComponent(token);
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${encodedToken}`;
}

async function verifyAdminRequest(req) {
  const authHeader = req.get("authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
  const idToken = authHeader.slice(7).trim();
  if (!idToken) return null;

  const decoded = await getAuth().verifyIdToken(idToken);
  if (!decoded?.uid) return null;

  // Match admin authorization with RTDB security rules:
  // admins/$uid === true
  const adminSnap = await getDatabase().ref(`admins/${decoded.uid}`).get();
  if (adminSnap.val() !== true) return null;

  return decoded;
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
 * Kuha ang FCM tokens ng isang specific na user.
 */
async function getUserTokens(uid) {
  if (!uid) return [];
  const db = getDatabase();
  const snap = await db.ref(`push_tokens/${uid}`).get();
  if (!snap.exists()) return [];
  const entries = [];
  snap.forEach((t) => {
    const d = t.val();
    if (d?.token && d?.enabled !== false) {
      entries.push({ uid, tokenKey: t.key, token: d.token });
    }
  });
  return entries;
}

/**
 * Kuha lahat ng FCM tokens ng mga rider.
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
 * Kuha lahat ng FCM tokens ng mga admin batay sa:
 *   1) `admins/$uid === true`, at
 *   2) token entry na may `role === "admin"`.
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
      if (data?.token && data?.enabled !== false && data?.role === "admin") {
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
  { ref: "notification_queue/{pushId}", region: "asia-southeast1" },
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
      let body = "We received your payment update.";

      if (paymentState === "paid") {
        title = "✅ Payment Confirmed";
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
// HTTPS: CREATE PAYMONGO QRPH CHECKOUT SESSION
// ─────────────────────────────────────────────────────────────────────────────
exports.createPaymongoQrphCheckout = onRequest(
  { region: "us-central1", cors: true },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Method Not Allowed" });
      return;
    }

    if (!PAYMONGO_SECRET_KEY) {
      res.status(500).json({ ok: false, error: "Missing PAYMONGO_SECRET_KEY" });
      return;
    }

    const orderId = String(req.body?.orderId || "").trim();
    if (!orderId) {
      res.status(400).json({ ok: false, error: "orderId is required" });
      return;
    }

    const db = getDatabase();
    const orderRef = db.ref(`orders/${orderId}`);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists()) {
      res.status(404).json({ ok: false, error: "order_not_found" });
      return;
    }

    const order = orderSnap.val() || {};
    const totalPhp = Number(order.total || 0);
    if (!Number.isFinite(totalPhp) || totalPhp <= 0) {
      res.status(400).json({ ok: false, error: "invalid_order_total" });
      return;
    }

    const amount = Math.round(totalPhp * 100);
    const auth = Buffer.from(`${PAYMONGO_SECRET_KEY}:`).toString("base64");
    const successUrl = `${USER_APP_URL}#orders`;
    const failUrl = `${USER_APP_URL}#orders`;

    const payload = {
      data: {
        attributes: {
          line_items: [
            {
              currency: "PHP",
              amount,
              name: `BayanGo Order ${orderId.slice(-6)}`,
              quantity: 1,
            },
          ],
          payment_method_types: ["qrph"],
          metadata: {
            orderId,
          },
          send_email_receipt: false,
          show_description: true,
          show_line_items: true,
          description: `QR PH payment for order ${orderId}`,
          success_url: successUrl,
          cancel_url: failUrl,
        },
      },
    };

    const response = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(payload),
    });

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("PayMongo checkout session error", response.status, json);
      res.status(502).json({ ok: false, error: "paymongo_api_error", details: json });
      return;
    }

    const checkoutId = json?.data?.id || null;
    const checkoutUrl = json?.data?.attributes?.checkout_url || null;

    await orderRef.update({
      paymentProvider: "paymongo",
      paymentStatus: "pending",
      paymentUpdatedAt: Date.now(),
      paymongoCheckoutId: checkoutId,
      paymongoCheckoutUrl: checkoutUrl,
    });

    res.status(200).json({
      ok: true,
      orderId,
      checkoutId,
      checkoutUrl,
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// HTTPS: ADMIN BROADCAST TO ALL CUSTOMER TOKENS
// ─────────────────────────────────────────────────────────────────────────────
exports.sendBroadcastNotification = onRequest(
  { region: "us-central1" },
  async (req, res) => {
    setCors(res, req.get("origin") || "");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Method Not Allowed" });
      return;
    }

    let caller;
    try {
      caller = await verifyAdminRequest(req);
    } catch (err) {
      console.warn("Broadcast auth verification failed:", err?.message || err);
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    if (!caller) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const title = String(req.body?.title || "").trim();
    const body = String(req.body?.body || "").trim();
    if (!title || !body) {
      res.status(400).json({ ok: false, error: "title and body are required" });
      return;
    }

    const tokens = await getAllCustomerTokens();
    const result = await sendBatchNotification(tokens, {
      title,
      body,
      type: "broadcast",
      link: USER_APP_URL,
    });

    res.status(200).json({
      ok: true,
      sent: result.sent,
      failed: result.failed,
      targetCount: tokens.length,
      requestedBy: caller.email || caller.uid,
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// HTTPS: ADMIN UPLOAD GCASH QR (SERVER-SIDE STORAGE WRITE; AVOIDS BROWSER CORS)
// ─────────────────────────────────────────────────────────────────────────────
exports.uploadGcashQrImage = onRequest(
  { region: "us-central1", memory: "256MiB" },
  async (req, res) => {
    setCors(res, req.get("origin") || "");
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Method Not Allowed" });
      return;
    }

    let caller;
    try {
      caller = await verifyAdminRequest(req);
    } catch (err) {
      console.warn("QR upload auth verification failed:", err?.message || err);
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    if (!caller) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const dataUrl = String(req.body?.dataUrl || "");
    const originalName = String(req.body?.fileName || "qr_upload.jpg").replace(/[^\w.\-]/g, "_");
    const contentType = String(req.body?.contentType || "").trim();
    if (!dataUrl.startsWith("data:image/")) {
      res.status(400).json({ ok: false, error: "invalid_image_payload" });
      return;
    }

    const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) {
      res.status(400).json({ ok: false, error: "invalid_data_url_format" });
      return;
    }

    const detectedType = match[1];
    const base64Payload = match[2];
    const finalType = contentType.startsWith("image/") ? contentType : detectedType;
    const bytes = Buffer.from(base64Payload, "base64");
    if (!bytes.length || bytes.length >= 5 * 1024 * 1024) {
      res.status(413).json({ ok: false, error: "image_too_large_or_empty" });
      return;
    }

    const safeName = originalName || `qr_${Date.now()}.jpg`;
    const objectPath = `gcash_qr/qr_${Date.now()}_${safeName}`;
    const downloadToken = crypto.randomUUID();

    try {
      const bucket = getStorage().bucket();
      const file = bucket.file(objectPath);
      await file.save(bytes, {
        metadata: {
          contentType: finalType,
          metadata: {
            firebaseStorageDownloadTokens: downloadToken,
          },
        },
        resumable: false,
      });
      const bucketName = bucket.name;
      const publicUrl = toPublicDownloadUrl(bucketName, objectPath, downloadToken);
      res.status(200).json({
        ok: true,
        objectPath,
        bucket: bucketName,
        url: publicUrl,
      });
    } catch (err) {
      console.error("Failed to upload QR image", err);
      res.status(500).json({ ok: false, error: "storage_upload_failed" });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULED NOTIFICATIONS (Philippines Time / Asia/Manila)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 8:00 AM — AM Batch is open — place your lunch order now.
 * Cut-off: 10:00 AM | Delivery: 11:00 AM
 */
exports.notifyAmBatchOpen = onSchedule(
  { schedule: "0 8 * * *", timeZone: "Asia/Manila" },
  async () => {
    const tokens = await getAllCustomerTokens();
    const result = await sendBatchNotification(tokens, {
      title: "BayanGo — Order for Lunch!",
      body: "Order now. Cut-off is 10:00 AM, delivery is 11:00 AM.",
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
      body: "Order now! Cut-off is 10:00 AM, delivery is 11:00 AM today.",
      type: "batch_reminder_am_warning",
    });
    console.log(`[AM Batch 1hr Warning 9AM] Sent: ${result.sent}, Failed: ${result.failed}`);
  }
);

/**
 * 12:00 PM — PM Batch is open — you can now order for the afternoon.
 * Cut-off: 3:00 PM | Delivery: 4:00 PM
 */
exports.notifyPmBatchOpen = onSchedule(
  { schedule: "0 12 * * *", timeZone: "Asia/Manila" },
  async () => {
    const tokens = await getAllCustomerTokens();
    const result = await sendBatchNotification(tokens, {
      title: "BayanGo — Order for the Afternoon!",
      body: "Order now. Cut-off is 3:00 PM, delivery is 4:00 PM.",
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
      body: "Order now! Cut-off is 3:00 PM, delivery is 4:00 PM today.",
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
      title: "BayanGo — Pre-order for Tomorrow!",
      body: "Order now for delivery tomorrow at 11:00 AM. Don't forget!",
      type: "batch_reminder_preorder",
    });
    console.log(`[Pre-order Reminder 8PM] Sent: ${result.sent}, Failed: ${result.failed}`);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// RTDB-TRIGGERED: ORDER EVENTS (notifications to customers & riders)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bagong order → i-notify ang lahat ng riders.
 */
exports.onNewOrder = onValueCreated(
  { ref: "orders/{orderId}", region: "asia-southeast1" },
  async (event) => {
    const order = event.data.val();
    if (!order || order.status !== "pending" || order.riderId) return;

    const riderTokens = await getAllRiderTokens();
    if (!riderTokens.length) return;

    const result = await sendBatchNotification(riderTokens, {
      title: "BayanGo: New Order!",
      body: `New order from ${order.customer?.name || "customer"}. Open the app to accept it.`,
      type: "new_order",
      link: RIDER_APP_URL,
    });
    console.log(`[onNewOrder ${event.params.orderId}] Sent:${result.sent} Failed:${result.failed}`);
  }
);

/**
 * Bagong support ticket → i-notify ang lahat ng admins.
 */
exports.onNewSupportTicket = onValueCreated(
  { ref: "support_tickets/{ticketId}", region: "asia-southeast1" },
  async (event) => {
    const ticket = event.data.val() || {};
    const ticketId = event.params.ticketId;
    const subject = String(ticket.subject || "New support concern").trim();
    const customerName = String(ticket.userName || ticket.name || "Customer").trim();

    const adminTokens = await getAllAdminTokens();
    if (adminTokens.length) {
      const result = await sendBatchNotification(adminTokens, {
        title: "New Support Ticket",
        body: `${customerName}: ${subject}`,
        type: "support_ticket_new",
        link: `${ADMIN_APP_URL}#support`,
      });
      console.log(`[onNewSupportTicket ${ticketId}] Sent:${result.sent} Failed:${result.failed}`);
    } else {
      console.log(`[onNewSupportTicket ${ticketId}] No admin tokens found.`);
    }

    const db = getDatabase();
    const adminsSnap = await db.ref("admins").get();
    if (!adminsSnap.exists()) return;

    const notificationPayload = {
      type: "support_ticket_new",
      title: "New Support Ticket",
      body: `${customerName}: ${subject}`,
      ticketId,
      createdAt: Date.now(),
      read: false,
    };
    const writes = [];
    adminsSnap.forEach((adminSnap) => {
      if (adminSnap.val() === true) {
        writes.push(db.ref(`notifications/${adminSnap.key}`).push(notificationPayload));
      }
    });
    if (writes.length) await Promise.all(writes);
  }
);

/**
 * Order na-update → i-notify ang customer at/o rider depende sa kung ano ang nagbago:
 *   - status nagbago       → notify customer; kung cancelled at may rider → notify rider din
 *   - riderId nai-assign   → notify rider
 *   - gcashPaymentConfirmed → notify customer
 *   - pricesUpdatedAt      → notify customer
 */
exports.onOrderUpdated = onValueUpdated(
  { ref: "orders/{orderId}", region: "asia-southeast1" },
  async (event) => {
    const before = event.data.before.val() || {};
    const after = event.data.after.val() || {};
    const orderId = event.params.orderId;
    const uid = after.uid || after.userId;

    // 1. Status changed → notify customer
    if (before.status !== after.status && uid) {
      const statusLabel = ORDER_STATUS_LABELS[after.status] || after.status;
      const userTokens = await getUserTokens(uid);
      if (userTokens.length) {
        await sendBatchNotification(userTokens, {
          title: "Order Update",
          body: `Order #${String(orderId).slice(-6)}: ${statusLabel}`,
          type: "order_status",
          link: `${USER_APP_URL}#orders`,
        });
      }
      // Kung cancelled at may rider → notify rider
      if (after.status === "cancelled" && after.riderId) {
        const riderTokens = await getUserTokens(after.riderId);
        if (riderTokens.length) {
          await sendBatchNotification(riderTokens, {
            title: "BayanGo: Order Cancelled",
            body: `Order #${String(orderId).slice(-6)} was cancelled by the customer.`,
            type: "order_cancelled",
            link: RIDER_APP_URL,
          });
        }
      }
    }

    // 2. Rider na-assign (riderId added) → notify rider
    if (!before.riderId && after.riderId) {
      const riderTokens = await getUserTokens(after.riderId);
      if (riderTokens.length) {
        await sendBatchNotification(riderTokens, {
          title: "An order has been assigned to you",
          body: `Order #${String(orderId).slice(-6)} for ${after.customer?.name || "customer"}.`,
          type: "assigned_order",
          link: RIDER_APP_URL,
        });
      }
    }

    // 3. GCash confirmed → notify customer
    if (!before.gcashPaymentConfirmed && after.gcashPaymentConfirmed && uid) {
      const userTokens = await getUserTokens(uid);
      if (userTokens.length) {
        await sendBatchNotification(userTokens, {
          title: "GCash Payment Confirmed!",
          body: `Order #${String(orderId).slice(-6)}: Your GCash payment has been confirmed. Your order is now being prepared!`,
          type: "gcash_confirmed",
          link: `${USER_APP_URL}#orders`,
        });
      }
    }

    // 4. Prices updated → notify customer
    if (before.pricesUpdatedAt !== after.pricesUpdatedAt && after.pricesUpdatedAt && uid) {
      const total = after.total || 0;
      const hasProof = Array.isArray(after.proofImages) && after.proofImages.length > 0;
      const userTokens = await getUserTokens(uid);
      if (userTokens.length) {
        const notifPayload = hasProof ? {
          title: "Your order has been purchased!",
          body: `Order #${String(orderId).slice(-6)}: Tapos na ang pamimili at may proof of order na. Total: ₱${Number(total).toLocaleString("en-PH")}`,
          type: "order_bought_with_proof",
          link: `${USER_APP_URL}#orders`,
        } : {
          title: "Order Update — Check your payment",
          body: `Order #${String(orderId).slice(-6)}: Actual pricing has been updated. Total: ₱${Number(total).toLocaleString("en-PH")}`,
          type: "prices_updated",
          link: `${USER_APP_URL}#orders`,
        };
        await sendBatchNotification(userTokens, notifPayload);
      }
    }
  }
);

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onValueCreated, onValueUpdated } = require("firebase-functions/v2/database");
const { onRequest } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { getStorage } = require("firebase-admin/storage");
const crypto = require("crypto");

// ─────────────────────────────────────────────────────────────────────────────
// CORE ENGINE IMPORTS — business logic lives in /functions/core/
// Change the "look" (handlers below) without touching the "engine" (core/).
// ─────────────────────────────────────────────────────────────────────────────
const {
  USER_APP_URL,
  RIDER_APP_URL,
  ADMIN_APP_URL,
  MERCHANT_APP_URL,
  ADMIN_ALLOWED_ORIGINS,
  ORDER_STATUS_LABELS,
  MERCHANT_STATUS_LABELS,
} = require("./core/constants");

const {
  getAllCustomerTokens,
  getUserTokens,
  getAllRiderTokens,
  getAllAdminTokens,
  sendBatchNotification,
} = require("./core/notifications");

const {
  verifyPaymongoSignature,
  extractOrderId,
  derivePaymentState,
} = require("./core/payments");

const {
  setCors,
  verifyAdminRequest,
} = require("./core/auth");

const {
  toPublicDownloadUrl,
} = require("./core/storage");

initializeApp();

const PAYMONGO_WEBHOOK_SECRET = process.env.PAYMONGO_WEBHOOK_SECRET || "";
const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY || "";

// ─────────────────────────────────────────────────────────────────────────────
// RTDB-TRIGGERED: notification_queue
// ─────────────────────────────────────────────────────────────────────────────

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

    try {
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

      await db.ref(`notification_queue/${pushId}`).remove();
    } catch (err) {
      console.error(`[notif_queue/${pushId}] Error processing notification for uid=${uid}:`, err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// RTDB-TRIGGERED: partner merchant enforcement updates
// Sends in-app notification + email queue payload when access is moderated.
// ─────────────────────────────────────────────────────────────────────────────
exports.notifyPartnerMerchantModeration = onValueUpdated(
  { ref: "partner_merchants/{merchantId}", region: "asia-southeast1" },
  async (event) => {
    const before = event.data.before.val() || {};
    const after = event.data.after.val() || {};
    const merchantId = event.params.merchantId;
    const prevAction = String(before?.enforcementStatus || before?.moderation?.action || "active").trim().toLowerCase();
    const nextAction = String(after?.enforcementStatus || after?.moderation?.action || "active").trim().toLowerCase();
    if (!["active", "suspended", "revoked", "deleted"].includes(nextAction)) return;
    if (prevAction === nextAction) return;

    const db = getDatabase();
    const candidates = [
      after?.contactEmail,
      after?.applicantEmail,
      after?.email,
      before?.contactEmail,
      before?.applicantEmail,
      before?.email,
    ]
      .map((v) => String(v || "").trim().toLowerCase())
      .filter(Boolean)
      .filter((email, idx, arr) => arr.indexOf(email) === idx);

    const reason = String(after?.moderation?.reason || "").trim();
    const storeName = String(after?.storeName || "your store").trim();
    const actionLabel =
      nextAction === "suspended" ? "suspended" :
      nextAction === "revoked" ? "access revoked" :
      nextAction === "deleted" ? "marked as deleted" : "restored";
    const title = nextAction === "active" ? "✅ Store access restored" : "⚠️ Store compliance action";
    const body = nextAction === "active"
      ? `${storeName} has been re-activated.`
      : `${storeName} was ${actionLabel} due to policy violations.${reason ? ` Reason: ${reason}` : ""}`;

    if (after?.applicantUid) {
      await db.ref("notification_queue").push({
        uid: after.applicantUid,
        title,
        body,
        link: `${MERCHANT_APP_URL}`,
        createdAt: Date.now(),
      });
    }

    if (candidates.length > 0) {
      const safeReason = reason ? `\nReason: ${reason}` : "";
      const htmlReason = reason ? `<p><strong>Reason:</strong> ${reason}</p>` : "";
      await db.ref("mail").push({
        to: candidates,
        message: {
          subject: `[BayanGo] Store access update: ${storeName}`,
          text: `Hello partner,\n\nYour store "${storeName}" has been ${actionLabel}.${safeReason}\n\nIf you believe this is a mistake, reply to BayanGo support.\n\n- BayanGo Admin`,
          html: `<p>Hello partner,</p><p>Your store <strong>${storeName}</strong> has been <strong>${actionLabel}</strong>.</p>${htmlReason}<p>If you believe this is a mistake, please contact BayanGo support.</p><p>- BayanGo Admin</p>`,
        },
        meta: {
          merchantId,
          enforcementStatus: nextAction,
          triggeredAt: Date.now(),
        },
      });
    }
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
// HTTPS: GENERATE PAYMONGO QRPH CODE (in-app QR display via Payment Intents)
// ─────────────────────────────────────────────────────────────────────────────
exports.generatePaymongoQrphCode = onRequest(
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
    const headers = { "Content-Type": "application/json", Authorization: `Basic ${auth}` };

    // Step 1: Create Payment Intent
    const piRes = await fetch("https://api.paymongo.com/v1/payment_intents", {
      method: "POST",
      headers,
      body: JSON.stringify({
        data: {
          attributes: {
            amount,
            payment_method_allowed: ["qrph"],
            currency: "PHP",
            capture_type: "automatic",
            metadata: { orderId },
          },
        },
      }),
    });
    const piJson = await piRes.json().catch(() => ({}));
    if (!piRes.ok) {
      console.error("PayMongo PI create error", piRes.status, piJson);
      res.status(502).json({ ok: false, error: "paymongo_pi_error", details: piJson });
      return;
    }
    const piId = piJson?.data?.id;

    // Step 2: Create QR Ph Payment Method
    const pmRes = await fetch("https://api.paymongo.com/v1/payment_methods", {
      method: "POST",
      headers,
      body: JSON.stringify({ data: { attributes: { type: "qrph" } } }),
    });
    const pmJson = await pmRes.json().catch(() => ({}));
    if (!pmRes.ok) {
      console.error("PayMongo PM create error", pmRes.status, pmJson);
      res.status(502).json({ ok: false, error: "paymongo_pm_error", details: pmJson });
      return;
    }
    const pmId = pmJson?.data?.id;

    // Step 3: Attach Payment Method to get QR code
    const attachRes = await fetch(`https://api.paymongo.com/v1/payment_intents/${piId}/attach`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        data: {
          attributes: {
            payment_method: pmId,
            return_url: "https://bayango.store/#orders",
          },
        },
      }),
    });
    const attachJson = await attachRes.json().catch(() => ({}));
    if (!attachRes.ok) {
      console.error("PayMongo attach error", attachRes.status, attachJson);
      res.status(502).json({ ok: false, error: "paymongo_attach_error", details: attachJson });
      return;
    }

    // PayMongo returns QR Ph image under next_action.display_qr_code.qr_image
    const nextAction = attachJson?.data?.attributes?.next_action || {};
    const qrImageUrl =
      nextAction?.display_qr_code?.qr_image ||
      nextAction?.display_instructions?.qr_image ||
      nextAction?.qr_image ||
      null;

    if (!qrImageUrl) {
      console.error("PayMongo QR image not found in next_action", JSON.stringify(nextAction));
    }

    await orderRef.update({
      paymentProvider: "paymongo",
      paymentStatus: "pending",
      paymentUpdatedAt: Date.now(),
      paymongoPaymentIntentId: piId,
      paymongoQrImageUrl: qrImageUrl,
    });

    res.status(200).json({ ok: true, orderId, paymentIntentId: piId, qrImageUrl });
  }
);


// ─────────────────────────────────────────────────────────────────────────────
exports.sendBroadcastNotification = onRequest(
  { region: "us-central1", cors: ADMIN_ALLOWED_ORIGINS },
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
// HTTPS: ADMIN DIRECT NOTIFICATION TO A SPECIFIC USER
// ─────────────────────────────────────────────────────────────────────────────
exports.sendUserNotification = onRequest(
  { region: "us-central1", cors: ADMIN_ALLOWED_ORIGINS },
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
      console.warn("Direct user notif auth verification failed:", err?.message || err);
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    if (!caller) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const uid = String(req.body?.uid || "").trim();
    const title = String(req.body?.title || "").trim();
    const body = String(req.body?.body || "").trim();
    if (!uid || !title || !body) {
      res.status(400).json({ ok: false, error: "uid, title and body are required" });
      return;
    }

    const tokens = await getUserTokens(uid, { excludeRole: "rider" });
    if (!tokens.length) {
      res.status(404).json({ ok: false, error: "no_active_tokens_for_user", uid });
      return;
    }

    const result = await sendBatchNotification(tokens, {
      title,
      body,
      type: "direct_admin_message",
      link: USER_APP_URL,
    });

    res.status(200).json({
      ok: true,
      uid,
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
  { region: "us-central1", memory: "256MiB", cors: ADMIN_ALLOWED_ORIGINS },
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

exports.notifyAmBatchOpen = onSchedule(
  { schedule: "0 8 * * *", timeZone: "Asia/Manila" },
  async () => {
    try {
      const tokens = await getAllCustomerTokens();
      const result = await sendBatchNotification(tokens, {
        title: "BayanGo — Order for Lunch!",
        body: "Order now. Cut-off is 10:00 AM, delivery is 11:00 AM.",
        type: "batch_reminder_am_open",
      });
      console.log(`[AM Batch Open 8AM] Sent: ${result.sent}, Failed: ${result.failed}`);
    } catch (err) {
      console.error("[AM Batch Open 8AM] Error:", err);
    }
  }
);

exports.notifyAmBatchWarning = onSchedule(
  { schedule: "0 9 * * *", timeZone: "Asia/Manila" },
  async () => {
    try {
      const tokens = await getAllCustomerTokens();
      const result = await sendBatchNotification(tokens, {
        title: "1 Oras Na Lang! — AM Batch",
        body: "Order now! Cut-off is 10:00 AM, delivery is 11:00 AM today.",
        type: "batch_reminder_am_warning",
      });
      console.log(`[AM Batch 1hr Warning 9AM] Sent: ${result.sent}, Failed: ${result.failed}`);
    } catch (err) {
      console.error("[AM Batch 1hr Warning 9AM] Error:", err);
    }
  }
);

exports.notifyPmBatchOpen = onSchedule(
  { schedule: "0 12 * * *", timeZone: "Asia/Manila" },
  async () => {
    try {
      const tokens = await getAllCustomerTokens();
      const result = await sendBatchNotification(tokens, {
        title: "BayanGo — Order for the Afternoon!",
        body: "Order now. Cut-off is 3:00 PM, delivery is 4:00 PM.",
        type: "batch_reminder_pm_open",
      });
      console.log(`[PM Batch Open 12PM] Sent: ${result.sent}, Failed: ${result.failed}`);
    } catch (err) {
      console.error("[PM Batch Open 12PM] Error:", err);
    }
  }
);

exports.notifyPmBatchWarning = onSchedule(
  { schedule: "0 14 * * *", timeZone: "Asia/Manila" },
  async () => {
    try {
      const tokens = await getAllCustomerTokens();
      const result = await sendBatchNotification(tokens, {
        title: "1 Oras Na Lang! — PM Batch",
        body: "Order now! Cut-off is 3:00 PM, delivery is 4:00 PM today.",
        type: "batch_reminder_pm_warning",
      });
      console.log(`[PM Batch 1hr Warning 2PM] Sent: ${result.sent}, Failed: ${result.failed}`);
    } catch (err) {
      console.error("[PM Batch 1hr Warning 2PM] Error:", err);
    }
  }
);

exports.notifyPreorder = onSchedule(
  { schedule: "0 20 * * *", timeZone: "Asia/Manila" },
  async () => {
    try {
      const tokens = await getAllCustomerTokens();
      const result = await sendBatchNotification(tokens, {
        title: "BayanGo — Pre-order for Tomorrow!",
        body: "Order now for delivery tomorrow at 11:00 AM. Don't forget!",
        type: "batch_reminder_preorder",
      });
      console.log(`[Pre-order Reminder 8PM] Sent: ${result.sent}, Failed: ${result.failed}`);
    } catch (err) {
      console.error("[Pre-order Reminder 8PM] Error:", err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// RTDB-TRIGGERED: ORDER EVENTS (notifications to customers & riders)
// ─────────────────────────────────────────────────────────────────────────────

exports.onNewOrder = onValueCreated(
  { ref: "orders/{orderId}", region: "asia-southeast1" },
  async (event) => {
    try {
      const order = event.data.val();
      if (!order || order.riderId) return;

      // Merchant order — notify the merchant
      if (order.status === "merchant_pending" && order.merchantId) {
        const merchantTokens = await getUserTokens(order.merchantId);
        if (merchantTokens.length) {
          const mResult = await sendBatchNotification(merchantTokens, {
            title: "BayanGo: New Order!",
            body: `New order from ${order.customer?.name || "customer"} — ₱${Number(order.total || 0).toLocaleString("en-PH")}. Open the dashboard to accept it.`,
            type: "new_merchant_order",
            link: MERCHANT_APP_URL,
          });
          console.log(`[onNewOrder ${event.params.orderId}] Merchant notified: Sent:${mResult.sent} Failed:${mResult.failed}`);
        }
        return;
      }

      // Regular order — notify riders
      if (order.status !== "pending") return;

      const riderTokens = await getAllRiderTokens();
      if (!riderTokens.length) return;

      const result = await sendBatchNotification(riderTokens, {
        title: "BayanGo: New Order!",
        body: `New order from ${order.customer?.name || "customer"}. Open the app to accept it.`,
        type: "new_order",
        link: RIDER_APP_URL,
      });
      console.log(`[onNewOrder ${event.params.orderId}] Sent:${result.sent} Failed:${result.failed}`);
    } catch (err) {
      console.error(`[onNewOrder ${event.params.orderId}] Error:`, err);
    }
  }
);

exports.onOrderUpdated = onValueUpdated(
  { ref: "orders/{orderId}", region: "asia-southeast1" },
  async (event) => {
    const orderId = event.params.orderId;
    try {
      const before = event.data.before.val() || {};
      const after = event.data.after.val() || {};
      const uid = after.uid || after.userId || before.uid || before.userId;
      const db = getDatabase();

      // 1. Status changed -> notify customer
      if (before.status !== after.status && uid) {
        const statusLabel = ORDER_STATUS_LABELS[after.status] || after.status;
        const cancelReason = String(after.cancellationReason || "").trim();
        const statusMessage = after.status === "cancelled" && cancelReason
          ? `${statusLabel}. Reason: ${cancelReason}`
          : statusLabel;
        const userTokens = await getUserTokens(uid, { excludeRole: "rider" });
        if (userTokens.length) {
          await sendBatchNotification(userTokens, {
            title: "Order Update",
            body: `Order #${String(orderId).slice(-6)}: ${statusMessage}`,
            type: "order_status",
            link: `${USER_APP_URL}#orders`,
          });
        } else {
          await db.ref(`user_notifications/${uid}`).push({
            title: "Order Update",
            body: `Order #${String(orderId).slice(-6)}: ${statusMessage}`,
            type: "order_status",
            link: `${USER_APP_URL}#orders`,
            createdAt: Date.now(),
          });
          console.warn(`[onOrderUpdated ${orderId}] No active push token for uid=${uid}; wrote fallback user_notifications entry.`);
        }
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

      // 1a. Merchant order becomes open for riders -> notify riders (uid-independent)
      if (before.status === "merchant_pending" && after.status === "pending" && !after.riderId) {
        const riderTokens = await getAllRiderTokens();
        if (riderTokens.length) {
          await sendBatchNotification(riderTokens, {
            title: "BayanGo: New Order!",
            body: `New merchant order from ${after.customer?.name || "customer"}. Open the app to accept it.`,
            type: "new_order",
            link: RIDER_APP_URL,
          });
        }
      }

      // 1b. Merchant status changed
      if (before.status === after.status && before.merchantStatus !== after.merchantStatus && after.merchantStatus && uid) {
        const merchantLabel = MERCHANT_STATUS_LABELS[after.merchantStatus] || `Merchant status: ${after.merchantStatus}`;
        const userTokens = await getUserTokens(uid, { excludeRole: "rider" });
        if (userTokens.length) {
          await sendBatchNotification(userTokens, {
            title: "Order Update",
            body: `Order #${String(orderId).slice(-6)}: ${merchantLabel}`,
            type: "order_status",
            link: `${USER_APP_URL}#orders`,
          });
        } else {
          await db.ref(`user_notifications/${uid}`).push({
            title: "Order Update",
            body: `Order #${String(orderId).slice(-6)}: ${merchantLabel}`,
            type: "order_status",
            link: `${USER_APP_URL}#orders`,
            createdAt: Date.now(),
          });
        }
      }

      // 2. Rider assigned
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

      // 3. GCash confirmed
      if (!before.gcashPaymentConfirmed && after.gcashPaymentConfirmed && uid) {
        const userTokens = await getUserTokens(uid, { excludeRole: "rider" });
        if (userTokens.length) {
          await sendBatchNotification(userTokens, {
            title: "GCash Payment Confirmed!",
            body: `Order #${String(orderId).slice(-6)}: Your GCash payment has been confirmed. Your order is now being prepared!`,
            type: "gcash_confirmed",
            link: `${USER_APP_URL}#orders`,
          });
        }
      }

      // 3b. Merchant order delivered — decrement stock on the merchant's listings.
      // Only runs once: when the status transitions INTO "delivered" and the order
      // has a merchantId. Uses a transaction on each item to avoid races.
      if (before.status !== "delivered" && after.status === "delivered" && after.merchantId) {
        try {
          const items = Array.isArray(after.items) ? after.items : Object.values(after.items || {});
          for (const it of items) {
            const listingId = it?.id || it?.listingId;
            if (!listingId) continue;
            const qty = Number(it?.qty || it?.quantity || 1);
            if (!Number.isFinite(qty) || qty <= 0) continue;
            const stockRef = db.ref(`merchant_listings/${after.merchantId}/${listingId}/stock`);
            await stockRef.transaction((current) => {
              const now = Number(current || 0);
              const next = now - qty;
              return next < 0 ? 0 : next;
            });
          }
        } catch (e) {
          console.error(`[onOrderUpdated ${orderId}] stock decrement failed:`, e);
        }
      }

      // 4. Prices updated
      if (before.pricesUpdatedAt !== after.pricesUpdatedAt && after.pricesUpdatedAt && uid) {
        const total = after.total || 0;
        const hasProof = Array.isArray(after.proofImages) && after.proofImages.length > 0;
        const userTokens = await getUserTokens(uid, { excludeRole: "rider" });
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
    } catch (err) {
      console.error(`[onOrderUpdated ${orderId}] Error:`, err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// RTDB-TRIGGERED: SUPPORT TICKET & MESSAGE NOTIFICATIONS
// ─────────────────────────────────────────────────────────────────────────────

exports.onNewSupportTicket = onValueCreated(
  { ref: "support_tickets/{ticketId}", region: "asia-southeast1" },
  async (event) => {
    try {
      const ticket = event.data.val();
      if (!ticket) return;

      const adminTokens = await getAllAdminTokens();
      if (!adminTokens.length) return;

      const customerName = ticket.userName || ticket.name || "Customer";
      const subject = ticket.subject || "No subject";

      const result = await sendBatchNotification(adminTokens, {
        title: "New Support Ticket",
        body: `${customerName}: ${subject}`,
        type: "support_ticket_new",
        link: `${ADMIN_APP_URL}#support`,
      });
      console.log(`[onNewSupportTicket ${event.params.ticketId}] Sent:${result.sent} Failed:${result.failed}`);
    } catch (err) {
      console.error(`[onNewSupportTicket ${event.params.ticketId}] Error:`, err);
    }
  }
);

exports.onNewSupportMessage = onValueCreated(
  { ref: "support_messages/{ticketId}/{messageId}", region: "asia-southeast1" },
  async (event) => {
    const ticketId = event.params.ticketId;
    try {
      const message = event.data.val();
      if (!message || !message.senderType || message.senderType === "bot") return;

      const db = getDatabase();
      const ticketSnap = await db.ref("support_tickets/" + ticketId).get();
      if (!ticketSnap.exists()) return;
      const ticket = ticketSnap.val();

      if (message.senderType === "user") {
        const adminTokens = await getAllAdminTokens();
        if (!adminTokens.length) return;

        const senderName = message.senderName || ticket.userName || "Customer";
        const preview = message.text.length > 80 ? message.text.slice(0, 80) + "\u2026" : message.text;

        const result = await sendBatchNotification(adminTokens, {
          title: `Support: ${ticket.subject || "Ticket"}`,
          body: `${senderName}: ${preview}`,
          type: "support_message_user",
          link: `${ADMIN_APP_URL}#support`,
        });
        console.log(`[onNewSupportMessage user->admin ${ticketId}] Sent:${result.sent} Failed:${result.failed}`);

      } else if (message.senderType === "admin") {
        const uid = ticket.uid;
        if (!uid) return;

        const userTokens = await getUserTokens(uid, { excludeRole: "rider" });
        if (!userTokens.length) return;

        const preview = message.text.length > 80 ? message.text.slice(0, 80) + "\u2026" : message.text;

        const result = await sendBatchNotification(userTokens, {
          title: "BayanGo Support Reply",
          body: preview,
          type: "support_message_admin",
          link: `${USER_APP_URL}#support`,
        });
        console.log(`[onNewSupportMessage admin->user ${ticketId}] Sent:${result.sent} Failed:${result.failed}`);
      }
    } catch (err) {
      console.error(`[onNewSupportMessage ${ticketId}] Error:`, err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// HTTPS: ADMIN — DELETE SAMPLE / TEST ORDERS
// One-time cleanup endpoint. Removes orders whose customer.name matches
// known test names: Kenneth Antonil, Shiela Gallos, Shiela, Sample.
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteSampleOrders = onRequest(
  { region: "us-central1", cors: ADMIN_ALLOWED_ORIGINS },
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
      console.warn("deleteSampleOrders auth failed:", err?.message || err);
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    if (!caller) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const SAMPLE_NAMES = [
      "kenneth antonil",
      "shiela gallos",
      "shiela",
      "sample",
    ];

    const db = getDatabase();
    const ordersSnap = await db.ref("orders").get();
    if (!ordersSnap.exists()) {
      res.status(200).json({ ok: true, deleted: 0, message: "No orders in database." });
      return;
    }

    const allOrders = ordersSnap.val();
    const deletedList = [];
    const updates = {};

    for (const [orderId, order] of Object.entries(allOrders)) {
      const name = String(order?.customer?.name || "").trim().toLowerCase();
      if (SAMPLE_NAMES.includes(name)) {
        updates[orderId] = null;
        deletedList.push({
          orderId,
          customerName: order?.customer?.name || "(no name)",
          status: order?.status || "(no status)",
        });
      }
    }

    if (deletedList.length === 0) {
      res.status(200).json({ ok: true, deleted: 0, message: "No sample orders found." });
      return;
    }

    await db.ref("orders").update(updates);
    console.log(`[deleteSampleOrders] Admin ${caller.email || caller.uid} deleted ${deletedList.length} sample orders.`);

    res.status(200).json({
      ok: true,
      deleted: deletedList.length,
      orders: deletedList,
      requestedBy: caller.email || caller.uid,
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// HTTPS: ADMIN — CREATE REFUND
// Creates a refund record and notifies the customer via push notification.
// ─────────────────────────────────────────────────────────────────────────────
exports.createRefund = onRequest(
  { region: "us-central1", cors: ADMIN_ALLOWED_ORIGINS },
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
      console.warn("createRefund auth failed:", err?.message || err);
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    if (!caller) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const uid = String(req.body?.uid || "").trim();
    const orderId = String(req.body?.orderId || "").trim();
    const amount = Number(req.body?.amount || 0);
    const reason = String(req.body?.reason || "").trim();

    if (!uid || !orderId || !Number.isFinite(amount) || amount <= 0 || !reason) {
      res.status(400).json({ ok: false, error: "uid, orderId, amount, and reason are required" });
      return;
    }

    const db = getDatabase();

    // Verify order exists and belongs to the user
    const orderSnap = await db.ref(`orders/${orderId}`).get();
    if (!orderSnap.exists()) {
      res.status(404).json({ ok: false, error: "order_not_found" });
      return;
    }
    const order = orderSnap.val() || {};
    if ((order.uid || order.userId) !== uid) {
      res.status(400).json({ ok: false, error: "order_uid_mismatch" });
      return;
    }

    // Prevent refund amount exceeding order total
    const orderTotal = Number(order.total || 0);
    if (orderTotal > 0 && amount > orderTotal) {
      res.status(400).json({ ok: false, error: "refund_exceeds_order_total" });
      return;
    }

    // Check for duplicate refund on same order
    const existingSnap = await db.ref("refunds").orderByChild("orderId").equalTo(orderId).get();
    if (existingSnap.exists()) {
      res.status(409).json({ ok: false, error: "refund_already_exists", message: "A refund already exists for this order." });
      return;
    }

    // Create refund record
    const refundData = {
      uid,
      orderId,
      amount,
      reason,
      status: "completed",
      createdAt: Date.now(),
      createdBy: caller.email || caller.uid,
    };
    const refundRef = await db.ref("refunds").push(refundData);

    // Mark the order as refunded
    await db.ref(`orders/${orderId}`).update({
      refunded: true,
      refundId: refundRef.key,
      refundAmount: amount,
    });

    // Send push notification to user
    const tokens = await getUserTokens(uid, { excludeRole: "rider" });
    const notifPayload = {
      title: "Refund Received!",
      body: `You received a ₱${Number(amount).toLocaleString("en-PH")} refund for Order #${orderId.slice(-6)}. Reason: ${reason}`,
      type: "refund",
      link: `${USER_APP_URL}#orders`,
    };

    if (tokens.length) {
      await sendBatchNotification(tokens, notifPayload);
    } else {
      await db.ref(`user_notifications/${uid}`).push({
        ...notifPayload,
        createdAt: Date.now(),
      });
    }

    console.log(`[createRefund] Admin ${caller.email || caller.uid} refunded ₱${amount} for order ${orderId} to uid=${uid}`);

    res.status(200).json({
      ok: true,
      refundId: refundRef.key,
      requestedBy: caller.email || caller.uid,
    });
  }
);

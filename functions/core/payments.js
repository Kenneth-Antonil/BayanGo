/**
 * BayanGo Backend Core — Payment Processing Engine
 *
 * PayMongo signature verification, order ID extraction, and payment state derivation.
 * This is the PAYMENT ENGINE — do not modify unless changing payment behavior.
 */

const crypto = require("crypto");

function asBuffer(rawBody, fallback) {
  if (Buffer.isBuffer(rawBody)) return rawBody;
  if (typeof rawBody === "string") return Buffer.from(rawBody, "utf8");
  if (rawBody && typeof rawBody === "object") return Buffer.from(JSON.stringify(rawBody), "utf8");
  if (typeof fallback === "string") return Buffer.from(fallback, "utf8");
  return Buffer.from("", "utf8");
}

/**
 * Parse PayMongo signature header.
 * Supports common timestamp fields (t, ts, timestamp) and signature fields (v1, sig, signature).
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

module.exports = {
  asBuffer,
  parsePaymongoSignature,
  verifyPaymongoSignature,
  extractOrderId,
  derivePaymentState,
};

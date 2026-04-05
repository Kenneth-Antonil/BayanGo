/**
 * BayanGo Backend Core — Auth & CORS Helpers
 *
 * Admin verification, origin normalization, and CORS header management.
 */

const { getAuth } = require("firebase-admin/auth");
const { getDatabase } = require("firebase-admin/database");
const { ADMIN_ALLOWED_ORIGINS } = require("./constants");

function normalizeOrigin(origin = "") {
  return String(origin || "").trim().toLowerCase().replace(/\/+$/, "");
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

async function verifyAdminRequest(req) {
  const authHeader = req.get("authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
  const idToken = authHeader.slice(7).trim();
  if (!idToken) return null;

  const decoded = await getAuth().verifyIdToken(idToken);
  if (!decoded?.uid) return null;

  const adminSnap = await getDatabase().ref(`admins/${decoded.uid}`).get();
  if (adminSnap.val() !== true) return null;

  return decoded;
}

module.exports = {
  normalizeOrigin,
  setCors,
  verifyAdminRequest,
};

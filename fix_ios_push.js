const fs = require("fs");
const path = require("path");

const VAPID = "BMdJvRjBWkB8Ob6OOJNiaFVtKkTG4Ubd1BEM4z8VshMVO0WiGHYUEu3mfm1sQYlK25OloE9jjojJUWB12eMfLfA";

const IS_SUPPORTED_BLOCK = `      try {
        const supported = typeof firebase.messaging.isSupported === "function"
          ? await firebase.messaging.isSupported()
          : true;
        if (!supported) return;
      } catch (_) { return; }
`;

const PATCHES = [
  // ── bayango-user.html: VAPID key ─────────────────────────────────────────
  {
    file: "bayango-user.html",
    old: `const STATIC_WEB_PUSH_VAPID_KEY = normalizeVapidKey(window.BAYANGO_WEB_PUSH_VAPID_KEY);
    let cachedWebPushVapidKey = STATIC_WEB_PUSH_VAPID_KEY;`,
    new: `const BAYANGO_HARDCODED_VAPID_KEY = "${VAPID}";
    const STATIC_WEB_PUSH_VAPID_KEY = normalizeVapidKey(window.BAYANGO_WEB_PUSH_VAPID_KEY || BAYANGO_HARDCODED_VAPID_KEY);
    let cachedWebPushVapidKey = STATIC_WEB_PUSH_VAPID_KEY;`,
  },
  // ── bayango-user.html: isSupported ───────────────────────────────────────
  {
    file: "bayango-user.html",
    old: `async function enablePushForUser(user, { requestPermission = true } = {}) {
      if (!user?.uid) return;
      if (!("serviceWorker" in navigator) || !("Notification" in window) || !firebase.messaging) return;`,
    new: `async function enablePushForUser(user, { requestPermission = true } = {}) {
      if (!user?.uid) return;
      if (!("serviceWorker" in navigator) || !("Notification" in window)) return;
${IS_SUPPORTED_BLOCK}`,
  },

  // ── hosting/user/app.html: VAPID key ─────────────────────────────────────
  {
    file: path.join("hosting", "user", "app.html"),
    old: `const STATIC_WEB_PUSH_VAPID_KEY = normalizeVapidKey(window.BAYANGO_WEB_PUSH_VAPID_KEY);
    let cachedWebPushVapidKey = STATIC_WEB_PUSH_VAPID_KEY;`,
    new: `const BAYANGO_HARDCODED_VAPID_KEY = "${VAPID}";
    const STATIC_WEB_PUSH_VAPID_KEY = normalizeVapidKey(window.BAYANGO_WEB_PUSH_VAPID_KEY || BAYANGO_HARDCODED_VAPID_KEY);
    let cachedWebPushVapidKey = STATIC_WEB_PUSH_VAPID_KEY;`,
  },
  // ── hosting/user/app.html: isSupported ───────────────────────────────────
  {
    file: path.join("hosting", "user", "app.html"),
    old: `async function enablePushForUser(user, { requestPermission = true } = {}) {
      if (!user?.uid) return;
      if (!("serviceWorker" in navigator) || !("Notification" in window) || !firebase.messaging) return;`,
    new: `async function enablePushForUser(user, { requestPermission = true } = {}) {
      if (!user?.uid) return;
      if (!("serviceWorker" in navigator) || !("Notification" in window)) return;
${IS_SUPPORTED_BLOCK}`,
  },

  // ── bayango-rider.html: isSupported ──────────────────────────────────────
  {
    file: "bayango-rider.html",
    old: `async function enablePushForRider(user, onForegroundNotify) {
      if (!user?.uid) return;
      if (!("serviceWorker" in navigator) || !("Notification" in window) || !firebase.messaging) return;`,
    new: `async function enablePushForRider(user, onForegroundNotify) {
      if (!user?.uid) return;
      if (!("serviceWorker" in navigator) || !("Notification" in window)) return;
${IS_SUPPORTED_BLOCK}`,
  },

  // ── hosting/rider/index.html: isSupported ────────────────────────────────
  {
    file: path.join("hosting", "rider", "index.html"),
    old: `async function enablePushForRider(user, onForegroundNotify) {
      if (!user?.uid) return;
      if (!("serviceWorker" in navigator) || !("Notification" in window) || !firebase.messaging) return;`,
    new: `async function enablePushForRider(user, onForegroundNotify) {
      if (!user?.uid) return;
      if (!("serviceWorker" in navigator) || !("Notification" in window)) return;
${IS_SUPPORTED_BLOCK}`,
  },
];

console.log("\n=== BayanGo iOS Push Fix (v2 — CRLF safe) ===\n");

let allOk = true;

for (const patch of PATCHES) {
  if (!fs.existsSync(patch.file)) {
    console.log(`  ✗  NOT FOUND: ${patch.file}`);
    allOk = false;
    continue;
  }

  const raw = fs.readFileSync(patch.file, "utf8");
  const hasCRLF = raw.includes("\r\n");

  // Normalize to LF for matching
  const content = raw.replace(/\r\n/g, "\n");
  const oldNorm  = patch.old.replace(/\r\n/g, "\n");
  const newNorm  = patch.new.replace(/\r\n/g, "\n");

  if (!content.includes(oldNorm)) {
    if (content.includes(newNorm)) {
      console.log(`  ✓  ALREADY PATCHED: ${patch.file}`);
    } else {
      console.log(`  ✗  PATTERN NOT FOUND in ${patch.file}`);
      allOk = false;
    }
    continue;
  }

  let patched = content.replace(oldNorm, newNorm);

  // Restore CRLF if that was the original style
  if (hasCRLF) {
    patched = patched.replace(/\n/g, "\r\n");
  }

  fs.writeFileSync(patch.file, patched, "utf8");
  console.log(`  ✓  PATCHED: ${patch.file}`);
}

console.log(`
─────────────────────────────────────────────────────
MANUAL STEP — Set VAPID key in Firebase RTDB Console
─────────────────────────────────────────────────────
Path:   settings/pushVapidKey
Value:  ${VAPID}
─────────────────────────────────────────────────────
`);

if (!allOk) {
  console.log("Some patches had issues — check messages above.");
  process.exit(1);
} else {
  console.log("All patches applied! Deploy and test on iPhone.");
}

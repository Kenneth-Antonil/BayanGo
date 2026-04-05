/**
 * BayanGo Core — Shared Utilities
 * Helper functions shared across user, rider, and admin apps.
 */
(function () {
  const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const sanitizeTokenKey = (token) =>
    encodeURIComponent(String(token || "")).replace(/\./g, "%2E");

  const ACTIVE_USER_WINDOW_MS = 5 * 60 * 1000;

  const isStandaloneMode = () =>
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  const normalizeToCategoryId = (value) => {
    const v = String(value || "").toLowerCase();
    if (v.includes("isda") || v.includes("fish")) return "isda";
    if (v.includes("karne") || v.includes("meat")) return "karne";
    if (v.includes("gulay") || v.includes("vegetable")) return "gulay";
    if (v.includes("prutas") || v.includes("fruit")) return "prutas";
    if (v.includes("ulam") || v.includes("lutong")) return "ulam";
    if (v.includes("gamot") || v.includes("pharma") || v.includes("medicine")) return "gamot";
    if (v.includes("hardware")) return "hardware";
    return "sari";
  };

  async function trackUserAppUsage(user, fbDb, { markInstalled = false } = {}) {
    if (!user?.uid || !fbDb) return;
    const now = Date.now();
    const usageRef = fbDb.ref(`app_usage/${user.uid}`);
    const updates = {
      uid: user.uid,
      email: user.email || null,
      name: user.displayName || null,
      lastActiveAt: now,
      activeWindowUntil: now + ACTIVE_USER_WINDOW_MS,
      platform: navigator.userAgent || "web",
    };
    if (markInstalled || isStandaloneMode()) {
      const installedSnap = await usageRef.child("installedAt").once("value");
      if (!installedSnap.exists()) updates.installedAt = now;
    }
    await usageRef.update(updates);
  }

  window.BayanGoCore = window.BayanGoCore || {};
  Object.assign(window.BayanGoCore, {
    genId,
    sanitizeTokenKey,
    ACTIVE_USER_WINDOW_MS,
    isStandaloneMode,
    normalizeToCategoryId,
    trackUserAppUsage,
  });
})();

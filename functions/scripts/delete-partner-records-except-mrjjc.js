#!/usr/bin/env node
/**
 * One-time script: delete all partner application + merchant records
 * except records for "MRJJC Essential Oil store".
 *
 * Deletes from:
 *   - partner_applications
 *   - merchant_applications
 *   - mechant_applications (legacy typo path)
 *   - partner_merchants
 *
 * Keep rule:
 *   - Keep any record whose storeName/store/store_name exactly matches
 *     "MRJJC Essential Oil store" (case-insensitive, trimmed)
 *
 * Usage:
 *   cd functions
 *   GOOGLE_APPLICATION_CREDENTIALS=path/to/serviceAccountKey.json node scripts/delete-partner-records-except-mrjjc.js
 */

const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");

const DATABASE_URL =
  "https://bayango-315c6-default-rtdb.asia-southeast1.firebasedatabase.app";

const KEEP_STORE_NAME = "mrjjc essential oil store";
const TARGET_PATHS = [
  "partner_applications",
  "merchant_applications",
  "mechant_applications",
  "partner_merchants",
];

function extractStoreName(record) {
  return String(
    record?.storeName || record?.store || record?.store_name || ""
  )
    .trim()
    .toLowerCase();
}

function shouldKeep(record) {
  return extractStoreName(record) === KEEP_STORE_NAME;
}

async function main() {
  initializeApp({
    credential: applicationDefault(),
    databaseURL: DATABASE_URL,
  });

  const db = getDatabase();
  const rootRef = db.ref();

  const updates = {};
  let totalFound = 0;
  let totalKept = 0;
  let totalDeleted = 0;

  for (const path of TARGET_PATHS) {
    const snap = await db.ref(path).get();
    if (!snap.exists()) {
      console.log(`- ${path}: no records`);
      continue;
    }

    const rows = snap.val() || {};
    const ids = Object.keys(rows);
    totalFound += ids.length;

    let kept = 0;
    let deleted = 0;

    for (const id of ids) {
      const record = rows[id] || {};
      if (shouldKeep(record)) {
        kept += 1;
        continue;
      }
      updates[`${path}/${id}`] = null;
      deleted += 1;
    }

    totalKept += kept;
    totalDeleted += deleted;

    console.log(`- ${path}: found=${ids.length}, keep=${kept}, delete=${deleted}`);
  }

  if (totalDeleted === 0) {
    console.log("Nothing to delete.");
    process.exit(0);
  }

  await rootRef.update(updates);

  console.log("\nDone.");
  console.log(`Total found:   ${totalFound}`);
  console.log(`Total kept:    ${totalKept}`);
  console.log(`Total deleted: ${totalDeleted}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

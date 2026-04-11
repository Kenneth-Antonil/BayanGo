#!/usr/bin/env node
/**
 * One-time script: Delete sample/test orders from Firebase RTDB.
 *
 * Removes orders whose customer name matches:
 *   - Kenneth Antonil
 *   - Shiela Gallos
 *   - Shiela
 *   - Sample
 *
 * Usage:
 *   cd functions
 *   GOOGLE_APPLICATION_CREDENTIALS=path/to/serviceAccountKey.json node scripts/delete-sample-orders.js
 *
 * Or if you have the Firebase CLI authenticated:
 *   npx firebase-tools login
 *   node scripts/delete-sample-orders.js
 */

const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");

const DATABASE_URL =
  "https://bayango-315c6-default-rtdb.asia-southeast1.firebasedatabase.app";

// Customer names to remove (case-insensitive match)
const SAMPLE_NAMES = [
  "kenneth antonil",
  "shiela gallos",
  "shiela",
  "sample",
];

function isSampleOrder(order) {
  const name = String(order?.customer?.name || "").trim().toLowerCase();
  return SAMPLE_NAMES.some((s) => name === s);
}

async function main() {
  initializeApp({
    credential: applicationDefault(),
    databaseURL: DATABASE_URL,
  });

  const db = getDatabase();
  const ordersRef = db.ref("orders");

  console.log("Fetching all orders...");
  const snapshot = await ordersRef.get();

  if (!snapshot.exists()) {
    console.log("No orders found in database.");
    process.exit(0);
  }

  const allOrders = snapshot.val();
  const toDelete = [];

  for (const [orderId, order] of Object.entries(allOrders)) {
    if (isSampleOrder(order)) {
      toDelete.push({
        orderId,
        customerName: order?.customer?.name || "(no name)",
        status: order?.status || "(no status)",
        createdAt: order?.createdAt
          ? new Date(order.createdAt).toISOString()
          : "(no date)",
      });
    }
  }

  if (toDelete.length === 0) {
    console.log("No sample orders found. Nothing to delete.");
    process.exit(0);
  }

  console.log(`\nFound ${toDelete.length} sample order(s) to delete:\n`);
  for (const o of toDelete) {
    console.log(
      `  - ${o.orderId}  |  ${o.customerName}  |  ${o.status}  |  ${o.createdAt}`
    );
  }

  // Build a single multi-path update to delete all at once
  const updates = {};
  for (const o of toDelete) {
    updates[o.orderId] = null; // setting to null deletes the node
  }

  console.log("\nDeleting...");
  await ordersRef.update(updates);
  console.log(`Done. ${toDelete.length} sample order(s) deleted.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

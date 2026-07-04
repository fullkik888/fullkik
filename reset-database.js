#!/usr/bin/env node
/**
 * FULLKIK — Nuclear database reset.
 *
 * Deletes ALL documents from: users, songs, orders, transactions, otp_logs,
 * pending_orders. A full fresh start. (Notifications live INSIDE user docs, so
 * they go automatically when users are deleted.) Keeps only settings/global —
 * your site config, top-up packages, payment methods, coupons.
 *
 * It needs the SAME credential the live server uses:
 *   FIREBASE_SERVICE_ACCOUNT_JSON = <the service-account JSON string>
 * (Copy it from your Render service's Environment tab.)
 *
 * DRY RUN (counts only, deletes NOTHING — always run this first):
 *   FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}' node reset-database.js
 *
 * REAL DELETE (must pass --yes):
 *   FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}' node reset-database.js --yes
 */
const admin = require('firebase-admin');

const COLLECTIONS = ['users', 'songs', 'orders', 'transactions', 'otp_logs', 'pending_orders'];
const CONFIRM = process.argv.includes('--yes');

if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    console.error('❌ Missing FIREBASE_SERVICE_ACCOUNT_JSON env var. Set it to the live service-account JSON (from Render → Environment).');
    process.exit(1);
}

try {
    admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
    });
} catch (e) {
    console.error('❌ Could not read FIREBASE_SERVICE_ACCOUNT_JSON:', e.message);
    process.exit(1);
}
const db = admin.firestore();

async function deleteCollection(name) {
    const snap = await db.collection(name).get();
    if (snap.empty) { console.log(`   • ${name}: 0 documents`); return 0; }
    if (!CONFIRM) { console.log(`   • ${name}: ${snap.size} documents (DRY RUN — not deleted)`); return snap.size; }
    let deleted = 0, count = 0;
    let batch = db.batch();
    for (const doc of snap.docs) {
        batch.delete(doc.ref); count++; deleted++;
        if (count === 450) { await batch.commit(); batch = db.batch(); count = 0; } // Firestore batch cap is 500
    }
    if (count > 0) await batch.commit();
    console.log(`   • ${name}: deleted ${deleted} documents`);
    return deleted;
}

(async () => {
    console.log(CONFIRM
        ? '🧨 NUCLEAR RESET — this will permanently DELETE data.\n'
        : '🔎 DRY RUN — nothing will be deleted. Add --yes to actually delete.\n');
    let total = 0;
    for (const name of COLLECTIONS) {
        try { total += await deleteCollection(name); }
        catch (e) { console.error(`   ⚠️  ${name}: ${e.message}`); }
    }
    console.log(`\n${CONFIRM ? '✅ Done.' : 'ℹ️  Dry run complete.'} Total documents ${CONFIRM ? 'deleted' : 'found'}: ${total}`);
    console.log('Kept: settings/global (site config, packages, payment methods, coupons).');
    process.exit(0);
})();

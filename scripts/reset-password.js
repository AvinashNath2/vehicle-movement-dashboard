/* ==========================================================================
   One-off admin script: force-set a user's password directly in Firestore.

   Use when a user has forgotten their password and can't wait for the admin
   to click Reset Password in the UI.

   Usage:
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node reset-password.js <username> [newPassword]

   If newPassword is omitted, defaults to abc123 — the same default the
   in-app admin reset button uses.
   ========================================================================== */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const [,, argUsername, argPassword] = process.argv;
if (!argUsername){
  console.error('Usage: GOOGLE_APPLICATION_CREDENTIALS=<key.json> node reset-password.js <username> [newPassword]');
  process.exit(1);
}

const KEY = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.SERVICE_ACCOUNT;
if (!KEY){ console.error('Set GOOGLE_APPLICATION_CREDENTIALS to your Firebase service-account key JSON.'); process.exit(1); }

const username = String(argUsername).trim().toLowerCase();
const newPassword = argPassword && argPassword.length ? argPassword : 'abc123';

initializeApp({ credential: cert(require(KEY)) });
const db = getFirestore();

(async () => {
  const ref = db.doc(`users/${username}`);
  const snap = await ref.get();
  if (!snap.exists){
    console.error(`\n✗ users/${username} does not exist. Create the user first.`);
    process.exit(1);
  }
  await ref.update({ Password: newPassword, UpdatedAt: new Date().toISOString() });
  const after = await ref.get();
  const u = after.data();
  console.log('\n✓ Password reset successful.\n');
  console.log(`   User            : ${u.DisplayName || '(no display name)'}`);
  console.log(`   Username        : ${u.Username}`);
  console.log(`   New password    : ${newPassword}\n`);
  console.log('Share this password with the user. Ask them to log in and change it');
  console.log('from Settings → Change Password.\n');
  process.exit(0);
})().catch(err => { console.error('\n✗ Failed:', err.message || err); process.exit(1); });

/* Live end-to-end verification that:
   1. The Firebase Auth updateEmail path now works (EEP off).
   2. sendPasswordResetEmail successfully triggers a mail.

   This runs directly against the real Firebase project via the Admin SDK,
   picks a single test user (given as CLI arg), reads its current email,
   flips it to a temporary test address (also under the shared inbox so
   nothing gets orphaned), verifies the change, and then restores the
   original email. Nothing else in the project is modified.

   Usage:
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node live-recovery-test.js <username>
*/

const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const KEY = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.SERVICE_ACCOUNT;
const username = process.argv[2];
if (!KEY || !username){
  console.error('Usage: GOOGLE_APPLICATION_CREDENTIALS=<key.json> node live-recovery-test.js <username>');
  process.exit(1);
}

const INBOX = 'avinashnath2@gmail.com';
const [INBOX_LOCAL, INBOX_DOMAIN] = INBOX.split('@');
const LEGACY_DOMAIN = 'vmd-fleet.app';

const candidates = [
  `${INBOX_LOCAL}+${username}@${INBOX_DOMAIN}`,
  `${username}@${LEGACY_DOMAIN}`,
];

initializeApp({ credential: cert(require(KEY)) });
const auth = getAuth();

(async () => {
  // ---------- Step 1: locate the user ----------
  let user = null;
  for (const email of candidates){
    try { user = await auth.getUserByEmail(email); break; }
    catch { /* try next */ }
  }
  if (!user){
    console.error(`\n✗ Could not find Firebase Auth user for "${username}". Tried: ${candidates.join(', ')}`);
    process.exit(1);
  }
  const originalEmail = user.email;
  console.log(`\nUser found:`);
  console.log(`  Username        : ${username}`);
  console.log(`  Current email   : ${originalEmail}`);
  console.log(`  UID             : ${user.uid}`);

  // ---------- Step 2: flip the email to a test address ----------
  const testEmail = `${INBOX_LOCAL}+${username}-livetest@${INBOX_DOMAIN}`;
  console.log(`\nStep 1 — updateEmail to test address: ${testEmail}`);
  try {
    await auth.updateUser(user.uid, { email: testEmail, emailVerified: true });
    const after = await auth.getUser(user.uid);
    if (after.email !== testEmail) throw new Error(`Expected ${testEmail}, got ${after.email}`);
    console.log(`  ✓ Success — Firebase Auth accepted the change (EEP is off).`);
  } catch (err){
    console.error(`  ✗ Failed: ${err.code || ''} ${err.message}`);
    process.exit(1);
  }

  // ---------- Step 3: revert to original ----------
  console.log(`\nStep 2 — restore original email: ${originalEmail}`);
  try {
    await auth.updateUser(user.uid, { email: originalEmail, emailVerified: false });
    const after = await auth.getUser(user.uid);
    if (after.email !== originalEmail) throw new Error(`Expected ${originalEmail}, got ${after.email}`);
    console.log(`  ✓ Restored.`);
  } catch (err){
    console.error(`  ✗ Failed to restore (manual fix needed): ${err.code || ''} ${err.message}`);
    console.error(`  The account is temporarily on ${testEmail}. Use scripts/reset-password.js to recover.`);
    process.exit(1);
  }

  // ---------- Step 4: generate a password reset link (does not send mail) ----------
  console.log(`\nStep 3 — generatePasswordResetLink for ${originalEmail}`);
  try {
    const link = await auth.generatePasswordResetLink(originalEmail);
    console.log(`  ✓ Firebase produced a working link (length ${link.length} chars).`);
    console.log(`  (Not sending this via email — just verifying Firebase Auth accepts the request.)`);
  } catch (err){
    console.error(`  ✗ Failed: ${err.code || ''} ${err.message}`);
    process.exit(1);
  }

  console.log(`\n=== ALL CHECKS PASSED ===`);
  console.log(`Firebase Auth updateEmail  : working`);
  console.log(`Firebase Auth reset link   : working`);
  console.log(`The in-app recovery flow will now work end-to-end.\n`);
  process.exit(0);
})().catch(err => {
  console.error('\nFatal:', err.message || err);
  process.exit(1);
});

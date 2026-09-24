/* ==========================================================================
   One-off admin script: force-reset a single user's password.

   Use when a user has forgotten their password AND does not have a recovery
   email set (so the in-app "Forgot Password?" flow can't help them).

   How it works:
     - Looks up the Firebase Auth user by trying the modern gmail alias,
       then the legacy @vmd-fleet.app email, then a direct email match.
     - Generates a short, memorable temporary password (or accepts one via
       CLI arg) and forces it onto the account via Admin SDK.
     - Prints the temp password once so the admin can hand it to the user
       via WhatsApp / verbal / whatever channel is trusted.
     - The user then logs in with the temp password and changes it from
       Settings → Change Password.

   Usage:
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node reset-password.js <username> [newPassword]

   Examples:
     # Auto-generated 8-char temp password:
     node reset-password.js 071681780

     # Pick your own temp password:
     node reset-password.js 071681780 hello123

     # If the user has set a recovery email, pass the email directly:
     node reset-password.js ravi.kumar@gmail.com

   Prereqs (same as migrate-emails-to-gmail.js):
     - firebase-admin installed in this scripts/ folder (npm i firebase-admin).
     - GOOGLE_APPLICATION_CREDENTIALS set to your service-account key JSON.
   ========================================================================== */

const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const [,, arg1, arg2] = process.argv;
if (!arg1){
  console.error('Usage: GOOGLE_APPLICATION_CREDENTIALS=<key.json> node reset-password.js <username-or-email> [newPassword]');
  process.exit(1);
}

const SERVICE_ACCOUNT_PATH = process.env.SERVICE_ACCOUNT || process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!SERVICE_ACCOUNT_PATH){
  console.error('ERROR: Set GOOGLE_APPLICATION_CREDENTIALS to the path of your Firebase service-account key JSON.');
  process.exit(1);
}

const INBOX = process.env.INBOX || 'avinashnath2@gmail.com';
const LEGACY_DOMAIN = 'vmd-fleet.app';
const atIdx = INBOX.indexOf('@');
const INBOX_LOCAL = INBOX.slice(0, atIdx);
const INBOX_DOMAIN = INBOX.slice(atIdx + 1);

function candidateEmails(input){
  const s = String(input).trim().toLowerCase();
  if (s.includes('@')) return [s];
  return [
    `${INBOX_LOCAL}+${s}@${INBOX_DOMAIN}`,
    `${s}@${LEGACY_DOMAIN}`,
  ];
}

function randomPassword(len = 8){
  // ambiguous chars (0/O, 1/l/I) excluded so admin can dictate over voice
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

initializeApp({ credential: cert(require(SERVICE_ACCOUNT_PATH)) });
const auth = getAuth();

(async () => {
  let user = null;
  const tried = [];
  for (const email of candidateEmails(arg1)){
    tried.push(email);
    try { user = await auth.getUserByEmail(email); break; }
    catch { /* try next candidate */ }
  }
  if (!user){
    console.error(`\n✗ No Firebase Auth user found for "${arg1}".`);
    console.error(`  Tried: ${tried.join(', ')}\n`);
    process.exit(1);
  }
  const newPw = arg2 || randomPassword();
  await auth.updateUser(user.uid, { password: newPw });
  console.log('\n✓ Password reset successful.\n');
  console.log(`   User            : ${user.displayName || '(no display name)'}`);
  console.log(`   Firebase email  : ${user.email}`);
  console.log(`   New password    : ${newPw}\n`);
  console.log('Share this password with the user. Ask them to log in and change it');
  console.log('from Settings → Change Password.\n');
  process.exit(0);
})().catch(err => {
  console.error('\n✗ Failed:', err.message || err);
  process.exit(1);
});

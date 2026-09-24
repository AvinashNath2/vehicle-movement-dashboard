/* ==========================================================================
   One-time migration: rewrite every Firebase Auth user's email to the
   Gmail plus-alias routing so admin-triggered password reset links can
   actually be delivered.

   Current state (legacy): each user's Firebase Auth email is
     <username>@vmd-fleet.app        (fake domain, mail goes nowhere)

   Target state: every user is stored as
     avinashnath2+<username>@gmail.com   (all mail lands in one real inbox)

   Why Admin SDK and not the app:
     - Firebase's Email Enumeration Protection blocks the client-side
       updateEmail() flow unless the new address is verified first, so the
       silent migration during login never actually takes effect.
     - Admin SDK bypasses all such restrictions — no password required,
       no verification required — and can update any user directly.

   Prereqs:
     1. Firebase Console → Project settings → Service accounts →
        "Generate new private key" → downloads a JSON file.
     2. Save that file somewhere OUTSIDE this repo and set:
          export GOOGLE_APPLICATION_CREDENTIALS="/absolute/path/to/key.json"
        (Or pass it via SERVICE_ACCOUNT env var — see below.)
     3. npm i firebase-admin   (only needed once)

   Usage:
     # Preview what would change without touching anything:
     node migrate-emails-to-gmail.js --dry-run

     # Actually perform the migration:
     node migrate-emails-to-gmail.js

     # Point at a specific service-account key file:
     SERVICE_ACCOUNT=/path/to/key.json node migrate-emails-to-gmail.js

     # Route to a different inbox (default is avinashnath2@gmail.com):
     INBOX=someone.else@gmail.com node migrate-emails-to-gmail.js

   Safety:
     - Idempotent: only touches users whose email still matches the legacy
       "@vmd-fleet.app" pattern. Rerunning is a no-op.
     - Passwords are not changed. Users keep signing in with the same
       password they use today; only the stored email flips.
     - The Firestore "users" collection is not touched (docs are keyed by
       username, not by email).
   ========================================================================== */

const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const LEGACY_DOMAIN = 'vmd-fleet.app';
const INBOX = process.env.INBOX || 'avinashnath2@gmail.com';
const DRY_RUN = process.argv.includes('--dry-run');
const SERVICE_ACCOUNT_PATH = process.env.SERVICE_ACCOUNT || process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!SERVICE_ACCOUNT_PATH){
  console.error('ERROR: Set GOOGLE_APPLICATION_CREDENTIALS or SERVICE_ACCOUNT to the path of your Firebase service-account key JSON.');
  process.exit(1);
}

const atIdx = INBOX.indexOf('@');
if (atIdx < 1){
  console.error(`ERROR: INBOX "${INBOX}" is not a valid email address.`);
  process.exit(1);
}
const INBOX_LOCAL = INBOX.slice(0, atIdx);
const INBOX_DOMAIN = INBOX.slice(atIdx + 1);

function aliasFor(username){
  return `${INBOX_LOCAL}+${String(username).trim().toLowerCase()}@${INBOX_DOMAIN}`;
}

const app = initializeApp({ credential: cert(require(SERVICE_ACCOUNT_PATH)) });
const auth = getAuth(app);

(async () => {
  console.log(`\n=== Firebase Auth email migration ===`);
  console.log(`Legacy domain     : @${LEGACY_DOMAIN}`);
  console.log(`Target inbox      : ${INBOX}`);
  console.log(`Mode              : ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE (writes to Firebase)'}\n`);

  let totalUsers = 0;
  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  let pageToken;

  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const u of page.users){
      totalUsers++;
      const email = u.email || '';
      const legacyRe = new RegExp(`^(.+)@${LEGACY_DOMAIN.replace(/\./g, '\\.')}$`, 'i');
      const m = email.match(legacyRe);
      if (!m){
        skipped++;
        continue;
      }
      const username = m[1];
      const newEmail = aliasFor(username);
      if (email.toLowerCase() === newEmail.toLowerCase()){
        skipped++;
        continue;
      }
      if (DRY_RUN){
        console.log(`  would migrate  ${email}  →  ${newEmail}`);
        migrated++;
        continue;
      }
      try {
        await auth.updateUser(u.uid, { email: newEmail, emailVerified: true });
        console.log(`  ✓ migrated     ${email}  →  ${newEmail}`);
        migrated++;
      } catch (err){
        console.error(`  ✗ failed       ${email}  →  ${newEmail}    (${err.code || err.message})`);
        failed++;
      }
    }
    pageToken = page.pageToken;
  } while (pageToken);

  console.log(`\n=== Summary ===`);
  console.log(`Total users scanned : ${totalUsers}`);
  console.log(`Migrated            : ${migrated}${DRY_RUN ? ' (would migrate)' : ''}`);
  console.log(`Skipped             : ${skipped}   (already migrated or unrelated email)`);
  console.log(`Failed              : ${failed}`);
  if (DRY_RUN){
    console.log(`\nRe-run without --dry-run to perform the migration.`);
  }
  process.exit(failed ? 1 : 0);
})().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

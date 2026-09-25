/* ==========================================================================
   One-off migration: populate the /usernameLookup Firestore collection with
   { authEmail } for every existing Firebase Auth user, so the login flow can
   translate a Force No. into the right auth email before signing in.

   Why we need this:
     - Once a user sets a recovery email, their Firebase Auth email flips to
       that address. The client-side login form only has the Force No. that
       the user types, and Firestore rules require auth before it can read
       the users collection — so the app needs a public lookup collection to
       find the auth email.
     - Without a seeded lookup, existing users would have to rely on the
       fallback chain (plus-alias → legacy @vmd-fleet.app) that already
       silently fails for anyone who's set a recovery email. See the
       `071681780` case observed in production.

   Behaviour:
     - Iterates every Firebase Auth user via Admin SDK (paginated).
     - Derives the Force No. from the auth email:
         <forceno>@vmd-fleet.app              → forceno
         avinashnath2+<forceno>@gmail.com     → forceno
         anything else                        → look up Firestore users where
                                                RecoveryEmail matches this
                                                Firebase email.
     - Writes /usernameLookup/<forceno> = { authEmail, updatedAt } with merge.
     - Idempotent — re-runs are safe.

   Usage:
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node migrate-lookup.js [--dry-run]
   ========================================================================== */

const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const KEY = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.SERVICE_ACCOUNT;
if (!KEY){ console.error('ERROR: Set GOOGLE_APPLICATION_CREDENTIALS to your Firebase service-account key JSON.'); process.exit(1); }

const DRY_RUN = process.argv.includes('--dry-run');
const INBOX = process.env.INBOX || 'avinashnath2@gmail.com';
const LEGACY_DOMAIN = 'vmd-fleet.app';
const [INBOX_LOCAL, INBOX_DOMAIN] = INBOX.split('@');

function deriveForceNo(email){
  const s = String(email || '').trim().toLowerCase();
  if (!s.includes('@')) return null;
  const [local, domain] = s.split('@');
  if (domain === LEGACY_DOMAIN) return local;
  if (domain === INBOX_DOMAIN && local.startsWith(INBOX_LOCAL + '+')){
    return local.slice(INBOX_LOCAL.length + 1);
  }
  return null;   // real recovery email — resolve via Firestore below
}

initializeApp({ credential: cert(require(KEY)) });
const auth = getAuth();
const db = getFirestore();

(async () => {
  console.log(`\n=== Populating /usernameLookup ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);

  // Preload all users docs once so we can look up by RecoveryEmail without a
  // roundtrip per Firebase Auth user.
  const usersSnap = await db.collection('users').get();
  const byRecoveryEmail = new Map();
  usersSnap.docs.forEach(d => {
    const data = d.data();
    if (data.RecoveryEmail){
      byRecoveryEmail.set(String(data.RecoveryEmail).toLowerCase(), d.id);
    }
  });

  let total = 0, written = 0, skipped = 0, unresolved = 0;
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const u of page.users){
      total++;
      const email = String(u.email || '').toLowerCase();
      if (!email) { skipped++; continue; }
      let forceNo = deriveForceNo(email);
      if (!forceNo){
        forceNo = byRecoveryEmail.get(email);
      }
      if (!forceNo){
        console.log(`  ✗ unresolved  ${email}   (no forceNo derivable)`);
        unresolved++;
        continue;
      }
      if (DRY_RUN){
        console.log(`  would write   usernameLookup/${forceNo}  →  { authEmail: ${email} }`);
        written++;
        continue;
      }
      try {
        await db.doc(`usernameLookup/${forceNo}`).set({
          authEmail: email,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
        console.log(`  ✓ wrote       usernameLookup/${forceNo}  →  ${email}`);
        written++;
      } catch (err){
        console.error(`  ✗ failed      usernameLookup/${forceNo}: ${err.code || err.message}`);
      }
    }
    pageToken = page.pageToken;
  } while (pageToken);

  console.log(`\n=== Summary ===`);
  console.log(`Total Firebase Auth users : ${total}`);
  console.log(`Lookup entries written    : ${written}${DRY_RUN ? ' (would write)' : ''}`);
  console.log(`Skipped (empty email)     : ${skipped}`);
  console.log(`Unresolved (no forceNo)   : ${unresolved}`);
  if (DRY_RUN) console.log(`\nRe-run without --dry-run to persist.`);
  process.exit(0);
})().catch(err => { console.error('\nFatal:', err); process.exit(1); });

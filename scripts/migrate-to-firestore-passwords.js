/* ==========================================================================
   One-off migration: prepare the project for the Firestore-only login model.

   Steps (all idempotent — safe to re-run):
     1. Give every users/<forceNo> doc a Password field. `admin` gets
        `admin123`; everyone else gets the well-known default `abc123` that
        admin can reset back to with one click. Any doc that already has a
        Password is left alone unless --overwrite is passed.
     2. Remove the RecoveryEmail field from every users doc via FieldValue
        .delete() — the field is no longer part of the schema.
     3. Delete every document in the usernameLookup collection — the
        collection is retired.
     4. Optional (--delete-auth): delete every Firebase Auth user, since
        Auth is no longer part of the login path.

   Usage:
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node migrate-to-firestore-passwords.js [--dry-run] [--overwrite] [--delete-auth]

   Flags:
     --dry-run      Show what would change without touching Firestore/Auth.
     --overwrite    Also stamp the default password on users who already
                    have a Password field (only useful for full reseeding).
     --delete-auth  Housekeeping: delete every Firebase Auth account.
                    Skips otherwise — safer default.
   ========================================================================== */

const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const KEY = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.SERVICE_ACCOUNT;
if (!KEY){ console.error('ERROR: Set GOOGLE_APPLICATION_CREDENTIALS to your Firebase service-account key JSON.'); process.exit(1); }

const DRY_RUN = process.argv.includes('--dry-run');
const OVERWRITE = process.argv.includes('--overwrite');
const DELETE_AUTH = process.argv.includes('--delete-auth');

const DEFAULT_ADMIN_PASSWORD = 'admin123';
const DEFAULT_USER_PASSWORD = 'abc123';

initializeApp({ credential: cert(require(KEY)) });
const db = getFirestore();
const auth = getAuth();

async function seedPasswords(){
  console.log('\n=== Step 1: seed Password field on users/<forceNo> ===');
  const snap = await db.collection('users').get();
  let stamped = 0, skipped = 0, cleared = 0;
  for (const d of snap.docs){
    const data = d.data();
    const desired = d.id === 'admin' ? DEFAULT_ADMIN_PASSWORD : DEFAULT_USER_PASSWORD;
    const hasPw = typeof data.Password === 'string' && data.Password.length > 0;
    const patch = { UpdatedAt: new Date().toISOString() };
    if (!hasPw || OVERWRITE){
      patch.Password = desired;
    } else {
      skipped++;
    }
    if ('RecoveryEmail' in data){
      patch.RecoveryEmail = FieldValue.delete();
      cleared++;
    }
    if (Object.keys(patch).length === 1) continue;   // only UpdatedAt — nothing meaningful
    if (DRY_RUN){
      console.log(`  would patch  users/${d.id}  →`, Object.keys(patch).filter(k => k !== 'UpdatedAt'));
    } else {
      await d.ref.update(patch);
      console.log(`  ✓ patched    users/${d.id}  →`, Object.keys(patch).filter(k => k !== 'UpdatedAt'));
    }
    if (patch.Password) stamped++;
  }
  console.log(`  Stamped Password on ${stamped} user(s). Skipped ${skipped} that already had one. Cleared RecoveryEmail on ${cleared}.`);
}

async function dropUsernameLookup(){
  console.log('\n=== Step 2: delete /usernameLookup collection ===');
  const snap = await db.collection('usernameLookup').get();
  console.log(`  Found ${snap.size} lookup doc(s).`);
  for (const d of snap.docs){
    if (DRY_RUN){
      console.log(`  would delete  usernameLookup/${d.id}`);
    } else {
      await d.ref.delete();
      console.log(`  ✓ deleted     usernameLookup/${d.id}`);
    }
  }
}

async function deleteAuthAccounts(){
  console.log('\n=== Step 3 (optional): delete every Firebase Auth account ===');
  if (!DELETE_AUTH){
    console.log('  Skipped — pass --delete-auth to enable.');
    return;
  }
  let pageToken;
  let deleted = 0;
  do {
    const p = await auth.listUsers(1000, pageToken);
    const uids = p.users.map(u => u.uid);
    if (DRY_RUN){
      uids.forEach(uid => console.log('  would delete uid', uid));
      deleted += uids.length;
    } else {
      const res = await auth.deleteUsers(uids);
      deleted += res.successCount;
      if (res.failureCount){
        console.warn(`  ${res.failureCount} deletion(s) failed:`, res.errors.slice(0,3));
      }
    }
    pageToken = p.pageToken;
  } while (pageToken);
  console.log(`  ${DRY_RUN ? 'Would delete' : 'Deleted'} ${deleted} Firebase Auth account(s).`);
}

(async () => {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}${OVERWRITE ? ' (overwrite existing passwords)' : ''}${DELETE_AUTH ? ' (will delete Auth accounts)' : ''}`);
  await seedPasswords();
  await dropUsernameLookup();
  await deleteAuthAccounts();
  console.log('\nDone.');
  process.exit(0);
})().catch(err => { console.error('\nFatal:', err); process.exit(1); });

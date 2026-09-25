/* Publishes the current firestore.rules file to the Firebase project using
   the Admin SDK Security Rules service. Equivalent to `firebase deploy --only
   firestore:rules` without needing the Firebase CLI installed.

   Usage:
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node deploy-rules.js
*/

const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getSecurityRules } = require('firebase-admin/security-rules');

const KEY = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.SERVICE_ACCOUNT;
if (!KEY){ console.error('ERROR: Set GOOGLE_APPLICATION_CREDENTIALS to your Firebase service-account key JSON.'); process.exit(1); }

const RULES_PATH = path.join(__dirname, '..', 'firestore.rules');
if (!fs.existsSync(RULES_PATH)){ console.error(`ERROR: ${RULES_PATH} does not exist.`); process.exit(1); }

initializeApp({ credential: cert(require(KEY)) });
const sr = getSecurityRules();

(async () => {
  const source = fs.readFileSync(RULES_PATH, 'utf8');
  console.log(`Publishing firestore.rules (${source.length} bytes)…`);
  const ruleset = await sr.releaseFirestoreRulesetFromSource(source);
  console.log(`\n✓ Published. Ruleset name: ${ruleset.name}, created: ${ruleset.createTime}`);
  process.exit(0);
})().catch(err => { console.error('\nFailed:', err.message || err); process.exit(1); });

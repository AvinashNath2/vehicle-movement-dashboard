/* ==========================================================================
   Toggle Firebase Auth's "Email Enumeration Protection" (EEP) on or off
   using the Admin SDK.

   EEP is Firebase's newer default that:
     - makes sendPasswordResetEmail silently succeed even for unknown emails
       (so admin-triggered resets look like they worked even when nothing
       was actually mailed);
     - blocks updateEmail (throws auth/operation-not-allowed), which stops
       users from setting a recovery email through the app.

   For this app we want it OFF, so real errors surface and updateEmail
   works. Turning it off is a one-time project-wide change.

   Usage:
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node toggle-eep.js status
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node toggle-eep.js off
     GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node toggle-eep.js on
   ========================================================================== */

const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const cmd = (process.argv[2] || 'status').toLowerCase();
if (!['status', 'off', 'on'].includes(cmd)){
  console.error('Usage: node toggle-eep.js [status|off|on]');
  process.exit(1);
}

const KEY = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.SERVICE_ACCOUNT;
if (!KEY){
  console.error('ERROR: Set GOOGLE_APPLICATION_CREDENTIALS to your Firebase service-account key JSON.');
  process.exit(1);
}

initializeApp({ credential: cert(require(KEY)) });
const mgr = getAuth().projectConfigManager();

(async () => {
  const before = await mgr.getProjectConfig();
  const currentlyOn = !!(before.emailPrivacyConfig && before.emailPrivacyConfig.enableImprovedEmailPrivacy);
  console.log(`\nEmail Enumeration Protection is currently: ${currentlyOn ? 'ON' : 'OFF'}`);

  if (cmd === 'status') { process.exit(0); }
  const desired = cmd === 'on';
  if (currentlyOn === desired){
    console.log(`No change needed — already ${desired ? 'ON' : 'OFF'}.`);
    process.exit(0);
  }
  await mgr.updateProjectConfig({ emailPrivacyConfig: { enableImprovedEmailPrivacy: desired } });
  const after = await mgr.getProjectConfig();
  const nowOn = !!(after.emailPrivacyConfig && after.emailPrivacyConfig.enableImprovedEmailPrivacy);
  console.log(`\n✓ Updated. Email Enumeration Protection is now: ${nowOn ? 'ON' : 'OFF'}`);
  process.exit(0);
})().catch(err => {
  console.error('\nFailed:', err.message || err);
  process.exit(1);
});

/* ==========================================================================
   One-time migration: replace the sample register with the unit's real fleet.

   - Backs up all current Firestore data to a local JSON file first.
   - Deletes ALL vehicles, movements and audit entries.
   - Keeps exactly one Admin user ("admin"); removes every other user
     (including the demo "operator" Firebase Auth account, if its password
     is the default).
   - Creates one Operator account per driver from the drivers list:
     username = Force No, password = abc123.
   - Loads all vehicles from the Appendix-A file.

   Usage:
     ADMIN_PW=… OPERATOR_PW=… node migrate-real-fleet.js "<drivers.xlsx>" "<vehicles.xlsx>"

   Env (required): ADMIN_PW, OPERATOR_PW (the password every new operator
   account gets). Optional: ADMIN_USER (default "admin"), DEMO_OPERATOR_PW
   (only needed to delete the old demo "operator" Auth account).

   Requires: npm i firebase xlsx  (script data source files are NOT part of
   the repo — they contain personnel details and must stay private).
   ========================================================================== */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { initializeApp } = require('firebase/app');
const { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, deleteUser, signOut } = require('firebase/auth');
const { getFirestore, collection, getDocs, doc, writeBatch } = require('firebase/firestore');

const EMAIL_DOMAIN = 'vmd-fleet.app';
const firebaseConfig = {
  apiKey: 'AIzaSyBTfvFaYj3__Bzv5NfKuFlwBagtNlHc5RM',
  authDomain: 'vehicle-dashboard-admin.firebaseapp.com',
  projectId: 'vehicle-dashboard-admin',
};

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PW = process.env.ADMIN_PW;
const OPERATOR_PW = process.env.OPERATOR_PW;
const DEMO_OPERATOR_PW = process.env.DEMO_OPERATOR_PW; // optional: delete old demo account

const [driversPath, vehiclesPath] = process.argv.slice(2);
if (!driversPath || !vehiclesPath || !ADMIN_PW || !OPERATOR_PW){
  console.error('Usage: ADMIN_PW=… OPERATOR_PW=… node migrate-real-fleet.js "<drivers.xlsx>" "<vehicles.xlsx>"');
  console.error('Passwords are passed via environment variables and never committed.');
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const emailFor = u => String(u).trim().toLowerCase() + '@' + EMAIL_DOMAIN;
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const todayISO = () => new Date().toISOString().slice(0, 10);

function parseDrivers(file){
  const wb = XLSX.readFile(file);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
  const headerIdx = rows.findIndex(r => r.some(c => /force\s*no/i.test(String(c))));
  if (headerIdx === -1) throw new Error('No "Force No" header found in drivers file');
  const drivers = [];
  const seen = new Set();
  for (const r of rows.slice(headerIdx + 1)){
    const forceNo = clean(r[1]);
    const rank = clean(r[2]);
    const name = clean(r[3]);
    if (!/^\d{5,}$/.test(forceNo) || !name) continue;
    if (seen.has(forceNo)){ console.warn('  ! duplicate Force No skipped:', forceNo, name); continue; }
    seen.add(forceNo);
    drivers.push({ Username: forceNo, DisplayName: name, Rank: rank, Role: 'Operator', Active: 'Yes' });
  }
  return drivers;
}

function parseVehicles(file){
  const wb = XLSX.readFile(file);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
  const vehicles = [];
  const seen = new Set();
  let category = '';
  for (const r of rows){
    const cells = r.map(clean);
    const line = cells.filter(Boolean).join(' ');
    if (/^SUMMARY$/i.test(line)) break;
    const reg = cells[2].toUpperCase().replace(/\s/g, '');
    const isReg = /^[A-Z]{2}-?\d{1,2}[A-Z]{0,3}-\d{3,4}$/.test(reg);
    if (!isReg){
      // section headers ("52 SEATER BUS", "PICKUP VAN", …) are rows with a
      // single non-empty cell that isn't the title/column/AUTH-count row
      const nonEmpty = cells.filter(Boolean);
      if (nonEmpty.length === 1 && !/AUTH-|REGD NO|FULL DETAILS/i.test(nonEmpty[0])) category = nonEmpty[0];
      continue;
    }
    if (seen.has(reg)){ console.warn('  ! duplicate registration skipped:', reg); continue; }
    seen.add(reg);
    vehicles.push({
      RegistrationNo: reg,
      VehicleType: clean(cells[3]) || category || 'Unspecified',
      Category: category,
      Status: 'Active',
      AddedOn: todayISO(),
      AddedBy: ADMIN_USER,
    });
  }
  return vehicles;
}

async function commitInChunks(db, ops){
  for (let i = 0; i < ops.length; i += 450){
    const batch = writeBatch(db);
    ops.slice(i, i + 450).forEach(op => op(batch));
    await batch.commit();
  }
}

async function createAuthUser(auth, email, pw){
  for (let attempt = 1; attempt <= 5; attempt++){
    try {
      await createUserWithEmailAndPassword(auth, email, pw);
      return 'created';
    } catch (e){
      if (e.code === 'auth/email-already-in-use') return 'exists';
      if (e.code === 'auth/too-many-requests'){ await sleep(3000 * attempt); continue; }
      throw e;
    }
  }
  throw new Error('rate-limited creating ' + email);
}

(async () => {
  const drivers = parseDrivers(driversPath);
  const vehicles = parseVehicles(vehiclesPath);
  console.log(`Parsed ${drivers.length} drivers and ${vehicles.length} vehicles.`);

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  // ---- 1. full backup of current data --------------------------------
  await signInWithEmailAndPassword(auth, emailFor(ADMIN_USER), ADMIN_PW);
  const backup = {};
  const existing = {};
  for (const name of ['vehicles', 'users', 'movements', 'auditLog']){
    const snap = await getDocs(collection(db, name));
    backup[name] = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
    existing[name] = snap.docs.map(d => d.id);
  }
  const backupFile = path.join(process.env.HOME || '.', `vmd-backup-pre-migration-${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 1));
  console.log(`Backup written: ${backupFile} (${existing.vehicles.length} vehicles, ${existing.movements.length} movements, ${existing.users.length} users, ${existing.auditLog.length} audit rows)`);

  // ---- 2. delete the demo operator's Auth account --------------------
  if (DEMO_OPERATOR_PW){
    try {
      await signInWithEmailAndPassword(auth, emailFor('operator'), DEMO_OPERATOR_PW);
      await deleteUser(auth.currentUser);
      console.log('Demo "operator" Auth account deleted.');
    } catch (e){
      console.warn('Could not delete demo operator Auth account (' + (e.code || e.message) + ') — its profile doc will still be removed, which blocks login.');
    }
  }

  // ---- 3. create operator Auth accounts ------------------------------
  let created = 0, existed = 0;
  for (const d of drivers){
    const res = await createAuthUser(auth, emailFor(d.Username), OPERATOR_PW);
    res === 'created' ? created++ : existed++;
    await sleep(250);
  }
  console.log(`Auth accounts: ${created} created, ${existed} already existed.`);

  // ---- 4. rewrite Firestore ------------------------------------------
  await signOut(auth);
  await signInWithEmailAndPassword(auth, emailFor(ADMIN_USER), ADMIN_PW);
  const ops = [];
  existing.vehicles.forEach(id => ops.push(b => b.delete(doc(db, 'vehicles', id))));
  existing.movements.forEach(id => ops.push(b => b.delete(doc(db, 'movements', id))));
  existing.auditLog.forEach(id => ops.push(b => b.delete(doc(db, 'auditLog', id))));
  existing.users.filter(id => id !== ADMIN_USER).forEach(id => ops.push(b => b.delete(doc(db, 'users', id))));
  drivers.forEach(d => ops.push(b => b.set(doc(db, 'users', d.Username), d)));
  vehicles.forEach(v => ops.push(b => b.set(doc(db, 'vehicles', v.RegistrationNo), v)));
  ops.push(b => b.set(doc(db, 'auditLog', 'AUD-MIGRATION-' + Date.now()), {
    ID: 'AUD-MIGRATION-' + Date.now(),
    Timestamp: new Date().toISOString(),
    User: ADMIN_USER,
    Action: 'Created',
    RecordType: 'System',
    RecordId: '-',
    Details: `Migration: loaded real fleet (${vehicles.length} vehicles, ${drivers.length} operator accounts); previous sample data removed`,
  }));
  await commitInChunks(db, ops);

  console.log(`Done. Firestore now has ${vehicles.length} vehicles, ${drivers.length} operators + 1 admin, 0 movements.`);
  console.log('Every operator logs in with their Force No and password "abc123".');
  process.exit(0);
})().catch(e => { console.error('MIGRATION FAILED:', e.code || '', e.message); process.exit(1); });

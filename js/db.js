/* ==========================================================================
   Data layer — Cloud Firestore.

   All records live in Firestore collections (vehicles, users, movements,
   auditLog) shared by every visitor. Live snapshot listeners keep the
   in-memory arrays below up to date, so page renderers can keep reading
   DB.vehicles / DB.movements synchronously exactly like before.

   Mutations update the local array immediately (so the UI can re-render
   right away) and write through to Firestore in the background; a failed
   write surfaces as an error toast.

   User credentials live in Firebase Authentication (usernames are mapped to
   synthetic emails via emailFor()) — the users collection only holds
   profile data (DisplayName, Role, Active), never passwords.

   data/vehicle-register.xlsx remains as the seed/reset baseline and the
   import/export format.
   ========================================================================== */

const BASELINE_URL = 'data/vehicle-register.xlsx';
const EMAIL_DOMAIN = 'vmd-fleet.app';

// Older docs/backups predate the Status field — derive it so nothing needs
// a migration: a recorded closing KM means the trip is finished.
function normalizeMovement(m){
  return { ...m, Status: m.Status || (Number(m.ClosingKM) > 0 ? 'Completed' : 'In Progress') };
}

const DB = {
  vehicles: [],
  users: [],
  movements: [],
  auditLog: [],
  meta: { source: 'Cloud Firestore (live)', loadedAt: '' },

  _unsubs: [],
  _ready: false,
  onRemoteChange: null, // set by main.js

  emailFor(username){
    return String(username || '').trim().toLowerCase() + '@' + EMAIL_DOMAIN;
  },

  /* ---------------- live subscriptions ---------------- */
  async init(){
    if (!window.FB) throw new Error('Firebase SDK did not load — check your internet connection.');
    if (this._unsubs.length) return; // already subscribed

    const { db, collection, onSnapshot } = FB;
    const subscribe = (name, assign) => new Promise((resolve, reject) => {
      let first = true;
      const unsub = onSnapshot(collection(db, name), (snap) => {
        assign(snap.docs.map(d => d.data()));
        this.meta.loadedAt = new Date().toISOString();
        if (first){ first = false; resolve(); }
        else if (this._ready && !snap.metadata.hasPendingWrites && typeof this.onRemoteChange === 'function'){
          this.onRemoteChange();
        }
      }, (err) => {
        if (first){ first = false; reject(err); }
        else console.error(`Snapshot listener for "${name}" failed:`, err);
      });
      this._unsubs.push(unsub);
    });

    const desc = (field) => (a, b) => String(b[field]).localeCompare(String(a[field]));
    await Promise.all([
      subscribe('vehicles',  rows => this.vehicles  = rows.sort(desc('AddedOn'))),
      subscribe('users',     rows => this.users     = rows),
      subscribe('movements', rows => this.movements = rows.map(normalizeMovement).sort(desc('CreatedAt'))),
      subscribe('auditLog',  rows => this.auditLog  = rows.sort(desc('Timestamp'))),
    ]);
    this._ready = true;
  },

  teardown(){
    this._unsubs.forEach(u => { try { u(); } catch(e){} });
    this._unsubs = [];
    this._ready = false;
    this.vehicles = []; this.users = []; this.movements = []; this.auditLog = [];
  },

  _write(promise){
    promise.catch(err => {
      console.error('Firestore write failed:', err);
      toast('error', 'Cloud sync failed', 'Your last change may not be saved. ' + (err.message || ''));
    });
  },

  /* ---------------- vehicles ---------------- */
  findVehicle(regNo){
    const key = String(regNo || '').trim().toUpperCase();
    return this.vehicles.find(v => v.RegistrationNo === key);
  },
  isDuplicateReg(regNo, excludeReg){
    const key = String(regNo || '').trim().toUpperCase();
    return this.vehicles.some(v => v.RegistrationNo === key && v.RegistrationNo !== excludeReg);
  },
  addVehicle({ RegistrationNo, VehicleType }, user){
    const reg = String(RegistrationNo).trim().toUpperCase();
    const v = { RegistrationNo: reg, VehicleType: VehicleType.trim(), Status: 'Active', AddedOn: todayISO(), AddedBy: user.Username };
    this.vehicles.unshift(v);
    this._write(FB.setDoc(FB.doc(FB.db, 'vehicles', reg), v));
    this.logAudit(user, 'Created', 'Vehicle', reg, `Vehicle added (${v.VehicleType})`);
    return v;
  },
  updateVehicle(regNo, patch, user){
    const v = this.findVehicle(regNo);
    if (!v) return null;
    const oldReg = v.RegistrationNo;
    const changes = [];
    if (patch.VehicleType && patch.VehicleType.trim() !== v.VehicleType){
      changes.push(`Type: "${v.VehicleType}" → "${patch.VehicleType.trim()}"`);
      v.VehicleType = patch.VehicleType.trim();
    }
    let renamed = false;
    if (patch.RegistrationNo){
      const newReg = patch.RegistrationNo.trim().toUpperCase();
      if (newReg !== v.RegistrationNo){
        changes.push(`Reg. No: "${v.RegistrationNo}" → "${newReg}"`);
        this.movements.forEach(m => { if (m.RegistrationNo === oldReg) m.RegistrationNo = newReg; });
        v.RegistrationNo = newReg;
        renamed = true;
      }
    }
    if (changes.length){
      const batch = FB.writeBatch(FB.db);
      if (renamed) batch.delete(FB.doc(FB.db, 'vehicles', oldReg));
      batch.set(FB.doc(FB.db, 'vehicles', v.RegistrationNo), { ...v });
      if (renamed){
        this.movements.filter(m => m.RegistrationNo === v.RegistrationNo)
          .forEach(m => batch.update(FB.doc(FB.db, 'movements', m.ID), { RegistrationNo: v.RegistrationNo }));
      }
      this._write(batch.commit());
      this.logAudit(user, 'Updated', 'Vehicle', v.RegistrationNo, changes.join('; '));
    }
    return v;
  },
  setVehicleStatus(regNo, status, user){
    const v = this.findVehicle(regNo);
    if (!v) return null;
    if (v.Status === status) return v;
    v.Status = status;
    this._write(FB.updateDoc(FB.doc(FB.db, 'vehicles', v.RegistrationNo), { Status: status }));
    this.logAudit(user, status === 'Active' ? 'Activated' : 'Deactivated', 'Vehicle', v.RegistrationNo, `Status set to ${status}`);
    return v;
  },
  vehicleHasMovements(regNo){
    const key = String(regNo).trim().toUpperCase();
    return this.movements.some(m => m.RegistrationNo === key);
  },
  deleteVehicle(regNo, user){
    if (this.vehicleHasMovements(regNo)) return false;
    const key = String(regNo).trim().toUpperCase();
    this.vehicles = this.vehicles.filter(v => v.RegistrationNo !== key);
    this._write(FB.deleteDoc(FB.doc(FB.db, 'vehicles', key)));
    this.logAudit(user, 'Deleted', 'Vehicle', key, 'Vehicle permanently removed (no movement history)');
    return true;
  },

  /* ---------------- movements ---------------- */
  getMovement(id){ return this.movements.find(m => m.ID === id); },
  addMovement(data, user){
    const veh = this.findVehicle(data.RegistrationNo);
    const rec = {
      ID: uid('MOV'),
      Date: data.Date,
      RegistrationNo: data.RegistrationNo,
      VehicleType: veh ? veh.VehicleType : '',
      DriverName: data.DriverName.trim(),
      RequestedBy: (data.RequestedBy || '').trim(),
      OpeningTime: data.OpeningTime || '',
      OpeningKM: Number(data.OpeningKM),
      ClosingTime: '',
      ClosingKM: 0,
      TotalKM: 0,
      Status: 'In Progress',
      PurposePlace: (data.PurposePlace || '').trim(),
      PermittedBy: (data.PermittedBy || '').trim(),
      Remarks: (data.Remarks || '').trim(),
      CreatedBy: user.Username,
      CreatedAt: new Date().toISOString(),
      UpdatedBy: '',
      UpdatedAt: '',
    };
    this.movements.unshift(rec);
    this._write(FB.setDoc(FB.doc(FB.db, 'movements', rec.ID), rec));
    this.logAudit(user, 'Created', 'Movement', rec.ID, `Movement started for ${rec.RegistrationNo} on ${rec.Date}`);
    return rec;
  },
  closeMovement(id, { ClosingTime, ClosingKM }, user){
    const m = this.getMovement(id);
    if (!m) return null;
    m.ClosingTime = ClosingTime || '';
    m.ClosingKM = Number(ClosingKM);
    m.TotalKM = Number(ClosingKM) - Number(m.OpeningKM);
    m.Status = 'Completed';
    m.UpdatedBy = user.Username;
    m.UpdatedAt = new Date().toISOString();
    this._write(FB.setDoc(FB.doc(FB.db, 'movements', m.ID), { ...m }));
    this.logAudit(user, 'Closed', 'Movement', m.ID, `Movement closed for ${m.RegistrationNo} at ${m.ClosingKM} km (total ${m.TotalKM} km)`);
    return m;
  },
  deleteMovement(id, user){
    const m = this.getMovement(id);
    if (!m) return false;
    this.movements = this.movements.filter(x => x.ID !== id);
    this._write(FB.deleteDoc(FB.doc(FB.db, 'movements', id)));
    this.logAudit(user, 'Deleted', 'Movement', id, `Entry for ${m.RegistrationNo} on ${m.Date} deleted (created by ${m.CreatedBy})`);
    return true;
  },
  updateMovement(id, data, user){
    const m = this.getMovement(id);
    if (!m) return null;
    const fieldsToCheck = ['Date','RegistrationNo','DriverName','RequestedBy','OpeningTime','OpeningKM','ClosingTime','ClosingKM','PurposePlace','PermittedBy','Remarks'];
    const changes = [];
    fieldsToCheck.forEach(f => {
      let nv = data[f];
      if (nv === undefined) return;
      if (f === 'OpeningKM' || f === 'ClosingKM') nv = Number(nv);
      else if (typeof nv === 'string') nv = nv.trim();
      if (String(nv) !== String(m[f])){
        changes.push(`${f}: "${m[f]}" → "${nv}"`);
        m[f] = nv;
      }
    });
    m.TotalKM = m.Status === 'Completed' ? Number(m.ClosingKM) - Number(m.OpeningKM) : 0;
    const veh = this.findVehicle(m.RegistrationNo);
    m.VehicleType = veh ? veh.VehicleType : m.VehicleType;
    if (changes.length){
      m.UpdatedBy = user.Username;
      m.UpdatedAt = new Date().toISOString();
      this._write(FB.setDoc(FB.doc(FB.db, 'movements', m.ID), { ...m }));
      this.logAudit(user, 'Updated', 'Movement', m.ID, changes.join('; '));
    }
    return m;
  },

  /* ---------------- users (profiles — credentials live in Firebase Auth) ---------------- */
  findUser(username){
    const key = String(username || '').trim().toLowerCase();
    return this.users.find(u => u.Username.toLowerCase() === key);
  },
  addUserProfile({ Username, DisplayName, Role, ForceNo }, user){
    const u = { Username: Username.trim().toLowerCase(), DisplayName: DisplayName.trim(), Role, Active: 'Yes', ForceNo: (ForceNo || '').trim() };
    this.users.push(u);
    this._write(FB.setDoc(FB.doc(FB.db, 'users', u.Username), u));
    this.logAudit(user, 'Created', 'User', u.Username, `User added with role ${u.Role}`);
    return u;
  },
  updateUserProfile(username, { DisplayName, ForceNo }, user){
    const u = this.findUser(username);
    if (!u) return null;
    const changes = [];
    if (DisplayName !== undefined && DisplayName.trim() !== u.DisplayName){
      changes.push(`DisplayName: "${u.DisplayName}" → "${DisplayName.trim()}"`);
      u.DisplayName = DisplayName.trim();
    }
    const newFno = (ForceNo || '').trim();
    if (ForceNo !== undefined && newFno !== (u.ForceNo || '')){
      changes.push(`ForceNo: "${u.ForceNo||''}" → "${newFno}"`);
      u.ForceNo = newFno;
    }
    if (changes.length){
      this._write(FB.updateDoc(FB.doc(FB.db, 'users', u.Username), { DisplayName: u.DisplayName, ForceNo: u.ForceNo || '' }));
      this.logAudit(user, 'Updated', 'User', u.Username, changes.join('; '));
    }
    return u;
  },
  async updateUsername(oldUsername, newUsername, currentPw, user){
    const newName = newUsername.trim().toLowerCase();
    if (this.findUser(newName)) throw Object.assign(new Error('That username is already taken.'), { code: 'username-taken' });
    const appName = 'username-change';
    const secondary = FB.getApps().some(a => a.name === appName)
      ? FB.getApp(appName) : FB.initializeApp(FB.firebaseConfig, appName);
    const secondaryAuth = FB.getAuth(secondary);
    await FB.signInWithEmailAndPassword(secondaryAuth, this.emailFor(oldUsername), currentPw);
    await FB.updateEmail(secondaryAuth.currentUser, this.emailFor(newName));
    await FB.signOut(secondaryAuth);
    const oldUser = this.findUser(oldUsername);
    const newUserDoc = { ...oldUser, Username: newName };
    const batch = FB.writeBatch(FB.db);
    batch.set(FB.doc(FB.db, 'users', newName), newUserDoc);
    batch.delete(FB.doc(FB.db, 'users', oldUsername));
    const toUpdate = this.movements.filter(m => m.CreatedBy === oldUsername);
    toUpdate.forEach(m => { m.CreatedBy = newName; batch.update(FB.doc(FB.db, 'movements', m.ID), { CreatedBy: newName }); });
    await batch.commit();
    const idx = this.users.indexOf(oldUser);
    if (idx > -1) this.users[idx] = newUserDoc;
    this.logAudit(user, 'Updated', 'User', oldUsername, `Username changed to "${newName}" (${toUpdate.length} movement(s) updated)`);
    return newUserDoc;
  },
  async adminResetPassword(username, currentPw, newPw, adminUser){
    const appName = 'pwd-reset';
    const secondary = FB.getApps().some(a => a.name === appName)
      ? FB.getApp(appName) : FB.initializeApp(FB.firebaseConfig, appName);
    const secondaryAuth = FB.getAuth(secondary);
    await FB.signInWithEmailAndPassword(secondaryAuth, this.emailFor(username), currentPw);
    await FB.updatePassword(secondaryAuth.currentUser, newPw);
    await FB.signOut(secondaryAuth);
    this.logAudit(adminUser, 'Updated', 'User', username, 'Password reset by admin');
  },
  setUserActive(username, active, user){
    const u = this.findUser(username);
    if (!u) return null;
    u.Active = active ? 'Yes' : 'No';
    this._write(FB.updateDoc(FB.doc(FB.db, 'users', u.Username), { Active: u.Active }));
    this.logAudit(user, active ? 'Activated' : 'Deactivated', 'User', u.Username, `Access ${active ? 'enabled' : 'revoked'}`);
    return u;
  },

  /* ---------------- audit ---------------- */
  logAudit(user, action, recordType, recordId, details){
    const entry = {
      ID: uid('AUD'),
      Timestamp: new Date().toISOString(),
      User: user ? user.Username : 'system',
      Action: action,
      RecordType: recordType,
      RecordId: recordId,
      Details: details,
    };
    this.auditLog.unshift(entry);
    const write = FB.setDoc(FB.doc(FB.db, 'auditLog', entry.ID), entry);
    this._write(write);
    return write.catch(() => {});
  },
  auditForRecord(recordId){
    return this.auditLog.filter(a => a.RecordId === recordId).sort((a,b) => new Date(b.Timestamp) - new Date(a.Timestamp));
  },

  /* ---------------- derived / query helpers ---------------- */
  movementsInRange(fromISO, toISO, regNo){
    return this.movements.filter(m => {
      if (fromISO && m.Date < fromISO) return false;
      if (toISO && m.Date > toISO) return false;
      if (regNo && regNo !== 'ALL' && m.RegistrationNo !== regNo) return false;
      return true;
    });
  },

  /* ---------------- export full backup ---------------- */
  exportBackupXlsx(){
    const wb = XLSX.utils.book_new();
    const addSheet = (name, rows, headers) => {
      const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
      XLSX.utils.book_append_sheet(wb, ws, name);
    };
    addSheet('Vehicles', this.vehicles, ['RegistrationNo','VehicleType','Status','AddedOn','AddedBy']);
    // No passwords in backups — credentials live in Firebase Authentication.
    addSheet('Users', this.users.map(u => ({ Username: u.Username, DisplayName: u.DisplayName, Role: u.Role, Active: u.Active, ForceNo: u.ForceNo || '' })), ['Username','DisplayName','Role','Active','ForceNo']);
    addSheet('Movements', this.movements, ['ID','Date','RegistrationNo','VehicleType','DriverName','RequestedBy','OpeningTime','OpeningKM','ClosingTime','ClosingKM','TotalKM','Status','PurposePlace','PermittedBy','Remarks','CreatedBy','CreatedAt','UpdatedBy','UpdatedAt']);
    addSheet('AuditLog', this.auditLog, ['ID','Timestamp','User','Action','RecordType','RecordId','Details']);
    XLSX.writeFile(wb, `vehicle-register-backup-${todayISO()}.xlsx`);
  },

  /* ---------------- movements-only exports ---------------- */
  _sortedMovements(){
    return this.movements.slice().sort((a, b) => a.Date.localeCompare(b.Date) || String(a.CreatedAt).localeCompare(String(b.CreatedAt)));
  },
  exportMovementsXlsx(){
    const ws = XLSX.utils.json_to_sheet(this._sortedMovements(), {
      header: ['ID','Date','RegistrationNo','VehicleType','DriverName','RequestedBy','OpeningTime','OpeningKM','ClosingTime','ClosingKM','TotalKM','Status','PurposePlace','PermittedBy','Remarks','CreatedBy','CreatedAt','UpdatedBy','UpdatedAt'],
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Movements');
    XLSX.writeFile(wb, `movements-${todayISO()}.xlsx`);
  },
  exportMovementsJson(){
    const payload = {
      exportedAt: new Date().toISOString(),
      count: this.movements.length,
      movements: this._sortedMovements(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `movements-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },

  /* ---------------- bulk replace (import backup / reset) ---------------- */
  async _commitInChunks(ops){
    // Firestore batches max out at 500 ops.
    for (let i = 0; i < ops.length; i += 450){
      const batch = FB.writeBatch(FB.db);
      ops.slice(i, i + 450).forEach(op => op(batch));
      await batch.commit();
    }
  },

  async _replaceCollections({ vehicles, movements, auditLog }){
    const { db, doc, collection, getDocs } = FB;
    const ops = [];
    for (const name of ['vehicles', 'movements', 'auditLog']){
      const snap = await getDocs(collection(db, name));
      snap.docs.forEach(d => ops.push(b => b.delete(d.ref)));
    }
    vehicles.forEach(v => ops.push(b => b.set(doc(db, 'vehicles', v.RegistrationNo), v)));
    movements.forEach(m => ops.push(b => b.set(doc(db, 'movements', m.ID), m)));
    auditLog.forEach(a => ops.push(b => b.set(doc(db, 'auditLog', String(a.ID)), a)));
    await this._commitInChunks(ops);
  },

  _parseFullWorkbook(wb){
    const sheet = (name) => wb.Sheets[name] ? XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' }) : [];
    const vehicles = sheet('Vehicles').map(v => ({
      RegistrationNo: String(v.RegistrationNo || '').trim().toUpperCase(),
      VehicleType: String(v.VehicleType || '').trim(),
      Status: v.Status || 'Active',
      AddedOn: v.AddedOn || todayISO(),
      AddedBy: v.AddedBy || 'system',
    })).filter(v => v.RegistrationNo);
    const movements = sheet('Movements').map(m => normalizeMovement({
      ID: String(m.ID || uid('MOV')),
      Date: m.Date || todayISO(),
      RegistrationNo: String(m.RegistrationNo || '').trim().toUpperCase(),
      VehicleType: m.VehicleType || '',
      DriverName: m.DriverName || '',
      RequestedBy: m.RequestedBy || '',
      OpeningTime: m.OpeningTime === undefined ? '' : String(m.OpeningTime),
      OpeningKM: Number(m.OpeningKM || 0),
      ClosingTime: m.ClosingTime === undefined ? '' : String(m.ClosingTime),
      ClosingKM: Number(m.ClosingKM || 0),
      TotalKM: Number(m.TotalKM || (Number(m.ClosingKM||0) - Number(m.OpeningKM||0)) || 0),
      Status: m.Status || '',
      PurposePlace: m.PurposePlace || '',
      PermittedBy: m.PermittedBy || '',
      Remarks: m.Remarks || '',
      CreatedBy: m.CreatedBy || 'system',
      CreatedAt: m.CreatedAt || new Date().toISOString(),
      UpdatedBy: m.UpdatedBy || '',
      UpdatedAt: m.UpdatedAt || '',
    }));
    const auditLog = sheet('AuditLog').map((a, i) => ({
      ID: String(a.ID || uid('AUD')),
      Timestamp: a.Timestamp || new Date().toISOString(),
      User: a.User || 'system',
      Action: a.Action || 'Created',
      RecordType: a.RecordType || '',
      RecordId: a.RecordId || '',
      Details: a.Details || '',
    }));
    return { vehicles, movements, auditLog };
  },

  async resetToBundled(){
    const res = await fetch(BASELINE_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('Could not load ' + BASELINE_URL);
    const buf = await res.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    await this._replaceCollections(this._parseFullWorkbook(wb));
    this.meta.source = 'Cloud Firestore (reset from bundled register)';
  },

  /* ---------------- import ---------------- */
  async importFile(file, user){
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheetNames = wb.SheetNames.map(n => n.toLowerCase());
    if (sheetNames.includes('vehicles') && sheetNames.includes('movements')){
      const data = this._parseFullWorkbook(wb);
      await this._replaceCollections(data);
      this.logAudit(user, 'Updated', 'System', '-', `Full data restored from backup file "${file.name}" (user accounts unaffected)`);
      return { mode: 'full', vehicles: data.vehicles.length, movements: data.movements.length };
    }
    return this._importLegacyRegister(wb, file.name, user);
  },

  async _importLegacyRegister(wb, fileName, user){
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!rows.length) throw new Error('Empty sheet');

    // Date from the title row, e.g. "... Date: 11-Sep-2026"
    let dateISO = todayISO();
    const titleCell = String(rows[0][0] || '');
    const dm = titleCell.match(/Date:\s*(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
    const monthsShort = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    if (dm){
      const mi = monthsShort.indexOf(dm[2].toLowerCase());
      if (mi > -1) dateISO = `${dm[3]}-${pad2(mi+1)}-${pad2(Number(dm[1]))}`;
    }

    // find header row: the title row also contains "REGISTER" so a loose
    // substring match on "reg" would false-positive on row 0 — require the
    // more specific "reg. no" / "reg no" / "registration" pattern instead.
    let headerRowIdx = 1;
    for (let i = 0; i < Math.min(4, rows.length); i++){
      if (rows[i].some(c => /reg\.?\s*no\.?|registration/i.test(String(c)))) { headerRowIdx = i; break; }
    }
    const header = rows[headerRowIdx].map(c => String(c || '').replace(/\s+/g, ' ').trim().toLowerCase());
    const findCol = (...keywords) => header.findIndex(h => keywords.some(k => h.includes(k)));
    const col = {
      reg: findCol('reg. no', 'reg no', 'registration'),
      type: findCol('vehicle\ntype', 'type'),
      openTime: findCol('opening\ntime', 'opening time'),
      openKm: findCol('opening\nkm', 'opening km'),
      closeTime: findCol('closing\ntime', 'closing time'),
      closeKm: findCol('closing\nkm', 'closing km'),
      driver: findCol('driver'),
      requestedBy: findCol('user name', 'requested'),
      purpose: findCol('purpose'),
      permittedBy: findCol('permitted'),
      remarks: findCol('remarks'),
    };
    if (col.reg === -1) throw new Error('Could not find a "Vehicle Reg. No." column in this file.');

    let vehiclesAdded = 0, vehiclesSeen = 0, movementsAdded = 0, movementsSkipped = 0;
    const ops = [];
    for (let i = headerRowIdx + 1; i < rows.length; i++){
      const r = rows[i];
      const reg = String(r[col.reg] || '').trim().toUpperCase();
      // Skip blanks and footer/signature rows (e.g. "GO IC/ MT") that don't
      // look like a vehicle registration — a real plate always has a digit.
      if (!reg || reg.length < 3 || !/\d/.test(reg)) continue;
      vehiclesSeen++;
      const type = col.type > -1 ? String(r[col.type] || '').trim() : '';
      if (!this.findVehicle(reg)){
        const v = { RegistrationNo: reg, VehicleType: type || 'Unspecified', Status: 'Active', AddedOn: todayISO(), AddedBy: user.Username };
        this.vehicles.push(v);
        ops.push(b => b.set(FB.doc(FB.db, 'vehicles', reg), v));
        vehiclesAdded++;
      }
      const openingKm = col.openKm > -1 ? Number(r[col.openKm] || 0) : 0;
      const closingKm = col.closeKm > -1 ? Number(r[col.closeKm] || 0) : 0;
      const driver = col.driver > -1 ? String(r[col.driver] || '').trim() : '';
      if (!openingKm || !closingKm || closingKm <= openingKm){ continue; }
      const dup = this.movements.some(m => m.RegistrationNo === reg && m.Date === dateISO && m.OpeningKM === openingKm && m.ClosingKM === closingKm);
      if (dup){ movementsSkipped++; continue; }
      const rec = {
        ID: uid('MOV'), Date: dateISO, RegistrationNo: reg, VehicleType: type,
        DriverName: driver, RequestedBy: col.requestedBy > -1 ? String(r[col.requestedBy] || '').trim() : '',
        OpeningTime: col.openTime > -1 ? String(r[col.openTime] || '') : '', OpeningKM: openingKm,
        ClosingTime: col.closeTime > -1 ? String(r[col.closeTime] || '') : '', ClosingKM: closingKm,
        TotalKM: closingKm - openingKm,
        Status: 'Completed',
        PurposePlace: col.purpose > -1 ? String(r[col.purpose] || '').trim() : '',
        PermittedBy: col.permittedBy > -1 ? String(r[col.permittedBy] || '').trim() : '',
        Remarks: col.remarks > -1 ? String(r[col.remarks] || '').trim() : '',
        CreatedBy: user.Username, CreatedAt: new Date().toISOString(), UpdatedBy: '', UpdatedAt: '',
      };
      this.movements.unshift(rec);
      ops.push(b => b.set(FB.doc(FB.db, 'movements', rec.ID), rec));
      movementsAdded++;
    }
    await this._commitInChunks(ops);
    this.logAudit(user, 'Created', 'System', '-', `Imported legacy register "${fileName}" (date ${dateISO}): ${vehiclesAdded} new vehicle(s), ${movementsAdded} movement row(s)`);
    return { mode: 'legacy', dateISO, vehiclesSeen, vehiclesAdded, movementsAdded, movementsSkipped };
  },
};

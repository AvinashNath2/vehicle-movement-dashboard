/* ==========================================================================
   Data layer.

   This app has no backend: on GitHub Pages every "write" happens in the
   visitor's own browser. The bundled file at data/vehicle-register.xlsx is
   the shared starting point (baseline); after that, all creates/edits live
   in this browser's localStorage until someone exports a backup (Settings →
   Data Management) and commits it back into data/vehicle-register.xlsx, or
   imports a fresh register. That is the documented trade-off for a static,
   file-backed app — see the README.
   ========================================================================== */

const STORAGE_KEY = 'vmd_database_v1';
const BASELINE_URL = 'data/vehicle-register.xlsx';

const DB = {
  vehicles: [],
  users: [],
  movements: [],
  auditLog: [],
  meta: { source: '', loadedAt: '' },

  async init(){
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached){
      try {
        const parsed = JSON.parse(cached);
        // A snapshot without any users would lock everyone out of login
        // permanently — treat it (and any other malformed shape) as corrupt
        // and fall back to the bundled baseline.
        const valid = parsed
          && Array.isArray(parsed.vehicles)
          && Array.isArray(parsed.movements)
          && Array.isArray(parsed.auditLog)
          && Array.isArray(parsed.users) && parsed.users.length > 0;
        if (valid){
          Object.assign(this, parsed);
          return;
        }
      } catch(e){ /* fall through to reload baseline */ }
    }
    await this.loadBaseline();
  },

  async loadBaseline(){
    const res = await fetch(BASELINE_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('Could not load ' + BASELINE_URL);
    const buf = await res.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    this._loadFullWorkbook(wb);
    this.meta.source = 'Bundled register (data/vehicle-register.xlsx)';
    this.meta.loadedAt = new Date().toISOString();
    this.persist();
  },

  _loadFullWorkbook(wb){
    const sheet = (name) => wb.Sheets[name] ? XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' }) : [];
    this.vehicles = sheet('Vehicles').map(v => ({
      RegistrationNo: String(v.RegistrationNo || '').trim().toUpperCase(),
      VehicleType: String(v.VehicleType || '').trim(),
      Status: v.Status || 'Active',
      AddedOn: v.AddedOn || todayISO(),
      AddedBy: v.AddedBy || 'system',
    })).filter(v => v.RegistrationNo);
    this.users = sheet('Users').map(u => ({
      Username: String(u.Username || '').trim(),
      DisplayName: u.DisplayName || u.Username,
      Password: String(u.Password ?? ''),
      Role: u.Role || 'Operator',
      Active: u.Active === undefined || u.Active === '' ? 'Yes' : u.Active,
    })).filter(u => u.Username);
    this.movements = sheet('Movements').map(m => ({
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
      PurposePlace: m.PurposePlace || '',
      PermittedBy: m.PermittedBy || '',
      Remarks: m.Remarks || '',
      CreatedBy: m.CreatedBy || 'system',
      CreatedAt: m.CreatedAt || new Date().toISOString(),
      UpdatedBy: m.UpdatedBy || '',
      UpdatedAt: m.UpdatedAt || '',
    }));
    this.auditLog = sheet('AuditLog').map((a, i) => ({
      ID: a.ID || i + 1,
      Timestamp: a.Timestamp || new Date().toISOString(),
      User: a.User || 'system',
      Action: a.Action || 'Created',
      RecordType: a.RecordType || '',
      RecordId: a.RecordId || '',
      Details: a.Details || '',
    }));
  },

  persist(){
    const snapshot = {
      vehicles: this.vehicles, users: this.users, movements: this.movements,
      auditLog: this.auditLog, meta: this.meta,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  },

  async resetToBundled(){
    localStorage.removeItem(STORAGE_KEY);
    await this.loadBaseline();
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
    this.logAudit(user, 'Created', 'Vehicle', reg, `Vehicle added (${v.VehicleType})`);
    this.persist();
    return v;
  },
  updateVehicle(regNo, patch, user){
    const v = this.findVehicle(regNo);
    if (!v) return null;
    const changes = [];
    if (patch.VehicleType && patch.VehicleType.trim() !== v.VehicleType){
      changes.push(`Type: "${v.VehicleType}" → "${patch.VehicleType.trim()}"`);
      v.VehicleType = patch.VehicleType.trim();
    }
    if (patch.RegistrationNo){
      const newReg = patch.RegistrationNo.trim().toUpperCase();
      if (newReg !== v.RegistrationNo){
        changes.push(`Reg. No: "${v.RegistrationNo}" → "${newReg}"`);
        this.movements.forEach(m => { if (m.RegistrationNo === v.RegistrationNo) m.RegistrationNo = newReg; });
        v.RegistrationNo = newReg;
      }
    }
    if (changes.length){
      this.logAudit(user, 'Updated', 'Vehicle', v.RegistrationNo, changes.join('; '));
      this.persist();
    }
    return v;
  },
  setVehicleStatus(regNo, status, user){
    const v = this.findVehicle(regNo);
    if (!v) return null;
    if (v.Status === status) return v;
    v.Status = status;
    this.logAudit(user, status === 'Active' ? 'Activated' : 'Deactivated', 'Vehicle', v.RegistrationNo, `Status set to ${status}`);
    this.persist();
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
    this.logAudit(user, 'Deleted', 'Vehicle', key, 'Vehicle permanently removed (no movement history)');
    this.persist();
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
      ClosingTime: data.ClosingTime || '',
      ClosingKM: Number(data.ClosingKM),
      TotalKM: Number(data.ClosingKM) - Number(data.OpeningKM),
      PurposePlace: (data.PurposePlace || '').trim(),
      PermittedBy: (data.PermittedBy || '').trim(),
      Remarks: (data.Remarks || '').trim(),
      CreatedBy: user.Username,
      CreatedAt: new Date().toISOString(),
      UpdatedBy: '',
      UpdatedAt: '',
    };
    this.movements.unshift(rec);
    this.logAudit(user, 'Created', 'Movement', rec.ID, `New movement entry created for ${rec.RegistrationNo} on ${rec.Date}`);
    this.persist();
    return rec;
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
    m.TotalKM = Number(m.ClosingKM) - Number(m.OpeningKM);
    const veh = this.findVehicle(m.RegistrationNo);
    m.VehicleType = veh ? veh.VehicleType : m.VehicleType;
    if (changes.length){
      m.UpdatedBy = user.Username;
      m.UpdatedAt = new Date().toISOString();
      this.logAudit(user, 'Updated', 'Movement', m.ID, changes.join('; '));
      this.persist();
    }
    return m;
  },

  /* ---------------- users ---------------- */
  findUser(username){
    const key = String(username || '').trim().toLowerCase();
    return this.users.find(u => u.Username.toLowerCase() === key);
  },
  verifyLogin(username, password){
    const u = this.findUser(username);
    if (!u) return null;
    if (String(u.Active).toLowerCase() === 'no') return null;
    if (u.Password !== password) return null;
    return u;
  },
  addUser({ Username, DisplayName, Password, Role }, user){
    const u = { Username: Username.trim(), DisplayName: DisplayName.trim(), Password, Role, Active: 'Yes' };
    this.users.push(u);
    this.logAudit(user, 'Created', 'User', u.Username, `User added with role ${u.Role}`);
    this.persist();
    return u;
  },
  setUserActive(username, active, user){
    const u = this.findUser(username);
    if (!u) return null;
    u.Active = active ? 'Yes' : 'No';
    this.logAudit(user, active ? 'Activated' : 'Deactivated', 'User', u.Username, `Access ${active ? 'enabled' : 'revoked'}`);
    this.persist();
    return u;
  },
  changePassword(username, newPassword, user){
    const u = this.findUser(username);
    if (!u) return false;
    u.Password = newPassword;
    this.logAudit(user, 'Updated', 'User', u.Username, 'Password changed');
    this.persist();
    return true;
  },

  /* ---------------- audit ---------------- */
  logAudit(user, action, recordType, recordId, details){
    this.auditLog.unshift({
      ID: this.auditLog.length ? Math.max(...this.auditLog.map(a => Number(a.ID)||0)) + 1 : 1,
      Timestamp: new Date().toISOString(),
      User: user ? user.Username : 'system',
      Action: action,
      RecordType: recordType,
      RecordId: recordId,
      Details: details,
    });
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
    addSheet('Users', this.users, ['Username','DisplayName','Password','Role','Active']);
    addSheet('Movements', this.movements, ['ID','Date','RegistrationNo','VehicleType','DriverName','RequestedBy','OpeningTime','OpeningKM','ClosingTime','ClosingKM','TotalKM','PurposePlace','PermittedBy','Remarks','CreatedBy','CreatedAt','UpdatedBy','UpdatedAt']);
    addSheet('AuditLog', this.auditLog, ['ID','Timestamp','User','Action','RecordType','RecordId','Details']);
    XLSX.writeFile(wb, `vehicle-register-backup-${todayISO()}.xlsx`);
  },

  /* ---------------- import ---------------- */
  async importFile(file, user){
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheetNames = wb.SheetNames.map(n => n.toLowerCase());
    if (sheetNames.includes('vehicles') && sheetNames.includes('movements')){
      this._loadFullWorkbook(wb);
      this.meta.source = `Imported backup: ${file.name}`;
      this.meta.loadedAt = new Date().toISOString();
      this.logAudit(user, 'Updated', 'System', '-', `Full data restored from backup file "${file.name}"`);
      this.persist();
      return { mode: 'full', vehicles: this.vehicles.length, movements: this.movements.length };
    }
    return this._importLegacyRegister(wb, file.name, user);
  },

  _importLegacyRegister(wb, fileName, user){
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
    for (let i = headerRowIdx + 1; i < rows.length; i++){
      const r = rows[i];
      const reg = String(r[col.reg] || '').trim().toUpperCase();
      // Skip blanks and footer/signature rows (e.g. "GO IC/ MT") that don't
      // look like a vehicle registration — a real plate always has a digit.
      if (!reg || reg.length < 3 || !/\d/.test(reg)) continue;
      vehiclesSeen++;
      const type = col.type > -1 ? String(r[col.type] || '').trim() : '';
      if (!this.findVehicle(reg)){
        this.vehicles.push({ RegistrationNo: reg, VehicleType: type || 'Unspecified', Status: 'Active', AddedOn: todayISO(), AddedBy: user.Username });
        vehiclesAdded++;
      }
      const openingKm = col.openKm > -1 ? Number(r[col.openKm] || 0) : 0;
      const closingKm = col.closeKm > -1 ? Number(r[col.closeKm] || 0) : 0;
      const driver = col.driver > -1 ? String(r[col.driver] || '').trim() : '';
      if (!openingKm || !closingKm || closingKm <= openingKm){ continue; }
      const dup = this.movements.some(m => m.RegistrationNo === reg && m.Date === dateISO && m.OpeningKM === openingKm && m.ClosingKM === closingKm);
      if (dup){ movementsSkipped++; continue; }
      this.movements.unshift({
        ID: uid('MOV'), Date: dateISO, RegistrationNo: reg, VehicleType: type,
        DriverName: driver, RequestedBy: col.requestedBy > -1 ? String(r[col.requestedBy] || '').trim() : '',
        OpeningTime: col.openTime > -1 ? String(r[col.openTime] || '') : '', OpeningKM: openingKm,
        ClosingTime: col.closeTime > -1 ? String(r[col.closeTime] || '') : '', ClosingKM: closingKm,
        TotalKM: closingKm - openingKm,
        PurposePlace: col.purpose > -1 ? String(r[col.purpose] || '').trim() : '',
        PermittedBy: col.permittedBy > -1 ? String(r[col.permittedBy] || '').trim() : '',
        Remarks: col.remarks > -1 ? String(r[col.remarks] || '').trim() : '',
        CreatedBy: user.Username, CreatedAt: new Date().toISOString(), UpdatedBy: '', UpdatedAt: '',
      });
      movementsAdded++;
    }
    this.logAudit(user, 'Created', 'System', '-', `Imported legacy register "${fileName}" (date ${dateISO}): ${vehiclesAdded} new vehicle(s), ${movementsAdded} movement row(s)`);
    this.persist();
    return { mode: 'legacy', dateISO, vehiclesSeen, vehiclesAdded, movementsAdded, movementsSkipped };
  },
};

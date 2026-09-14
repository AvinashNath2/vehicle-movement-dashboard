/* ==========================================================================
   Page renderers. Each function takes the #page-content container and
   fully re-renders that page from current App / DB state.
   ========================================================================== */

function vehicleOptionsHtml(selected, { onlyActive } = {}){
  const list = DB.vehicles
    .filter(v => !onlyActive || v.Status === 'Active')
    .slice()
    .sort((a,b) => a.RegistrationNo.localeCompare(b.RegistrationNo));
  return list.map(v => `<option value="${v.RegistrationNo}" ${v.RegistrationNo===selected?'selected':''}>${v.RegistrationNo} — ${escapeHtml(v.VehicleType)}${v.Status!=='Active'?' (Inactive)':''}</option>`).join('');
}

function actionBadge(action){
  const map = {
    Created: 'badge-good', Updated: 'badge-brand', Closed: 'badge-good', Deactivated: 'badge-critical',
    Activated: 'badge-good', Deleted: 'badge-critical', Login: 'badge-muted', Logout: 'badge-muted',
  };
  return `<span class="badge ${map[action] || 'badge-muted'}">${escapeHtml(action)}</span>`;
}

/* ============================== DASHBOARD ============================== */

function renderDashboardPage(container){
  const f = App.filters.dashboard;
  container.innerHTML = `
    <div class="card card-pad filter-bar">
      <div class="field"><label>From Date</label><input type="date" id="db-from" value="${f.from}"></div>
      <div class="field"><label>To Date</label><input type="date" id="db-to" value="${f.to}"></div>
      <div class="field grow"><label>Vehicle</label>
        <select id="db-vehicle"><option value="ALL">All Vehicles</option>${vehicleOptionsHtml(f.vehicle === 'ALL' ? '' : f.vehicle)}</select>
      </div>
      <div class="actions">
        <button class="btn btn-primary" id="db-apply" type="button">Apply</button>
        <button class="btn btn-outline" id="db-clear" type="button">Clear</button>
      </div>
    </div>

    <div class="stat-grid" id="stat-grid"></div>

    <div class="dash-grid">
      <div class="card">
        <div class="card-head"><h2>Daily KM Movement (Last 7 Days)</h2></div>
        <div class="chart-wrap" id="daily-chart"></div>
      </div>
      <div class="card">
        <div class="card-head">
          <h2>Top Vehicles by Distance</h2>
          <a href="#" id="view-all-top" class="link">View All</a>
        </div>
        <div class="card-pad" id="top-vehicles-list"></div>
      </div>
    </div>
  `;

  $('#db-apply').addEventListener('click', () => {
    f.from = $('#db-from').value || todayISO();
    f.to = $('#db-to').value || todayISO();
    f.vehicle = $('#db-vehicle').value;
    renderDashboardPage(container);
  });
  $('#db-clear').addEventListener('click', () => {
    App.filters.dashboard = { from: todayISO(), to: todayISO(), vehicle: 'ALL' };
    renderDashboardPage(container);
  });

  const inRange = DB.movementsInRange(f.from, f.to, f.vehicle);
  const vehiclesUsed = new Set(inRange.map(m => m.RegistrationNo)).size;
  const totalKm = inRange.reduce((s,m) => s + Number(m.TotalKM||0), 0);
  const sameDay = f.from === f.to;

  $('#stat-grid').innerHTML = `
    ${statCard('fleet', 'brand', 'Total Vehicles', DB.vehicles.length, 'Registered in fleet')}
    ${statCard('car', 'aqua', 'Vehicles Used', vehiclesUsed, sameDay ? 'On selected date' : 'In selected range')}
    ${statCard('flag', 'violet', 'Total Trips', inRange.length, 'Movement entries')}
    ${statCard('route', 'orange', 'Total KM Travelled', formatNumber(totalKm), sameDay ? 'km on selected date' : 'km in selected range')}
  `;

  // last 7 days, always anchored to real "today" regardless of filters
  const days = [];
  for (let i = 6; i >= 0; i--){
    const d = addDaysISO(todayISO(), -i);
    const sum = DB.movements.filter(m => m.Date === d).reduce((s,m) => s + Number(m.TotalKM||0), 0);
    days.push({ dateISO: d, label: formatDateShort(d), value: sum });
  }
  renderDailyKmChart($('#daily-chart'), days);

  renderTopVehicles($('#top-vehicles-list'), inRange, 5);
  $('#view-all-top').addEventListener('click', (e) => {
    e.preventDefault();
    openModal({
      title: 'All Vehicles by Distance',
      large: true,
      bodyHtml: `<div id="top-vehicles-full"></div>`,
      onMount: (m) => renderTopVehicles($('#top-vehicles-full', m), inRange, 999),
    });
  });
}

function statCard(iconName, color, label, value, sub){
  return `
    <div class="card stat-card">
      <div class="stat-icon" style="background:var(--${color}-bg);color:var(--${color})">${icon(iconName)}</div>
      <div>
        <div class="stat-label">${label}</div>
        <div class="stat-value tabular">${value}</div>
        <div class="stat-sub">${sub}</div>
      </div>
    </div>`;
}

function renderTopVehicles(container, movementsList, limit){
  const byVehicle = {};
  movementsList.forEach(m => { byVehicle[m.RegistrationNo] = (byVehicle[m.RegistrationNo] || 0) + Number(m.TotalKM||0); });
  const rows = Object.entries(byVehicle).map(([reg, km]) => ({ reg, km, type: DB.findVehicle(reg)?.VehicleType || '' }))
    .sort((a,b) => b.km - a.km).slice(0, limit);
  if (!rows.length){
    container.innerHTML = `<div class="empty-state">${icon('car')}<div>No trips in the selected range yet.</div></div>`;
    return;
  }
  const max = rows[0].km || 1;
  container.innerHTML = rows.map(r => `
    <div class="rank-row">
      <div class="rank-name" title="${escapeHtml(r.reg)} — ${escapeHtml(r.type)}">${escapeHtml(r.reg)}</div>
      <div class="rank-bar-track"><div class="rank-bar-fill" style="width:${Math.max(4,(r.km/max)*100)}%"></div></div>
      <div class="rank-value tabular">${fmtKm(r.km)}</div>
    </div>`).join('');
}

/* ============================== VEHICLES ============================== */

function renderVehiclesPage(container){
  const f = App.filters.vehicles;
  container.innerHTML = `
    <div class="card">
      <div class="card-head" style="flex-wrap:wrap;gap:10px">
        <div style="display:flex;gap:10px;flex:1;min-width:260px">
          <div class="input-icon" style="flex:1;max-width:320px">${icon('search')}<input type="search" id="veh-search" placeholder="Search registration no. or type…" value="${escapeHtml(f.search)}"></div>
          <select id="veh-status" style="max-width:160px">
            <option value="ALL" ${f.status==='ALL'?'selected':''}>All Status</option>
            <option value="Active" ${f.status==='Active'?'selected':''}>Active</option>
            <option value="Inactive" ${f.status==='Inactive'?'selected':''}>Inactive</option>
          </select>
        </div>
        <button class="btn btn-primary" id="btn-add-vehicle" type="button">${icon('plus')} Add Vehicle</button>
      </div>
      <div class="card-pad">
        <div class="table-wrap cards-sm"><table class="data-table">
          <thead><tr><th>#</th><th>Registration No.</th><th>Vehicle Type</th><th>Status</th><th>Trips</th><th>Actions</th></tr></thead>
          <tbody id="veh-tbody"></tbody>
        </table></div>
        <div id="veh-empty"></div>
        <div id="veh-pagination"></div>
      </div>
    </div>`;

  $('#veh-search').addEventListener('input', debounce(() => { f.search = $('#veh-search').value; f.page = 1; renderVehiclesTable(); }, 200));
  $('#veh-status').addEventListener('change', () => { f.status = $('#veh-status').value; f.page = 1; renderVehiclesTable(); });
  $('#btn-add-vehicle').addEventListener('click', () => openVehicleModal());

  function renderVehiclesTable(){
    const q = f.search.trim().toLowerCase();
    const filtered = DB.vehicles.filter(v => {
      if (f.status !== 'ALL' && v.Status !== f.status) return false;
      if (q && !(v.RegistrationNo.toLowerCase().includes(q) || v.VehicleType.toLowerCase().includes(q))) return false;
      return true;
    });
    const info = paginate(filtered, f.page, 10);
    $('#veh-empty').innerHTML = info.total ? '' : `<div class="empty-state">${icon('car')}<div>No vehicles match your filters.</div></div>`;
    $('#veh-tbody').innerHTML = info.rows.map((v, i) => {
      const trips = DB.movements.filter(m => m.RegistrationNo === v.RegistrationNo).length;
      return `
      <tr>
        <td class="cell-muted" data-label="#">${info.start + i + 1}</td>
        <td data-label="Registration No."><strong>${escapeHtml(v.RegistrationNo)}</strong></td>
        <td data-label="Type">${escapeHtml(v.VehicleType)}</td>
        <td data-label="Status"><span class="badge ${v.Status==='Active'?'badge-good':'badge-muted'}">${v.Status}</span></td>
        <td class="cell-muted tabular" data-label="Trips">${trips}</td>
        <td class="row-actions">
          <button class="icon-btn" data-edit="${v.RegistrationNo}" title="Edit" type="button">${icon('edit')}</button>
          <button class="icon-btn" data-toggle="${v.RegistrationNo}" title="${v.Status==='Active'?'Deactivate':'Activate'}" type="button">${icon(v.Status==='Active'?'x':'check')}</button>
          <button class="icon-btn danger" data-delete="${v.RegistrationNo}" title="Delete" type="button">${icon('trash')}</button>
        </td>
      </tr>`;
    }).join('');
    $('#veh-pagination').innerHTML = paginationHtml(info);
    wirePagination($('#veh-pagination'), (p) => { f.page = p; renderVehiclesTable(); });

    $$('#veh-tbody [data-edit]').forEach(b => b.addEventListener('click', () => openVehicleModal(DB.findVehicle(b.dataset.edit))));
    $$('#veh-tbody [data-toggle]').forEach(b => b.addEventListener('click', () => {
      const v = DB.findVehicle(b.dataset.toggle);
      const next = v.Status === 'Active' ? 'Inactive' : 'Active';
      confirmDialog({
        title: `${next === 'Active' ? 'Activate' : 'Deactivate'} vehicle?`,
        message: `${next === 'Active' ? 'Re-activate' : 'Deactivate'} <strong>${escapeHtml(v.RegistrationNo)}</strong>? ${next==='Inactive' ? 'It will no longer be selectable for new movement entries.' : 'It will become available for new movement entries again.'}`,
        confirmText: next === 'Active' ? 'Activate' : 'Deactivate',
        danger: next === 'Inactive',
        onConfirm: () => { DB.setVehicleStatus(v.RegistrationNo, next, App.user); toast('success', `Vehicle ${next.toLowerCase()}`, v.RegistrationNo); renderVehiclesTable(); },
      });
    }));
    $$('#veh-tbody [data-delete]').forEach(b => b.addEventListener('click', () => {
      const reg = b.dataset.delete;
      if (DB.vehicleHasMovements(reg)){
        toast('error', 'Cannot delete', 'This vehicle has movement history. Deactivate it instead to keep the audit trail intact.');
        return;
      }
      confirmDialog({
        title: 'Delete vehicle?', danger: true, confirmText: 'Delete',
        message: `Permanently delete <strong>${escapeHtml(reg)}</strong> from the vehicle master? This cannot be undone.`,
        onConfirm: () => { DB.deleteVehicle(reg, App.user); toast('success', 'Vehicle deleted', reg); renderVehiclesTable(); },
      });
    }));
  }
  renderVehiclesTable();
}

function openVehicleModal(existing){
  const isEdit = !!existing;
  const backdrop = openModal({
    title: isEdit ? 'Edit Vehicle' : 'Add Vehicle',
    bodyHtml: `
      <div class="field"><label>Registration No. *</label><input type="text" id="v-reg" value="${escapeHtml(existing?.RegistrationNo||'')}" placeholder="e.g. OD-05BS-1960" style="text-transform:uppercase"></div>
      <div class="field"><label>Vehicle Type *</label><input type="text" id="v-type" value="${escapeHtml(existing?.VehicleType||'')}" placeholder="e.g. M Bolero"></div>
      ${isEdit ? `<div class="field"><label>Status</label>
        <select id="v-status"><option value="Active" ${existing.Status==='Active'?'selected':''}>Active</option><option value="Inactive" ${existing.Status!=='Active'?'selected':''}>Inactive</option></select></div>` : ''}
      <div id="v-error" class="error-text" hidden></div>
    `,
    footerHtml: `<button class="btn btn-outline" data-close-modal type="button">Cancel</button><button class="btn btn-primary" id="v-save" type="button">${isEdit?'Save Changes':'Add Vehicle'}</button>`,
  });
  $('#v-save', backdrop).addEventListener('click', () => {
    const reg = $('#v-reg', backdrop).value.trim().toUpperCase();
    const type = $('#v-type', backdrop).value.trim();
    const errBox = $('#v-error', backdrop);
    if (!reg || !type){ errBox.textContent = 'Registration number and vehicle type are required.'; errBox.hidden = false; return; }
    if (DB.isDuplicateReg(reg, isEdit ? existing.RegistrationNo : null)){
      errBox.textContent = `A vehicle with registration "${reg}" already exists.`; errBox.hidden = false; return;
    }
    if (isEdit){
      const status = $('#v-status', backdrop).value;
      DB.updateVehicle(existing.RegistrationNo, { RegistrationNo: reg, VehicleType: type }, App.user);
      DB.setVehicleStatus(reg, status, App.user);
      toast('success', 'Vehicle updated', reg);
    } else {
      DB.addVehicle({ RegistrationNo: reg, VehicleType: type }, App.user);
      toast('success', 'Vehicle added', reg);
    }
    closeModal();
    renderPage('vehicles');
  });
}

/* ============================== MOVEMENTS ============================== */

function canManageMovement(m){
  return App.user.Role === 'Admin' || m.CreatedBy === App.user.Username;
}
function movementsHomeView(){
  return App.user.Role === 'Admin' ? 'list' : 'landing';
}
function statusBadge(m){
  return m.Status === 'Completed'
    ? '<span class="badge badge-good">Completed</span>'
    : '<span class="badge badge-warning">In Progress</span>';
}
function goMovementsHome(){
  const f = App.filters.movements;
  f.editingId = null;
  f.view = movementsHomeView();
  renderPage('movements');
}

function renderMovementsPage(container){
  const f = App.filters.movements;
  if (f.view === 'form') renderMovementForm(container);
  else if (f.view === 'landing') renderOperatorLanding(container);
  else renderMovementList(container);
}

function renderMovementForm(container){
  const f = App.filters.movements;
  let editing = f.editingId ? DB.getMovement(f.editingId) : null;
  if (editing && !canManageMovement(editing)){
    toast('error', 'Not allowed', 'You can only edit entries you created.');
    editing = null;
    f.editingId = null;
  }
  const isCompleted = editing?.Status === 'Completed';
  container.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2 style="display:flex;align-items:center;gap:10px">
          <button class="icon-btn" id="mv-back" type="button">${icon('chevronLeft')}</button>
          ${editing ? 'Edit Movement Entry' : 'New Movement'}
          ${editing ? statusBadge(editing) : ''}
        </h2>
        ${App.user.Role === 'Admin' ? `<button class="btn btn-outline btn-sm" id="mv-view-all" type="button">${icon('list')} View All Entries</button>` : ''}
      </div>
      <div class="card-pad">
        <form id="mv-form">
          <div class="form-row">
            <div class="field"><label>Date *</label><input type="date" id="f-date" value="${editing?.Date || todayISO()}"></div>
            <div class="field"><label>Vehicle *</label><select id="f-vehicle"><option value="">Select Vehicle</option>${vehicleOptionsHtml(editing?.RegistrationNo, { onlyActive: !editing })}</select></div>
          </div>
          <div class="form-row">
            <div class="field"><label>Driver Name *</label><input type="text" id="f-driver" value="${escapeHtml(editing?.DriverName||'')}" placeholder="Enter driver name"></div>
            <div class="field"><label>Requested By</label><input type="text" id="f-reqby" value="${escapeHtml(editing?.RequestedBy||'')}" placeholder="Enter name"></div>
          </div>
          <div class="form-row">
            <div class="field"><label>Opening Time</label><input type="text" id="f-otime" value="${editing?.OpeningTime||''}" placeholder="--:--"></div>
            <div class="field"><label>Opening KM *</label><input type="number" min="0" id="f-okm" value="${editing?.OpeningKM ?? ''}" placeholder="0"></div>
          </div>
          ${isCompleted ? `
          <div class="form-row">
            <div class="field"><label>Closing Time</label><input type="text" id="f-ctime" value="${editing?.ClosingTime||''}" placeholder="--:--"></div>
            <div class="field"><label>Closing KM *</label><input type="number" min="0" id="f-ckm" value="${editing?.ClosingKM ?? ''}" placeholder="0"></div>
          </div>
          <div class="total-km-box">
            <div class="ic">${icon('gauge')}</div>
            <div><div class="lbl">Total KM (Auto)</div><div class="num tabular" id="f-total">0 km</div></div>
          </div>` : `
          <p class="helper-text" style="margin:0 0 4px">${editing
            ? 'This movement is still open — use <strong>Close Entry</strong> below to record the closing time and KM when the vehicle returns.'
            : 'The entry is saved as <strong>In Progress</strong>. Close it from the movements page when the vehicle returns.'}</p>`}
          <div class="field" style="margin-top:14px"><label>Purpose / Place *</label><input type="text" id="f-purpose" value="${escapeHtml(editing?.PurposePlace||'')}" placeholder="Enter purpose or place"></div>
          <div class="field"><label>Permitted By</label><input type="text" id="f-permby" value="${escapeHtml(editing?.PermittedBy||'')}" placeholder="Enter approving authority"></div>
          <div class="field"><label>Remarks</label><textarea id="f-remarks" placeholder="Enter remarks (optional)">${escapeHtml(editing?.Remarks||'')}</textarea></div>
          <div id="f-error" class="error-text" hidden></div>
          ${editing ? `<div class="section-title">Audit History</div><div id="f-history"></div>` : ''}
          <div class="modal-foot" style="padding:16px 0 0;border-top:1px solid var(--border);margin-top:18px">
            ${editing && !isCompleted ? `<button class="btn btn-outline" id="f-close-entry" type="button" style="margin-right:auto;border-color:var(--good);color:var(--good)">${icon('check')} Close Entry</button>` : ''}
            <button class="btn btn-outline" id="f-cancel" type="button">Cancel</button>
            <button class="btn btn-primary" id="f-save" type="submit">${editing ? 'Update Entry' : 'Save Entry'}</button>
          </div>
        </form>
      </div>
    </div>`;

  if (editing){
    const hist = DB.auditForRecord(editing.ID);
    $('#f-history').innerHTML = hist.length ? hist.map(h => `
      <div class="history-item"><strong>${escapeHtml(h.Action)}</strong> by ${escapeHtml(h.User)} — ${escapeHtml(h.Details)}
        <div class="meta">${formatDateTime(h.Timestamp)}</div></div>`).join('')
      : `<div class="helper-text">No history yet.</div>`;
  }

  if (isCompleted){
    const recalc = () => {
      const ok = Number($('#f-okm').value || 0), ck = Number($('#f-ckm').value || 0);
      const total = ck - ok;
      $('#f-total').textContent = fmtKm(total > 0 ? total : 0);
    };
    $('#f-okm').addEventListener('input', recalc);
    $('#f-ckm').addEventListener('input', recalc);
    recalc();
  }

  $('#mv-back').addEventListener('click', goMovementsHome);
  $('#mv-view-all')?.addEventListener('click', goMovementsHome);
  $('#f-cancel').addEventListener('click', goMovementsHome);
  $('#f-close-entry')?.addEventListener('click', () => openCloseMovementModal(editing.ID));

  $('#mv-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const errBox = $('#f-error');
    errBox.hidden = true;
    $$('#mv-form input, #mv-form select').forEach(i => i.classList.remove('invalid'));

    const data = {
      Date: $('#f-date').value,
      RegistrationNo: $('#f-vehicle').value,
      DriverName: $('#f-driver').value.trim(),
      RequestedBy: $('#f-reqby').value.trim(),
      OpeningTime: $('#f-otime').value.trim(),
      OpeningKM: $('#f-okm').value,
      PurposePlace: $('#f-purpose').value.trim(),
      PermittedBy: $('#f-permby').value.trim(),
      Remarks: $('#f-remarks').value.trim(),
    };
    if (isCompleted){
      data.ClosingTime = $('#f-ctime').value.trim();
      data.ClosingKM = $('#f-ckm').value;
    }

    const missing = [];
    if (!data.Date) missing.push('#f-date');
    if (!data.RegistrationNo) missing.push('#f-vehicle');
    if (!data.DriverName) missing.push('#f-driver');
    if (!data.PurposePlace) missing.push('#f-purpose');
    if (data.OpeningKM === '' || isNaN(Number(data.OpeningKM))) missing.push('#f-okm');
    if (data.OpeningTime && normalizeTime(data.OpeningTime) === null) missing.push('#f-otime');
    if (isCompleted){
      if (data.ClosingKM === '' || isNaN(Number(data.ClosingKM))) missing.push('#f-ckm');
      if (data.ClosingTime && normalizeTime(data.ClosingTime) === null) missing.push('#f-ctime');
    }

    if (missing.length){
      missing.forEach(sel => $(sel).classList.add('invalid'));
      errBox.textContent = 'Please fill all required fields correctly (highlighted above).';
      errBox.hidden = false;
      return;
    }
    if (isCompleted && Number(data.ClosingKM) < Number(data.OpeningKM)){
      $('#f-ckm').classList.add('invalid');
      errBox.textContent = 'Closing KM cannot be less than Opening KM.';
      errBox.hidden = false;
      return;
    }

    if (editing){
      DB.updateMovement(editing.ID, data, App.user);
      toast('success', 'Entry updated', `${data.RegistrationNo} on ${formatDateDMY(data.Date)}`);
      goMovementsHome();
    } else {
      DB.addMovement(data, App.user);
      toast('success', 'Movement started', `${data.RegistrationNo} on ${formatDateDMY(data.Date)} — close it when the vehicle returns`);
      if (App.user.Role === 'Admin') renderPage('movements'); // fresh form, ready for another trip
      else goMovementsHome(); // operators see it appear under Open Movements
    }
  });
}

function openCloseMovementModal(id){
  const m = DB.getMovement(id);
  if (!m || m.Status === 'Completed' || !canManageMovement(m)) return;
  const backdrop = openModal({
    title: 'Close Movement Entry',
    bodyHtml: `
      <div class="kv-row"><span class="k">Vehicle</span><span class="v">${escapeHtml(m.RegistrationNo)} (${escapeHtml(m.VehicleType)})</span></div>
      <div class="kv-row"><span class="k">Date · Driver</span><span class="v">${formatDateDMY(m.Date)} · ${escapeHtml(m.DriverName)}</span></div>
      <div class="kv-row"><span class="k">Opening</span><span class="v">${formatTime(m.OpeningTime)} · ${formatNumber(m.OpeningKM)} km</span></div>
      <div class="form-row" style="margin-top:16px">
        <div class="field"><label>Closing Time</label><input type="text" id="c-time" placeholder="--:--"></div>
        <div class="field"><label>Closing KM *</label><input type="number" min="0" id="c-km" placeholder="${m.OpeningKM}"></div>
      </div>
      <div class="total-km-box">
        <div class="ic">${icon('gauge')}</div>
        <div><div class="lbl">Total KM (Auto)</div><div class="num tabular" id="c-total">0 km</div></div>
      </div>
      <div id="c-error" class="error-text" hidden style="margin-top:10px"></div>`,
    footerHtml: `<button class="btn btn-outline" data-close-modal type="button">Cancel</button>
      <button class="btn btn-primary" id="c-save" type="button">${icon('check')} Close Entry</button>`,
  });
  $('#c-km', backdrop).addEventListener('input', () => {
    const t = Number($('#c-km', backdrop).value || 0) - Number(m.OpeningKM);
    $('#c-total', backdrop).textContent = fmtKm(t > 0 ? t : 0);
  });
  $('#c-km', backdrop).focus();
  $('#c-save', backdrop).addEventListener('click', () => {
    const err = $('#c-error', backdrop);
    const time = $('#c-time', backdrop).value.trim();
    const km = $('#c-km', backdrop).value;
    const fail = (msg) => { err.textContent = msg; err.hidden = false; };
    if (km === '' || isNaN(Number(km))){ fail('Closing KM is required.'); return; }
    if (Number(km) < Number(m.OpeningKM)){ fail('Closing KM cannot be less than Opening KM.'); return; }
    if (time && normalizeTime(time) === null){ fail('Closing time must be a valid time, e.g. 1430 or 14:30.'); return; }
    DB.closeMovement(m.ID, { ClosingTime: time, ClosingKM: Number(km) }, App.user);
    closeModal();
    toast('success', 'Movement closed', `${m.RegistrationNo} · ${fmtKm(Number(km) - Number(m.OpeningKM))}`);
    goMovementsHome();
  });
}

function confirmDeleteMovement(m, onDone){
  confirmDialog({
    title: 'Delete movement entry?', danger: true, confirmText: 'Delete',
    message: `Permanently delete the entry for <strong>${escapeHtml(m.RegistrationNo)}</strong> on ${formatDateDMY(m.Date)}${m.CreatedBy !== App.user.Username ? ` (created by <strong>${escapeHtml(m.CreatedBy)}</strong>)` : ''}? This cannot be undone and will be recorded in the audit log.`,
    onConfirm: () => {
      DB.deleteMovement(m.ID, App.user);
      toast('success', 'Entry deleted', `${m.RegistrationNo} on ${formatDateDMY(m.Date)}`);
      onDone();
    },
  });
}

/* Operator home: their open trips up top, their full history below. */
function renderOperatorLanding(container){
  const f = App.filters.movements;
  const mine = DB.movements.filter(m => m.CreatedBy === App.user.Username);
  const open = mine.filter(m => m.Status !== 'Completed')
    .sort((a, b) => String(b.CreatedAt).localeCompare(String(a.CreatedAt)));

  container.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="card-head">
        <h2 style="display:flex;align-items:center;gap:8px">Open Movements
          ${open.length ? `<span class="badge badge-warning">${open.length}</span>` : ''}</h2>
        <button class="btn btn-primary btn-sm" id="mv-new" type="button">${icon('plus')} New Entry</button>
      </div>
      <div class="card-pad" id="open-list"></div>
    </div>

    <div class="card">
      <div class="card-head"><h2>My Entries</h2></div>
      <div class="card-pad">
        <div class="filter-bar">
          <div class="field grow"><label>Search</label><div class="input-icon">${icon('search')}<input type="search" id="ml-search" placeholder="Driver, vehicle, purpose…" value="${escapeHtml(f.search)}"></div></div>
          <div class="field"><label>From Date</label><input type="date" id="ml-from" value="${f.from}"></div>
          <div class="field"><label>To Date</label><input type="date" id="ml-to" value="${f.to}"></div>
          <div class="actions"><button class="btn btn-outline" id="ml-clear" type="button">Clear</button></div>
        </div>
        <div class="table-wrap cards-sm"><table class="data-table">
          <thead><tr><th>Date</th><th>Vehicle</th><th>Driver</th><th>Status</th><th>Total KM</th><th>Actions</th></tr></thead>
          <tbody id="ml-tbody"></tbody>
        </table></div>
        <div id="ml-empty"></div>
        <div id="ml-pagination"></div>
      </div>
    </div>`;

  $('#open-list').innerHTML = open.length ? open.map(m => `
    <div class="open-mv-row">
      <div>
        <div><strong>${escapeHtml(m.RegistrationNo)}</strong> <span class="cell-muted">${escapeHtml(m.VehicleType)}</span></div>
        <div class="meta">${formatDateDMY(m.Date)} · out ${formatTime(m.OpeningTime)} at ${formatNumber(m.OpeningKM)} km · ${escapeHtml(m.DriverName)}</div>
      </div>
      <div class="acts">
        <button class="btn btn-primary btn-sm" data-close="${m.ID}" type="button">${icon('check')} Close</button>
        <button class="icon-btn" data-edit="${m.ID}" title="Edit" type="button">${icon('edit')}</button>
        <button class="icon-btn danger" data-del="${m.ID}" title="Delete" type="button">${icon('trash')}</button>
      </div>
    </div>`).join('')
    : `<div class="empty-state" style="padding:24px 16px">${icon('car')}<div>No open movements. Tap <strong>New Entry</strong> when a vehicle goes out.</div></div>`;

  $('#mv-new').addEventListener('click', () => { f.editingId = null; f.view = 'form'; renderPage('movements'); });
  $('#ml-search').addEventListener('input', debounce(() => { f.search = $('#ml-search').value; f.page = 1; renderTable(); }, 200));
  $('#ml-from').addEventListener('change', () => { f.from = $('#ml-from').value; f.page = 1; renderTable(); });
  $('#ml-to').addEventListener('change', () => { f.to = $('#ml-to').value; f.page = 1; renderTable(); });
  $('#ml-clear').addEventListener('click', () => { Object.assign(f, { search:'', from:'', to:'', page:1 }); renderPage('movements'); });

  const wireRowActions = (root, refresh) => {
    $$('[data-close]', root).forEach(b => b.addEventListener('click', () => openCloseMovementModal(b.dataset.close)));
    $$('[data-edit]', root).forEach(b => b.addEventListener('click', () => { f.editingId = b.dataset.edit; f.view = 'form'; renderPage('movements'); }));
    $$('[data-del]', root).forEach(b => b.addEventListener('click', () => confirmDeleteMovement(DB.getMovement(b.dataset.del), refresh)));
    $$('[data-view]', root).forEach(b => b.addEventListener('click', () => openMovementDetailModal(b.dataset.view)));
  };
  wireRowActions($('#open-list'), () => renderPage('movements'));

  function renderTable(){
    const q = f.search.trim().toLowerCase();
    const rows = mine.filter(m => {
      if (f.from && m.Date < f.from) return false;
      if (f.to && m.Date > f.to) return false;
      if (q && !(`${m.DriverName} ${m.PurposePlace} ${m.RegistrationNo}`.toLowerCase().includes(q))) return false;
      return true;
    }).sort((a, b) => b.Date.localeCompare(a.Date) || String(b.CreatedAt).localeCompare(String(a.CreatedAt)));

    const info = paginate(rows, f.page, 8);
    $('#ml-empty').innerHTML = info.total ? '' : `<div class="empty-state">${icon('doc')}<div>No entries match your filters.</div></div>`;
    $('#ml-tbody').innerHTML = info.rows.map(m => `
      <tr>
        <td class="tabular" data-label="Date">${formatDateDMY(m.Date)}</td>
        <td data-label="Vehicle"><strong>${escapeHtml(m.RegistrationNo)}</strong><div class="cell-muted" style="font-size:11.5px">${escapeHtml(m.VehicleType)}</div></td>
        <td data-label="Driver">${escapeHtml(m.DriverName)}</td>
        <td data-label="Status">${statusBadge(m)}</td>
        <td class="tabular" data-label="Total KM"><strong>${m.Status === 'Completed' ? formatNumber(m.TotalKM) : '—'}</strong></td>
        <td class="row-actions">
          <button class="icon-btn" data-view="${m.ID}" title="View details" type="button">${icon('eye')}</button>
          ${m.Status !== 'Completed' ? `<button class="icon-btn" data-close="${m.ID}" title="Close" type="button">${icon('check')}</button>` : ''}
          <button class="icon-btn" data-edit="${m.ID}" title="Edit" type="button">${icon('edit')}</button>
          <button class="icon-btn danger" data-del="${m.ID}" title="Delete" type="button">${icon('trash')}</button>
        </td>
      </tr>`).join('');
    $('#ml-pagination').innerHTML = paginationHtml(info);
    wirePagination($('#ml-pagination'), (p) => { f.page = p; renderTable(); });
    wireRowActions($('#ml-tbody'), () => renderPage('movements'));
  }
  renderTable();
}

function renderMovementList(container){
  const f = App.filters.movements;
  container.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>All Movement Entries</h2>
        <button class="btn btn-primary btn-sm" id="mv-new" type="button">${icon('plus')} New Entry</button>
      </div>
      <div class="card-pad">
        <div class="filter-bar">
          <div class="field grow"><label>Search</label><div class="input-icon">${icon('search')}<input type="search" id="ml-search" placeholder="Driver, requested by, purpose…" value="${escapeHtml(f.search)}"></div></div>
          <div class="field"><label>From Date</label><input type="date" id="ml-from" value="${f.from}"></div>
          <div class="field"><label>To Date</label><input type="date" id="ml-to" value="${f.to}"></div>
          <div class="field"><label>Vehicle</label><select id="ml-vehicle"><option value="ALL">All Vehicles</option>${vehicleOptionsHtml(f.vehicle==='ALL'?'':f.vehicle)}</select></div>
          <div class="actions"><button class="btn btn-outline" id="ml-clear" type="button">Clear</button></div>
        </div>
        <div class="table-wrap cards-sm"><table class="data-table">
          <thead><tr><th>Date</th><th>Vehicle</th><th>Driver</th><th>Requested By</th><th>Opening KM</th><th>Closing KM</th><th>Total KM</th><th>Status</th><th>Purpose</th><th>Actions</th></tr></thead>
          <tbody id="ml-tbody"></tbody>
        </table></div>
        <div id="ml-empty"></div>
        <div id="ml-pagination"></div>
      </div>
    </div>`;

  $('#mv-new').addEventListener('click', () => { f.editingId = null; f.view = 'form'; renderPage('movements'); });
  $('#ml-search').addEventListener('input', debounce(() => { f.search = $('#ml-search').value; f.page = 1; renderTable(); }, 200));
  $('#ml-from').addEventListener('change', () => { f.from = $('#ml-from').value; f.page = 1; renderTable(); });
  $('#ml-to').addEventListener('change', () => { f.to = $('#ml-to').value; f.page = 1; renderTable(); });
  $('#ml-vehicle').addEventListener('change', () => { f.vehicle = $('#ml-vehicle').value; f.page = 1; renderTable(); });
  $('#ml-clear').addEventListener('click', () => {
    Object.assign(f, { search:'', from:'', to:'', vehicle:'ALL', page:1 });
    renderPage('movements');
  });

  function renderTable(){
    const q = f.search.trim().toLowerCase();
    let rows = DB.movements.filter(m => {
      if (f.from && m.Date < f.from) return false;
      if (f.to && m.Date > f.to) return false;
      if (f.vehicle !== 'ALL' && m.RegistrationNo !== f.vehicle) return false;
      if (q && !(`${m.DriverName} ${m.RequestedBy} ${m.PurposePlace} ${m.RegistrationNo}`.toLowerCase().includes(q))) return false;
      return true;
    }).sort((a,b) => b.Date.localeCompare(a.Date) || b.ID.localeCompare(a.ID));

    const info = paginate(rows, f.page, 8);
    $('#ml-empty').innerHTML = info.total ? '' : `<div class="empty-state">${icon('doc')}<div>No movement entries match your filters.</div></div>`;
    $('#ml-tbody').innerHTML = info.rows.map(m => `
      <tr>
        <td class="tabular" data-label="Date">${formatDateDMY(m.Date)}</td>
        <td data-label="Vehicle"><strong>${escapeHtml(m.RegistrationNo)}</strong><div class="cell-muted" style="font-size:11.5px">${escapeHtml(m.VehicleType)}</div></td>
        <td data-label="Driver">${escapeHtml(m.DriverName)}</td>
        <td data-label="Requested By">${escapeHtml(m.RequestedBy) || '—'}</td>
        <td class="tabular" data-label="Opening KM">${formatNumber(m.OpeningKM)}</td>
        <td class="tabular" data-label="Closing KM">${m.Status === 'Completed' ? formatNumber(m.ClosingKM) : '—'}</td>
        <td class="tabular" data-label="Total KM"><strong>${m.Status === 'Completed' ? formatNumber(m.TotalKM) : '—'}</strong></td>
        <td data-label="Status">${statusBadge(m)}</td>
        <td data-label="Purpose">${escapeHtml(m.PurposePlace)}</td>
        <td class="row-actions">
          <button class="icon-btn" data-view="${m.ID}" title="View details" type="button">${icon('eye')}</button>
          ${m.Status !== 'Completed' ? `<button class="icon-btn" data-close="${m.ID}" title="Close" type="button">${icon('check')}</button>` : ''}
          <button class="icon-btn" data-edit="${m.ID}" title="Edit" type="button">${icon('edit')}</button>
          <button class="icon-btn danger" data-del="${m.ID}" title="Delete" type="button">${icon('trash')}</button>
        </td>
      </tr>`).join('');
    $('#ml-pagination').innerHTML = paginationHtml(info);
    wirePagination($('#ml-pagination'), (p) => { f.page = p; renderTable(); });

    $$('#ml-tbody [data-edit]').forEach(b => b.addEventListener('click', () => {
      f.editingId = b.dataset.edit; f.view = 'form'; renderPage('movements');
    }));
    $$('#ml-tbody [data-view]').forEach(b => b.addEventListener('click', () => openMovementDetailModal(b.dataset.view)));
    $$('#ml-tbody [data-close]').forEach(b => b.addEventListener('click', () => openCloseMovementModal(b.dataset.close)));
    $$('#ml-tbody [data-del]').forEach(b => b.addEventListener('click', () => confirmDeleteMovement(DB.getMovement(b.dataset.del), renderTable)));
  }
  renderTable();
}

function openMovementDetailModal(id){
  const m = DB.getMovement(id);
  if (!m) return;
  const hist = DB.auditForRecord(id);
  openModal({
    title: `Movement ${m.ID}`,
    large: true,
    bodyHtml: `
      <div class="two-col">
        <div>
          <div class="kv-row"><span class="k">Date</span><span class="v">${formatDateDMY(m.Date)}</span></div>
          <div class="kv-row"><span class="k">Vehicle</span><span class="v">${escapeHtml(m.RegistrationNo)} (${escapeHtml(m.VehicleType)})</span></div>
          <div class="kv-row"><span class="k">Driver</span><span class="v">${escapeHtml(m.DriverName)}</span></div>
          <div class="kv-row"><span class="k">Requested By</span><span class="v">${escapeHtml(m.RequestedBy)||'—'}</span></div>
          <div class="kv-row"><span class="k">Permitted By</span><span class="v">${escapeHtml(m.PermittedBy)||'—'}</span></div>
          <div class="kv-row"><span class="k">Status</span><span class="v">${statusBadge(m)}</span></div>
          <div class="kv-row"><span class="k">Opening</span><span class="v">${formatTime(m.OpeningTime)} · ${formatNumber(m.OpeningKM)} km</span></div>
          <div class="kv-row"><span class="k">Closing</span><span class="v">${m.Status === 'Completed' ? `${formatTime(m.ClosingTime)} · ${formatNumber(m.ClosingKM)} km` : '— still open'}</span></div>
          <div class="kv-row"><span class="k">Total KM</span><span class="v"><strong>${m.Status === 'Completed' ? fmtKm(m.TotalKM) : '—'}</strong></span></div>
          <div class="kv-row"><span class="k">Purpose / Place</span><span class="v">${escapeHtml(m.PurposePlace)}</span></div>
          <div class="kv-row"><span class="k">Remarks</span><span class="v">${escapeHtml(m.Remarks)||'—'}</span></div>
          <div class="kv-row"><span class="k">Created</span><span class="v">${escapeHtml(m.CreatedBy)} · ${formatDateTime(m.CreatedAt)}</span></div>
          ${m.UpdatedAt ? `<div class="kv-row"><span class="k">Last Updated</span><span class="v">${escapeHtml(m.UpdatedBy)} · ${formatDateTime(m.UpdatedAt)}</span></div>` : ''}
        </div>
        <div>
          <div class="section-title" style="margin-top:0">Audit History</div>
          ${hist.length ? hist.map(h => `<div class="history-item"><strong>${escapeHtml(h.Action)}</strong> by ${escapeHtml(h.User)} — ${escapeHtml(h.Details)}<div class="meta">${formatDateTime(h.Timestamp)}</div></div>`).join('') : '<div class="helper-text">No history yet.</div>'}
        </div>
      </div>`,
    footerHtml: `<button class="btn btn-outline" data-close-modal type="button">Close</button>
      ${canManageMovement(m) ? `<button class="btn btn-primary" id="detail-edit" type="button">${icon('edit')} Edit Entry</button>` : ''}`,
    onMount: (bd) => $('#detail-edit', bd)?.addEventListener('click', () => {
      closeModal();
      App.filters.movements.editingId = id;
      App.filters.movements.view = 'form';
      renderPage('movements');
    }),
  });
}

/* ============================== REPORTS ============================== */

function renderReportsPage(container){
  const f = App.filters.reports;
  container.innerHTML = `
    <div class="card card-pad filter-bar">
      <div class="field"><label>From Date</label><input type="date" id="rp-from" value="${f.from}"></div>
      <div class="field"><label>To Date</label><input type="date" id="rp-to" value="${f.to}"></div>
      <div class="field grow"><label>Vehicle</label><select id="rp-vehicle"><option value="ALL">All Vehicles</option>${vehicleOptionsHtml(f.vehicle==='ALL'?'':f.vehicle)}</select></div>
      <div class="actions"><button class="btn btn-primary" id="rp-generate" type="button">${icon('list')} Generate Report</button></div>
    </div>
    <div class="card">
      <div class="card-head">
        <h2 id="rp-heading">Report</h2>
        <div class="actions" id="rp-export" style="display:flex;gap:8px" hidden>
          <button class="btn btn-outline btn-sm" id="rp-xlsx" type="button">${icon('download')} Excel (.xlsx)</button>
          <button class="btn btn-outline btn-sm" id="rp-pdf" type="button">${icon('download')} PDF</button>
        </div>
      </div>
      <div class="card-pad" id="rp-body">
        <div class="empty-state">${icon('list')}<div>Choose a date range and click <strong>Generate Report</strong> to view results.</div></div>
      </div>
    </div>`;

  $('#rp-generate').addEventListener('click', () => {
    f.from = $('#rp-from').value || todayISO();
    f.to = $('#rp-to').value || todayISO();
    f.vehicle = $('#rp-vehicle').value;
    f.generated = true;
    renderReportBody();
  });

  function currentRows(){
    return DB.movementsInRange(f.from, f.to, f.vehicle).slice().sort((a,b) => a.Date.localeCompare(b.Date));
  }

  function renderReportBody(){
    if (!f.generated) return;
    const rows = currentRows();
    const totalKm = rows.reduce((s,m) => s + Number(m.TotalKM||0), 0);
    const vehiclesUsed = new Set(rows.map(m => m.RegistrationNo)).size;
    $('#rp-heading').textContent = `Report: ${formatDateDMY(f.from)} to ${formatDateDMY(f.to)}`;
    $('#rp-export').hidden = false;

    $('#rp-body').innerHTML = !rows.length
      ? `<div class="empty-state">${icon('doc')}<div>No movement records found for this selection.</div></div>`
      : `
        <div class="helper-text" style="margin-bottom:14px;font-size:13px;color:var(--text-secondary)">
          <strong>${rows.length}</strong> trip(s) · <strong>${vehiclesUsed}</strong> vehicle(s) used · <strong>${fmtKm(totalKm)}</strong> total ·
          generated by ${escapeHtml(App.user.DisplayName)} on ${formatDateTime(new Date().toISOString())}
        </div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Date</th><th>Vehicle</th><th>Type</th><th>Driver</th><th>Requested By</th><th>Opening KM</th><th>Closing KM</th><th>Total KM</th><th>Status</th><th>Purpose</th><th>Permitted By</th></tr></thead>
          <tbody>
            ${rows.map(m => `<tr>
              <td class="tabular">${formatDateDMY(m.Date)}</td>
              <td>${escapeHtml(m.RegistrationNo)}</td>
              <td>${escapeHtml(m.VehicleType)}</td>
              <td>${escapeHtml(m.DriverName)}</td>
              <td>${escapeHtml(m.RequestedBy)}</td>
              <td class="tabular">${formatNumber(m.OpeningKM)}</td>
              <td class="tabular">${m.Status === 'Completed' ? formatNumber(m.ClosingKM) : '—'}</td>
              <td class="tabular">${m.Status === 'Completed' ? formatNumber(m.TotalKM) : '—'}</td>
              <td>${statusBadge(m)}</td>
              <td>${escapeHtml(m.PurposePlace)}</td>
              <td>${escapeHtml(m.PermittedBy)}</td>
            </tr>`).join('')}
          </tbody>
          <tfoot><tr><td colspan="7">Total</td><td class="tabular">${formatNumber(totalKm)}</td><td colspan="3"></td></tr></tfoot>
        </table></div>`;
  }

  $('#rp-xlsx').addEventListener('click', () => {
    const rows = currentRows();
    if (!rows.length){ toast('error', 'Nothing to export', 'Generate a report with at least one record first.'); return; }
    exportReportXlsx(f, rows);
  });
  $('#rp-pdf').addEventListener('click', () => {
    const rows = currentRows();
    if (!rows.length){ toast('error', 'Nothing to export', 'Generate a report with at least one record first.'); return; }
    exportReportPdf(f, rows);
  });
}

function exportReportXlsx(f, rows){
  const totalKm = rows.reduce((s,m) => s + Number(m.TotalKM||0), 0);
  const aoa = [
    ['03 BN NDRF, MUNDALI — Daily Vehicle Movement Report'],
    [`Date Range: ${formatDateDMY(f.from)} to ${formatDateDMY(f.to)}`],
    [`Vehicle: ${f.vehicle === 'ALL' ? 'All Vehicles' : f.vehicle}`],
    [`Generated by: ${App.user.DisplayName} on ${formatDateTime(new Date().toISOString())}`],
    [],
    ['Date','Vehicle','Type','Driver','Requested By','Opening KM','Closing KM','Total KM','Status','Purpose / Place','Permitted By'],
    ...rows.map(m => [formatDateDMY(m.Date), m.RegistrationNo, m.VehicleType, m.DriverName, m.RequestedBy, m.OpeningKM, m.ClosingKM, m.TotalKM, m.Status, m.PurposePlace, m.PermittedBy]),
    [],
    ['', '', '', '', '', '', 'Total', totalKm, '', '', ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{wch:12},{wch:14},{wch:12},{wch:16},{wch:16},{wch:11},{wch:11},{wch:10},{wch:12},{wch:24},{wch:14}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  XLSX.writeFile(wb, `Vehicle_Movement_Report_${f.from}_to_${f.to}.xlsx`);
  toast('success', 'Excel report downloaded');
}

function exportReportPdf(f, rows){
  if (!window.jspdf){ toast('error', 'PDF library unavailable', 'Check your internet connection and try again.'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape' });
  const totalKm = rows.reduce((s,m) => s + Number(m.TotalKM||0), 0);
  doc.setFontSize(14); doc.text('03 BN NDRF, MUNDALI — Daily Vehicle Movement Report', 14, 14);
  doc.setFontSize(10); doc.setTextColor(90);
  doc.text(`Date Range: ${formatDateDMY(f.from)} to ${formatDateDMY(f.to)}   |   Vehicle: ${f.vehicle==='ALL'?'All Vehicles':f.vehicle}`, 14, 21);
  doc.text(`Generated by ${App.user.DisplayName} on ${formatDateTime(new Date().toISOString())}`, 14, 27);
  doc.autoTable({
    startY: 33,
    head: [['Date','Vehicle','Type','Driver','Requested By','Opening KM','Closing KM','Total KM','Status','Purpose / Place','Permitted By']],
    body: rows.map(m => [formatDateDMY(m.Date), m.RegistrationNo, m.VehicleType, m.DriverName, m.RequestedBy, formatNumber(m.OpeningKM), formatNumber(m.ClosingKM), formatNumber(m.TotalKM), m.Status, m.PurposePlace, m.PermittedBy]),
    foot: [['', '', '', '', '', '', 'Total', formatNumber(totalKm), '', '', '']],
    styles: { fontSize: 8.5 },
    headStyles: { fillColor: [42,120,214] },
    footStyles: { fillColor: [238,242,251], textColor: [20,24,31] },
  });
  doc.save(`Vehicle_Movement_Report_${f.from}_to_${f.to}.pdf`);
  toast('success', 'PDF report downloaded');
}

/* ============================== AUDIT LOG ============================== */

function renderAuditPage(container){
  const f = App.filters.audit;
  container.innerHTML = `
    <div class="card">
      <div class="card-head" style="flex-wrap:wrap;gap:10px">
        <div class="input-icon" style="flex:1;min-width:220px">${icon('search')}<input type="search" id="au-search" placeholder="Search user, action, or record…" value="${escapeHtml(f.search)}"></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <input type="date" id="au-from" value="${f.from}">
          <input type="date" id="au-to" value="${f.to}">
          <button class="btn btn-outline btn-sm" id="au-clear" type="button">Clear</button>
        </div>
      </div>
      <div class="card-pad">
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>#</th><th>Timestamp</th><th>User</th><th>Action</th><th>Record</th><th>Details</th></tr></thead>
          <tbody id="au-tbody"></tbody>
        </table></div>
        <div id="au-empty"></div>
        <div id="au-pagination"></div>
      </div>
    </div>`;

  $('#au-search').addEventListener('input', debounce(() => { f.search = $('#au-search').value; f.page = 1; renderTable(); }, 200));
  $('#au-from').addEventListener('change', () => { f.from = $('#au-from').value; f.page = 1; renderTable(); });
  $('#au-to').addEventListener('change', () => { f.to = $('#au-to').value; f.page = 1; renderTable(); });
  $('#au-clear').addEventListener('click', () => { Object.assign(f, { search:'', from:'', to:'', page:1 }); renderPage('audit'); });

  function renderTable(){
    const q = f.search.trim().toLowerCase();
    let rows = DB.auditLog.filter(a => {
      const day = (a.Timestamp || '').slice(0,10);
      if (f.from && day < f.from) return false;
      if (f.to && day > f.to) return false;
      if (q && !(`${a.User} ${a.Action} ${a.RecordType} ${a.RecordId} ${a.Details}`.toLowerCase().includes(q))) return false;
      return true;
    }).sort((a,b) => new Date(b.Timestamp) - new Date(a.Timestamp));

    const info = paginate(rows, f.page, 10);
    $('#au-empty').innerHTML = info.total ? '' : `<div class="empty-state">${icon('clock')}<div>No audit entries match your filters.</div></div>`;
    $('#au-tbody').innerHTML = info.rows.map((a, i) => `
      <tr>
        <td class="cell-muted">${info.start + i + 1}</td>
        <td class="tabular">${formatDateTime(a.Timestamp)}</td>
        <td>${escapeHtml(a.User)}</td>
        <td>${actionBadge(a.Action)}</td>
        <td>${escapeHtml(a.RecordType)}${a.RecordId && a.RecordId !== '-' ? ` · ${escapeHtml(a.RecordId)}` : ''}</td>
        <td class="cell-muted">${escapeHtml(a.Details)}</td>
      </tr>`).join('');
    $('#au-pagination').innerHTML = paginationHtml(info);
    wirePagination($('#au-pagination'), (p) => { f.page = p; renderTable(); });
  }
  renderTable();
}

/* ============================== SETTINGS ============================== */

function renderSettingsPage(container){
  const isAdmin = App.user.Role === 'Admin';
  container.innerHTML = `
    <div class="${isAdmin ? 'two-col' : ''}" style="${isAdmin ? '' : 'max-width:520px'}">
      <div class="card card-pad">
        <div class="section-title" style="margin-top:0">Profile</div>
        <div class="kv-row"><span class="k">Display Name</span><span class="v">${escapeHtml(App.user.DisplayName)}</span></div>
        <div class="kv-row"><span class="k">Username</span><span class="v">${escapeHtml(App.user.Username)}</span></div>
        <div class="kv-row"><span class="k">Role</span><span class="v">${escapeHtml(App.user.Role)}</span></div>
        <div class="section-title">Change Password</div>
        <form id="pwd-form">
          <div class="field"><label>Current Password</label><input type="password" id="pw-current"></div>
          <div class="field"><label>New Password</label><input type="password" id="pw-new"></div>
          <div class="field"><label>Confirm New Password</label><input type="password" id="pw-confirm"></div>
          <div id="pw-error" class="error-text" hidden></div>
          <button class="btn btn-primary" type="submit">Update Password</button>
        </form>
      </div>

      ${isAdmin ? `
      <div class="card card-pad">
        <div class="section-title" style="margin-top:0">Data Management</div>
        <div class="kv-row"><span class="k">Data Source</span><span class="v">${escapeHtml(DB.meta.source || '—')}</span></div>
        <div class="kv-row"><span class="k">Last Synced</span><span class="v">${DB.meta.loadedAt ? formatDateTime(DB.meta.loadedAt) : '—'}</span></div>
        <p class="helper-text">Data is stored in Cloud Firestore and shared live with every user. Export a backup regularly for safekeeping. Importing a backup or resetting affects <strong>all users immediately</strong>.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
          <button class="btn btn-outline" id="btn-export-backup" type="button">${icon('download')} Export Full Backup (.xlsx)</button>
          <button class="btn btn-outline" id="btn-import" type="button">${icon('upload')} Import Register / Backup</button>
          <input type="file" id="import-file" accept=".xlsx" hidden>
          <button class="btn btn-danger" id="btn-reset" type="button">${icon('refresh')} Reset to Bundled Sample Data</button>
        </div>
      </div>` : ''}
    </div>

    ${isAdmin ? `
    <div class="card" style="margin-top:16px">
      <div class="card-head"><h2>User Management</h2><button class="btn btn-primary btn-sm" id="btn-add-user" type="button">${icon('plus')} Add User</button></div>
      <div class="card-pad">
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Username</th><th>Display Name</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody id="user-tbody"></tbody>
        </table></div>
      </div>
    </div>` : ''}
  `;

  $('#pwd-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const cur = $('#pw-current').value, nw = $('#pw-new').value, cf = $('#pw-confirm').value;
    const errBox = $('#pw-error');
    const fail = (msg) => { errBox.textContent = msg; errBox.hidden = false; };
    if (nw.length < 6){ fail('New password must be at least 6 characters.'); return; }
    if (nw !== cf){ fail('New password and confirmation do not match.'); return; }
    try {
      const cred = FB.EmailAuthProvider.credential(DB.emailFor(App.user.Username), cur);
      await FB.reauthenticateWithCredential(FB.auth.currentUser, cred);
      await FB.updatePassword(FB.auth.currentUser, nw);
      DB.logAudit(App.user, 'Updated', 'User', App.user.Username, 'Password changed');
      errBox.hidden = true;
      toast('success', 'Password updated');
      $('#pwd-form').reset();
    } catch (err){
      if (['auth/invalid-credential', 'auth/wrong-password'].includes(err.code)) fail('Current password is incorrect.');
      else if (err.code === 'auth/weak-password') fail('New password is too weak.');
      else { fail('Could not update password: ' + (err.message || err.code)); console.error(err); }
    }
  });

  if (!isAdmin) return;

  $('#btn-export-backup').addEventListener('click', () => { DB.exportBackupXlsx(); toast('success', 'Backup downloaded'); });

  $('#btn-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    confirmDialog({
      title: 'Import file?',
      message: `Import <strong>${escapeHtml(file.name)}</strong>? A full backup replaces all vehicle/movement data <strong>for every user</strong>; a daily register sheet adds/merges its vehicles and trips. User accounts are not affected.`,
      confirmText: 'Import',
      onConfirm: async () => {
        try {
          showLoadingOverlay('Importing…');
          const result = await DB.importFile(file, App.user);
          hideLoadingOverlay();
          if (result.mode === 'full'){
            toast('success', 'Backup imported', `${result.vehicles} vehicles, ${result.movements} movements loaded.`);
          } else {
            toast('success', 'Register imported', `${result.vehiclesAdded} new vehicle(s), ${result.movementsAdded} movement row(s) added for ${formatDateDMY(result.dateISO)}.`);
          }
          renderPage('settings');
        } catch(err){
          hideLoadingOverlay();
          toast('error', 'Import failed', err.message || 'Could not read this file.');
        }
      },
    });
    e.target.value = '';
  });

  $('#btn-reset').addEventListener('click', () => {
    confirmDialog({
      title: 'Reset all data?', danger: true, confirmText: 'Reset',
      message: 'This replaces the cloud database with the bundled sample register — <strong>for every user, immediately</strong>. User accounts are kept. This cannot be undone.',
      onConfirm: async () => {
        showLoadingOverlay('Resetting…');
        await DB.resetToBundled();
        hideLoadingOverlay();
        toast('success', 'Data reset to bundled sample');
        renderPage('settings');
      },
    });
  });

  if (isAdmin){
    function renderUsers(){
      $('#user-tbody').innerHTML = DB.users.map(u => `
        <tr>
          <td><strong>${escapeHtml(u.Username)}</strong></td>
          <td>${escapeHtml(u.DisplayName)}</td>
          <td>${escapeHtml(u.Role)}</td>
          <td><span class="badge ${String(u.Active).toLowerCase()==='yes'?'badge-good':'badge-muted'}">${String(u.Active).toLowerCase()==='yes'?'Active':'Inactive'}</span></td>
          <td class="row-actions">
            <button class="icon-btn" data-utoggle="${u.Username}" title="Toggle access" type="button">${icon(String(u.Active).toLowerCase()==='yes'?'x':'check')}</button>
          </td>
        </tr>`).join('');
      $$('#user-tbody [data-utoggle]').forEach(b => b.addEventListener('click', () => {
        const u = DB.findUser(b.dataset.utoggle);
        if (u.Username === App.user.Username){ toast('error', 'Not allowed', "You can't revoke your own access."); return; }
        DB.setUserActive(u.Username, String(u.Active).toLowerCase() !== 'yes', App.user);
        renderUsers();
      }));
    }
    renderUsers();

    $('#btn-add-user').addEventListener('click', () => {
      openModal({
        title: 'Add User',
        bodyHtml: `
          <div class="field"><label>Username *</label><input type="text" id="u-username"></div>
          <div class="field"><label>Display Name *</label><input type="text" id="u-display"></div>
          <div class="field"><label>Password *</label><input type="text" id="u-password"></div>
          <div class="field"><label>Role</label><select id="u-role"><option>Operator</option><option>Admin</option></select></div>
          <div id="u-error" class="error-text" hidden></div>`,
        footerHtml: `<button class="btn btn-outline" data-close-modal type="button">Cancel</button><button class="btn btn-primary" id="u-save" type="button">Add User</button>`,
        onMount: (bd) => $('#u-save', bd).addEventListener('click', async () => {
          const username = $('#u-username', bd).value.trim().toLowerCase();
          const display = $('#u-display', bd).value.trim();
          const pw = $('#u-password', bd).value;
          const role = $('#u-role', bd).value;
          const err = $('#u-error', bd);
          const fail = (msg) => { err.textContent = msg; err.hidden = false; };
          if (!username || !display || !pw){ fail('All fields are required.'); return; }
          if (!/^[a-z0-9._-]+$/.test(username)){ fail('Username can only contain letters, numbers, dots, dashes and underscores.'); return; }
          if (pw.length < 6){ fail('Password must be at least 6 characters.'); return; }
          if (DB.findUser(username)){ fail('That username is already taken.'); return; }
          const btn = $('#u-save', bd);
          btn.disabled = true;
          try {
            // Create the account on a secondary Firebase app instance so the
            // signed-in admin session is not replaced by the new user.
            const secondary = FB.getApps().some(a => a.name === 'user-creation')
              ? FB.getApp('user-creation')
              : FB.initializeApp(FB.firebaseConfig, 'user-creation');
            const secondaryAuth = FB.getAuth(secondary);
            await FB.createUserWithEmailAndPassword(secondaryAuth, DB.emailFor(username), pw);
            await FB.signOut(secondaryAuth);
            DB.addUserProfile({ Username: username, DisplayName: display, Role: role }, App.user);
            toast('success', 'User added', username);
            closeModal();
            renderPage('settings');
          } catch (e2){
            btn.disabled = false;
            if (e2.code === 'auth/email-already-in-use') fail('That username is already taken.');
            else if (e2.code === 'auth/weak-password') fail('Password is too weak (minimum 6 characters).');
            else { fail('Could not create user: ' + (e2.message || e2.code)); console.error(e2); }
          }
        }),
      });
    });
  }
}

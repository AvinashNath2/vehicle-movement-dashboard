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

function driverPickerOptions(){
  const opts = [{ value: 'ALL', label: 'All Drivers' }];
  const userOpts = DB.users.map(u => ({
    value: 'user:' + u.Username,
    label: `${u.DisplayName} · ${u.ForceNo || u.Username}`,
  }));
  const covered = new Set(DB.users.map(u => (u.DisplayName || '').toLowerCase()));
  const nameOpts = Array.from(new Set(DB.movements.map(m => m.DriverName).filter(Boolean)))
    .filter(n => !covered.has(n.toLowerCase()))
    .map(n => ({ value: 'name:' + n, label: n }));
  const rest = [...userOpts, ...nameOpts].sort((a,b) => a.label.localeCompare(b.label));
  return opts.concat(rest);
}

function applyDriverFilter(rows, driver){
  if (!driver || driver === 'ALL') return rows;
  if (driver.startsWith('user:')){
    const u = driver.slice(5);
    return rows.filter(m => m.CreatedBy === u);
  }
  if (driver.startsWith('name:')){
    const n = driver.slice(5).toLowerCase();
    return rows.filter(m => (m.DriverName||'').toLowerCase() === n);
  }
  const n = driver.toLowerCase();
  return rows.filter(m => (m.DriverName||'').toLowerCase() === n);
}

function driverLabel(driver){
  if (!driver || driver === 'ALL') return '';
  const opt = driverPickerOptions().find(o => o.value === driver);
  return opt ? opt.label : driver;
}

function renderDashboardPage(container){
  const f = App.filters.dashboard;
  const activeDriver = driverLabel(f.driver);
  container.innerHTML = `
    <div class="card card-pad filter-bar">
      <div class="field"><label>From Date</label><input type="date" id="db-from" value="${f.from}"></div>
      <div class="field"><label>To Date</label><input type="date" id="db-to" value="${f.to}"></div>
      <div class="field"><label>Vehicle</label>
        ${buildSearchableSelect({ id:'db-vehicle', options:vehicleSelectOptions({includeAll:true}), value:f.vehicle||'ALL', placeholder:'All Vehicles' })}
      </div>
      <div class="field grow"><label>Driver</label>
        ${buildSearchableSelect({ id:'db-driver', options:driverPickerOptions(), value:f.driver||'ALL', placeholder:'All Drivers' })}
      </div>
      <div class="actions">
        <button class="btn btn-primary" id="db-apply" type="button">Apply</button>
        <button class="btn btn-outline" id="db-clear" type="button">Clear</button>
        <button class="btn btn-outline" id="db-share" type="button">${icon('share')} Share as Image</button>
      </div>
    </div>

    <div id="dashboard-capture">
      ${activeDriver ? `<div class="active-filter-chip"><span>Driver: <strong>${escapeHtml(activeDriver)}</strong></span><button class="chip-x" id="db-driver-clear" title="Clear driver filter" type="button">×</button></div>` : ''}
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
    </div>
  `;

  wireSearchableSelect('db-vehicle');
  wireSearchableSelect('db-driver');
  $('#db-apply').addEventListener('click', () => {
    f.from = $('#db-from').value || todayISO();
    f.to = $('#db-to').value || todayISO();
    f.vehicle = $('#db-vehicle').value;
    f.driver = $('#db-driver').value || 'ALL';
    renderDashboardPage(container);
  });
  $('#db-clear').addEventListener('click', () => {
    App.filters.dashboard = { from: addDaysISO(todayISO(), -6), to: todayISO(), vehicle: 'ALL', driver: 'ALL' };
    renderDashboardPage(container);
  });
  $('#db-driver-clear')?.addEventListener('click', () => {
    f.driver = 'ALL';
    renderDashboardPage(container);
  });

  const inRange = applyDriverFilter(DB.movementsInRange(f.from, f.to, f.vehicle), f.driver);
  const vehiclesUsed = new Set(inRange.map(m => m.RegistrationNo)).size;
  const totalKm = inRange.reduce((s,m) => s + Number(m.TotalKM||0), 0);
  const sameDay = f.from === f.to;

  $('#stat-grid').innerHTML = `
    ${statCard('fleet', 'brand', 'Total Vehicles', DB.vehicles.length, 'Registered in fleet')}
    ${statCard('car', 'aqua', 'Vehicles Used', vehiclesUsed, sameDay ? 'On selected date' : 'In selected range')}
    ${statCard('flag', 'violet', 'Total Trips', inRange.length, 'Movement entries')}
    ${statCard('route', 'orange', 'Total KM Travelled', formatNumber(totalKm), sameDay ? 'km on selected date' : 'km in selected range')}
  `;

  // last 7 days, always anchored to real "today" regardless of filters (driver filter still applies)
  const days = [];
  for (let i = 6; i >= 0; i--){
    const d = addDaysISO(todayISO(), -i);
    const dayRows = applyDriverFilter(DB.movements.filter(m => m.Date === d), f.driver);
    const sum = dayRows.reduce((s,m) => s + Number(m.TotalKM||0), 0);
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

  $('#db-share').addEventListener('click', async () => {
    if (!$('#dashboard-capture')){ toast('error', 'Nothing to share', 'Dashboard not ready.'); return; }
    const btn = $('#db-share');
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Capturing…`;
    // Off-screen branded card so the capture always includes the full
    // KPI grid + charts regardless of viewport size.
    const card = buildDashboardShareCard(f, inRange, days, activeDriver, totalKm, vehiclesUsed);
    document.body.appendChild(card);
    let imgSrc = null;
    try {
      if (typeof html2canvas !== 'undefined'){
        const canvas = await html2canvas(card, {
          scale: 2, backgroundColor: '#fff', logging: false,
          windowWidth: card.scrollWidth, windowHeight: card.scrollHeight,
        });
        imgSrc = canvas.toDataURL('image/png');
      }
    } catch(e){ console.warn('html2canvas:', e); }
    finally {
      document.body.removeChild(card);
      btn.disabled = false; btn.innerHTML = `${icon('share')} Share as Image`;
    }
    if (!imgSrc){ toast('error', 'Image capture failed', 'Check console for details.'); return; }
    openModal({
      title: 'Share Dashboard as Image',
      large: true,
      bodyHtml: `<div class="share-preview" style="max-width:none"><img src="${imgSrc}" alt="Dashboard preview"></div>`,
      footerHtml: `
        <button class="btn btn-outline btn-sm" data-close-modal type="button" style="margin-right:auto">Close</button>
        <button class="btn btn-outline btn-sm" id="db-img-dl" type="button">${icon('download')} Download PNG</button>
        <button class="btn btn-sm share-wa-btn" id="db-img-wa" type="button">${icon('share')} WhatsApp</button>`,
      onMount: (bd) => {
        $('#db-img-dl', bd).addEventListener('click', () => {
          const a = document.createElement('a'); a.href = imgSrc;
          a.download = `Vehicle_Dashboard_${f.from}_to_${f.to}.png`; a.click();
        });
        $('#db-img-wa', bd).addEventListener('click', async () => {
          if (imgSrc && navigator.share && navigator.canShare){
            try {
              const res = await fetch(imgSrc); const blob = await res.blob();
              const file = new File([blob], `Dashboard_${f.from}_to_${f.to}.png`, { type:'image/png' });
              if (navigator.canShare({ files:[file] })){ await navigator.share({ files:[file], title:'MT Ops Dashboard' }); return; }
            } catch(e){ /* fall through */ }
          }
          const parts = [`*03 BN NDRF — MT Ops Dashboard*`, `Date: ${formatDateDMY(f.from)} to ${formatDateDMY(f.to)}`];
          if (f.vehicle && f.vehicle !== 'ALL') parts.push(`Vehicle: ${f.vehicle}`);
          if (activeDriver) parts.push(`Driver: ${activeDriver}`);
          window.open(`https://wa.me/?text=${encodeURIComponent(parts.join('\n'))}`, '_blank');
        });
      },
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
        <div style="display:flex;gap:10px;flex:1;min-width:260px;align-items:flex-end">
          <div class="field" style="margin:0;flex:1;max-width:320px"><label>Search</label><div class="input-icon">${icon('search')}<input type="search" id="veh-search" placeholder="Registration no. or type…" value="${escapeHtml(f.search)}"></div></div>
          <div class="field" style="margin:0;max-width:160px"><label>Status</label><select id="veh-status">
            <option value="ALL" ${f.status==='ALL'?'selected':''}>All Status</option>
            <option value="Active" ${f.status==='Active'?'selected':''}>Active</option>
            <option value="Inactive" ${f.status==='Inactive'?'selected':''}>Inactive</option>
          </select></div>
        </div>
        <button class="btn btn-primary" id="btn-add-vehicle" type="button" style="align-self:flex-end">${icon('plus')} Add Vehicle</button>
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
    : '<span class="badge badge-critical">In Progress</span>';
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
            <div class="field"><label>Vehicle *</label>${buildSearchableSelect({ id:'f-vehicle', options:[{value:'',label:'Select Vehicle…'},...vehicleSelectOptions({onlyActive:!editing})], value:editing?.RegistrationNo||'', placeholder:'Search vehicle…' })}</div>
          </div>
          <div class="form-row">
            <div class="field"><label>Driver Name *</label><input type="text" id="f-driver" value="${escapeHtml(editing?.DriverName||'')}" placeholder="Enter driver name"></div>
            <div class="field"><label>Requested By</label><input type="text" id="f-reqby" value="${escapeHtml(editing?.RequestedBy||'')}" placeholder="Enter name"></div>
          </div>
          <div class="form-row">
            <div class="field"><label>Opening Time</label><input type="text" id="f-otime" value="${editing?.OpeningTime||''}" placeholder="e.g. 0930 or 09:30"></div>
            <div class="field"><label>Opening KM *</label><input type="number" min="0" id="f-okm" value="${editing?.OpeningKM ?? ''}" placeholder="0"></div>
          </div>
          ${isCompleted ? `
          <div class="form-row">
            <div class="field"><label>Closing Time</label><input type="text" id="f-ctime" value="${editing?.ClosingTime||''}" placeholder="e.g. 0930 or 09:30"></div>
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

  wireSearchableSelect('f-vehicle');
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
    if (!data.RegistrationNo) missing.push('#f-vehicle-input');
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
          ${open.length ? `<span class="badge badge-critical">${open.length}</span>` : ''}</h2>
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
        <div class="meta" style="margin-top:2px;color:var(--text-secondary)">${escapeHtml(m.PurposePlace)}</div>
      </div>
      <div class="acts">
        <button class="btn btn-primary btn-sm" data-close="${m.ID}" type="button">${icon('check')} Close</button>
        <button class="icon-btn" data-share="${m.ID}" title="Share" type="button">${icon('share')}</button>
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
    $$('[data-share]', root).forEach(b => b.addEventListener('click', () => openShareModal(b.dataset.share)));
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
          <button class="icon-btn" data-share="${m.ID}" title="Share" type="button">${icon('share')}</button>
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
          <div class="field"><label>Vehicle</label>${buildSearchableSelect({ id:'ml-vehicle', options:vehicleSelectOptions({includeAll:true}), value:f.vehicle||'ALL', placeholder:'All Vehicles' })}</div>
          <div class="field"><label>Driver Name</label><input type="search" id="ml-driver" placeholder="Filter by driver…" value="${escapeHtml(f.driver||'')}"></div>
          <div class="field"><label>Force No.</label><input type="search" id="ml-forceno" placeholder="Filter by force no.…" value="${escapeHtml(f.forceNo||'')}"></div>
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
  wireSearchableSelect('ml-vehicle', (val) => { f.vehicle = val; f.page = 1; renderTable(); });
  $('#ml-driver').addEventListener('input', debounce(() => { f.driver = $('#ml-driver').value; f.page = 1; renderTable(); }, 200));
  $('#ml-forceno').addEventListener('input', debounce(() => { f.forceNo = $('#ml-forceno').value; f.page = 1; renderTable(); }, 200));
  $('#ml-clear').addEventListener('click', () => {
    Object.assign(f, { search:'', from:'', to:'', vehicle:'ALL', driver:'', forceNo:'', page:1 });
    renderPage('movements');
  });

  function renderTable(){
    const q = f.search.trim().toLowerCase();
    const drv = (f.driver || '').trim().toLowerCase();
    const fno = (f.forceNo || '').trim().toLowerCase();
    let rows = DB.movements.filter(m => {
      if (f.from && m.Date < f.from) return false;
      if (f.to && m.Date > f.to) return false;
      if (f.vehicle !== 'ALL' && m.RegistrationNo !== f.vehicle) return false;
      if (drv && !m.DriverName.toLowerCase().includes(drv)) return false;
      if (fno){
        const match = DB.users.find(u => (u.ForceNo || u.Username).toLowerCase() === fno);
        if (!match || m.CreatedBy !== match.Username) return false;
      }
      if (q && !(`${m.DriverName} ${m.RequestedBy} ${m.PurposePlace} ${m.RegistrationNo}`.toLowerCase().includes(q))) return false;
      return true;
    }).sort((a,b) => b.Date.localeCompare(a.Date) || b.ID.localeCompare(a.ID));

    const info = paginate(rows, f.page, 8);
    $('#ml-empty').innerHTML = info.total ? '' : `<div class="empty-state">${icon('doc')}<div>No movement entries match your filters.</div></div>`;
    $('#ml-tbody').innerHTML = info.rows.map(m => `
      <tr>
        <td class="tabular" data-label="Date">${formatDateDMY(m.Date)}</td>
        <td data-label="Vehicle"><strong>${escapeHtml(m.RegistrationNo)}</strong><div class="cell-muted" style="font-size:11.5px">${escapeHtml(m.VehicleType)}</div></td>
        <td data-label="Driver">${escapeHtml(m.DriverName)}<div class="cell-muted" style="font-size:11.5px">by ${escapeHtml(m.CreatedBy)}</div></td>
        <td data-label="Requested By">${escapeHtml(m.RequestedBy) || '—'}</td>
        <td class="tabular" data-label="Opening KM">${formatNumber(m.OpeningKM)}</td>
        <td class="tabular" data-label="Closing KM">${m.Status === 'Completed' ? formatNumber(m.ClosingKM) : '—'}</td>
        <td class="tabular" data-label="Total KM"><strong>${m.Status === 'Completed' ? formatNumber(m.TotalKM) : '—'}</strong></td>
        <td data-label="Status">${statusBadge(m)}</td>
        <td data-label="Purpose" title="${escapeHtml(m.PurposePlace)}" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(m.PurposePlace)}</td>
        <td class="row-actions">
          <button class="icon-btn" data-view="${m.ID}" title="View details" type="button">${icon('eye')}</button>
          ${m.Status !== 'Completed' ? `<button class="icon-btn" data-close="${m.ID}" title="Close" type="button">${icon('check')}</button>` : ''}
          <button class="icon-btn" data-share="${m.ID}" title="Share" type="button">${icon('share')}</button>
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
    $$('#ml-tbody [data-share]').forEach(b => b.addEventListener('click', () => openShareModal(b.dataset.share)));
  }
  renderTable();
}

function renderAllMovementsPage(container){
  const f = App.filters.allMovements;
  const isAdminUser = App.user.Role === 'Admin';
  container.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h2>All Movement Entries</h2>
      </div>
      <div class="card-pad">
        <div class="filter-bar">
          <div class="field grow"><label>Search</label><div class="input-icon">${icon('search')}<input type="search" id="am-search" placeholder="Search entries…" value="${escapeHtml(f.search)}"></div></div>
          <div class="field"><label>From Date</label><input type="date" id="am-from" value="${f.from}"></div>
          <div class="field"><label>To Date</label><input type="date" id="am-to" value="${f.to}"></div>
          <div class="field"><label>Vehicle</label>${buildSearchableSelect({ id:'am-vehicle', options:vehicleSelectOptions({includeAll:true}), value:f.vehicle||'ALL', placeholder:'All Vehicles' })}</div>
          <div class="field"><label>Driver Name</label><input type="search" id="am-driver" placeholder="Driver…" value="${escapeHtml(f.driver||'')}"></div>
          ${isAdminUser ? `<div class="field"><label>Force No.</label><input type="search" id="am-forceno" placeholder="Force no.…" value="${escapeHtml(f.forceNo||'')}"></div>` : ''}
          <div class="actions"><button class="btn btn-outline" id="am-clear" type="button">Clear</button></div>
        </div>
        <div class="table-wrap cards-sm"><table class="data-table">
          <thead><tr><th>Date</th><th>Vehicle</th><th>Driver</th><th>Requested By</th><th>Opening KM</th><th>Closing KM</th><th>Total KM</th><th>Status</th><th>Purpose</th><th>Actions</th></tr></thead>
          <tbody id="am-tbody"></tbody>
        </table></div>
        <div id="am-empty"></div>
        <div id="am-pagination"></div>
      </div>
    </div>`;

  $('#am-search').addEventListener('input', debounce(() => { f.search = $('#am-search').value; f.page = 1; renderTable(); }, 200));
  $('#am-from').addEventListener('change', () => { f.from = $('#am-from').value; f.page = 1; renderTable(); });
  $('#am-to').addEventListener('change', () => { f.to = $('#am-to').value; f.page = 1; renderTable(); });
  wireSearchableSelect('am-vehicle', (val) => { f.vehicle = val; f.page = 1; renderTable(); });
  $('#am-driver').addEventListener('input', debounce(() => { f.driver = $('#am-driver').value; f.page = 1; renderTable(); }, 200));
  if (isAdminUser){
    $('#am-forceno').addEventListener('input', debounce(() => { f.forceNo = $('#am-forceno').value; f.page = 1; renderTable(); }, 200));
  }
  $('#am-clear').addEventListener('click', () => {
    Object.assign(f, { search:'', from:'', to:'', vehicle:'ALL', driver:'', forceNo:'', page:1 });
    renderPage('all-movements');
  });

  function renderTable(){
    const q = f.search.trim().toLowerCase();
    const drv = (f.driver || '').trim().toLowerCase();
    const fno = (f.forceNo || '').trim().toLowerCase();
    const base = isAdminUser ? DB.movements : DB.movements.filter(m => m.CreatedBy === App.user.Username);
    let rows = base.filter(m => {
      if (f.from && m.Date < f.from) return false;
      if (f.to && m.Date > f.to) return false;
      if (f.vehicle !== 'ALL' && m.RegistrationNo !== f.vehicle) return false;
      if (drv && !m.DriverName.toLowerCase().includes(drv)) return false;
      if (isAdminUser && fno){
        const match = DB.users.find(u => (u.ForceNo || u.Username).toLowerCase() === fno);
        if (!match || m.CreatedBy !== match.Username) return false;
      }
      if (q && !(`${m.DriverName} ${m.RequestedBy} ${m.PurposePlace} ${m.RegistrationNo}`.toLowerCase().includes(q))) return false;
      return true;
    }).sort((a,b) => b.Date.localeCompare(a.Date) || b.ID.localeCompare(a.ID));

    const info = paginate(rows, f.page, 10);
    $('#am-empty').innerHTML = info.total ? '' : `<div class="empty-state">${icon('doc')}<div>No movement entries match your filters.</div></div>`;
    $('#am-tbody').innerHTML = info.rows.map(m => `
      <tr>
        <td class="tabular" data-label="Date">${formatDateDMY(m.Date)}</td>
        <td data-label="Vehicle"><strong>${escapeHtml(m.RegistrationNo)}</strong><div class="cell-muted" style="font-size:11.5px">${escapeHtml(m.VehicleType)}</div></td>
        <td data-label="Driver">${escapeHtml(m.DriverName)}${isAdminUser ? `<div class="cell-muted" style="font-size:11.5px">by ${escapeHtml(m.CreatedBy)}</div>` : ''}</td>
        <td data-label="Requested By">${escapeHtml(m.RequestedBy) || '—'}</td>
        <td class="tabular" data-label="Opening KM">${formatNumber(m.OpeningKM)}</td>
        <td class="tabular" data-label="Closing KM">${m.Status === 'Completed' ? formatNumber(m.ClosingKM) : '—'}</td>
        <td class="tabular" data-label="Total KM"><strong>${m.Status === 'Completed' ? formatNumber(m.TotalKM) : '—'}</strong></td>
        <td data-label="Status">${statusBadge(m)}</td>
        <td data-label="Purpose" title="${escapeHtml(m.PurposePlace)}" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(m.PurposePlace)}</td>
        <td class="row-actions">
          <button class="icon-btn" data-view="${m.ID}" title="View details" type="button">${icon('eye')}</button>
          ${canManageMovement(m) && m.Status !== 'Completed' ? `<button class="icon-btn" data-close="${m.ID}" title="Close" type="button">${icon('check')}</button>` : ''}
          <button class="icon-btn" data-share="${m.ID}" title="Share" type="button">${icon('share')}</button>
          ${canManageMovement(m) ? `<button class="icon-btn" data-edit="${m.ID}" title="Edit" type="button">${icon('edit')}</button>` : ''}
          ${canManageMovement(m) ? `<button class="icon-btn danger" data-del="${m.ID}" title="Delete" type="button">${icon('trash')}</button>` : ''}
        </td>
      </tr>`).join('');
    $('#am-pagination').innerHTML = paginationHtml(info);
    wirePagination($('#am-pagination'), (p) => { f.page = p; renderTable(); });

    $$('#am-tbody [data-view]').forEach(b => b.addEventListener('click', () => openMovementDetailModal(b.dataset.view)));
    $$('#am-tbody [data-close]').forEach(b => b.addEventListener('click', () => openCloseMovementModal(b.dataset.close)));
    $$('#am-tbody [data-share]').forEach(b => b.addEventListener('click', () => openShareModal(b.dataset.share)));
    $$('#am-tbody [data-edit]').forEach(b => b.addEventListener('click', () => {
      App.filters.movements.editingId = b.dataset.edit;
      App.filters.movements.view = 'form';
      renderPage('movements');
    }));
    $$('#am-tbody [data-del]').forEach(b => b.addEventListener('click', () => confirmDeleteMovement(DB.getMovement(b.dataset.del), renderTable)));
  }
  renderTable();
}

function openMovementDetailModal(id){
  const m = DB.getMovement(id);
  if (!m) return;
  const hist = DB.auditForRecord(id);
  openModal({
    title: `${escapeHtml(m.RegistrationNo)} · ${formatDateDMY(m.Date)}`,
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
      <div class="field grow"><label>Vehicle</label>${buildSearchableSelect({ id:'rp-vehicle', options:vehicleSelectOptions({includeAll:true}), value:f.vehicle||'ALL', placeholder:'All Vehicles' })}</div>
      <div class="actions"><button class="btn btn-primary" id="rp-generate" type="button">${icon('list')} Generate Report</button></div>
    </div>
    <div class="card">
      <div class="card-head report-head">
        <div class="report-head-title">
          <h2 id="rp-heading">Report</h2>
          <div id="rp-summary" class="rp-summary" hidden></div>
        </div>
        <div class="actions" id="rp-export" style="display:flex;gap:8px;flex-wrap:wrap" hidden>
          <button class="btn btn-outline btn-sm" id="rp-xlsx" type="button">${icon('download')} Excel</button>
          <button class="btn btn-outline btn-sm" id="rp-pdf" type="button">${icon('download')} PDF</button>
          <button class="btn btn-outline btn-sm" id="rp-img" type="button">${icon('share')} Share Image</button>
        </div>
      </div>
      <div class="card-pad" id="rp-body">
        <div class="empty-state">${icon('list')}<div>Choose a date range and click <strong>Generate Report</strong> to view results.</div></div>
      </div>
    </div>`;

  wireSearchableSelect('rp-vehicle');
  $('#rp-generate').addEventListener('click', () => {
    f.from = $('#rp-from').value || todayISO();
    f.to = $('#rp-to').value || todayISO();
    f.vehicle = $('#rp-vehicle').value;
    f.generated = true;
    renderReportBody();
  });

  const REPORT_COLUMNS = [
    { key: null,             label: '#',            cls: 'tabular cell-muted', render: (m,i) => i+1 },
    { key: 'Date',           label: 'Date',         cls: 'tabular',            render: m => formatDateDMY(m.Date) },
    { key: 'OpeningTime',    label: 'Out Time',     cls: 'tabular',            render: m => m.OpeningTime ? formatTime(m.OpeningTime) : '—' },
    { key: 'ClosingTime',    label: 'In Time',      cls: 'tabular',            render: m => m.Status==='Completed'&&m.ClosingTime ? formatTime(m.ClosingTime) : '—' },
    { key: 'RegistrationNo', label: 'Vehicle',      cls: '',                   render: m => escapeHtml(m.RegistrationNo) },
    { key: 'VehicleType',    label: 'Type',         cls: '',                   render: m => escapeHtml(m.VehicleType) },
    { key: 'DriverName',     label: 'Driver',       cls: '',                   render: m => escapeHtml(m.DriverName) },
    { key: 'RequestedBy',    label: 'Requested By', cls: '',                   render: m => escapeHtml(m.RequestedBy) },
    { key: 'OpeningKM',      label: 'Opening KM',   cls: 'tabular', num: true, render: m => formatNumber(m.OpeningKM) },
    { key: 'ClosingKM',      label: 'Closing KM',   cls: 'tabular', num: true, render: m => m.Status === 'Completed' ? formatNumber(m.ClosingKM) : '—' },
    { key: 'TotalKM',        label: 'Total KM',     cls: 'tabular', num: true, render: m => m.Status === 'Completed' ? formatNumber(m.TotalKM) : '—' },
    { key: 'Status',         label: 'Status',       cls: '',                   render: m => statusBadge(m) },
    { key: 'PurposePlace',   label: 'Purpose',      cls: 'wrap',               render: m => escapeHtml(m.PurposePlace), titleFn: m => escapeHtml(m.PurposePlace) },
    { key: 'PermittedBy',    label: 'Permitted By', cls: 'wrap',               render: m => escapeHtml(m.PermittedBy),  titleFn: m => escapeHtml(m.PermittedBy) },
    { key: 'Remarks',        label: 'Remarks',      cls: 'wrap',               render: m => m.Remarks ? escapeHtml(m.Remarks) : '—', titleFn: m => escapeHtml(m.Remarks || '') },
  ];

  function sortRows(rows, key, dir){
    if (!key) return rows;
    const col = REPORT_COLUMNS.find(c => c.key === key);
    const num = col && col.num;
    const sign = dir === 'desc' ? -1 : 1;
    return rows.slice().sort((a,b) => {
      const av = a[key], bv = b[key];
      const aEmpty = av === undefined || av === null || av === '';
      const bEmpty = bv === undefined || bv === null || bv === '';
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      if (num) return sign * (Number(av) - Number(bv));
      return sign * String(av).localeCompare(String(bv));
    });
  }

  function currentRows(){
    const inRange = DB.movementsInRange(f.from, f.to, f.vehicle);
    return sortRows(inRange, f.sortKey, f.sortDir);
  }

  function renderReportBody(){
    if (!f.generated) return;
    const rows = currentRows();
    const totalKm = rows.reduce((s,m) => s + Number(m.TotalKM||0), 0);
    const vehiclesUsed = new Set(rows.map(m => m.RegistrationNo)).size;
    $('#rp-heading').textContent = `${formatDateDMY(f.from)} → ${formatDateDMY(f.to)}`;
    if (rows.length){
      $('#rp-summary').innerHTML = `<strong>${rows.length}</strong> trip${rows.length===1?'':'s'} · <strong>${vehiclesUsed}</strong> vehicle${vehiclesUsed===1?'':'s'} · <strong>${fmtKm(totalKm)}</strong> total`;
      $('#rp-summary').hidden = false;
    } else {
      $('#rp-summary').hidden = true;
    }
    $('#rp-export').hidden = false;

    const headHtml = REPORT_COLUMNS.map(c => {
      if (!c.key) return `<th class="${c.cls||''}">${c.label}</th>`;
      const active = c.key === f.sortKey;
      const arrow = active ? (f.sortDir === 'desc' ? ' ▼' : ' ▲') : '';
      const wrapCls = c.cls === 'wrap' ? ' wrap' : '';
      return `<th class="sortable${wrapCls}${active?' active':''}" data-sort="${c.key}">${c.label}${arrow}</th>`;
    }).join('');

    const bodyHtml = rows.map((m, i) => `<tr>${
      REPORT_COLUMNS.map(c => {
        const t = c.titleFn ? ` title="${c.titleFn(m)}"` : '';
        return `<td class="${c.cls||''}"${t}>${c.render(m, i)}</td>`;
      }).join('')
    }</tr>`).join('');

    const totalKmColIdx = REPORT_COLUMNS.findIndex(c => c.key === 'TotalKM');
    const beforeTotal = totalKmColIdx;
    const afterTotal = REPORT_COLUMNS.length - totalKmColIdx - 1;

    $('#rp-body').innerHTML = !rows.length
      ? `<div class="empty-state">${icon('doc')}<div>No movement records found for this selection.</div></div>`
      : `<div class="table-wrap"><table class="data-table report-table">
          <thead><tr>${headHtml}</tr></thead>
          <tbody>${bodyHtml}</tbody>
          <tfoot><tr><td colspan="${beforeTotal}">Total</td><td class="tabular">${formatNumber(totalKm)}</td><td colspan="${afterTotal}"></td></tr></tfoot>
        </table></div>`;

    $$('#rp-body th[data-sort]').forEach(th => th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (f.sortKey === key){
        f.sortDir = f.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        f.sortKey = key;
        f.sortDir = 'asc';
      }
      renderReportBody();
    }));
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
  $('#rp-img').addEventListener('click', async () => {
    const rows = currentRows();
    if (!rows.length){ toast('error', 'Nothing to share', 'Generate a report first.'); return; }
    const totalKm = rows.reduce((s,m) => s + Number(m.TotalKM||0), 0);
    const vehiclesUsed = new Set(rows.map(m => m.RegistrationNo)).size;
    const btn = $('#rp-img');
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Capturing…`;
    // Off-screen full-data card so the capture is not truncated by the
    // horizontal-scrolling on-page .table-wrap or by viewport height.
    const card = buildReportShareCard(f, rows, totalKm, vehiclesUsed);
    document.body.appendChild(card);
    let imgSrc = null;
    try {
      if (typeof html2canvas !== 'undefined'){
        const canvas = await html2canvas(card, {
          scale: 2, backgroundColor: '#fff', logging: false,
          windowWidth: card.scrollWidth, windowHeight: card.scrollHeight,
        });
        imgSrc = canvas.toDataURL('image/png');
      }
    } catch(e){ console.warn('html2canvas:', e); }
    finally {
      document.body.removeChild(card);
      btn.disabled = false; btn.innerHTML = `${icon('share')} Share Image`;
    }
    if (!imgSrc){ toast('error', 'Image capture failed', 'Check console for details.'); return; }
    openModal({
      title: 'Share Report as Image',
      large: true,
      bodyHtml: `<div class="share-preview" style="max-width:none"><img src="${imgSrc}" alt="Report preview"></div>`,
      footerHtml: `
        <button class="btn btn-outline btn-sm" data-close-modal type="button" style="margin-right:auto">Close</button>
        <button class="btn btn-outline btn-sm" id="rp-img-dl" type="button">${icon('download')} Download PNG</button>
        <button class="btn btn-sm share-wa-btn" id="rp-img-wa" type="button">${icon('share')} WhatsApp</button>`,
      onMount: (bd) => {
        $('#rp-img-dl', bd).addEventListener('click', () => {
          const a = document.createElement('a'); a.href = imgSrc;
          a.download = `Vehicle_Report_${f.from}_to_${f.to}.png`; a.click();
        });
        $('#rp-img-wa', bd).addEventListener('click', async () => {
          if (imgSrc && navigator.share && navigator.canShare){
            try {
              const res = await fetch(imgSrc); const blob = await res.blob();
              const file = new File([blob], `Report_${f.from}_to_${f.to}.png`, { type:'image/png' });
              if (navigator.canShare({ files:[file] })){ await navigator.share({ files:[file], title:'MT Ops Report' }); return; }
            } catch(e){ /* fall through */ }
          }
          const title = encodeURIComponent(`*03 BN NDRF — MT Ops Report*\nDate: ${formatDateDMY(f.from)} to ${formatDateDMY(f.to)}\nVehicle: ${f.vehicle === 'ALL' ? 'All' : f.vehicle}`);
          window.open(`https://wa.me/?text=${title}`, '_blank');
        });
      },
    });
  });

  if (f.generated) renderReportBody();
}

function buildReportShareCard(f, rows, totalKm, vehiclesUsed){
  const card = document.createElement('div');
  card.className = 'share-card report-share-card';
  card.style.position = 'absolute';
  card.style.left = '-9999px';
  card.style.top = '0';
  const rowsHtml = rows.map((m, i) => `
    <tr>
      <td>${i+1}</td>
      <td class="rsc-num">${formatDateDMY(m.Date)}</td>
      <td class="rsc-num">${m.OpeningTime ? formatTime(m.OpeningTime) : '—'}</td>
      <td class="rsc-num">${m.Status==='Completed' && m.ClosingTime ? formatTime(m.ClosingTime) : '—'}</td>
      <td><strong>${escapeHtml(m.RegistrationNo)}</strong></td>
      <td>${escapeHtml(m.VehicleType)}</td>
      <td>${escapeHtml(m.DriverName)}</td>
      <td>${escapeHtml(m.RequestedBy) || '—'}</td>
      <td class="rsc-num">${formatNumber(m.OpeningKM)}</td>
      <td class="rsc-num">${m.Status==='Completed' ? formatNumber(m.ClosingKM) : '—'}</td>
      <td class="rsc-num"><strong>${m.Status==='Completed' ? formatNumber(m.TotalKM) : '—'}</strong></td>
      <td><span class="rsc-status rsc-status-${m.Status==='Completed'?'ok':'wip'}">${m.Status}</span></td>
      <td>${escapeHtml(m.PurposePlace)}</td>
      <td>${escapeHtml(m.PermittedBy) || '—'}</td>
      <td>${m.Remarks ? escapeHtml(m.Remarks) : '—'}</td>
    </tr>`).join('');
  card.innerHTML = `
    <div class="sc-head">
      <div class="sc-unit">03 BN NDRF, MUNDALI</div>
      <div class="sc-sub">MT Ops Report</div>
    </div>
    <div class="rsc-meta">
      <div><span>Date Range</span><strong>${formatDateDMY(f.from)} → ${formatDateDMY(f.to)}</strong></div>
      <div><span>Vehicle</span><strong>${f.vehicle === 'ALL' ? 'All Vehicles' : escapeHtml(f.vehicle)}</strong></div>
      <div><span>Trips</span><strong>${rows.length}</strong></div>
      <div><span>Vehicles Used</span><strong>${vehiclesUsed}</strong></div>
      <div><span>Total KM</span><strong>${fmtKm(totalKm)}</strong></div>
    </div>
    <table class="rsc-table">
      <thead>
        <tr>
          <th>#</th><th>Date</th><th>Out</th><th>In</th><th>Vehicle</th><th>Type</th>
          <th>Driver</th><th>Requested By</th><th>Open KM</th><th>Close KM</th><th>Total</th>
          <th>Status</th><th>Purpose</th><th>Permitted By</th><th>Remarks</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot>
        <tr>
          <td colspan="10">Total</td>
          <td class="rsc-num"><strong>${formatNumber(totalKm)}</strong></td>
          <td colspan="4"></td>
        </tr>
      </tfoot>
    </table>
    <div class="rsc-foot">
      Generated by ${escapeHtml(App.user.DisplayName)} · ${formatDateTime(new Date().toISOString())}
    </div>`;
  return card;
}

function buildDashboardShareCard(f, rows, days, activeDriver, totalKm, vehiclesUsed){
  const card = document.createElement('div');
  card.className = 'share-card dashboard-share-card';
  card.style.position = 'absolute';
  card.style.left = '-9999px';
  card.style.top = '0';
  const maxDay = Math.max(1, ...days.map(d => d.value));
  const daysHtml = days.map(d => {
    const h = Math.max(4, Math.round((d.value / maxDay) * 140));
    return `<div class="dsc-bar-col">
      <div class="dsc-bar-val">${d.value ? formatNumber(d.value) : ''}</div>
      <div class="dsc-bar" style="height:${h}px"></div>
      <div class="dsc-bar-lbl">${d.label}</div>
    </div>`;
  }).join('');
  // Top vehicles for context
  const byVehicle = {};
  rows.forEach(m => { byVehicle[m.RegistrationNo] = (byVehicle[m.RegistrationNo] || 0) + Number(m.TotalKM||0); });
  const topVehicles = Object.entries(byVehicle)
    .map(([reg, km]) => ({ reg, km, type: DB.findVehicle(reg)?.VehicleType || '' }))
    .sort((a,b) => b.km - a.km).slice(0, 6);
  const maxKm = Math.max(1, ...topVehicles.map(v => v.km));
  const topHtml = topVehicles.length ? topVehicles.map(v => {
    const w = Math.max(6, Math.round((v.km / maxKm) * 100));
    return `<div class="dsc-rank">
      <div class="dsc-rank-name"><strong>${escapeHtml(v.reg)}</strong><span>${escapeHtml(v.type)}</span></div>
      <div class="dsc-rank-track"><div class="dsc-rank-fill" style="width:${w}%"></div></div>
      <div class="dsc-rank-val">${formatNumber(v.km)} km</div>
    </div>`;
  }).join('') : `<div class="dsc-empty">No trips in range.</div>`;

  card.innerHTML = `
    <div class="sc-head">
      <div class="sc-unit">03 BN NDRF, MUNDALI</div>
      <div class="sc-sub">MT Ops Dashboard</div>
    </div>
    <div class="rsc-meta">
      <div><span>Date Range</span><strong>${formatDateDMY(f.from)} → ${formatDateDMY(f.to)}</strong></div>
      <div><span>Vehicle</span><strong>${f.vehicle === 'ALL' ? 'All Vehicles' : escapeHtml(f.vehicle)}</strong></div>
      ${activeDriver ? `<div><span>Driver</span><strong>${escapeHtml(activeDriver)}</strong></div>` : ''}
    </div>
    <div class="dsc-kpis">
      <div class="dsc-kpi"><div class="dsc-kpi-lbl">Total Vehicles</div><div class="dsc-kpi-val">${DB.vehicles.length}</div><div class="dsc-kpi-sub">Registered in fleet</div></div>
      <div class="dsc-kpi"><div class="dsc-kpi-lbl">Vehicles Used</div><div class="dsc-kpi-val">${vehiclesUsed}</div><div class="dsc-kpi-sub">In selected range</div></div>
      <div class="dsc-kpi"><div class="dsc-kpi-lbl">Total Trips</div><div class="dsc-kpi-val">${rows.length}</div><div class="dsc-kpi-sub">Movement entries</div></div>
      <div class="dsc-kpi"><div class="dsc-kpi-lbl">Total KM</div><div class="dsc-kpi-val">${formatNumber(totalKm)}</div><div class="dsc-kpi-sub">km in range</div></div>
    </div>
    <div class="dsc-cols">
      <div class="dsc-section">
        <div class="dsc-section-title">Daily KM (Last 7 Days)</div>
        <div class="dsc-bar-wrap">${daysHtml}</div>
      </div>
      <div class="dsc-section">
        <div class="dsc-section-title">Top Vehicles by Distance</div>
        <div class="dsc-rank-wrap">${topHtml}</div>
      </div>
    </div>
    <div class="rsc-foot">
      Generated by ${escapeHtml(App.user.DisplayName)} · ${formatDateTime(new Date().toISOString())}
    </div>`;
  return card;
}

function exportReportXlsx(f, rows){
  const totalKm = rows.reduce((s,m) => s + Number(m.TotalKM||0), 0);
  const aoa = [
    ['03 BN NDRF, MUNDALI — MT Ops Report'],
    [`Date Range: ${formatDateDMY(f.from)} to ${formatDateDMY(f.to)}`],
    [`Vehicle: ${f.vehicle === 'ALL' ? 'All Vehicles' : f.vehicle}`],
    [`Generated by: ${App.user.DisplayName} on ${formatDateTime(new Date().toISOString())}`],
    [],
    ['#','Date','Out Time','In Time','Vehicle','Type','Driver','Requested By','Opening KM','Closing KM','Total KM','Status','Purpose / Place','Permitted By','Remarks'],
    ...rows.map((m, i) => [i+1, formatDateDMY(m.Date), m.OpeningTime ? formatTime(m.OpeningTime) : '', m.Status==='Completed'&&m.ClosingTime ? formatTime(m.ClosingTime) : '', m.RegistrationNo, m.VehicleType, m.DriverName, m.RequestedBy, m.OpeningKM, m.ClosingKM, m.TotalKM, m.Status, m.PurposePlace, m.PermittedBy, m.Remarks || '']),
    [],
    ['', '', '', '', '', '', '', '', '', 'Total', totalKm, '', '', '', ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{wch:5},{wch:12},{wch:10},{wch:10},{wch:14},{wch:12},{wch:16},{wch:16},{wch:11},{wch:11},{wch:10},{wch:12},{wch:22},{wch:14},{wch:22}];
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
  doc.setFontSize(14); doc.text('03 BN NDRF, MUNDALI — MT Ops Report', 14, 14);
  doc.setFontSize(10); doc.setTextColor(90);
  doc.text(`Date Range: ${formatDateDMY(f.from)} to ${formatDateDMY(f.to)}   |   Vehicle: ${f.vehicle==='ALL'?'All Vehicles':f.vehicle}`, 14, 21);
  doc.text(`Generated by ${App.user.DisplayName} on ${formatDateTime(new Date().toISOString())}`, 14, 27);
  doc.autoTable({
    startY: 33,
    head: [['#','Date','Out','In','Vehicle','Type','Driver','Requested By','Open KM','Close KM','Total KM','Status','Purpose / Place','Permitted By','Remarks']],
    body: rows.map((m,i) => [i+1, formatDateDMY(m.Date), m.OpeningTime?formatTime(m.OpeningTime):'', m.Status==='Completed'&&m.ClosingTime?formatTime(m.ClosingTime):'', m.RegistrationNo, m.VehicleType, m.DriverName, m.RequestedBy, formatNumber(m.OpeningKM), formatNumber(m.ClosingKM), formatNumber(m.TotalKM), m.Status, m.PurposePlace, m.PermittedBy, m.Remarks || '']),
    foot: [['','','','','','','','','','Total', formatNumber(totalKm),'','','','']],
    styles: { fontSize: 7.5, textColor: [20,20,20], lineColor: [220,219,224], lineWidth: 0.1 },
    headStyles: { fillColor: [247,246,250], textColor: [20,20,20], fontStyle: 'bold' },
    footStyles: { fillColor: [247,246,250], textColor: [20,20,20] },
    columnStyles: { 0:{cellWidth:8}, 1:{cellWidth:20}, 2:{cellWidth:14}, 3:{cellWidth:14}, 10:{cellWidth:16} },
  });
  doc.save(`Vehicle_Movement_Report_${f.from}_to_${f.to}.pdf`);
  toast('success', 'PDF report downloaded');
}

/* ============================== AUDIT LOG ============================== */

function renderAuditPage(container){
  const f = App.filters.audit;

  // Actor list: known users (by profile) + any usernames only seen in
  // the audit log itself (e.g. a deleted account). Sorted by label.
  const knownUsernames = new Set(DB.users.map(u => u.Username));
  const logUsernames = new Set(DB.auditLog.map(a => a.User).filter(Boolean));
  const userOpts = [
    { value: 'ALL', label: 'All Users' },
    ...DB.users.map(u => ({ value: u.Username, label: `${u.DisplayName} · ${u.ForceNo || u.Username}` })),
    ...[...logUsernames].filter(u => !knownUsernames.has(u))
      .map(u => ({ value: u, label: `${u} (removed)` })),
  ];

  container.innerHTML = `
    <div class="card">
      <div class="card-pad">
        <div class="filter-bar" style="margin-bottom:14px">
          <div class="field grow"><label>Search</label><div class="input-icon">${icon('search')}<input type="search" id="au-search" placeholder="Search log…" value="${escapeHtml(f.search)}"></div></div>
          <div class="field"><label>User</label>${buildSearchableSelect({ id:'au-user', options:userOpts, value:f.user||'ALL', placeholder:'All Users' })}</div>
          <div class="field"><label>From Date</label><input type="date" id="au-from" value="${f.from}"></div>
          <div class="field"><label>To Date</label><input type="date" id="au-to" value="${f.to}"></div>
          <div class="actions"><button class="btn btn-outline" id="au-clear" type="button">Clear</button></div>
        </div>
        <div class="table-wrap cards-sm"><table class="data-table">
          <thead><tr><th>#</th><th>Timestamp</th><th>User</th><th>Action</th><th>Record</th><th>Details</th></tr></thead>
          <tbody id="au-tbody"></tbody>
        </table></div>
        <div id="au-empty"></div>
        <div id="au-pagination"></div>
      </div>
    </div>`;

  $('#au-search').addEventListener('input', debounce(() => { f.search = $('#au-search').value; f.page = 1; renderTable(); }, 200));
  wireSearchableSelect('au-user', (val) => { f.user = val; f.page = 1; renderTable(); });
  $('#au-from').addEventListener('change', () => { f.from = $('#au-from').value; f.page = 1; renderTable(); });
  $('#au-to').addEventListener('change', () => { f.to = $('#au-to').value; f.page = 1; renderTable(); });
  $('#au-clear').addEventListener('click', () => { Object.assign(f, { search:'', from:'', to:'', user:'ALL', page:1 }); renderPage('audit'); });

  function renderTable(){
    const q = f.search.trim().toLowerCase();
    let rows = DB.auditLog.filter(a => {
      const day = (a.Timestamp || '').slice(0,10);
      if (f.from && day < f.from) return false;
      if (f.to && day > f.to) return false;
      if (f.user && f.user !== 'ALL' && a.User !== f.user) return false;
      if (q){
        const u = DB.findUser(a.User);
        const searchable = `${a.User} ${u?.DisplayName || ''} ${u?.ForceNo || ''} ${a.Action} ${a.RecordType} ${a.RecordId} ${a.Details}`.toLowerCase();
        if (!searchable.includes(q)) return false;
      }
      return true;
    }).sort((a,b) => new Date(b.Timestamp) - new Date(a.Timestamp));

    const info = paginate(rows, f.page, 10);
    $('#au-empty').innerHTML = info.total ? '' : `<div class="empty-state">${icon('clock')}<div>No audit entries match your filters.</div></div>`;
    $('#au-tbody').innerHTML = info.rows.map((a, i) => {
      const u = DB.findUser(a.User);
      const name = u?.DisplayName || a.User || '—';
      const forceNo = u?.ForceNo || a.User || '';
      return `
      <tr>
        <td class="cell-muted" data-label="#">${info.start + i + 1}</td>
        <td class="tabular" data-label="Timestamp">${formatDateTime(a.Timestamp)}</td>
        <td data-label="User"><strong>${escapeHtml(name)}</strong>${forceNo ? `<div class="cell-muted" style="font-size:11.5px">${escapeHtml(forceNo)}</div>` : ''}</td>
        <td data-label="Action">${actionBadge(a.Action)}</td>
        <td data-label="Record">${escapeHtml(a.RecordType)}${a.RecordId && a.RecordId !== '-' ? ` · ${escapeHtml(a.RecordId)}` : ''}</td>
        <td class="cell-muted" data-label="Details">${escapeHtml(a.Details)}</td>
      </tr>`;
    }).join('');
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
          <button class="btn btn-primary btn-block" type="submit">Update Password</button>
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
          <button class="btn btn-outline" id="btn-export-mov-xlsx" type="button">${icon('download')} Movements (.xlsx)</button>
          <button class="btn btn-outline" id="btn-export-mov-json" type="button">${icon('download')} Movements (.json)</button>
        </div>
        <hr style="border:none;border-top:1px solid var(--border);margin:14px 0">
        <p class="helper-text" style="margin:0 0 10px;color:var(--critical)">Danger zone — these actions affect all users immediately.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-outline" id="btn-import" type="button">${icon('upload')} Import Register / Backup</button>
          <input type="file" id="import-file" accept=".xlsx" hidden>
          <button class="btn btn-danger" id="btn-reset" type="button">${icon('refresh')} Reset to Bundled Sample Data</button>
        </div>
      </div>` : ''}
    </div>

    ${isAdmin ? `
    <div class="card card-pad" style="margin-top:16px">
      <div class="section-title" style="margin-top:0">Backup & Restore</div>
      <p class="helper-text">
        Download a JSON snapshot of the entire cloud database for safekeeping, or restore
        a previously downloaded snapshot. Restore <strong>replaces every record</strong>
        with the backup contents — for every user, immediately.
      </p>
      <details style="margin:10px 0 4px">
        <summary style="cursor:pointer;font-weight:600">What is in a backup?</summary>
        <div style="margin-top:8px;font-size:13.5px;color:var(--text-muted);line-height:1.55">
          User profiles (no passwords), Vehicles, Movements, and the full Audit Log — a snapshot
          of the database as it is right now. Firebase Auth sign-in credentials are managed
          separately and are not included. Keep the downloaded file secure: it contains
          operational data.
        </div>
      </details>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
        <button class="btn btn-outline" id="btn-backup-json" type="button">${icon('download')} Download Backup (.json)</button>
        <button class="btn btn-outline" id="btn-restore-json" type="button">${icon('upload')} Import Backup (.json)</button>
        <input type="file" id="restore-json-file" accept=".json,application/json" hidden>
      </div>
    </div>` : ''}

    ${isAdmin ? `
    <div class="card" style="margin-top:16px">
      <div class="card-head">
        <h2>User Management</h2>
        <button class="btn btn-primary btn-sm" id="btn-add-user" type="button">${icon('plus')} Add User</button>
      </div>
      <div class="card-pad">
        <div class="filter-bar" style="margin-bottom:14px">
          <div class="field grow"><label>Search</label><div class="input-icon">${icon('search')}<input type="search" id="usr-search" placeholder="Name, username, or force no…"></div></div>
          <div class="field"><label>Role</label><select id="usr-role"><option value="ALL">All Roles</option><option value="Admin">Admin</option><option value="Operator">Operator</option></select></div>
          <div class="field"><label>Status</label><select id="usr-status"><option value="ALL">All Status</option><option value="Active">Active</option><option value="Inactive">Inactive</option></select></div>
        </div>
        <div class="table-wrap cards-sm"><table class="data-table">
          <thead><tr><th>Username</th><th>Display Name</th><th>Force No.</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody id="user-tbody"></tbody>
        </table></div>
        <div id="usr-empty"></div>
        <div id="usr-pagination"></div>
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
  $('#btn-export-mov-xlsx').addEventListener('click', () => {
    if (!DB.movements.length){ toast('info', 'No movements yet', 'There are no movement entries to export.'); return; }
    DB.exportMovementsXlsx();
    toast('success', 'Movements exported', `${DB.movements.length} entr${DB.movements.length === 1 ? 'y' : 'ies'} (.xlsx)`);
  });
  $('#btn-export-mov-json').addEventListener('click', () => {
    if (!DB.movements.length){ toast('info', 'No movements yet', 'There are no movement entries to export.'); return; }
    DB.exportMovementsJson();
    toast('success', 'Movements exported', `${DB.movements.length} entr${DB.movements.length === 1 ? 'y' : 'ies'} (.json)`);
  });

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

  $('#btn-backup-json').addEventListener('click', () => {
    DB.exportBackupJson();
    DB.logAudit(App.user, 'Exported', 'Backup', 'json', 'Full JSON backup downloaded');
    toast('success', 'Backup downloaded', `${DB.users.length + DB.vehicles.length + DB.movements.length + DB.auditLog.length} record(s) written to .json`);
  });

  $('#btn-restore-json').addEventListener('click', () => $('#restore-json-file').click());
  $('#restore-json-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const backup = DB.parseBackupJson(text);
      const impact = DB.computeRestoreImpact(backup);
      openBackupReviewModal(backup, impact, file.name);
    } catch (err){
      toast('error', 'Invalid backup', err.message);
    }
    e.target.value = '';
  });

  if (isAdmin){
    const uf = { search: '', role: 'ALL', status: 'ALL', page: 1 };

    function renderUsers(){
      const q = uf.search.trim().toLowerCase();
      const filtered = DB.users.filter(u => {
        if (uf.role !== 'ALL' && u.Role !== uf.role) return false;
        const active = String(u.Active).toLowerCase() === 'yes' ? 'Active' : 'Inactive';
        if (uf.status !== 'ALL' && active !== uf.status) return false;
        if (q && !(`${u.Username} ${u.DisplayName} ${u.ForceNo || u.Username}`.toLowerCase().includes(q))) return false;
        return true;
      });
      const info = paginate(filtered, uf.page, 8);
      $('#usr-empty').innerHTML = info.total ? '' : `<div class="empty-state">${icon('user')}<div>No users match your filters.</div></div>`;
      $('#user-tbody').innerHTML = info.rows.map(u => {
        const isActive = String(u.Active).toLowerCase() === 'yes';
        return `
        <tr>
          <td data-label="Username"><strong>${escapeHtml(u.Username)}</strong></td>
          <td data-label="Display Name">${escapeHtml(u.DisplayName)}</td>
          <td class="cell-muted" data-label="Force No.">${escapeHtml(u.ForceNo || u.Username)}</td>
          <td data-label="Role">${escapeHtml(u.Role)}</td>
          <td data-label="Status"><span class="badge ${isActive?'badge-good':'badge-muted'}">${isActive?'Active':'Inactive'}</span></td>
          <td class="row-actions">
            <button class="icon-btn" data-uedit="${u.Username}" title="Edit user" type="button">${icon('edit')}</button>
            <button class="icon-btn" data-ureset="${u.Username}" title="Reset password" type="button">${icon('lockReset')}</button>
            <button class="icon-btn" data-utoggle="${u.Username}" title="${isActive?'Deactivate':'Activate'}" type="button">${icon(isActive?'x':'check')}</button>
          </td>
        </tr>`;
      }).join('');
      $('#usr-pagination').innerHTML = paginationHtml(info);
      wirePagination($('#usr-pagination'), (p) => { uf.page = p; renderUsers(); });
      $$('#user-tbody [data-utoggle]').forEach(b => b.addEventListener('click', () => {
        const u = DB.findUser(b.dataset.utoggle);
        if (u.Username === App.user.Username){ toast('error', 'Not allowed', "You can't revoke your own access."); return; }
        DB.setUserActive(u.Username, String(u.Active).toLowerCase() !== 'yes', App.user);
        renderUsers();
      }));
      $$('#user-tbody [data-uedit]').forEach(b => b.addEventListener('click', () => openEditUserModal(DB.findUser(b.dataset.uedit), renderUsers)));
      $$('#user-tbody [data-ureset]').forEach(b => b.addEventListener('click', () => openResetPasswordModal(b.dataset.ureset)));
    }

    $('#usr-search').addEventListener('input', debounce(() => { uf.search = $('#usr-search').value; uf.page = 1; renderUsers(); }, 200));
    $('#usr-role').addEventListener('change', () => { uf.role = $('#usr-role').value; uf.page = 1; renderUsers(); });
    $('#usr-status').addEventListener('change', () => { uf.status = $('#usr-status').value; uf.page = 1; renderUsers(); });
    renderUsers();

    $('#btn-add-user').addEventListener('click', () => {
      openModal({
        title: 'Add User',
        bodyHtml: `
          <div class="form-row">
            <div class="field"><label>Username *</label><input type="text" id="u-username" placeholder="e.g. john123"></div>
            <div class="field"><label>Force No.</label><input type="text" id="u-forceno" placeholder="e.g. 01020304"></div>
          </div>
          <div class="field"><label>Display Name *</label><input type="text" id="u-display" placeholder="Full name"></div>
          <div class="field"><label>Password *</label><input type="password" id="u-password" placeholder="Min 6 characters"></div>
          <div class="field"><label>Role</label><select id="u-role"><option>Operator</option><option>Admin</option></select></div>
          <div id="u-error" class="error-text" hidden></div>`,
        footerHtml: `<button class="btn btn-outline" data-close-modal type="button">Cancel</button><button class="btn btn-primary" id="u-save" type="button">Add User</button>`,
        onMount: (bd) => $('#u-save', bd).addEventListener('click', async () => {
          const username = $('#u-username', bd).value.trim().toLowerCase();
          const display = $('#u-display', bd).value.trim();
          const pw = $('#u-password', bd).value;
          const role = $('#u-role', bd).value;
          const forceno = $('#u-forceno', bd).value.trim();
          const err = $('#u-error', bd);
          const fail = (msg) => { err.textContent = msg; err.hidden = false; };
          if (!username || !display || !pw){ fail('Username, display name and password are required.'); return; }
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
            DB.addUserProfile({ Username: username, DisplayName: display, Role: role, ForceNo: forceno }, App.user);
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

/* ---------- Backup restore: 3-step modal flow ---------- */

function openBackupReviewModal(backup, impact, fileName){
  const created = formatDateTime(backup.createdAt);
  const collLabel = { users:'Users', vehicles:'Vehicles', movements:'Movements', auditLog:'Audit Log' };
  const gridRows = ['users','vehicles','movements','auditLog'].map(name => `
    <tr>
      <td>${collLabel[name]}</td>
      <td class="tabular">${formatNumber(impact[name].currentCount)}</td>
      <td class="tabular">${formatNumber(impact[name].backupCount)}</td>
    </tr>`).join('');

  const olderRows = ['users','vehicles','movements','auditLog']
    .filter(n => impact[n].newerInCurrent > 0)
    .map(n => `<li><strong>${collLabel[n]}:</strong> ${formatNumber(impact[n].newerInCurrent)} newer record(s) may be lost</li>`)
    .join('');
  const olderWarning = impact.isOlderBackup ? `
    <div class="backup-warning backup-warning-yellow" style="margin-top:14px">
      <div style="font-weight:600;margin-bottom:6px">${icon('alertTriangle')} This backup may contain older data</div>
      <div style="font-size:13.5px;line-height:1.55">
        The backup was created on <strong>${created}</strong>. Records that were created or updated after that time are not in the backup and will be overwritten.
        <ul style="margin:8px 0 0 20px;padding:0">${olderRows}</ul>
      </div>
    </div>` : '';

  const missingRows = ['users','vehicles','movements','auditLog']
    .filter(n => impact[n].missingFromBackup > 0)
    .map(n => `<li><strong>${collLabel[n]}:</strong> ${formatNumber(impact[n].missingFromBackup)} current record(s) will be deleted</li>`)
    .join('');
  const missingWarning = missingRows ? `
    <div class="backup-warning backup-warning-red" style="margin-top:10px">
      <div style="font-weight:600;margin-bottom:6px">${icon('alertTriangle')} Potential data loss</div>
      <div style="font-size:13.5px;line-height:1.55">
        The backup does not contain every record that is currently in the cloud database. A full restore will remove records that are not in the backup:
        <ul style="margin:8px 0 0 20px;padding:0">${missingRows}</ul>
      </div>
    </div>` : '';

  openModal({
    title: 'Review Backup', large: true,
    bodyHtml: `
      <div style="font-size:14px;line-height:1.6">
        <div class="section-title" style="margin-top:0">Backup Information</div>
        <div class="kv-row"><span class="k">File</span><span class="v">${escapeHtml(fileName)}</span></div>
        <div class="kv-row"><span class="k">Created</span><span class="v">${created}</span></div>
        <div class="kv-row"><span class="k">Backup Version</span><span class="v">${backup.backupVersion}</span></div>
        <div class="kv-row"><span class="k">Created By</span><span class="v">${escapeHtml(backup.createdBy || '—')}</span></div>

        <div class="section-title" style="margin-top:18px">Current vs. Backup</div>
        <div class="table-wrap"><table class="data-table backup-review-grid">
          <thead><tr><th>Collection</th><th class="tabular">Current</th><th class="tabular">Backup</th></tr></thead>
          <tbody>${gridRows}</tbody>
        </table></div>

        ${olderWarning}
        ${missingWarning}

        <p class="helper-text" style="margin-top:14px">
          <strong>Note:</strong> Restoring users updates their profile only. Firebase Auth sign-in credentials are managed separately and are not affected by a JSON backup restore.
        </p>
      </div>`,
    footerHtml: `
      <button class="btn btn-outline" data-close-modal type="button" style="margin-right:auto">Cancel</button>
      <button class="btn btn-primary" id="backup-continue" type="button">Continue to Import</button>`,
    onMount: (bd) => {
      $('#backup-continue', bd).addEventListener('click', () => {
        closeModal();
        openBackupConfirmModal(backup, impact);
      });
    },
  });
}

function openBackupConfirmModal(backup, impact){
  const created = formatDateLong(backup.createdAt.slice(0,10));
  const collLabel = { users:'Users', vehicles:'Vehicles', movements:'Movements', auditLog:'Audit Log' };
  const affectedRows = ['users','vehicles','movements','auditLog']
    .filter(n => impact[n].newerInCurrent > 0)
    .map(n => `<li><strong>${collLabel[n]}:</strong> ${formatNumber(impact[n].newerInCurrent)}</li>`)
    .join('');
  const affectedBlock = affectedRows ? `
    <div style="margin-top:12px;font-size:13.5px">
      <div style="font-weight:600;margin-bottom:4px">Potentially affected records:</div>
      <ul style="margin:0 0 0 20px;padding:0">${affectedRows}</ul>
    </div>` : '';

  openModal({
    title: 'Confirm Backup Restore',
    bodyHtml: `
      <div class="confirm-icon" style="background:var(--critical-bg);color:var(--critical)">${icon('alertTriangle')}</div>
      <div style="font-size:14px;line-height:1.6">
        <p style="margin:0 0 6px">You are about to restore data from a backup created on <strong>${created}</strong>.</p>
        <p style="margin:0;color:var(--text-muted)">This will <strong>overwrite the current cloud database for every user</strong>. This action cannot be undone.</p>
        ${affectedBlock}
        <label class="backup-checkbox" style="display:flex;align-items:flex-start;gap:10px;margin-top:16px;padding:12px;border:1px solid var(--border);border-radius:10px;cursor:pointer;font-size:13.5px;line-height:1.5">
          <input type="checkbox" id="backup-ack" style="margin-top:2px">
          <span>I understand that restoring this backup will overwrite current data and may cause loss of newer records.</span>
        </label>
      </div>`,
    footerHtml: `
      <button class="btn btn-outline" data-close-modal type="button" style="margin-right:auto">Cancel</button>
      <button class="btn btn-danger" id="backup-restore" type="button" disabled>Restore Backup</button>`,
    onMount: (bd) => {
      const btn = $('#backup-restore', bd);
      $('#backup-ack', bd).addEventListener('change', (e) => { btn.disabled = !e.target.checked; });
      btn.addEventListener('click', async () => {
        closeModal();
        showLoadingOverlay('Restoring backup…');
        try {
          const res = await DB.restoreFromBackupJson(backup);
          DB.logAudit(App.user, 'Restored', 'Backup', backup.createdAt, `Restored JSON backup (${res.done}/${res.total} ops)`);
          hideLoadingOverlay();
          openBackupResultModal(res);
        } catch(err){
          hideLoadingOverlay();
          toast('error', 'Restore failed', err.message || 'See console.');
          console.error(err);
        }
      });
    },
  });
}

function openBackupResultModal(result){
  const { done, failed, total, backup } = result;
  const created = formatDateLong(backup.createdAt.slice(0,10));
  const ok = failed === 0;
  const collLabel = { users:'Users', vehicles:'Vehicles', movements:'Movements', auditLog:'Audit Log' };
  const perColl = ['users','vehicles','movements','auditLog']
    .map(n => `<div class="kv-row"><span class="k">${collLabel[n]}</span><span class="v tabular">${formatNumber(backup.counts[n] || 0)}</span></div>`)
    .join('');
  openModal({
    title: ok ? 'Backup Restored' : 'Restore Completed with Errors',
    bodyHtml: `
      <div class="confirm-icon" style="background:${ok ? 'var(--good-bg,#E6F4EA)' : 'var(--critical-bg)'};color:${ok ? 'var(--good,#137333)' : 'var(--critical)'}">${icon(ok ? 'check' : 'alertTriangle')}</div>
      <div style="font-size:14px;line-height:1.6">
        <p style="margin:0 0 10px">
          ${ok ? `The backup created on <strong>${created}</strong> was restored successfully.` : `The restore finished, but ${formatNumber(failed)} of ${formatNumber(total)} write operations failed. Check the browser console for details.`}
        </p>
        <div class="section-title" style="margin-top:14px">Restored from backup</div>
        ${perColl}
        <div class="kv-row" style="margin-top:8px"><span class="k">Write operations</span><span class="v tabular">${formatNumber(done)} / ${formatNumber(total)}</span></div>
      </div>`,
    footerHtml: `<button class="btn btn-primary" data-close-modal type="button">Close</button>`,
    onClose: () => { renderPage('settings'); },
  });
}

function openEditUserModal(u, onSaved){
  if (!u) return;
  openModal({
    title: `Edit User — ${u.Username}`,
    bodyHtml: `
      <div class="field"><label>Display Name *</label><input type="text" id="eu-display" value="${escapeHtml(u.DisplayName)}"></div>
      <div class="field"><label>Force No.</label><input type="text" id="eu-forceno" value="${escapeHtml(u.ForceNo||'')}" placeholder="e.g. 01020304"></div>
      <div class="section-title">Change Username</div>
      <p class="helper-text" style="margin-bottom:10px">Changing the username updates the login email. Admin must know the user's current password.</p>
      <div class="form-row">
        <div class="field"><label>New Username</label><input type="text" id="eu-newname" value="${escapeHtml(u.Username)}" placeholder="${escapeHtml(u.Username)}"></div>
        <div class="field"><label>User's Current Password</label><input type="password" id="eu-curpw" placeholder="Required only if renaming"></div>
      </div>
      <div id="eu-error" class="error-text" hidden></div>`,
    footerHtml: `<button class="btn btn-outline" data-close-modal type="button">Cancel</button><button class="btn btn-primary" id="eu-save" type="button">Save Changes</button>`,
    onMount: (bd) => $('#eu-save', bd).addEventListener('click', async () => {
      const display  = $('#eu-display', bd).value.trim();
      const forceno  = $('#eu-forceno', bd).value.trim();
      const newname  = $('#eu-newname', bd).value.trim().toLowerCase();
      const curpw    = $('#eu-curpw', bd).value;
      const err = $('#eu-error', bd);
      const fail = (msg) => { err.textContent = msg; err.hidden = false; };
      if (!display){ fail('Display name is required.'); return; }
      const btn = $('#eu-save', bd);
      btn.disabled = true;
      try {
        // Profile-only update (display name / force no)
        DB.updateUserProfile(u.Username, { DisplayName: display, ForceNo: forceno }, App.user);
        // Username rename (if changed)
        if (newname && newname !== u.Username){
          if (!curpw){ fail('Current password is required to change the username.'); btn.disabled = false; return; }
          if (!/^[a-z0-9._-]+$/.test(newname)){ fail('Username can only contain letters, numbers, dots, dashes and underscores.'); btn.disabled = false; return; }
          await DB.updateUsername(u.Username, newname, curpw, App.user);
          if (App.user.Username === u.Username) App.user.Username = newname;
        }
        toast('success', 'User updated', newname || u.Username);
        closeModal();
        if (onSaved) onSaved();
      } catch(e){
        btn.disabled = false;
        if (e.code === 'username-taken') fail('That username is already taken.');
        else if (['auth/invalid-credential','auth/wrong-password'].includes(e.code)) fail('Current password is incorrect.');
        else if (e.code === 'auth/email-already-in-use') fail('That username is already taken.');
        else { fail('Error: ' + (e.message || e.code)); console.error(e); }
      }
    }),
  });
}

function openResetPasswordModal(username){
  openModal({
    title: `Reset Password — ${username}`,
    bodyHtml: `
      <p class="helper-text" style="margin-bottom:14px">Admin must provide the user's current password to set a new one. If the password is unknown, delete and recreate the user account.</p>
      <div class="field"><label>User's Current Password *</label><input type="password" id="rp-curpw" placeholder="User's existing password"></div>
      <div class="field"><label>New Password *</label><input type="password" id="rp-newpw" placeholder="Min 6 characters"></div>
      <div class="field"><label>Confirm New Password *</label><input type="password" id="rp-cfpw" placeholder="Re-enter new password"></div>
      <div id="rp-error" class="error-text" hidden></div>`,
    footerHtml: `<button class="btn btn-outline" data-close-modal type="button">Cancel</button><button class="btn btn-primary" id="rp-save" type="button">Reset Password</button>`,
    onMount: (bd) => $('#rp-save', bd).addEventListener('click', async () => {
      const cur  = $('#rp-curpw', bd).value;
      const nw   = $('#rp-newpw', bd).value;
      const cf   = $('#rp-cfpw', bd).value;
      const err  = $('#rp-error', bd);
      const fail = (msg) => { err.textContent = msg; err.hidden = false; };
      if (!cur || !nw || !cf){ fail('All fields are required.'); return; }
      if (nw.length < 6){ fail('New password must be at least 6 characters.'); return; }
      if (nw !== cf){ fail('Passwords do not match.'); return; }
      const btn = $('#rp-save', bd);
      btn.disabled = true;
      try {
        await DB.adminResetPassword(username, cur, nw, App.user);
        toast('success', 'Password reset', username);
        closeModal();
      } catch(e){
        btn.disabled = false;
        if (['auth/invalid-credential','auth/wrong-password'].includes(e.code)) fail('Current password is incorrect.');
        else if (e.code === 'auth/weak-password') fail('New password is too weak (min 6 characters).');
        else { fail('Error: ' + (e.message || e.code)); console.error(e); }
      }
    }),
  });
}

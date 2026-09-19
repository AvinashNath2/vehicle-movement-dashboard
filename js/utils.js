/* Shared DOM + formatting + UI-primitive helpers. */

const $  = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function el(html){
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function escapeHtml(str){
  return String(str ?? '').replace(/[&<>"']/g, s => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[s]));
}

function debounce(fn, ms){
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms || 250); };
}

function uid(prefix){
  return (prefix || 'ID') + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
}

function pad2(n){ return String(n).padStart(2, '0'); }

function todayISO(){
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}

function isoToDate(iso){
  if (!iso) return null;
  const [y,m,d] = iso.split('-').map(Number);
  return new Date(y, (m||1)-1, d||1);
}

function addDaysISO(iso, days){
  const d = isoToDate(iso);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}

const WEEKDAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTH = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatDateLong(iso){
  const d = isoToDate(iso);
  if (!d) return '';
  return `${WEEKDAY[d.getDay()]}, ${pad2(d.getDate())} ${MONTH[d.getMonth()]} ${d.getFullYear()}`;
}

function formatDateShort(iso){
  const d = isoToDate(iso);
  if (!d) return '';
  return `${pad2(d.getDate())} ${MONTH[d.getMonth()]}`;
}

function formatDateDMY(iso){
  const d = isoToDate(iso);
  if (!d) return '';
  return `${pad2(d.getDate())}-${pad2(d.getMonth()+1)}-${d.getFullYear()}`;
}

function formatDateTime(iso){
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return `${pad2(d.getDate())}-${pad2(d.getMonth()+1)}-${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatTime(t){
  if (t === undefined || t === null || t === '') return '--:--';
  let s = String(t).trim().replace(':', '');
  if (!/^\d{3,4}$/.test(s)) return escapeHtml(String(t));
  s = s.padStart(4, '0');
  return `${s.slice(0,2)}:${s.slice(2)}`;
}

function normalizeTime(t){
  if (!t) return '';
  const s = String(t).trim().replace(':', '');
  if (!/^\d{3,4}$/.test(s)) return null;
  const padded = s.padStart(4, '0');
  const hh = Number(padded.slice(0,2)), mm = Number(padded.slice(2));
  if (hh > 23 || mm > 59) return null;
  return padded;
}

function formatNumber(n){
  return Number(n || 0).toLocaleString('en-IN');
}

function fmtKm(n){
  return `${formatNumber(n)} km`;
}

/* ---------------- toasts ---------------- */
function toast(type, title, msg){
  const stack = $('#toast-stack');
  if (!stack) return;
  const iconName = type === 'success' ? 'check' : type === 'error' ? 'alertTriangle' : 'info';
  const node = el(`
    <div class="toast ${type}">
      ${icon(iconName)}
      <div class="msg"><span class="t">${escapeHtml(title)}</span>${msg ? escapeHtml(msg) : ''}</div>
    </div>`);
  stack.appendChild(node);
  setTimeout(() => { node.style.opacity = '0'; node.style.transition = 'opacity .25s'; setTimeout(() => node.remove(), 260); }, 3400);
}

/* ---------------- modal ---------------- */
function openModal({ title, bodyHtml, large, footerHtml, onMount, onClose }){
  closeModal();
  const backdrop = el(`
    <div class="modal-backdrop" id="active-modal">
      <div class="modal ${large ? 'modal-lg' : ''}">
        <div class="modal-head">
          <h3>${escapeHtml(title)}</h3>
          <button class="icon-btn" data-close-modal type="button">${icon('x')}</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
        ${footerHtml ? `<div class="modal-foot">${footerHtml}</div>` : ''}
      </div>
    </div>`);
  document.body.appendChild(backdrop);
  document.body.style.overflow = 'hidden';
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) closeModal(); });
  $$('[data-close-modal]', backdrop).forEach(b => b.addEventListener('click', closeModal));
  backdrop._onClose = onClose;
  if (onMount) onMount(backdrop);
  return backdrop;
}

function closeModal(){
  const m = $('#active-modal');
  if (m){
    if (m._onClose) { try { m._onClose(); } catch(e){} }
    m.remove();
  }
  document.body.style.overflow = '';
}

function confirmDialog({ title, message, confirmText, danger, onConfirm }){
  const backdrop = openModal({
    title,
    bodyHtml: `
      <div class="confirm-icon" style="background:${danger ? 'var(--critical-bg)' : 'var(--brand-bg)'};color:${danger ? 'var(--critical)' : 'var(--brand)'}">
        ${icon(danger ? 'alertTriangle' : 'info')}
      </div>
      <div>${message}</div>`,
    footerHtml: `
      <button class="btn btn-outline" data-close-modal type="button">Cancel</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirm-ok" type="button">${confirmText || 'Confirm'}</button>`
  });
  $('#confirm-ok', backdrop).addEventListener('click', () => { closeModal(); onConfirm(); });
}

/* ---------------- searchable dropdown ---------------- */
function vehicleSelectOptions({ onlyActive, includeAll } = {}){
  const list = DB.vehicles
    .filter(v => !onlyActive || v.Status === 'Active')
    .slice().sort((a,b) => a.RegistrationNo.localeCompare(b.RegistrationNo))
    .map(v => ({ value: v.RegistrationNo, label: `${v.RegistrationNo} — ${v.VehicleType}${v.Status!=='Active'?' (Inactive)':''}` }));
  return includeAll ? [{ value: 'ALL', label: 'All Vehicles' }, ...list] : list;
}

function buildSearchableSelect({ id, options, value, placeholder }){
  const sel = options.find(o => o.value === value);
  const optsHtml = options.map(o =>
    `<li data-ss-val="${escapeHtml(o.value)}" ${o.value===value?'class="ss-selected"':''}>${escapeHtml(o.label)}</li>`
  ).join('');
  return `<div class="ss-wrap" data-ss-id="${escapeHtml(id)}">
      <input type="text" class="ss-input" id="${id}-input" placeholder="${escapeHtml(placeholder||'Search…')}" value="${sel?escapeHtml(sel.label):''}" autocomplete="off" spellcheck="false">
      <ul class="ss-list" id="${id}-list" hidden>${optsHtml}</ul>
    </div>
    <input type="hidden" id="${id}" value="${escapeHtml(value||'')}">`;
}

function wireSearchableSelect(id, onChange){
  const input = document.getElementById(`${id}-input`);
  const list  = document.getElementById(`${id}-list`);
  const hidden = document.getElementById(id);
  if (!input || !list || !hidden) return;

  const items = () => Array.from(list.querySelectorAll('li'));

  function filterList(q){
    const ql = q.trim().toLowerCase();
    items().forEach(li => { li.hidden = !!(ql && !li.textContent.toLowerCase().includes(ql)); });
  }
  function selectItem(val, label){
    hidden.value = val;
    items().forEach(li => li.classList.toggle('ss-selected', li.dataset.ssVal === val));
    input.value = label;
    list.hidden = true;
    if (onChange) onChange(val);
  }
  function openList(){
    filterList(''); list.hidden = false;
    const s = list.querySelector('li.ss-selected');
    if (s) s.scrollIntoView({ block:'nearest' });
  }

  input.addEventListener('focus',  () => { input.select(); openList(); });
  input.addEventListener('input',  () => { filterList(input.value); list.hidden = false; });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape'){ list.hidden = true; input.blur(); return; }
    if (e.key === 'Enter'){
      e.preventDefault();
      const vis = items().filter(li => !li.hidden);
      if (vis.length === 1) selectItem(vis[0].dataset.ssVal, vis[0].textContent.trim());
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      e.preventDefault();
      const vis = items().filter(li => !li.hidden);
      const cur = vis.findIndex(li => li.classList.contains('ss-focus'));
      vis.forEach(li => li.classList.remove('ss-focus'));
      const next = e.key === 'ArrowDown' ? (vis[cur+1] || vis[0]) : (vis[cur-1] || vis[vis.length-1]);
      if (next){ next.classList.add('ss-focus'); next.scrollIntoView({ block:'nearest' }); }
    }
  });
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    e.preventDefault();
    selectItem(li.dataset.ssVal, li.textContent.trim());
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (!list.hidden){
        const sel = list.querySelector('li.ss-selected');
        input.value = sel ? sel.textContent.trim() : '';
        list.hidden = true;
      }
    }, 150);
  });
  // Init display from currently selected item
  const initSel = list.querySelector('li.ss-selected');
  if (initSel) input.value = initSel.textContent.trim();
}

/* ---------------- whatsapp movement share ---------------- */
async function openShareModal(movId){
  const m = DB.getMovement(movId);
  if (!m) return;
  const date   = formatDateDMY(m.Date);
  const outT   = m.OpeningTime ? formatTime(m.OpeningTime) : '—';
  const inT    = m.ClosingTime ? formatTime(m.ClosingTime) : '—';
  const done   = m.Status === 'Completed';
  const lines  = [
    '*03 BN NDRF — MT Ops*',
    '━━━━━━━━━━━━━━━━',
    `Veh: ${m.RegistrationNo} (${m.VehicleType})`,
    `Driver: ${m.DriverName}`,
    `Date: ${date}`,
    `Out: ${outT} @ ${formatNumber(m.OpeningKM)} km`,
    ...(done ? [`In: ${inT} @ ${formatNumber(m.ClosingKM)} km`, `Total: ${fmtKm(m.TotalKM)}`] : []),
    `Purpose: ${m.PurposePlace}`,
    ...(m.PermittedBy ? [`Permitted By: ${m.PermittedBy}`] : []),
    `Status: ${done ? '✅ Completed' : '🔴 In Progress'}`,
    '━━━━━━━━━━━━━━━━',
  ];
  const text = lines.join('\n');

  // Build off-screen card for capture
  const card = document.createElement('div');
  card.className = 'mv-share-card';
  card.innerHTML = `
    <div class="sc-head"><div class="sc-unit">03 BN NDRF, MUNDALI</div><div class="sc-sub">MT Ops Record</div></div>
    <table class="sc-table">
      <tr><td class="sk">Vehicle</td><td class="sv">${escapeHtml(m.RegistrationNo)} — ${escapeHtml(m.VehicleType)}</td></tr>
      <tr><td class="sk">Date</td><td class="sv">${date}</td></tr>
      <tr><td class="sk">Driver</td><td class="sv">${escapeHtml(m.DriverName)}</td></tr>
      <tr><td class="sk">Out Time</td><td class="sv">${outT}&nbsp;&nbsp;(${formatNumber(m.OpeningKM)} km)</td></tr>
      ${done ? `<tr><td class="sk">In Time</td><td class="sv">${inT}&nbsp;&nbsp;(${formatNumber(m.ClosingKM)} km)</td></tr>
      <tr><td class="sk">Total KM</td><td class="sv"><strong>${fmtKm(m.TotalKM)}</strong></td></tr>` : ''}
      <tr><td class="sk">Purpose</td><td class="sv">${escapeHtml(m.PurposePlace)}</td></tr>
      ${m.PermittedBy ? `<tr><td class="sk">Permitted By</td><td class="sv">${escapeHtml(m.PermittedBy)}</td></tr>` : ''}
      <tr><td class="sk">Status</td><td class="sv"><span class="sc-status-${done?'ok':'wip'}">${done ? 'Completed' : 'In Progress'}</span></td></tr>
    </table>`;
  document.body.appendChild(card);

  let imgSrc = null;
  if (typeof html2canvas !== 'undefined'){
    try {
      const canvas = await html2canvas(card, { scale:2, backgroundColor:'#fff', logging:false });
      imgSrc = canvas.toDataURL('image/png');
    } catch(e){ console.warn('html2canvas:', e); }
  }
  document.body.removeChild(card);

  openModal({
    title: 'Share Movement',
    large: true,
    bodyHtml: `
      <div class="share-grid">
        ${imgSrc ? `<div class="share-preview"><img src="${imgSrc}" alt="Movement card preview"></div>` : ''}
        <div class="share-message">
          <div class="field" style="margin:0">
            <label>WhatsApp Message</label>
            <textarea id="share-text" rows="10">${escapeHtml(text)}</textarea>
          </div>
        </div>
      </div>`,
    footerHtml: `
      <button class="btn btn-outline btn-sm" data-close-modal type="button" style="margin-right:auto">Close</button>
      <button class="btn btn-outline btn-sm" id="share-copy" type="button">${icon('doc')} Copy Text</button>
      ${imgSrc ? `<button class="btn btn-outline btn-sm" id="share-dl" type="button">${icon('download')} Save Image</button>` : ''}
      <button class="btn btn-sm share-wa-btn" id="share-wa" type="button">${icon('share')} WhatsApp</button>`,
    onMount: (bd) => {
      $('#share-copy', bd).addEventListener('click', async () => {
        const t = $('#share-text', bd).value;
        try { await navigator.clipboard.writeText(t); } catch { const s = $('#share-text', bd); s.select(); document.execCommand('copy'); }
        toast('success', 'Copied to clipboard');
      });
      $('#share-dl', bd)?.addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = imgSrc; a.download = `movement-${m.RegistrationNo}-${m.Date}.png`; a.click();
      });
      $('#share-wa', bd).addEventListener('click', async () => {
        const t = $('#share-text', bd).value;
        if (imgSrc && navigator.share && navigator.canShare){
          try {
            const res = await fetch(imgSrc);
            const blob = await res.blob();
            const file = new File([blob], `movement-${m.RegistrationNo}.png`, { type:'image/png' });
            if (navigator.canShare({ files:[file] })){ await navigator.share({ files:[file], text:t }); return; }
          } catch(e){ /* fall through */ }
        }
        window.open(`https://wa.me/?text=${encodeURIComponent(t)}`, '_blank');
      });
    },
  });
}

/* ---------------- tiny state-driven pagination helper ---------------- */
function paginate(items, page, pageSize){
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), pages);
  const start = (p - 1) * pageSize;
  return { rows: items.slice(start, start + pageSize), page: p, pages, total, start };
}

function paginationHtml(info){
  const { page, pages, total, start, rows } = info;
  let btns = '';
  const windowSize = 5;
  let from = Math.max(1, page - Math.floor(windowSize/2));
  let to = Math.min(pages, from + windowSize - 1);
  from = Math.max(1, to - windowSize + 1);
  for (let p = from; p <= to; p++){
    btns += `<button class="page-btn ${p===page?'active':''}" data-page="${p}" type="button">${p}</button>`;
  }
  return `
    <div class="pagination">
      <div class="info">Showing ${total ? start+1 : 0}-${start + rows.length} of ${total}</div>
      <div class="pages">
        <button class="page-btn" data-page="${page-1}" type="button" ${page<=1?'disabled':''}>${icon('chevronLeft')}</button>
        ${btns}
        <button class="page-btn" data-page="${page+1}" type="button" ${page>=pages?'disabled':''}>${icon('chevronRight')}</button>
      </div>
    </div>`;
}

function wirePagination(container, onChange){
  $$('.page-btn[data-page]', container).forEach(b => {
    b.addEventListener('click', () => {
      if (b.disabled) return;
      onChange(Number(b.dataset.page));
    });
  });
}

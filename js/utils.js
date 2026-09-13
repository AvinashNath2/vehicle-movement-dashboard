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

/* App shell: boot, auth, routing, top-level chrome. Page bodies live in pages.js */

function makeDefaultFilters(){
  const from7 = addDaysISO(todayISO(), -6);
  return {
    dashboard: { from: from7, to: todayISO(), vehicle: 'ALL', driver: 'ALL' },
    movements: { view: 'form', search: '', from: '', to: '', vehicle: 'ALL', driver: '', forceNo: '', requestedBy: '', page: 1, editingId: null },
    allMovements: { search: '', from: '', to: '', vehicle: 'ALL', driver: '', forceNo: '', page: 1 },
    vehicles: { search: '', status: 'ALL', page: 1 },
    reports: { from: from7, to: todayISO(), vehicle: 'ALL', generated: false, sortKey: 'Date', sortDir: 'desc' },
    audit: { search: '', from: '', to: '', user: 'ALL', page: 1 },
  };
}

const App = {
  user: null,
  route: 'dashboard',
  filters: makeDefaultFilters(),
};

/* Operators only work the daily register: their nav shows Movement Entries
   alone, and Settings stays reachable via the avatar menu for password
   changes. Everything else is Admin-only (guarded in onRouteChange too). */
const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'home', roles: ['Admin'] },
  { id: 'vehicles', label: 'Vehicles', icon: 'car', roles: ['Admin'] },
  { id: 'movements', label: 'Movement Entries', icon: 'doc', roles: ['Admin', 'Operator'] },
  { id: 'all-movements', label: 'All Movement Entries', icon: 'list', roles: ['Admin', 'Operator'] },
  { id: 'reports', label: 'Reports', icon: 'list', roles: ['Admin'] },
  { id: 'audit', label: 'Audit Log', icon: 'clock', roles: ['Admin'] },
  { id: 'settings', label: 'Settings', icon: 'gear', roles: ['Admin', 'Operator'], operatorHiddenInNav: true },
];

function isAdmin(){ return App.user?.Role === 'Admin'; }
function allowedRoutes(){
  return NAV_ITEMS.filter(n => n.roles.includes(App.user?.Role)).map(n => n.id);
}
function navItems(){
  return NAV_ITEMS.filter(n => n.roles.includes(App.user?.Role) && !(n.operatorHiddenInNav && !isAdmin()));
}
function defaultRoute(){ return isAdmin() ? 'dashboard' : 'movements'; }

function bootError(msg, err){
  hideLoadingOverlay();
  $('#login-error').textContent = msg;
  $('#login-error').hidden = false;
  if (err) console.error(err);
}

const SESSION_KEY = 'mtOpsSession';

function saveSession(forceNo){
  try { localStorage.setItem(SESSION_KEY, JSON.stringify({ forceNo, at: new Date().toISOString() })); }
  catch (e){ console.warn('saveSession failed:', e); }
}
function readSession(){
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && s.forceNo ? s : null;
  } catch { return null; }
}
function clearSession(){ try { localStorage.removeItem(SESSION_KEY); } catch(_){} }

function boot(){
  showLoadingOverlay('Connecting…');
  if (!window.FB){
    bootError('Could not load Firebase. Check your internet connection and reload.');
    showLoginKeepError();
    return;
  }
  const session = readSession();
  if (!session){
    hideLoadingOverlay();
    showLogin();
    return;
  }
  // Restore the session by re-fetching the user doc so we pick up any
  // password/active-status changes admin made while this tab was closed.
  // 5s timeout falls through to the login screen instead of hanging on the
  // loading overlay if Firestore is unreachable.
  const restore = (async () => {
    const u = await DB.fetchUser(session.forceNo);
    if (!u || String(u.Active).toLowerCase() === 'no'){
      clearSession();
      throw new Error('inactive-or-missing');
    }
    App.user = u;
    await DB.init();
    if (!isAdmin()) App.filters.movements.view = 'landing';
    hideLoadingOverlay();
    enterApp();
  })();
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000));
  Promise.race([restore, timeout]).catch(err => {
    if (err.message === 'timeout'){
      bootError('Could not connect to the cloud database. Check your internet connection and reload.');
    }
    hideLoadingOverlay();
    showLogin();
  });
}

// Session revalidation — cheap defense against a session that's still in
// localStorage after admin deactivated the account or changed the password
// from another tab/browser. Runs on tab focus and every route change.
let _revalInFlight = false;
async function revalidateSession(){
  if (!App.user || _revalInFlight) return;
  _revalInFlight = true;
  try {
    const fresh = await DB.fetchUser(App.user.Username);
    if (!fresh){
      forceLogout('Your account is no longer available. Please log in again.');
      return;
    }
    if (String(fresh.Active).toLowerCase() === 'no'){
      forceLogout('Your account has been deactivated. Contact an admin.');
      return;
    }
    if (String(fresh.Password) !== String(App.user.Password)){
      forceLogout('Your password was changed elsewhere. Please log in again.');
      return;
    }
    // Refresh in-memory profile so DisplayName / ForceNo etc. stay current.
    App.user = fresh;
  } catch (err){
    // Non-fatal — network hiccup; leave session as-is.
    console.warn('revalidateSession failed:', err);
  } finally {
    _revalInFlight = false;
  }
}
function forceLogout(msg){
  try { toast('warn', 'Signed out', msg); } catch(_){}
  App.user = null;
  DB.teardown();
  clearSession();
  showLogin();
  const err = $('#login-error');
  if (err){ err.textContent = msg; err.hidden = false; }
}

function showLoginKeepError(){
  $('#app-shell').hidden = true;
  $('#login-screen').hidden = false;
}

function showLoadingOverlay(msg){
  let ov = $('#loading-overlay');
  if (!ov){
    ov = el(`<div class="loading-overlay" id="loading-overlay"><span class="spinner dark"></span><span id="loading-msg"></span></div>`);
    document.body.appendChild(ov);
  }
  $('#loading-msg', ov).textContent = msg || 'Loading…';
  ov.hidden = false;
}
function hideLoadingOverlay(){ const ov = $('#loading-overlay'); if (ov) ov.hidden = true; }

function showLogin(){
  $('#app-shell').hidden = true;
  $('#login-screen').hidden = false;
  $('#login-username').value = '';
  $('#login-password').value = '';
  $('#login-error').hidden = true;
  $('#login-username').focus();
}

function enterApp(){
  $('#login-screen').hidden = true;
  $('#app-shell').hidden = false;
  renderShell();
  window.removeEventListener('hashchange', onRouteChange);
  window.addEventListener('hashchange', onRouteChange);
  onRouteChange();
}

async function handleLogin(e){
  e.preventDefault();
  const forceNo = $('#login-username').value.trim().toLowerCase();
  const password = $('#login-password').value;
  const errBox = $('#login-error');
  if (!forceNo || !password){
    errBox.textContent = 'Please enter both Force No. and password.';
    errBox.hidden = false;
    return;
  }
  const btn = $('#login-submit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Signing in…';
  const fail = (msg) => { errBox.textContent = msg; errBox.hidden = false; };
  try {
    // Single Firestore read; compare passwords client-side. Return the same
    // generic error for both "no such user" and "wrong password" so an
    // attacker with the API key can't enumerate valid Force Nos through
    // timing differences on the login form alone.
    const u = await DB.fetchUser(forceNo);
    if (!u){ fail('Invalid Force No. or password.'); return; }
    if (String(u.Password) !== String(password)){ fail('Invalid Force No. or password.'); return; }
    if (String(u.Active).toLowerCase() === 'no'){ fail('This account has been deactivated. Contact an admin.'); return; }
    App.user = u;
    saveSession(u.Username);
    await DB.init();
    DB.logAudit(u, 'Login', 'User', u.Username, 'User signed in');
    App.filters = makeDefaultFilters();
    if (!isAdmin()) App.filters.movements.view = 'landing';
    history.replaceState(null, '', '#/' + defaultRoute());
    enterApp();
  } catch (err){
    fail('Sign-in failed: ' + (err.message || err.code || 'unknown error'));
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Login';
  }
}

async function handleLogout(){
  if (App.user) await DB.logAudit(App.user, 'Logout', 'User', App.user.Username, 'User signed out');
  App.user = null;
  DB.teardown();
  clearSession();
  showLogin();
}

function renderShell(){
  const shell = $('#app-shell');
  shell.innerHTML = `
    <div class="sidebar" id="sidebar">
      <div class="sidebar-brand">
        <div class="logo">${icon('car')}</div>
        <div class="name">MT Ops</div>
      </div>
      <nav class="nav" id="nav-list">
        ${navItems().map(n => `
          <a href="#/${n.id}" class="nav-item" data-nav="${n.id}">${icon(n.icon)}<span>${n.label}</span></a>
        `).join('')}
      </nav>
      <div class="sidebar-foot">Daily MT Ops Register<br>Live · data synced via Cloud Firestore</div>
    </div>
    <div class="main">
      <div class="topbar">
        <div style="display:flex;align-items:center;gap:10px">
          <button class="btn icon-btn hamburger" id="btn-hamburger" type="button">${icon('menu')}</button>
          <h1 id="page-title">Dashboard</h1>
        </div>
        <div class="topbar-right">
          <div class="today-chip">${icon('calendar')}<span class="long">${formatDateLong(todayISO())}</span></div>
          <div class="user-menu">
            <button class="user-btn" id="btn-user-menu" type="button">
              <div class="avatar">${(App.user.DisplayName||App.user.Username).slice(0,2).toUpperCase()}</div>
            </button>
            <div class="user-dropdown" id="user-dropdown">
              <div class="who"><div class="name">${escapeHtml(App.user.DisplayName)}</div><div class="role">${escapeHtml(App.user.Role)}</div></div>
              <button type="button" data-nav-inline="settings">${icon('gear')} Settings</button>
              <button type="button" id="btn-logout">${icon('logout')} Logout</button>
            </div>
          </div>
        </div>
      </div>
      <div class="page" id="page-content"></div>
    </div>
  `;

  $('#btn-user-menu').addEventListener('click', () => $('#user-dropdown').classList.toggle('open'));
  $('#btn-logout').addEventListener('click', handleLogout);
  $('[data-nav-inline="settings"]').addEventListener('click', () => { location.hash = '#/settings'; $('#user-dropdown').classList.remove('open'); });
  $('#btn-hamburger').addEventListener('click', (e) => { e.stopPropagation(); $('#sidebar').classList.toggle('open'); });

  // Shell is re-rendered on every login, so document-level dismiss handlers
  // must only be attached once or they pile up across logout/login cycles.
  if (!renderShell._docWired){
    renderShell._docWired = true;
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.user-menu')) $('#user-dropdown')?.classList.remove('open');
      const sidebar = $('#sidebar');
      if (sidebar && sidebar.classList.contains('open') && !e.target.closest('#sidebar') && !e.target.closest('#btn-hamburger')){
        sidebar.classList.remove('open');
      }
    });
  }
}

function onRouteChange(){
  if (!App.user) return;
  const hash = (location.hash || '').replace('#/', '');
  App.route = allowedRoutes().includes(hash) ? hash : defaultRoute();
  if (hash !== App.route) history.replaceState(null, '', '#/' + App.route);
  $$('.nav-item').forEach(a => a.classList.toggle('active', a.dataset.nav === App.route));
  $('#page-title').textContent = (NAV_ITEMS.find(n => n.id === App.route) || {}).label || 'Dashboard';
  $('#sidebar').classList.remove('open');
  renderPage(App.route);
  window.scrollTo({ top: 0 });
  // Fire-and-forget: catches deactivation / password-change-elsewhere quickly.
  revalidateSession();
}

function renderPage(route){
  const container = $('#page-content');
  const renderers = {
    dashboard: renderDashboardPage,
    vehicles: renderVehiclesPage,
    movements: renderMovementsPage,
    'all-movements': renderAllMovementsPage,
    reports: renderReportsPage,
    audit: renderAuditPage,
    settings: renderSettingsPage,
  };
  (renderers[route] || renderDashboardPage)(container);
}

// Re-render the current page when another device changes data — but never
// mid-interaction: skip if a modal is open, the movement form is showing,
// or the user is typing in a field.
DB.onRemoteChange = debounce(() => {
  if (!App.user) return;
  if ($('#active-modal')) return;
  if (App.route === 'movements' && App.filters.movements.view === 'form') return;
  const ae = document.activeElement;
  if (ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) return;
  renderPage(App.route);
}, 300);


document.addEventListener('DOMContentLoaded', () => {
  $('#login-form').addEventListener('submit', handleLogin);
  // Re-check whether the user is still active / still has the same password
  // whenever the tab regains focus. Cheap free defence against a session
  // that's been sitting in localStorage since admin changed something.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') revalidateSession();
  });
  boot();
});

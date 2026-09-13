/* App shell: boot, auth, routing, top-level chrome. Page bodies live in pages.js */

function makeDefaultFilters(){
  return {
    dashboard: { from: todayISO(), to: todayISO(), vehicle: 'ALL' },
    movements: { view: 'form', search: '', from: '', to: '', vehicle: 'ALL', driver: '', requestedBy: '', page: 1, editingId: null },
    vehicles: { search: '', status: 'ALL', page: 1 },
    reports: { from: todayISO(), to: todayISO(), vehicle: 'ALL', generated: false },
    audit: { search: '', from: '', to: '', page: 1 },
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

function boot(){
  showLoadingOverlay('Connecting…');
  if (!window.FB){
    bootError('Could not load Firebase. Check your internet connection and reload.');
    showLoginKeepError();
    return;
  }
  // First callback reflects the restored session (Firebase persists logins
  // across restarts). Later auth changes are handled by login/logout directly.
  let handledRestore = false;
  FB.onAuthStateChanged(FB.auth, async (fbUser) => {
    if (handledRestore) return;
    handledRestore = true;
    if (fbUser){
      try {
        await DB.init();
        const username = fbUser.email.split('@')[0];
        const u = DB.findUser(username);
        if (u && String(u.Active).toLowerCase() !== 'no'){
          App.user = u;
          hideLoadingOverlay();
          enterApp();
          return;
        }
        DB.teardown();
        await FB.signOut(FB.auth);
      } catch (err){
        bootError('Could not connect to the cloud database. Check your internet connection and reload.', err);
        showLoginKeepError();
        return;
      }
    }
    hideLoadingOverlay();
    showLogin();
  });
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
  const username = $('#login-username').value.trim().toLowerCase();
  const password = $('#login-password').value;
  const errBox = $('#login-error');
  if (!username || !password){
    errBox.textContent = 'Please enter both username and password.';
    errBox.hidden = false;
    return;
  }
  const btn = $('#login-submit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Signing in…';
  const fail = (msg) => { errBox.textContent = msg; errBox.hidden = false; };
  try {
    await FB.signInWithEmailAndPassword(FB.auth, DB.emailFor(username), password);
    await DB.init();
    const u = DB.findUser(username);
    if (!u || String(u.Active).toLowerCase() === 'no'){
      DB.teardown();
      await FB.signOut(FB.auth);
      fail(!u ? 'This account has no profile. Ask an admin to re-create it.' : 'This account has been deactivated. Contact an admin.');
      return;
    }
    App.user = u;
    DB.logAudit(u, 'Login', 'User', u.Username, 'User signed in');
    // Fresh sign-in: don't inherit the previous user's page or filters.
    App.filters = makeDefaultFilters();
    history.replaceState(null, '', '#/' + defaultRoute());
    enterApp();
  } catch (err){
    if (['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password', 'auth/invalid-email'].includes(err.code)){
      fail('Invalid username or password.');
    } else if (err.code === 'auth/too-many-requests'){
      fail('Too many failed attempts. Wait a few minutes and try again.');
    } else if (err.code === 'auth/network-request-failed'){
      fail('Network error — check your internet connection.');
    } else {
      fail('Sign-in failed: ' + (err.message || err.code || 'unknown error'));
      console.error(err);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Login';
  }
}

async function handleLogout(){
  if (App.user) await DB.logAudit(App.user, 'Logout', 'User', App.user.Username, 'User signed out');
  App.user = null;
  DB.teardown();
  try { await FB.signOut(FB.auth); } catch(e){ console.error(e); }
  showLogin();
}

function renderShell(){
  const shell = $('#app-shell');
  shell.innerHTML = `
    <div class="sidebar" id="sidebar">
      <div class="sidebar-brand">
        <div class="logo">${icon('car')}</div>
        <div class="name">Vehicle Movement</div>
      </div>
      <nav class="nav" id="nav-list">
        ${navItems().map(n => `
          <a href="#/${n.id}" class="nav-item" data-nav="${n.id}">${icon(n.icon)}<span>${n.label}</span></a>
        `).join('')}
      </nav>
      <div class="sidebar-foot">Daily Vehicle Movement Register<br>Live · data synced via Cloud Firestore</div>
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
}

function renderPage(route){
  const container = $('#page-content');
  const renderers = {
    dashboard: renderDashboardPage,
    vehicles: renderVehiclesPage,
    movements: renderMovementsPage,
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
  boot();
});

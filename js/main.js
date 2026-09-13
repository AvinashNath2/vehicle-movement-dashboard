/* App shell: boot, auth, routing, top-level chrome. Page bodies live in pages.js */

const SESSION_KEY = 'vmd_session_v1';

const App = {
  user: null,
  route: 'dashboard',
  filters: {
    dashboard: { from: todayISO(), to: todayISO(), vehicle: 'ALL' },
    movements: { view: 'form', search: '', from: '', to: '', vehicle: 'ALL', driver: '', requestedBy: '', page: 1, editingId: null },
    vehicles: { search: '', status: 'ALL', page: 1 },
    reports: { from: todayISO(), to: todayISO(), vehicle: 'ALL', generated: false },
    audit: { search: '', from: '', to: '', page: 1 },
  },
};

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'home' },
  { id: 'vehicles', label: 'Vehicles', icon: 'car' },
  { id: 'movements', label: 'Movement Entries', icon: 'doc' },
  { id: 'reports', label: 'Reports', icon: 'list' },
  { id: 'audit', label: 'Audit Log', icon: 'clock' },
  { id: 'settings', label: 'Settings', icon: 'gear' },
];

async function boot(){
  showLoadingOverlay('Loading register…');
  try {
    await DB.init();
  } catch (err){
    hideLoadingOverlay();
    $('#login-error').textContent = 'Could not load the vehicle register data file. If you are opening this file directly (file://), please serve it over http(s) — see README.';
    $('#login-error').hidden = false;
    console.error(err);
    return;
  }
  hideLoadingOverlay();

  const savedSession = sessionStorage.getItem(SESSION_KEY);
  if (savedSession){
    const u = DB.findUser(savedSession);
    if (u && String(u.Active).toLowerCase() !== 'no'){
      App.user = u;
      enterApp();
      return;
    }
  }
  showLogin();
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

function handleLogin(e){
  e.preventDefault();
  const username = $('#login-username').value.trim();
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
  setTimeout(() => {
    const u = DB.verifyLogin(username, password);
    btn.disabled = false;
    btn.textContent = 'Login';
    if (!u){
      errBox.textContent = 'Invalid username or password.';
      errBox.hidden = false;
      return;
    }
    App.user = u;
    sessionStorage.setItem(SESSION_KEY, u.Username);
    DB.logAudit(u, 'Login', 'User', u.Username, 'User signed in');
    DB.persist();
    enterApp();
  }, 250);
}

function handleLogout(){
  if (App.user) { DB.logAudit(App.user, 'Logout', 'User', App.user.Username, 'User signed out'); DB.persist(); }
  sessionStorage.removeItem(SESSION_KEY);
  App.user = null;
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
        ${NAV_ITEMS.map(n => `
          <a href="#/${n.id}" class="nav-item" data-nav="${n.id}">${icon(n.icon)}<span>${n.label}</span></a>
        `).join('')}
      </nav>
      <div class="sidebar-foot">Daily Vehicle Movement Register<br>Static build · data stored in this browser</div>
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
  const hash = (location.hash || '#/dashboard').replace('#/', '');
  const valid = NAV_ITEMS.some(n => n.id === hash);
  App.route = valid ? hash : 'dashboard';
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

document.addEventListener('DOMContentLoaded', () => {
  $('#login-form').addEventListener('submit', handleLogin);
  boot();
});

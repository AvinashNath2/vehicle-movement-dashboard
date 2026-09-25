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
        // Resolve the restored session to a user profile. The auth email may
        // be either a synthetic pattern (email.split('@')[0] == Force No.) or
        // a real recovery email — in the latter case we find the user by
        // matching RecoveryEmail. Then heal the lookup so future logins skip
        // the fallback chain.
        const email = String(fbUser.email || '').toLowerCase();
        const local = email.split('@')[0];
        let u = DB.findUser(local);
        if (!u){
          // Handle the plus-alias form (avinashnath2+<forceno>@gmail.com).
          const plus = local.split('+')[1];
          if (plus) u = DB.findUser(plus);
        }
        if (!u){
          u = DB.users.find(x => (x.RecoveryEmail || '').toLowerCase() === email);
        }
        if (u && String(u.Active).toLowerCase() !== 'no'){
          App.user = u;
          DB.writeUsernameLookup(u.Username, email);
          if (!isAdmin()) App.filters.movements.view = 'landing';
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
  const rawInput = $('#login-username').value.trim();
  const forceNo = rawInput.toLowerCase();
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
    // Force No. is the only accepted identifier. Resolve it to an auth email
    // via the public usernameLookup collection first; if we've never seen the
    // user, fall back to the two synthetic patterns (plus-alias, then legacy
    // @vmd-fleet.app). Whichever email actually works, we then heal the
    // lookup so the next login uses the fast path.
    const credentialCodes = ['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password', 'auth/invalid-email'];
    const cachedEmail = await DB.lookupAuthEmail(forceNo);
    const candidates = [];
    if (cachedEmail) candidates.push(cachedEmail);
    candidates.push(DB.emailFor(forceNo), DB.legacyEmailFor(forceNo));
    let signedIn = false, lastErr;
    for (const email of candidates){
      try {
        await FB.signInWithEmailAndPassword(FB.auth, email, password);
        signedIn = true;
        break;
      } catch (err){
        if (!credentialCodes.includes(err.code)) throw err;
        lastErr = err;
      }
    }
    if (!signedIn) throw lastErr || Object.assign(new Error('Invalid credentials.'), { code: 'auth/invalid-credential' });

    await DB.init();
    const u = DB.findUser(forceNo);
    if (!u || String(u.Active).toLowerCase() === 'no'){
      DB.teardown();
      await FB.signOut(FB.auth);
      fail(!u ? 'This account has no profile. Ask an admin to re-create it.' : 'This account has been deactivated. Contact an admin.');
      return;
    }
    App.user = u;
    // Heal the lookup so future logins skip the fallback chain and admin
    // flows (rename, force-reset) can find this user by Force No. Awaited so
    // the write is durable before we surface success to the user.
    await DB.writeUsernameLookup(u.Username, FB.auth.currentUser.email);
    DB.logAudit(u, 'Login', 'User', u.Username, 'User signed in');
    App.filters = makeDefaultFilters();
    if (!isAdmin()) App.filters.movements.view = 'landing';
    history.replaceState(null, '', '#/' + defaultRoute());
    enterApp();
    // Mandatory recovery email: block the app until one is set.
    if (!u.RecoveryEmail) openMandatoryRecoveryEmailModal(password);
  } catch (err){
    if (['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password', 'auth/invalid-email'].includes(err.code)){
      fail('Invalid Force No. or password.');
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

/**
 * Three-state blocking modal:
 *   STATE A "initial"  — email + password fields, Save & Continue
 *   STATE B "pending"  — verification link sent, poll + I've clicked + resend
 *   STATE C "timeout"  — polling gave up after 15 min
 *
 * All state transitions happen inside one modal (never closed/reopened) so the
 * user can't dismiss it by accident. Signing out is the only escape.
 */
function openMandatoryRecoveryEmailModal(loginPassword){
  let pendingEmail = null;
  let pollTimer = null;
  let pollDeadline = 0;

  function stopPolling(){ if (pollTimer){ clearInterval(pollTimer); pollTimer = null; } }

  function paint(state, err){
    const body = document.querySelector('#active-modal .modal-body');
    const foot = document.querySelector('#active-modal .modal-foot');
    if (!body || !foot) return;
    if (state === 'initial'){
      body.innerHTML = `
        <div style="padding:10px 12px;background:#FFF7E6;border:1px solid #F4C97C;border-radius:8px;color:#7A4A00;font-size:13.5px;line-height:1.55;margin:0 0 14px">
          <strong>Required before you can use the app.</strong> Add a personal email so you can reset your password on your own if you forget it. Without this, you'd be locked out until an admin resets it for you.
        </div>
        <div class="field"><label>Recovery Email</label><input type="email" id="mr-email" placeholder="you@example.com" autocomplete="email"></div>
        <div class="field"><label>Confirm Password</label><input type="password" id="mr-pw" placeholder="Your login password" autocomplete="current-password"></div>
        <div id="mr-error" class="error-text" ${err ? '' : 'hidden'} style="margin-top:6px">${err ? escapeHtml(err) : ''}</div>
      `;
      foot.innerHTML = `
        <button class="btn btn-outline" id="mr-logout" type="button" style="margin-right:auto">Sign out</button>
        <button class="btn btn-primary" id="mr-save" type="button">Send verification link</button>
      `;
      const emailInput = body.querySelector('#mr-email');
      const pwInput = body.querySelector('#mr-pw');
      if (pendingEmail) emailInput.value = pendingEmail;
      if (loginPassword) pwInput.value = loginPassword;
      emailInput.focus();
      foot.querySelector('#mr-logout').addEventListener('click', signOutAndReload);
      foot.querySelector('#mr-save').addEventListener('click', () => beginVerification(emailInput.value.trim(), pwInput.value));
    }
    else if (state === 'pending'){
      body.innerHTML = `
        <div style="padding:12px 14px;background:#EEFBF3;border:1px solid #A6E3BF;border-radius:8px;color:#0F5132;font-size:13.5px;line-height:1.6;margin:0 0 14px">
          <strong>Check your inbox.</strong><br>
          We sent a verification link to <strong>${escapeHtml(pendingEmail)}</strong>. Open your inbox, click the link, then come back here and press <em>"I've clicked the link"</em>.<br>
          <span style="opacity:.75">Don't see it? Check Spam. Some corporate mail scanners consume the link before you click it — if the first link doesn't work, tap <em>Resend</em>.</span>
        </div>
        <div id="mr-error" class="error-text" ${err ? '' : 'hidden'} style="margin-top:6px">${err ? escapeHtml(err) : ''}</div>
      `;
      foot.innerHTML = `
        <button class="btn btn-outline" id="mr-logout" type="button" style="margin-right:auto">Sign out</button>
        <button class="btn btn-outline" id="mr-change" type="button">Change email</button>
        <button class="btn btn-outline" id="mr-resend" type="button">Resend link</button>
        <button class="btn btn-primary" id="mr-check" type="button">I've clicked the link</button>
      `;
      foot.querySelector('#mr-logout').addEventListener('click', signOutAndReload);
      foot.querySelector('#mr-change').addEventListener('click', () => { stopPolling(); paint('initial'); });
      foot.querySelector('#mr-resend').addEventListener('click', () => beginVerification(pendingEmail, loginPassword, /*resend*/ true));
      foot.querySelector('#mr-check').addEventListener('click', () => checkOnce(/*byUser*/ true));
    }
    else if (state === 'timeout'){
      body.innerHTML = `
        <div style="padding:12px 14px;background:#FDECEC;border:1px solid #E7A6A6;border-radius:8px;color:#7A2020;font-size:13.5px;line-height:1.6;margin:0 0 14px">
          <strong>We couldn't confirm the click.</strong><br>
          We stopped watching for the verification after 15 minutes. Tap <em>Resend</em> to send a fresh link, <em>Change email</em> if you typed the wrong address, or <em>Sign out</em> and try again later.
        </div>
      `;
      foot.innerHTML = `
        <button class="btn btn-outline" id="mr-logout" type="button" style="margin-right:auto">Sign out</button>
        <button class="btn btn-outline" id="mr-change" type="button">Change email</button>
        <button class="btn btn-primary" id="mr-resend" type="button">Resend link</button>
      `;
      foot.querySelector('#mr-logout').addEventListener('click', signOutAndReload);
      foot.querySelector('#mr-change').addEventListener('click', () => paint('initial'));
      foot.querySelector('#mr-resend').addEventListener('click', () => beginVerification(pendingEmail, loginPassword, /*resend*/ true));
    }
  }

  async function beginVerification(email, password, resend){
    stopPolling();
    const errBox = () => document.querySelector('#mr-error');
    if (!email){ paint('initial', 'Enter a recovery email.'); return; }
    if (!password){ paint('initial', 'Enter your login password.'); return; }
    // paint the pending shell first so the user gets feedback while we wait
    pendingEmail = email;
    paint('pending');
    try {
      await DB.beginRecoveryEmailVerification(email, password, App.user);
      loginPassword = password;      // remember for resends this session
      startPolling();
      if (resend) toast('info', 'Verification link resent', `A fresh link is on the way to ${email}.`);
    } catch (err){
      console.error('beginRecoveryEmailVerification failed:', err);
      // Go back to initial with an explanatory error
      paint('initial', DB.friendlyRecoveryEmailError(err));
    }
  }

  function startPolling(){
    stopPolling();
    pollDeadline = Date.now() + 15 * 60 * 1000;   // 15 minutes
    pollTimer = setInterval(() => {
      if (Date.now() > pollDeadline){ stopPolling(); paint('timeout'); return; }
      checkOnce(/*byUser*/ false);
    }, 5000);
  }

  async function checkOnce(byUser){
    if (!pendingEmail) return;
    try {
      const res = await DB.pollForVerification(pendingEmail, App.user);
      if (res.verified){
        stopPolling();
        closeModal();
        toast('success', 'Recovery email verified', `Reset links will now go to ${res.email}.`);
        return;
      }
      if (byUser){
        // Explicit user click — surface a helpful nudge inside the modal
        const err = document.querySelector('#mr-error');
        if (err){
          err.textContent = 'We haven\'t seen the verification click yet. Give it a few seconds after clicking, then try again.';
          err.hidden = false;
        }
      }
    } catch (err){
      console.warn('pollForVerification failed:', err);
    }
  }

  async function signOutAndReload(){
    stopPolling();
    try { await FB.signOut(FB.auth); } catch(_){}
    location.reload();
  }

  openModal({
    title: 'Set a recovery email to continue',
    blocking: true,
    bodyHtml: '<div id="mr-shell"></div>',   // filled by paint()
    footerHtml: '<span id="mr-foot-shell"></span>',   // placeholder so the .modal-foot element exists for paint() to fill
    onMount: () => paint('initial'),
    onClose: () => stopPolling(),
  });
}

function openForgotPasswordModal(){
  openModal({
    title: 'Reset your password',
    bodyHtml: `
      <p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:var(--text-muted)">
        Enter your <strong>Force No.</strong> We'll send a reset link to the recovery email you registered.
      </p>
      <div class="field"><label>Force No.</label><input type="text" id="fp-forceno" placeholder="Your Force No." autocomplete="username"></div>
      <div id="fp-info" class="helper-text" hidden style="margin:6px 0 0;padding:10px 12px;background:#EEFBF3;border:1px solid #A6E3BF;border-radius:8px;color:#0F5132"></div>
      <div id="fp-error" class="error-text" hidden style="margin-top:6px"></div>
    `,
    footerHtml: `
      <button class="btn btn-outline" data-close-modal type="button" style="margin-right:auto">Cancel</button>
      <button class="btn btn-primary" id="fp-send" type="button">Send Reset Link</button>
    `,
    onMount: (body) => {
      const forceInput = body.querySelector('#fp-forceno');
      const errBox = body.querySelector('#fp-error');
      const infoBox = body.querySelector('#fp-info');
      const btn = body.querySelector('#fp-send');
      forceInput.focus();
      btn.addEventListener('click', async () => {
        const forceNo = forceInput.value.trim().toLowerCase();
        errBox.hidden = true; infoBox.hidden = true;
        if (!forceNo){ errBox.textContent = 'Enter your Force No.'; errBox.hidden = false; return; }
        btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sending…';
        try {
          const authEmail = await DB.lookupAuthEmail(forceNo);
          // If we have a lookup entry AND it's a real recovery email (not
          // either of this Force No.'s synthetic patterns), send the reset
          // there. Otherwise show the generic wording anyway so we don't leak
          // whether the Force No. or a recovery email exists.
          const syntheticLegacy = DB.legacyEmailFor(forceNo);
          const syntheticPlus = DB.emailFor(forceNo);
          if (authEmail && authEmail !== syntheticLegacy && authEmail !== syntheticPlus){
            await DB.sendPasswordResetToEmail(authEmail);
          }
          infoBox.innerHTML = `If Force No. <strong>${escapeHtml(forceNo)}</strong> has a verified recovery email, a reset link has been sent to it. Check that inbox (including Spam). If nothing arrives, ask an admin to reset your password from the command line.`;
          infoBox.hidden = false;
          btn.innerHTML = 'Sent';
          setTimeout(() => closeModal(), 6000);
        } catch (err){
          console.error('forgot-password send failed:', err);
          errBox.textContent = err.message || 'Could not send reset link. Try again in a moment.';
          errBox.hidden = false;
          btn.disabled = false; btn.textContent = 'Send Reset Link';
        }
      });
    },
  });
}

document.addEventListener('DOMContentLoaded', () => {
  $('#login-form').addEventListener('submit', handleLogin);
  const forgot = $('#login-forgot');
  if (forgot) forgot.addEventListener('click', (e) => { e.preventDefault(); openForgotPasswordModal(); });
  boot();
});

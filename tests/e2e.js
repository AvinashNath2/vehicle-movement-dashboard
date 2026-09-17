/* ==========================================================================
   End-to-end test suite — runs the real app in headless Chrome against the
   real Firebase backend, covering auth, role gating, CRUD, validation,
   reports, audit and live multi-client sync. Test records are tagged "E2E"
   and removed from Firestore at the end.

   Usage:
     cd tests && npm install
     ADMIN_PW=… OPERATOR_USER=… OPERATOR_PW=… node e2e.js [url]
     # url defaults to http://localhost:8090

   Env: ADMIN_PW, OPERATOR_USER, OPERATOR_PW are required (credentials are
   never committed); optional: ADMIN_USER (default "admin"), CHROME_PATH
   ========================================================================== */

const puppeteer = require('puppeteer-core');

const URL = process.argv[2] || process.env.VMD_URL || 'http://localhost:8090';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Real credentials are never committed: pass them via environment variables.
const ADMIN = { user: process.env.ADMIN_USER || 'admin', pw: process.env.ADMIN_PW };
const OPERATOR = { user: process.env.OPERATOR_USER, pw: process.env.OPERATOR_PW };
if (!ADMIN.pw || !OPERATOR.user || !OPERATOR.pw){
  console.error('Set ADMIN_PW, OPERATOR_USER and OPERATOR_PW environment variables to run the suite.');
  process.exit(1);
}

const V1 = 'E2E-99TS-0001'; // main test vehicle
const V2 = 'E2E-88TS-0002'; // live-sync test vehicle (created from 2nd browser context)

const sleep = ms => new Promise(r => setTimeout(r, ms));
let passed = 0, failed = 0;
const failures = [];

async function test(name, fn){
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e){ failed++; failures.push(`${name} — ${e.message}`); console.log('  ✗', name, '—', e.message); }
}
function expect(cond, msg){ if (!cond) throw new Error(msg); }

async function waitFor(page, fn, arg, timeout = 8000, step = 200){
  const start = Date.now();
  while (Date.now() - start < timeout){
    if (await page.evaluate(fn, arg)) return true;
    await sleep(step);
  }
  return false;
}

const text = (page, sel) => page.evaluate(s => document.querySelector(s)?.textContent ?? null, sel);
const exists = (page, sel) => page.evaluate(s => !!document.querySelector(s), sel);
// Synthetic click: headless Chrome intermittently stops delivering trusted
// clicks to specific elements mid-suite; element.click() is deterministic.
const domClick = (page, sel) => page.evaluate(s => document.querySelector(s).click(), sel);
async function clearType(page, sel, value){
  const found = await page.evaluate(s => {
    const el = document.querySelector(s);
    if (!el) return false;
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, sel);
  if (!found) throw new Error(`element not found: ${sel}`);
  if (value) await page.type(sel, value);
}
async function goRoute(page, route){
  await page.evaluate(r => location.hash = '#/' + r, route);
  await sleep(600);
}
async function login(page, { user, pw }){
  // DOM-driven (not trusted-input) on purpose: headless Chrome can stop
  // routing real input events after another browser context is closed.
  await page.evaluate(([u, p]) => {
    document.getElementById('login-username').value = u;
    document.getElementById('login-password').value = p;
    document.getElementById('login-form').dispatchEvent(new Event('submit', { cancelable: true }));
  }, [user, pw]);
  const ok = await waitFor(page, () => !document.getElementById('app-shell').hidden, null, 20000);
  if (!ok) throw new Error(`login as "${user}" timed out (error box: "${await text(page, '#login-error')}")`);
}

async function openVehicleModal(page){
  // A live-sync re-render can occasionally swallow the first click.
  for (let i = 0; i < 3; i++){
    await page.click('#btn-add-vehicle');
    if (await waitFor(page, () => !!document.getElementById('v-reg'), null, 2500)) return;
  }
  throw new Error('vehicle modal did not open');
}

async function cleanupE2EDocs(page){
  return page.evaluate(async () => {
    const { db, collection, getDocs, deleteDoc } = FB;
    let n = 0;
    for (const name of ['vehicles', 'movements', 'auditLog']){
      const snap = await getDocs(collection(db, name));
      for (const d of snap.docs){
        if (JSON.stringify(d.data()).includes('E2E')){ await deleteDoc(d.ref); n++; }
      }
    }
    return n;
  });
}
async function logout(page){
  // evaluate-based clicks: immune to dropdown open/close animation races
  await page.evaluate(() => document.getElementById('btn-logout').click());
  await waitFor(page, () => !document.getElementById('login-screen').hidden, null, 10000);
}
async function confirmDialogOk(page){
  await waitFor(page, () => !!document.getElementById('confirm-ok'));
  await page.click('#confirm-ok');
  await sleep(500);
}

(async () => {
  console.log(`\nRunning E2E suite against ${URL}\n`);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  await page.goto(URL, { waitUntil: 'networkidle2' });
  await waitFor(page, () => !document.getElementById('login-screen').hidden, null, 15000);

  /* ------------------------------ AUTH ------------------------------ */
  console.log('AUTH');
  await test('empty login shows validation error', async () => {
    await page.click('#login-submit');
    await sleep(300);
    expect((await text(page, '#login-error')).includes('both username and password'), 'no empty-fields error');
  });
  await test('wrong password rejected', async () => {
    await clearType(page, '#login-username', ADMIN.user);
    await clearType(page, '#login-password', 'definitely-wrong');
    await page.click('#login-submit');
    await waitFor(page, () => document.getElementById('login-error').textContent.includes('Invalid'), null, 10000);
    expect((await text(page, '#login-error')).includes('Invalid username or password'), 'no invalid-credentials error');
  });
  await test('admin can sign in', async () => {
    await login(page, ADMIN);
    expect(await page.evaluate(() => !document.getElementById('app-shell').hidden), 'app shell not shown');
  });
  {
    const stale = await cleanupE2EDocs(page); // leftovers from an aborted previous run
    if (stale) console.log(`  (pre-clean: removed ${stale} stale E2E doc(s))`);
    await sleep(800);
  }
  await test('session survives a page reload', async () => {
    await page.reload({ waitUntil: 'networkidle2' });
    const ok = await waitFor(page, () => !document.getElementById('app-shell')?.hidden, null, 15000);
    expect(ok, 'not logged in after reload');
  });

  /* --------------------------- ROLE: ADMIN --------------------------- */
  console.log('ROLE GATING (ADMIN)');
  await test('admin sees all 6 navigation items', async () => {
    const n = await page.evaluate(() => document.querySelectorAll('.nav-item').length);
    expect(n === 6, `expected 6 nav items, got ${n}`);
  });

  /* ----------------------------- VEHICLES ---------------------------- */
  console.log('VEHICLES');
  await goRoute(page, 'vehicles');
  await test('add vehicle', async () => {
    await openVehicleModal(page);
    await page.type('#v-reg', V1);
    await page.type('#v-type', 'E2E Test Truck');
    await page.click('#v-save');
    await sleep(800);
    await clearType(page, '#veh-search', V1);
    await sleep(600);
    expect((await text(page, '#veh-tbody')).includes(V1), 'new vehicle not in table');
  });
  await test('duplicate registration rejected', async () => {
    await openVehicleModal(page);
    await page.type('#v-reg', V1);
    await page.type('#v-type', 'Dup');
    await page.click('#v-save');
    await sleep(300);
    expect((await text(page, '#v-error')).includes('already exists'), 'duplicate not rejected');
    await page.click('[data-close-modal]');
    await sleep(300);
  });
  await test('edit vehicle type persists', async () => {
    await clearType(page, '#veh-search', V1);
    await sleep(600);
    await page.click(`#veh-tbody [data-edit="${V1}"]`);
    await waitFor(page, () => !!document.getElementById('v-type'));
    await clearType(page, '#v-type', 'E2E Bolero');
    await page.click('#v-save');
    await sleep(800);
    await clearType(page, '#veh-search', V1);
    await sleep(600);
    expect((await text(page, '#veh-tbody')).includes('E2E Bolero'), 'edited type not shown');
  });
  await test('deactivated vehicle is hidden from the movement form', async () => {
    await page.click(`#veh-tbody [data-toggle="${V1}"]`);
    await confirmDialogOk(page);
    await sleep(500);
    expect((await text(page, '#veh-tbody')).includes('Inactive'), 'vehicle not marked Inactive');
    await goRoute(page, 'movements');
    // f-vehicle is now a hidden input (searchable dropdown); check list item data-ss-val attributes
    const inList = await page.evaluate((v1) =>
      Array.from(document.querySelectorAll('#f-vehicle-list li')).some(li => li.dataset.ssVal === v1)
    , V1);
    expect(!inList, 'inactive vehicle still selectable in movement form');
    await goRoute(page, 'vehicles');
    await clearType(page, '#veh-search', V1);
    await sleep(600);
    await page.click(`#veh-tbody [data-toggle="${V1}"]`); // reactivate
    await confirmDialogOk(page);
  });
  await test('vehicle search filters the table', async () => {
    await clearType(page, '#veh-search', 'zzz-no-such-vehicle');
    await sleep(600);
    expect((await text(page, '#veh-empty')).includes('No vehicles match'), 'empty state missing');
    await clearType(page, '#veh-search', '');
    await sleep(400);
  });

  /* ----------------------- MOVEMENTS (LIFECYCLE) ---------------------- */
  console.log('MOVEMENTS (lifecycle)');
  await goRoute(page, 'movements');
  await test('create form has no closing fields (entries always start In Progress)', async () => {
    expect(!(await exists(page, '#f-ckm')) && !(await exists(page, '#f-ctime')), 'closing fields present on create form');
  });
  await test('empty movement form rejected with highlights', async () => {
    await domClick(page, '#f-save');
    await sleep(300);
    expect(!(await page.evaluate(() => document.getElementById('f-error').hidden)), 'no validation error');
    expect(await exists(page, '#mv-form .invalid'), 'missing fields not highlighted');
  });
  await test('invalid opening time rejected', async () => {
    // f-vehicle is now a hidden input (searchable dropdown) — set value directly as wireSearchableSelect does
    await page.evaluate((v1) => {
      const el = document.getElementById('f-vehicle');
      el.value = v1;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, V1);
    const picked = await page.evaluate(() => document.getElementById('f-vehicle').value);
    const v1State = await page.evaluate((r) => DB.findVehicle(r)?.Status, V1);
    expect(picked === V1, `vehicle not selectable (value="${picked}", ${V1} status=${v1State})`);
    await clearType(page, '#f-driver', 'E2E Driver');
    await clearType(page, '#f-okm', '200');
    await clearType(page, '#f-purpose', 'E2E Suite');
    await clearType(page, '#f-otime', '99:99');
    await domClick(page, '#f-save');
    await sleep(300);
    expect(!(await page.evaluate(() => document.getElementById('f-error').hidden)), 'invalid time accepted');
    await clearType(page, '#f-otime', '0915');
  });
  await test('new entry saves as In Progress', async () => {
    await domClick(page, '#f-save');
    await sleep(1200);
    await domClick(page, '#mv-view-all');
    await sleep(700);
    await clearType(page, '#ml-search', 'E2E Driver');
    await sleep(600);
    const t = await text(page, '#ml-tbody');
    expect(t.includes('E2E Driver') && t.includes(V1), 'saved entry not in list');
    expect(t.includes('In Progress'), 'entry not marked In Progress');
  });
  await test('close modal rejects closing KM below opening KM', async () => {
    await domClick(page, '#ml-tbody [data-close]');
    await waitFor(page, () => !!document.getElementById('c-km'));
    await clearType(page, '#c-km', '150');
    await domClick(page, '#c-save');
    await sleep(300);
    expect((await text(page, '#c-error')).includes('cannot be less than'), 'no closing<opening error');
  });
  await test('closing the entry completes it with correct total', async () => {
    await clearType(page, '#c-km', '230');
    await clearType(page, '#c-time', '1030');
    expect((await text(page, '#c-total')).includes('30'), `close-modal total wrong: "${await text(page, '#c-total')}"`);
    await domClick(page, '#c-save');
    await sleep(1200);
    await clearType(page, '#ml-search', 'E2E Driver');
    await sleep(600);
    const t = await text(page, '#ml-tbody');
    expect(t.includes('Completed'), 'entry not marked Completed after close');
    expect(t.includes('30'), 'TotalKM (30) not shown after close');
  });
  await test('audit records the Closed action', async () => {
    const ok = await page.evaluate((id) =>
      DB.auditLog.some(a => a.Action === 'Closed' && a.RecordType === 'Movement' && a.Details.includes(id)), V1);
    expect(ok, 'no Closed audit entry for the test vehicle');
  });
  await test('editing a completed entry updates totals', async () => {
    await domClick(page, '#ml-tbody [data-edit]');
    await sleep(700);
    expect(await exists(page, '#f-ckm'), 'closing fields missing when editing a completed entry');
    await clearType(page, '#f-ckm', '240');
    await domClick(page, '#f-save');
    await sleep(1200);
    await clearType(page, '#ml-search', 'E2E Driver');
    await sleep(600);
    expect((await text(page, '#ml-tbody')).includes('40'), 'updated TotalKM (40) not shown');
  });
  await test('detail modal shows status and audit history', async () => {
    await domClick(page, '#ml-tbody [data-view]');
    await waitFor(page, () => !!document.getElementById('active-modal'));
    const t = await text(page, '#active-modal');
    expect(t.includes('E2E Driver') && t.includes('Completed') && t.includes('Closed'), 'detail/status/audit content missing');
    await domClick(page, '[data-close-modal]');
    await sleep(300);
  });

  /* ------------------------------ REPORTS ---------------------------- */
  console.log('REPORTS');
  await goRoute(page, 'reports');
  await test('report generates with rows and totals', async () => {
    await page.click('#rp-generate');
    await sleep(700);
    const body = await text(page, '#rp-body');
    expect(body.includes(V1), 'test vehicle not in report');
    expect(body.includes('Status') && body.includes('Completed'), 'Status column missing from report');
    expect(!(await page.evaluate(() => document.getElementById('rp-export').hidden)), 'export buttons not revealed');
  });
  await test('empty date range shows empty state', async () => {
    await page.evaluate(() => { document.getElementById('rp-from').value = '1990-01-01'; document.getElementById('rp-to').value = '1990-01-02'; });
    await page.click('#rp-generate');
    await sleep(500);
    expect((await text(page, '#rp-body')).includes('No movement records'), 'empty state missing');
  });

  /* ------------------------------- AUDIT ------------------------------ */
  console.log('AUDIT');
  await goRoute(page, 'audit');
  await test('audit log records the test session actions', async () => {
    await clearType(page, '#au-search', V1);
    await sleep(600);
    const rows = await page.evaluate(() => document.querySelectorAll('#au-tbody tr').length);
    expect(rows >= 2, `expected >=2 audit rows for ${V1}, got ${rows}`);
  });

  /* ------------------------ SETTINGS VALIDATION ----------------------- */
  console.log('SETTINGS');
  await goRoute(page, 'settings');
  await test('password mismatch rejected', async () => {
    await page.type('#pw-current', 'whatever');
    await page.type('#pw-new', 'abcdef');
    await page.type('#pw-confirm', 'abcdeg');
    await page.click('#pwd-form button[type=submit]');
    await sleep(400);
    expect((await text(page, '#pw-error')).includes('do not match'), 'mismatch not rejected');
  });
  await test('short password rejected', async () => {
    await clearType(page, '#pw-new', '123');
    await clearType(page, '#pw-confirm', '123');
    await page.click('#pwd-form button[type=submit]');
    await sleep(400);
    expect((await text(page, '#pw-error')).includes('at least 6'), 'short password not rejected');
  });
  await test('admin sees data management and user management', async () => {
    expect(await exists(page, '#btn-export-backup'), 'export button missing for admin');
    expect(await exists(page, '#btn-export-mov-xlsx'), 'movements xlsx export button missing');
    expect(await exists(page, '#btn-export-mov-json'), 'movements json export button missing');
    expect(await exists(page, '#user-tbody'), 'user management missing for admin');
  });
  await test('movements-only exports produce data without errors', async () => {
    const res = await page.evaluate(() => {
      const rows = DB._sortedMovements();
      DB.exportMovementsJson();
      DB.exportMovementsXlsx();
      return { count: rows.length, sorted: rows.every((m, i) => i === 0 || rows[i-1].Date <= m.Date) };
    });
    expect(res.count >= 1, 'no movements available for export test');
    expect(res.sorted, 'export rows not sorted by date');
  });

  /* --------------------------- ROLE: OPERATOR ------------------------- */
  console.log('ROLE GATING (OPERATOR)');
  await logout(page);
  await test('operator can sign in', async () => {
    await login(page, OPERATOR);
    expect(await page.evaluate(() => !document.getElementById('app-shell').hidden), 'operator not signed in');
  });
  await test('operator nav shows only Movement Entries', async () => {
    const items = await page.evaluate(() => Array.from(document.querySelectorAll('.nav-item span')).map(e => e.textContent));
    expect(items.length === 1 && items[0] === 'Movement Entries', `expected [Movement Entries], got [${items.join(', ')}]`);
  });
  await test('operator lands on Movement Entries by default', async () => {
    const title = await text(page, '#page-title');
    expect(title === 'Movement Entries', `landed on "${title}"`);
  });
  await test('operator is redirected away from admin routes', async () => {
    for (const r of ['dashboard', 'vehicles', 'reports', 'audit']){
      await goRoute(page, r);
      const title = await text(page, '#page-title');
      expect(title === 'Movement Entries', `route ${r} not blocked (title "${title}")`);
    }
  });
  await test('operator settings hides data & user management', async () => {
    await page.evaluate(() => document.querySelector('[data-nav-inline="settings"]').click());
    await sleep(700);
    expect(await exists(page, '#pwd-form'), 'change-password form missing');
    expect(!(await exists(page, '#btn-export-backup')), 'operator can see export backup');
    expect(!(await exists(page, '#btn-reset')), 'operator can see reset');
    expect(!(await exists(page, '#user-tbody')), 'operator can see user management');
  });
  // Operator form/landing interactions are DOM-driven (see login()): trusted
  // input coverage for the same code paths exists in the admin sections above.
  const domStartMovement = async (driver, okm) => {
    await page.evaluate(() => document.getElementById('mv-new').click());
    const formReady = await waitFor(page, () => !!document.getElementById('f-vehicle'), null, 5000);
    expect(formReady, 'movement form not shown');
    await page.evaluate(([reg, drv, km]) => {
      const set = (id, v) => {
        const el = document.getElementById(id);
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('f-vehicle', reg);
      set('f-driver', drv);
      set('f-okm', km);
      set('f-purpose', 'E2E Suite operator');
      document.getElementById('mv-form').dispatchEvent(new Event('submit', { cancelable: true }));
    }, [V1, driver, okm]);
    await sleep(1500);
  };

  await test('operator landing shows open movements section', async () => {
    await goRoute(page, 'movements');
    expect(await exists(page, '#open-list'), 'Open Movements section missing');
    expect(await exists(page, '#mv-new'), 'New Entry button missing');
  });
  await test('operator starts a movement (appears under Open Movements)', async () => {
    await domStartMovement('E2E Op Driver', '300');
    const backOnLanding = await waitFor(page, () => !!document.getElementById('open-list'), null, 5000);
    expect(backOnLanding, 'did not return to landing after save');
    const openList = await text(page, '#open-list');
    expect(openList.includes('E2E Op Driver') && openList.includes(V1), 'new open movement not listed');
  });
  await test('operator closes the movement from the landing page', async () => {
    await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll('.open-mv-row')).find(r => r.textContent.includes('E2E Op Driver'));
      row.querySelector('[data-close]').click();
    });
    await waitFor(page, () => !!document.getElementById('c-km'));
    // reject below-opening first
    await page.evaluate(() => { const el = document.getElementById('c-km'); el.value = '250'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.evaluate(() => document.getElementById('c-save').click());
    await sleep(300);
    expect((await text(page, '#c-error')).includes('cannot be less than'), 'close modal accepted lower KM');
    // then close for real
    await page.evaluate(() => { const el = document.getElementById('c-km'); el.value = '318'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.evaluate(() => document.getElementById('c-save').click());
    await sleep(1200);
    const openList = await text(page, '#open-list');
    expect(!openList.includes('E2E Op Driver'), 'closed movement still listed as open');
    const myEntries = await text(page, '#ml-tbody');
    expect(myEntries.includes('E2E Op Driver') && myEntries.includes('Completed') && myEntries.includes('18'), 'closed entry not Completed with 18 km in My Entries');
  });
  await test('operator sees only their own entries', async () => {
    const myEntries = await text(page, '#ml-tbody');
    // the admin-created entry (driver "E2E Driver") must not appear;
    // note "E2E Op Driver" does not contain the substring "E2E Driver"
    expect(!myEntries.includes('E2E Driver'), 'operator can see entries created by other users');
    expect(myEntries.includes('E2E Op Driver'), 'own entry missing from My Entries');
  });
  await test('operator deletes their own entry (audited)', async () => {
    await domStartMovement('E2E Del Driver', '400');
    await waitFor(page, () => !!document.getElementById('open-list'), null, 5000);
    await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll('.open-mv-row')).find(r => r.textContent.includes('E2E Del Driver'));
      row.querySelector('[data-del]').click();
    });
    await waitFor(page, () => !!document.getElementById('confirm-ok'));
    await page.evaluate(() => document.getElementById('confirm-ok').click());
    await sleep(1000);
    expect(!(await text(page, '#open-list')).includes('E2E Del Driver'), 'deleted entry still listed');
    const audited = await page.evaluate((op) => DB.auditLog.some(a => a.Action === 'Deleted' && a.RecordType === 'Movement' && a.User === op), OPERATOR.user);
    expect(audited, 'operator deletion not in audit log');
  });

  /* ---------------------------- LIVE SYNC ----------------------------- */
  // Runs LAST among UI tests: closing the second browser context can stop
  // headless Chrome from routing trusted input events to the first page,
  // so nothing after this may rely on real keyboard/mouse input.
  console.log('LIVE SYNC (second browser context)');
  await test('vehicle added in another browser appears live', async () => {
    await goRoute(page, 'movements'); // operator is signed in; movements is their page
    const ctx = await browser.createBrowserContext();
    const p2 = await ctx.newPage();
    await p2.goto(URL, { waitUntil: 'networkidle2' });
    await waitFor(p2, () => !document.getElementById('login-screen').hidden, null, 15000);
    await login(p2, ADMIN);
    await p2.evaluate(() => location.hash = '#/vehicles');
    await sleep(700);
    const before = await page.evaluate(() => DB.vehicles.length);
    await p2.click('#btn-add-vehicle');
    await waitFor(p2, () => !!document.getElementById('v-reg'));
    await p2.type('#v-reg', V2);
    await p2.type('#v-type', 'E2E Sync Test');
    await p2.click('#v-save');
    // keep the second context alive until the first browser has seen the change
    const synced = await waitFor(page, (n) => DB.vehicles.length === n + 1, before, 15000);
    await ctx.close();
    expect(synced, `vehicle list did not grow from ${before} to ${before + 1} in first browser`);
  });

  /* ---------------------- ADMIN DELETE PERMISSIONS -------------------- */
  console.log('ADMIN DELETE');
  await logout(page);
  await login(page, ADMIN);
  await test('admin can delete an operator-created entry (audited)', async () => {
    await page.evaluate(() => { App.filters.movements.view = 'list'; location.hash = '#/movements'; renderPage('movements'); });
    await sleep(700);
    await page.evaluate(() => {
      const el = document.getElementById('ml-search');
      el.value = 'E2E Op Driver';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(700);
    expect((await text(page, '#ml-tbody')).includes('E2E Op Driver'), "operator's entry not visible to admin");
    await page.evaluate(() => document.querySelector('#ml-tbody [data-del]').click());
    await waitFor(page, () => !!document.getElementById('confirm-ok'));
    const confirmMsg = await text(page, '#active-modal');
    expect(confirmMsg.includes('created by') && confirmMsg.includes(OPERATOR.user), 'confirm dialog does not attribute the creator');
    await page.evaluate(() => document.getElementById('confirm-ok').click());
    await sleep(1000);
    expect(!(await text(page, '#ml-tbody')).includes('E2E Op Driver'), 'entry still present after admin delete');
    const audited = await page.evaluate((op) =>
      DB.auditLog.some(a => a.Action === 'Deleted' && a.RecordType === 'Movement' && a.User === 'admin' && a.Details.includes('created by ' + op)), OPERATOR.user);
    expect(audited, 'admin deletion with creator attribution not in audit log');
  });

  /* -------------------- SEARCHABLE DROPDOWNS (Feature 2) -------------- */
  console.log('SEARCHABLE DROPDOWNS');
  await test('movement form vehicle picker is a searchable dropdown (not a plain select)', async () => {
    await page.evaluate(() => { App.filters.movements.view = 'form'; App.filters.movements.editingId = null; renderPage('movements'); });
    await sleep(600);
    const hasSsWrap = await exists(page, '.ss-wrap');
    const isHiddenInput = await page.evaluate(() => {
      const el = document.getElementById('f-vehicle');
      return el && el.tagName === 'INPUT' && el.type === 'hidden';
    });
    expect(hasSsWrap, 'searchable dropdown .ss-wrap missing on movement form');
    expect(isHiddenInput, 'f-vehicle is not a hidden input — plain <select> not replaced');
  });
  await test('vehicle searchable dropdown has visible text input and hidden value list', async () => {
    expect(await exists(page, '#f-vehicle-input'), '#f-vehicle-input text input missing');
    expect(await exists(page, '#f-vehicle-list'), '#f-vehicle-list ul missing');
    const listItemCount = await page.evaluate(() => document.querySelectorAll('#f-vehicle-list li').length);
    expect(listItemCount >= 1, `vehicle list has ${listItemCount} items, expected at least 1`);
  });
  await test('typing in vehicle input filters dropdown items', async () => {
    const total = await page.evaluate(() => document.querySelectorAll('#f-vehicle-list li').length);
    // filter with V1 prefix — should show at least 1 match
    await page.evaluate((v1) => {
      const inp = document.getElementById('f-vehicle-input');
      inp.value = v1.slice(0, 6);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }, V1);
    await sleep(200);
    const visible = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#f-vehicle-list li')).filter(li => !li.hidden).length
    );
    expect(visible >= 1, `typing V1 prefix should keep >=1 item visible, got ${visible}`);
    expect(visible <= total, 'filter increased visible count');
    // garbage query should hide all items
    await page.evaluate(() => {
      const inp = document.getElementById('f-vehicle-input');
      inp.value = 'ZZZ-NO-SUCH-VEH-9999';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(200);
    const afterGarbage = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#f-vehicle-list li')).filter(li => !li.hidden).length
    );
    expect(afterGarbage === 0, `garbage query should hide all items, got ${afterGarbage} visible`);
    // restore empty query
    await page.evaluate(() => {
      const inp = document.getElementById('f-vehicle-input');
      inp.value = '';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(150);
  });
  await test('clicking a dropdown item sets the hidden input value', async () => {
    const firstVal = await page.evaluate(() => {
      const li = document.querySelector('#f-vehicle-list li');
      if (!li) return null;
      li.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      return li.dataset.ssVal;
    });
    await sleep(200);
    const hiddenVal = await page.evaluate(() => document.getElementById('f-vehicle').value);
    expect(firstVal != null, 'no list items found to click');
    expect(hiddenVal === firstVal, `hidden input value "${hiddenVal}" does not match clicked item "${firstVal}"`);
  });
  await test('movement list filter bar has searchable vehicle picker', async () => {
    await page.evaluate(() => { App.filters.movements.view = 'list'; renderPage('movements'); });
    await sleep(500);
    expect(await exists(page, '#ml-vehicle-input'), '#ml-vehicle-input missing from movement filter bar');
    const isHidden = await page.evaluate(() => {
      const el = document.getElementById('ml-vehicle');
      return el && el.type === 'hidden';
    });
    expect(isHidden, 'ml-vehicle is not a hidden input in movement list filter');
  });

  /* ----------------------- COLOR CODING (Feature 5) ------------------- */
  console.log('COLOR CODING');
  await test('In Progress status badge uses badge-critical (red), not badge-warning', async () => {
    // Create a temporary In Progress entry specifically for this check
    await page.evaluate(() => { App.filters.movements.view = 'form'; App.filters.movements.editingId = null; renderPage('movements'); });
    await sleep(500);
    await page.evaluate((v1) => {
      const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
      document.getElementById('f-vehicle').value = v1;
      set('f-driver', 'E2E Color Driver');
      set('f-okm', '500');
      set('f-purpose', 'E2E Color Test');
      document.getElementById('mv-form').dispatchEvent(new Event('submit', { cancelable: true }));
    }, V1);
    await sleep(1500);
    await page.evaluate(() => {
      App.filters.movements.view = 'list';
      App.filters.movements.search = 'E2E Color Driver';
      renderPage('movements');
    });
    await sleep(600);
    const badgeClass = await page.evaluate(() => document.querySelector('#ml-tbody .badge')?.className ?? '');
    expect(badgeClass.includes('badge-critical'), `In Progress badge missing badge-critical (got "${badgeClass}")`);
    expect(!badgeClass.includes('badge-warning'), 'In Progress badge still uses deprecated badge-warning');
  });
  await test('Completed status badge uses badge-good (green)', async () => {
    await page.evaluate(() => {
      App.filters.movements.search = 'E2E Driver';
      renderPage('movements');
    });
    await sleep(600);
    const badgeClass = await page.evaluate(() => document.querySelector('#ml-tbody .badge')?.className ?? '');
    expect(badgeClass.includes('badge-good'), `Completed badge missing badge-good (got "${badgeClass}")`);
  });

  /* ------------------- REPORT ENHANCEMENTS (Feature 3) ---------------- */
  console.log('REPORT ENHANCEMENTS');
  await goRoute(page, 'reports');
  await test('report table header includes # (S.No), Out Time and In Time columns', async () => {
    await page.evaluate(() => {
      const today = new Date().toISOString().slice(0, 10);
      document.getElementById('rp-from').value = today;
      document.getElementById('rp-to').value = today;
    });
    await page.click('#rp-generate');
    await sleep(800);
    const headers = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#rp-body thead th')).map(th => th.textContent.trim())
    );
    expect(headers.includes('#'), `"#" column missing (headers: ${headers.join(', ')})`);
    expect(headers.includes('Out Time'), '"Out Time" column missing from report');
    expect(headers.includes('In Time'), '"In Time" column missing from report');
  });
  await test('report data rows have 14 columns (including new S.No, Out Time, In Time)', async () => {
    const colCount = await page.evaluate(() => {
      const firstRow = document.querySelector('#rp-body tbody tr');
      return firstRow ? firstRow.querySelectorAll('td').length : 0;
    });
    expect(colCount === 0 || colCount === 14, `expected 14 columns per data row, got ${colCount}`);
  });
  await test('report S.No starts at 1 and increments per row', async () => {
    const snos = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#rp-body tbody tr'))
        .map((tr, i) => ({ sno: tr.querySelector('td')?.textContent.trim(), expected: String(i + 1) }))
    );
    expect(snos.length === 0 || snos.every(r => r.sno === r.expected),
      `S.No not sequential: ${snos.filter(r => r.sno !== r.expected).map(r => `"${r.sno}"≠"${r.expected}"`).join(', ')}`);
  });

  /* ------------ MOVEMENT FILTERS — Driver & Force No. (Feature 6) ----- */
  console.log('MOVEMENT FILTERS');
  await test('driver name filter narrows admin movement list', async () => {
    await page.evaluate(() => {
      Object.assign(App.filters.movements, { view: 'list', search: '', driver: '', forceNo: '', page: 1 });
      renderPage('movements');
    });
    await sleep(500);
    const totalRows = await page.evaluate(() => document.querySelectorAll('#ml-tbody tr').length);
    await page.evaluate(() => {
      const el = document.getElementById('ml-driver');
      el.value = 'E2E Driver';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(600);
    const filteredRows = await page.evaluate(() => document.querySelectorAll('#ml-tbody tr').length);
    const allMatch = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#ml-tbody tr'))
        .every(tr => tr.textContent.toLowerCase().includes('e2e driver'))
    );
    expect(filteredRows >= 1, 'driver filter removed all rows when E2E Driver should exist');
    expect(filteredRows <= totalRows, 'driver filter increased row count');
    expect(allMatch, 'driver filter shows rows that do not contain the driver name');
    await page.evaluate(() => { const el = document.getElementById('ml-driver'); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await sleep(400);
  });
  await test('driver name filter shows empty state for unknown driver', async () => {
    await page.evaluate(() => {
      const el = document.getElementById('ml-driver');
      el.value = 'ZZZ-NoSuchDriver-XYZZY';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(600);
    const rows = await page.evaluate(() => document.querySelectorAll('#ml-tbody tr').length);
    expect(rows === 0, `expected 0 rows for unknown driver, got ${rows}`);
    await page.evaluate(() => { const el = document.getElementById('ml-driver'); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await sleep(400);
  });
  await test('force no. filter input exists on movement list', async () => {
    expect(await exists(page, '#ml-forceno'), '#ml-forceno input missing from admin movement filter bar');
    expect(await exists(page, '#ml-driver'), '#ml-driver input missing from admin movement filter bar');
  });
  await test('force no. filter shows empty state for unknown force no.', async () => {
    await page.evaluate(() => {
      const el = document.getElementById('ml-forceno');
      el.value = '99887766'; // very unlikely to match any test user's ForceNo
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(600);
    const rows = await page.evaluate(() => document.querySelectorAll('#ml-tbody tr').length);
    expect(rows === 0, `expected 0 rows for unknown force no., got ${rows}`);
    await page.evaluate(() => { const el = document.getElementById('ml-forceno'); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await sleep(400);
  });

  /* ------------ USER MANAGEMENT — Edit / Reset Pwd (Features 1, 6, 7) - */
  console.log('USER MANAGEMENT');
  await goRoute(page, 'settings');
  await test('user table has a Force No. column header', async () => {
    const headers = await page.evaluate(() =>
      Array.from(document.querySelectorAll('th')).map(th => th.textContent.trim())
    );
    expect(headers.some(h => h.includes('Force No')), `Force No. header missing (found: ${headers.join(', ')})`);
  });
  await test('each user row has Edit (data-uedit) and Reset Password (data-ureset) buttons', async () => {
    expect(await exists(page, '#user-tbody [data-uedit]'), 'Edit button (data-uedit) missing from user table');
    expect(await exists(page, '#user-tbody [data-ureset]'), 'Reset password button (data-ureset) missing from user table');
  });
  await test('Edit User modal opens with display name, force no. and username fields', async () => {
    await domClick(page, '#user-tbody [data-uedit]');
    const ok = await waitFor(page, () => !!document.getElementById('eu-display'), null, 5000);
    expect(ok, 'Edit User modal did not open');
    expect(await exists(page, '#eu-display'), '#eu-display (Display Name) missing');
    expect(await exists(page, '#eu-forceno'), '#eu-forceno (Force No.) missing');
    expect(await exists(page, '#eu-newname'), '#eu-newname (New Username) missing');
    expect(await exists(page, '#eu-curpw'), '#eu-curpw (Current Password) missing');
  });
  await test('Edit User modal rejects empty display name', async () => {
    await page.evaluate(() => { const el = document.getElementById('eu-display'); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await domClick(page, '#eu-save');
    await sleep(400);
    const errText = await text(page, '#eu-error');
    const errHidden = await page.evaluate(() => document.getElementById('eu-error')?.hidden);
    expect(errText && !errHidden, `expected error to be visible, got hidden=${errHidden} text="${errText}"`);
    expect(errText && errText.toLowerCase().includes('required'), `expected "required" error, got "${errText}"`);
    await domClick(page, '[data-close-modal]');
    await sleep(300);
  });
  await test('Reset Password modal opens with current, new and confirm password fields', async () => {
    await domClick(page, '#user-tbody [data-ureset]');
    const ok = await waitFor(page, () => !!document.getElementById('rp-curpw'), null, 5000);
    expect(ok, 'Reset Password modal did not open');
    expect(await exists(page, '#rp-curpw'), '#rp-curpw missing');
    expect(await exists(page, '#rp-newpw'), '#rp-newpw missing');
    expect(await exists(page, '#rp-cfpw'), '#rp-cfpw missing');
  });
  await test('Reset Password modal rejects all-empty fields', async () => {
    await domClick(page, '#rp-save');
    await sleep(300);
    const errText = await text(page, '#rp-error');
    expect(errText && errText.toLowerCase().includes('required'), `expected "required" error, got "${errText}"`);
  });
  await test('Reset Password modal rejects password shorter than 6 characters', async () => {
    await page.evaluate(() => {
      document.getElementById('rp-curpw').value = 'anything';
      document.getElementById('rp-newpw').value = '123';
      document.getElementById('rp-cfpw').value = '123';
    });
    await domClick(page, '#rp-save');
    await sleep(300);
    const errText = await text(page, '#rp-error');
    expect(errText && errText.includes('6'), `expected "6 characters" error, got "${errText}"`);
  });
  await test('Reset Password modal rejects mismatched passwords', async () => {
    await page.evaluate(() => {
      document.getElementById('rp-curpw').value = 'anything';
      document.getElementById('rp-newpw').value = 'validpw123';
      document.getElementById('rp-cfpw').value = 'validpw456';
    });
    await domClick(page, '#rp-save');
    await sleep(300);
    const errText = await text(page, '#rp-error');
    expect(errText && errText.toLowerCase().includes('match'), `expected "do not match" error, got "${errText}"`);
    await domClick(page, '[data-close-modal]');
    await sleep(300);
  });

  /* ------------------- SHARE MODAL (Feature 4) — operator -------------- */
  console.log('SHARE MODAL (OPERATOR)');
  await logout(page);
  await test('operator signs in for share modal tests', async () => {
    await login(page, OPERATOR);
    expect(await page.evaluate(() => !document.getElementById('app-shell').hidden), 'operator sign-in failed');
  });
  await test('share button (data-share) appears on open movements in operator landing', async () => {
    await goRoute(page, 'movements');
    await waitFor(page, () => !!document.getElementById('mv-new'), null, 5000);
    await domStartMovement('E2E Share Driver', '600');
    const backOnLanding = await waitFor(page, () => !!document.getElementById('open-list'), null, 5000);
    expect(backOnLanding, 'did not return to operator landing after saving movement');
    const hasShareBtn = await exists(page, '#open-list [data-share]');
    expect(hasShareBtn, 'share button (data-share) missing on open movement card in landing');
  });
  await test('share modal opens and textarea contains movement details', async () => {
    await page.evaluate(() => { const btn = document.querySelector('#open-list [data-share]'); if (btn) btn.click(); });
    const modalOpened = await waitFor(page, () => !!document.getElementById('active-modal'), null, 8000);
    expect(modalOpened, 'share modal did not open after clicking share button');
    expect(await exists(page, '#share-text'), '#share-text textarea missing in share modal');
    const shareContent = await page.evaluate(() => document.getElementById('share-text')?.value ?? '');
    expect(shareContent.includes('E2E Share Driver') || shareContent.includes(V1),
      `share text should contain driver or vehicle reg (got: "${shareContent.slice(0, 120)}")`);
    await domClick(page, '[data-close-modal]');
    await sleep(300);
  });
  await test('share modal text contains NDRF unit header and vehicle metadata', async () => {
    await page.evaluate(() => { const btn = document.querySelector('#open-list [data-share]') || document.querySelector('[data-share]'); if (btn) btn.click(); });
    const ready = await waitFor(page, () => !!document.getElementById('share-text'), null, 6000);
    expect(ready, 'share-text not ready after re-opening share modal');
    const content = await page.evaluate(() => document.getElementById('share-text')?.value ?? '');
    expect(content.includes('NDRF'), `share text missing "NDRF" header (first 100 chars: "${content.slice(0, 100)}")`);
    expect(content.includes(V1), `share text missing vehicle registration ${V1}`);
    await domClick(page, '[data-close-modal]');
    await sleep(300);
  });
  await test('share modal has copy-text and WhatsApp buttons', async () => {
    await page.evaluate(() => { const btn = document.querySelector('#open-list [data-share]') || document.querySelector('[data-share]'); if (btn) btn.click(); });
    await waitFor(page, () => !!document.getElementById('share-copy'), null, 6000);
    expect(await exists(page, '#share-copy'), '#share-copy button missing');
    expect(await exists(page, '#share-wa'), '#share-wa (WhatsApp) button missing');
    await domClick(page, '[data-close-modal]');
    await sleep(300);
  });

  // Return to admin so CLEANUP can run
  await logout(page);
  await login(page, ADMIN);

  /* ------------------------------ CLEANUP ----------------------------- */
  console.log('CLEANUP');
  const removed = await cleanupE2EDocs(page);
  console.log(`  removed ${removed} E2E test document(s) from Firestore`);

  await test('no uncaught page errors during the whole run', async () => {
    expect(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);
  });

  await browser.close();
  console.log(`\n${'='.repeat(50)}\nRESULT: ${passed} passed, ${failed} failed`);
  if (failures.length){ console.log('\nFailures:'); failures.forEach(f => console.log('  -', f)); }
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('SUITE CRASHED:', e); process.exit(2); });

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
    const opts = await text(page, '#f-vehicle');
    expect(!opts.includes(V1), 'inactive vehicle still selectable in movement form');
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
    await page.select('#f-vehicle', V1);
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
    expect(await exists(page, '#user-tbody'), 'user management missing for admin');
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

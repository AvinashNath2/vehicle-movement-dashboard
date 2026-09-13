# Vehicle Movement Dashboard

A static, Excel-backed Daily Vehicle Movement Register & Dashboard, built to
be hosted for free on **GitHub Pages** — no server, no database, no build
step.

Live structure mirrors the unit's existing paper/Excel register (`03 BN
NDRF, MUNDALI — DAILY VEHICLE MOVEMENT REGISTER`): Vehicle Master, daily
movement entries with auto-calculated Total KM, reports, and an audit trail.

## 1. Quick start (local preview)

Browsers block `fetch()` on `file://` pages, so don't just double-click
`index.html`. Serve the folder instead:

```bash
# from inside this folder
python3 -m http.server 8080
# then open http://localhost:8080
```

Any static server works (`npx serve`, VS Code "Live Server", etc.).

**Demo credentials:**

| Username | Password | Role |
|---|---|---|
| `admin` | `admin123` | Admin |
| `operator` | `operator123` | Operator |

Change these before real use — see [Security notes](#5-security-notes--important).

## 2. Deploying to GitHub Pages

1. Create a new GitHub repository and push this folder's contents to it (the
   repo root should contain `index.html` directly, or a `/docs` folder — pick
   whichever matches your Pages source setting).
2. In the repo: **Settings → Pages → Build and deployment → Source** = "Deploy
   from a branch", pick your branch and the `/ (root)` folder.
3. Wait a minute for the first build, then open the URL GitHub gives you
   (`https://<user>.github.io/<repo>/`).

No build tools, no `npm install` — every dependency is already vendored in
`js/vendor/` (see below).

## 3. How the data layer works (read this before relying on it)

GitHub Pages is **static hosting**: there is no server to write an .xlsx
file back to when someone clicks "Save". This app is built around that
constraint on purpose:

- **`data/vehicle-register.xlsx`** is the shared *baseline* — sample data
  seeded from your real register, structured as four sheets: `Vehicles`,
  `Users`, `Movements`, `AuditLog`. It ships in the repo, so it's the same
  for every visitor on first load.
- The first time the app runs in a browser, it reads that file and copies it
  into that browser's **`localStorage`**. From then on, every add/edit
  (vehicles, movement entries, users, audit entries) is read from and saved
  straight back to `localStorage` — instantly, no network call.
- That means **new entries are only visible in the browser/device that
  created them.** Two people using the site on two computers do not
  automatically see each other's new trips. This is the direct consequence
  of "static hosting + shared login" that the brief called out — a real
  shared multi-user store needs a backend or a serverless database
  (Firebase, Supabase, a simple Google Sheets API bridge, etc.).
- **To share updates:** open **Settings → Data Management → Export Full
  Backup (.xlsx)**, which downloads everything (all four sheets, current
  state) as one file. Replace `data/vehicle-register.xlsx` in the repo with
  it and push — the new baseline goes out to everyone the next time they
  load the site (or hit **Reset to Bundled Sample Data**).
- **To bring in a fresh daily register** (the same single-sheet format as
  your original file, with the "Date: dd-Mon-yyyy" title row), use
  **Settings → Import Register / Backup**. The importer recognizes two
  shapes automatically:
  - A **full backup** (has `Vehicles`/`Users`/`Movements`/`AuditLog` sheets)
    → replaces all data.
  - A **daily register sheet** (one sheet, title + header row like the
    original template) → adds any vehicles it doesn't already know about and
    imports any rows that have both Opening KM and Closing KM filled in,
    skipping exact duplicates and non-vehicle rows (e.g. the signature line
    at the bottom of the paper register).

If you outgrow this model (need real concurrent multi-user editing), the
cleanest next step is swapping `js/db.js`'s `persist()`/`init()` for calls to
a small backend or a serverless database — the rest of the app (pages,
forms, validation, exports) doesn't need to change.

## 4. Project structure

```
index.html                 Login screen + app shell
css/styles.css              All styling (responsive, light theme)
js/icons.js                 Small inline SVG icon set
js/utils.js                 DOM/date/number helpers, toasts, modals, pagination
js/db.js                    Data layer: load/save, CRUD, audit log, import/export
js/charts.js                Dependency-free SVG bar chart
js/pages.js                 Page renderers: Dashboard, Vehicles, Movements, Reports, Audit, Settings
js/main.js                  Auth, routing, app shell chrome
js/vendor/                  Vendored libraries (see js/vendor/README.md)
data/vehicle-register.xlsx  Baseline data (Vehicles / Users / Movements / AuditLog sheets)
```

## 5. Security notes — important

This is a client-side-only app, so please set expectations accordingly
before pointing real people at it:

- **Credentials live in the Excel file / browser storage in plain text.**
  Anyone who can view the page's network requests or `localStorage` can read
  them. This is fine for a low-stakes internal tool behind a private
  GitHub Pages URL or an intranet, but it is **not** equivalent to a real
  login system. Don't reuse a password anyone cares about.
- Change the default `admin` / `operator` passwords immediately: log in,
  go to **Settings → Change Password**, or edit the `Users` sheet in
  `data/vehicle-register.xlsx` before you first deploy.
- Role gating (Admin vs Operator) is enforced in the UI, not by a server —
  someone comfortable with browser dev tools could bypass it. Treat it as a
  convenience for well-intentioned users, not access control against a
  determined one.
- "Delete" is deliberately restricted: a vehicle with movement history can
  only be **deactivated**, never deleted, so the audit trail always stays
  intact. Only an unused vehicle can be hard-deleted.

## 6. Customizing

- **Unit name / report title:** search for `03 BN NDRF, MUNDALI` in
  `js/pages.js` (report export functions) and replace it.
- **Colors:** all design tokens are CSS custom properties at the top of
  `css/styles.css` (`--brand`, `--good`, etc.).
- **Add a column** (e.g. a new field on movement entries): add the input in
  `renderMovementForm` (`js/pages.js`), include it in the `data` object built
  in the form's submit handler, and add it to the relevant column lists in
  `DB.addMovement` / `DB.updateMovement` / `DB.exportBackupXlsx` (`js/db.js`)
  and the Reports export functions if it should appear there too.

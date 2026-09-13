# Vehicle Movement Dashboard

A Daily Vehicle Movement Register & Dashboard hosted for free on **GitHub
Pages**, with data stored in **Cloud Firestore** (Firebase free tier) — no
server to maintain, no build step, and live multi-user sync.

Live structure mirrors the unit's existing paper/Excel register (`03 BN
NDRF, MUNDALI — DAILY VEHICLE MOVEMENT REGISTER`): Vehicle Master, daily
movement entries with auto-calculated Total KM, reports, and an audit trail.

## 1. Quick start (local preview)

Browsers block ES-module scripts on `file://` pages, so don't just
double-click `index.html`. Serve the folder instead:

```bash
# from inside this folder
python3 -m http.server 8080
# then open http://localhost:8080
```

Any static server works (`npx serve`, VS Code "Live Server", etc.).
An internet connection is required (Firebase Auth + Firestore).

**Demo credentials:**

| Username | Password | Role |
|---|---|---|
| `admin` | `admin123` | Admin |
| `operator` | `operator123` | Operator |

Change these before real use: log in → **Settings → Change Password**.

## 2. Architecture

```
GitHub Pages  (serves the static HTML/CSS/JS — free)
      │
      ▼
Browser  ──►  Firebase Authentication  (login: username + password)
      │
      └────►  Cloud Firestore          (vehicles / movements / users / auditLog)
```

- **Login** uses Firebase Authentication (Email/Password provider).
  Usernames are mapped to synthetic emails (`admin` →
  `admin@vmd-fleet.app`) internally. Passwords are stored only by Firebase —
  never in Firestore, never in this repo.
- **Data** lives in four Firestore collections: `vehicles` (doc id =
  registration no.), `movements` (doc id = entry ID), `users` (profile only:
  display name, role, active flag) and `auditLog`.
- **Live sync**: the app uses Firestore snapshot listeners, so an entry
  added on one device appears on every other signed-in device within
  seconds. Firestore's offline cache keeps the app readable during brief
  network drops and syncs writes when the connection returns.
- **Security rules** (`firestore.rules`): all reads/writes require a
  signed-in Firebase user. Role gating (Admin vs Operator) is still
  enforced in the UI only.
- `data/vehicle-register.xlsx` is no longer the live data store — it is the
  bundled sample/seed used by **Settings → Reset to Bundled Sample Data**,
  and the template for the import/export features.

## 3. Firebase setup (already done for this deployment)

For reference, or to point the app at a different Firebase project:

1. Create a project at console.firebase.google.com (free Spark plan).
2. **Firestore Database → Create database** (pick a region close to you).
3. **Authentication → Sign-in method → Email/Password → Enable**.
4. **Firestore → Rules**: paste `firestore.rules` from this repo → Publish.
5. Project settings → Your apps → Web app → copy the config object into
   `js/firebase-init.js` (the config is public — it identifies the project,
   it does not grant access).
6. Create the first users + seed data (any Node script using the Firebase
   web SDK works; accounts can also be added by hand in the Authentication
   tab as `<username>@vmd-fleet.app`, plus a matching profile document in
   the `users` collection).

## 4. Deploying to GitHub Pages

1. Push this folder to a GitHub repository.
2. **Settings → Pages → Build and deployment → Source** = "Deploy from a
   branch", pick the branch and `/ (root)`.
3. Open `https://<user>.github.io/<repo>/`.

The Firebase SDK is loaded from Google's CDN (`gstatic.com`); the other
libraries (SheetJS, jsPDF) are vendored in `js/vendor/`.

## 5. Data management

- **Export Full Backup (.xlsx)** (Settings): downloads all four collections
  as one Excel file. Do this regularly — it is your offline backup.
- **Import Register / Backup** (Settings): a full backup replaces all
  vehicle/movement data *for every user*; a single-sheet daily register (the
  original paper format, with the "Date: dd-Mon-yyyy" title row) merges its
  vehicles and completed rows in. User accounts are never touched by imports.
- **Reset to Bundled Sample Data** (Settings): replaces the cloud data with
  `data/vehicle-register.xlsx`. Affects every user immediately.

## 6. Security notes

- Anyone who can sign in can read/write the register (Firestore rules).
  Keep accounts limited and deactivate users who leave (Settings → User
  Management).
- Role gating (Admin vs Operator) is a UI convenience, not a server-side
  guarantee — a signed-in operator with dev-tools knowledge could bypass it.
- "Delete" is deliberately restricted: a vehicle with movement history can
  only be **deactivated**, never deleted, so the audit trail stays intact.
- Change the default demo passwords before sharing the URL.

## 7. Project structure

```
index.html                 Login screen + app shell
css/styles.css              All styling (responsive, light theme)
js/firebase-init.js         Firebase SDK bootstrap (config + exports on window.FB)
js/icons.js                 Small inline SVG icon set
js/utils.js                 DOM/date/number helpers, toasts, modals, pagination
js/db.js                    Data layer: Firestore live sync, CRUD, audit, import/export
js/charts.js                Dependency-free SVG bar chart
js/pages.js                 Page renderers: Dashboard, Vehicles, Movements, Reports, Audit, Settings
js/main.js                  Auth (Firebase), routing, app shell chrome
js/vendor/                  Vendored libraries (SheetJS, jsPDF)
data/vehicle-register.xlsx  Bundled sample/seed data + import/export template
firestore.rules             Firestore security rules (paste into Firebase console)
```

## 8. Customizing

- **Unit name / report title:** search for `03 BN NDRF, MUNDALI` in
  `js/pages.js` (report export functions) and replace it.
- **Colors:** all design tokens are CSS custom properties at the top of
  `css/styles.css` (`--brand`, `--good`, etc.).
- **Add a column** (e.g. a new field on movement entries): add the input in
  `renderMovementForm` (`js/pages.js`), include it in the `data` object built
  in the form's submit handler, and add it to the relevant column lists in
  `DB.addMovement` / `DB.updateMovement` / `DB.exportBackupXlsx` (`js/db.js`)
  and the Reports export functions if it should appear there too.

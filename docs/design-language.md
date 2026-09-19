# "Sundays" Design Language — Reference

Extracted from the reference screenshot (Sundays task-manager dashboard) for use as the
target design language when redesigning the vehicle-movement-dashboard.

The overall feel: **editorial-modern SaaS** — near-white surfaces, soft lilac framing,
generous whitespace, large rounded corners, one bold serif accent (brand mark), pastel
tinted category tiles, black pill CTAs, and small pastel status pills.

---

## 1. Color palette

### 1.1 Surface / neutral

| Token              | Hex        | Usage                                           |
| ------------------ | ---------- | ----------------------------------------------- |
| `--frame`          | `#E4DBF5`  | Outer lavender frame / body background          |
| `--surface`        | `#FFFFFF`  | Sidebar and main content cards                  |
| `--surface-alt`    | `#F7F6FA`  | Subtle content bg (between sidebar and main)    |
| `--border`         | `#EDECEF`  | Card / input hairline border                    |
| `--border-strong`  | `#DCDBE0`  | Divider borders, filter chips                   |

### 1.2 Text

| Token              | Hex        | Usage                                      |
| ------------------ | ---------- | ------------------------------------------ |
| `--ink`            | `#141414`  | Primary text / headings                    |
| `--ink-soft`       | `#4C4C55`  | Body text, secondary labels                |
| `--ink-muted`      | `#9A9AA3`  | "MENU" / "TODO" / helper labels            |
| `--ink-faint`      | `#C4C4CA`  | Placeholder text, disabled                 |

### 1.3 Brand accent (soft lilac)

| Token              | Hex        | Usage                                       |
| ------------------ | ---------- | ------------------------------------------- |
| `--accent`         | `#7C5CFF`  | Reserved for links / focus rings            |
| `--accent-tint`    | `#EDE9FF`  | Selected nav pill background, badge circles |
| `--accent-tint-2`  | `#DAD1FF`  | Hover on selected pill                      |

### 1.4 Category icon tints (pale)

Cards use a **tinted background circle + saturated line icon**. Keep the tint pale
(≈ 15% saturation on a very light base):

| Category          | Tint hex     | Icon hex    |
| ----------------- | ------------ | ----------- |
| Home Help         | `#FFF3D6`    | `#E4A73E`   |
| Plan an event     | `#FBE6DB`    | `#C55A2B`   |
| Return a package  | `#E1EAFB`    | `#3D6DD9`   |
| Send a gift       | `#FBE1EE`    | `#D14A8F`   |
| Schedule appt.    | `#FBDDE3`    | `#D14760`   |
| Get a passport    | `#DFF0E4`    | `#2F9553`   |
| Kids activity     | `#DDEBF9`    | `#2F82C2`   |
| Plan a trip       | `#FCE3D6`    | `#DE7A2C`   |

### 1.5 Status pill palette (pastel)

Text sits on tint; both hues share the same base:

| Status          | Tint bg    | Text        |
| --------------- | ---------- | ----------- |
| **In Review**   | `#FCE0CB`  | `#8A3F14`   |
| **Drafts**      | `#EBDEF9`  | `#5A2E9C`   |
| **In Progress** | `#E5DBFB`  | `#4A2AA0`   |
| **High**        | `#EEE7FE`  | `#5539B6`   |
| **Medium**      | `#FDD8B9`  | `#8A3F14`   |
| **Mid**         | `#FBD3DB`  | `#8C2A44`   |

### 1.6 Semantic

| Token           | Hex        | Usage                                       |
| --------------- | ---------- | ------------------------------------------- |
| `--success`     | `#2F9553`  | Passport tint icon; success text            |
| `--warning`     | `#E4A73E`  | Warnings                                    |
| `--critical`    | `#D14760`  | Errors, destructive states                  |
| `--info`        | `#3D6DD9`  | Informational icons                         |

### 1.7 Special gradients

`Upgrade your plan` card is a subtle 45° gradient:
```css
background: linear-gradient(135deg, #FEE1D8 0%, #F4E1F5 55%, #E4D4FB 100%);
```

---

## 2. Typography

### 2.1 Font families

| Role                     | Family                                  | Weight   |
| ------------------------ | --------------------------------------- | -------- |
| **Brand / display serif**| `"Instrument Serif"` (fallback: `"Fraunces", "Playfair Display", serif`) | 400 / italic-optional |
| **UI sans**              | `"Inter"` (fallback: `"General Sans", "Manrope", ui-sans-serif, system-ui`) | 400 / 500 / 600 / 700 |
| **Tabular numbers**      | Same Inter, `font-variant-numeric: tabular-nums` | 500 |

Brand wordmark ("Sundays.") is the **only** serif on the page. Everything else is
sans.

### 2.2 Type scale

| Token                | Size   | Line-height | Weight | Usage                                    |
| -------------------- | ------ | ----------- | ------ | ---------------------------------------- |
| `--fs-brand`         | 32 px  | 1.1         | 400    | Sidebar brand wordmark (serif)           |
| `--fs-h1`            | 22 px  | 1.25        | 600    | Page title ("My Task")                   |
| `--fs-h2`            | 18 px  | 1.3         | 600    | Section heading ("Recommended…")         |
| `--fs-body`          | 14.5 px| 1.45        | 400    | Default body                             |
| `--fs-body-strong`   | 14.5 px| 1.45        | 600    | Task titles                              |
| `--fs-label`         | 13 px  | 1.4         | 500    | Buttons, category card labels            |
| `--fs-eyebrow`       | 11 px  | 1.3         | 600    | "MENU", "TODO", "ACTIVE PROJECTS"        |
| `--fs-badge`         | 12 px  | 1.2         | 500    | Status pills                             |
| `--fs-meta`          | 12.5 px| 1.35        | 500    | "12 Days left", "0%", "26%"              |

`--fs-eyebrow` uses `text-transform: uppercase; letter-spacing: 0.08em;`.

### 2.3 Google Fonts imports

```html
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
```

---

## 3. Spacing & sizing

Base unit **4 px**.

| Token       | Value  | Notes                                              |
| ----------- | ------ | -------------------------------------------------- |
| `--space-1` | 4 px   | Tightest gap                                       |
| `--space-2` | 8 px   |                                                    |
| `--space-3` | 12 px  |                                                    |
| `--space-4` | 16 px  | Default gutter inside cards                        |
| `--space-5` | 20 px  |                                                    |
| `--space-6` | 24 px  | Section spacing                                    |
| `--space-8` | 32 px  | Card padding, sidebar internal gap                 |

| Token          | Value        | Notes                                      |
| -------------- | ------------ | ------------------------------------------ |
| `--sidebar-w`  | 260 px       | Fixed sidebar width on desktop             |
| `--content-max`| 1240 px      | Optional inner content cap                 |
| `--frame-pad`  | 20 px        | Lavender-frame breathing room around app   |

Cards use **20–24 px** internal padding. Rows have **16 px** vertical padding.

---

## 4. Radii

| Token         | Value      | Usage                                    |
| ------------- | ---------- | ---------------------------------------- |
| `--r-sm`      | 8 px       | Small chips, key badges (⌘F)             |
| `--r-md`      | 12 px      | Input fields, secondary buttons          |
| `--r-lg`      | 16 px      | Cards, category tiles, task rows         |
| `--r-xl`      | 20 px      | Sidebar, upgrade card                    |
| `--r-pill`    | 999 px     | Primary CTA, status pills, filter chips  |

**Rule of thumb**: nothing is fully square. Even icon buttons are ≥ 8 px.

---

## 5. Shadows / elevation

Everything is nearly flat — depth comes from **borders + tints**, not shadows.

| Token           | Value                                              | Usage                            |
| --------------- | -------------------------------------------------- | -------------------------------- |
| `--shadow-none` | none                                               | Default state for cards          |
| `--shadow-xs`   | `0 1px 2px rgba(20,20,20,0.04)`                    | Subtle hover state               |
| `--shadow-sm`   | `0 4px 14px rgba(20,20,20,0.06)`                   | Dropdown menus, floating panels  |
| `--shadow-md`   | `0 10px 28px rgba(20,20,20,0.10)`                  | Modal dialogs                    |

---

## 6. Buttons

### 6.1 Primary (solid black pill)

```css
.btn-primary {
  background: #141414;
  color: #fff;
  border: none;
  border-radius: 999px;
  padding: 12px 20px;
  font-size: 13px;
  font-weight: 600;
}
.btn-primary:hover  { background: #2a2a2a; }
.btn-primary:active { background: #000; }
```
Height ≈ **44 px** for `+ New Project` and `See plans`.

### 6.2 Secondary / outline

```css
.btn-outline {
  background: #fff;
  color: #141414;
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  padding: 10px 14px;
  font-weight: 500;
}
.btn-outline:hover { background: #F7F6FA; }
```
Filter / Sort / Hide buttons follow this style with a leading 16 px icon.

### 6.3 Ghost / icon-only

```css
.icon-btn {
  width: 36px; height: 36px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 10px;
  color: var(--ink-soft);
  background: transparent; border: 1px solid transparent;
}
.icon-btn:hover { background: #F0EEF5; color: var(--ink); }
```

### 6.4 Nav item

```css
.nav-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 12px;
  color: var(--ink-soft); font-weight: 500;
  border-radius: 12px;
}
.nav-item.active {
  background: var(--accent-tint);
  color: var(--ink);
}
.nav-item.active .icon-square {
  width: 28px; height: 28px;
  background: #141414; color: #fff;
  border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
}
```

### 6.5 CTA badge (upgrade card)

Same as primary but paired with a sparkle glyph.

---

## 7. Form controls

### 7.1 Search input

- Container: 48 px tall, `border-radius: 14px`, white bg, 1 px border `--border-strong`.
- Leading icon (search) at 16 px, `--ink-muted`.
- Trailing kbd chip (`⌘F`): height 26 px, border-radius 8 px, bg `#F4F3F7`, border 1 px `--border`, monospace 12 px.

### 7.2 Text inputs

```css
.input {
  height: 40px;
  padding: 0 14px;
  border-radius: 12px;
  border: 1px solid var(--border-strong);
  background: #fff;
  font-size: 14px;
}
.input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(124, 92, 255, 0.15);
  outline: none;
}
```

### 7.3 Select / dropdown

Same as `.input` but with a trailing chevron 16 px (`--ink-muted`).

---

## 8. Cards, tiles, rows

### 8.1 Base card

```css
.card {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 20px 24px;
}
```

### 8.2 Category tile (Recommended Categories)

- 4-column grid, 16 px gap.
- 72 px tall, padding 16 px 20 px.
- Left icon in a 40×40 tinted rounded-square (`--r-md`).
- Label right of icon, 15 px / weight 600.

### 8.3 Task row (Todo / Active Projects)

- Full width, 72 px tall.
- White background, radius 16 px, hairline border.
- Layout: title stack (title 15/600 + subtitle 12/500 muted) | meta group (icon+count pills, status pill, priority pill, "days left" chip) | progress bar + % | overflow menu.
- **Selected/hovered** row: `background: #FBFAFE` with `box-shadow: var(--shadow-xs)`.

### 8.4 Empty-slot row

Dashed 1.5 px border in `--border-strong`, transparent bg, "+ Add New Project" center-aligned, 60 px tall.

---

## 9. Badges, pills & chips

- **Status pills** — see § 1.5. Padding `4px 10px`, radius 999 px, font 12/500.
- **Count chip** (`0 12`, `21`): white bg, 1 px border `--border`, radius 8 px, padding `2 8`, icon on left.
- **Time chip** (`15 Days left`): same as count chip.
- **Chats badge** (sidebar): circle 22 px, bg `--accent-tint`, text `--ink` weight 600.
- **Notification dot**: 8 px black circle top-right of bell.

---

## 10. Sidebar

- Width **260 px**, height 100vh, 20 px inner padding.
- Serif brand mark at top, 32 px, bottom padding 32 px.
- "MENU" eyebrow label above nav.
- Nav items ~12 px vertical padding, 12 px gap between icon and label.
- Bottom **Upgrade card**: gradient bg (see § 1.7), 20 px padding, 20 px radius, contains headline 16/700, body 12/500, and a full-width black `See plans` CTA.

---

## 11. Top bar

- Height 72 px, 24 px horizontal padding.
- Left: page title 22/600.
- Center: search input (§ 7.1) — max-width 640 px, centered.
- Right: notification bell (36 px icon button) + avatar (40 px circle, 2 px white ring optional).

---

## 12. Icons

- Line style, 1.75 px stroke, rounded joins / caps.
- Default size 20 px in nav, 18 px in inputs, 16 px in chips.
- Colored icons in category tiles use the palette from § 1.4 (fill + line combo).
- Recommended set: **Lucide** or **Phosphor** duotone-light. Do not mix with filled/solid icons.

---

## 13. Motion

- Hover / focus transitions: `120ms ease-out` on `background`, `color`, `border-color`, `box-shadow`.
- Row expand / accordion: `220ms cubic-bezier(0.4, 0, 0.2, 1)`.
- Modal enter: `180ms ease-out` for opacity + `scale(0.98 → 1)`.

---

## 14. Layout grid

- Desktop: sidebar (260 px, fixed) + main (fluid, max 1240 px inner).
- Cards inside main: 2- and 4-column grids with 16 px gap.
- Task rows are single column, full width.
- Mobile (< 720 px): sidebar collapses behind hamburger; grids collapse to 2 or 1 column; row meta group wraps below title.

---

## 15. CSS custom-properties starter

Drop-in variables to mirror this language:

```css
:root {
  /* Surfaces */
  --frame:         #E4DBF5;
  --surface:       #FFFFFF;
  --surface-alt:   #F7F6FA;
  --border:        #EDECEF;
  --border-strong: #DCDBE0;

  /* Text */
  --ink:        #141414;
  --ink-soft:   #4C4C55;
  --ink-muted:  #9A9AA3;
  --ink-faint:  #C4C4CA;

  /* Accent */
  --accent:       #7C5CFF;
  --accent-tint:  #EDE9FF;
  --accent-tint-2:#DAD1FF;

  /* Radii */
  --r-sm: 8px; --r-md: 12px; --r-lg: 16px; --r-xl: 20px; --r-pill: 999px;

  /* Shadows */
  --shadow-xs: 0 1px 2px rgba(20,20,20,.04);
  --shadow-sm: 0 4px 14px rgba(20,20,20,.06);
  --shadow-md: 0 10px 28px rgba(20,20,20,.10);

  /* Type */
  --font-serif: "Instrument Serif", "Fraunces", "Playfair Display", serif;
  --font-sans:  "Inter", "General Sans", ui-sans-serif, system-ui, -apple-system, sans-serif;
}
body {
  background: var(--frame);
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: 14.5px;
  line-height: 1.45;
}
```

---

## 16. Do / don't

**Do**
- Keep surfaces near-white; use color only through tints and pastel pills.
- Use one bold serif for brand/wordmark only.
- Prefer 12–16 px radii; nothing sharp.
- Rely on soft borders and generous padding instead of drop shadows.
- Group icon + label with 12 px gap.

**Don't**
- Use dark backgrounds anywhere except the primary CTA pill.
- Mix icon styles (line + filled).
- Use pure `#000` for text; always `#141414`.
- Use bright saturated colors as backgrounds — always pale tints.
- Add heavy borders on top of tinted rows (choose one, not both).

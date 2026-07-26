# Setty PMS Suite — Accessibility Review (WCAG 2.1 AA)

**Date:** 2026-07-24
**Scope:** All user-facing surfaces in this repository — `SettyPMS.html` (28k lines), the Outlook add-in (`taskpane.html` / `taskpane.js`), `SiteReport.html`, `SettyFieldPhotos.html`, `transmittal.html`, `ContractExtractor.html`, `SettyIntelligence.html`, `SettyAdmin.html`, `Newsletter.html`, `SettyMarketing.html`, `RFISubmittalSync_Preview.html`, `auth-callback.html`, `setty-auth.js`, `manifest.webmanifest`, `sw.js`.
**Method:** Static code review against WCAG 2.1 AA (semantics, keyboard access, focus management, labeling, live regions, contrast, motion). No runtime/AT testing was performed; line numbers reference the current state of `main` at the time of review.

> **Remediation status (this branch):** systemic failures #6 (document structure — headings, landmarks, skip links in SettyPMS, the taskpane, and transmittal) and #7 (contrast — the `#64748B` muted token suite-wide, SettyPMS badges and primary button, taskpane `--text-faint` and Dates-view dark-theme leftovers) have been addressed. The remaining items are still open.

---

## Executive summary

The suite is functionally rich but has had essentially **no accessibility work**: across ~55,000 lines there are almost no `aria-*` attributes, no `role`s (one, misused), no `htmlFor`/`for` label associations, no landmarks, and no live regions. The consequences cluster into seven systemic failures that repeat across every app:

1. **Keyboard users cannot perform core tasks.** Interactive controls are built from `<div>`/`<span>` with `onclick` — including the SettyAdmin tab bar (locked to one tab), the shared sign-in pill injected by `setty-auth.js`, ContractExtractor's and SettyFieldPhotos' file-upload controls (`display:none` inputs), SiteReport's pointer-only pin placement, transmittal's discipline picker, and five mouse-only typeaheads in SettyPMS.
2. **Focus is invisible.** `outline: none` is applied globally to buttons (SettyPMS) and/or form fields (SiteReport, SettyFieldPhotos, transmittal, SettyIntelligence, SettyAdmin, taskpane) with only a 1px border-tint replacement.
3. **No form control has a programmatic name.** The suite contains **zero** `for=`/`htmlFor=` attributes. SettyPMS's shared `Field` component renders labels as `<div>`s (~56+ uses per half of the file); the taskpane has 41 labels and 0 associations; every other app repeats the pattern. Dozens of controls have only a placeholder, or nothing at all (e.g. SettyAdmin's permission-matrix checkboxes).
4. **Every modal is a bare positioned `<div>`.** ~25 overlays across the suite lack `role="dialog"`, `aria-modal`, accessible names, focus trap/restore, and (with two exceptions) Escape handling; background content stays tabbable.
5. **All feedback is silent.** Toasts, `setStatus`-style banners (111 call sites in the taskpane alone), validation errors, loading states, and async results are injected with no `aria-live`/`role="status"`/`role="alert"` anywhere. Errors never set `aria-invalid` or move focus.
6. **No document structure.** The rendered UIs of SettyPMS, taskpane, and transmittal contain no heading elements at all (headings exist only inside generated print/export HTML strings); most apps have no `<main>`/`<nav>`/`<header>` landmarks and no skip links.
7. **The shared muted-text token fails contrast.** `#64748B` (variously `--muted`, `--dim`, `--faint`, `textDim`) is used for labels, table headers, and metadata at 10–12px across nearly every app at ≈3.1–4.0:1 (minimum is 4.5:1). Additional failures: SettyPMS badge palettes (3.6–4.3:1), the `#fff`-on-`#3b82f6` primary button (3.7:1), and dark-theme leftovers in the taskpane Dates view rendering text at ≈1.1:1.

**What's working:** every page sets `lang="en"`, a meaningful `<title>`, and a zoom-permitting viewport; the taskpane and SettyIntelligence use mostly native `<button>`/`<select>` elements; SettyIntelligence implements Escape-to-close and initial focus for modals; the FieldPhotos lightbox supports Escape and arrow keys; ContractExtractor keeps default focus rings and a clean heading hierarchy; SettyAdmin uses native `<details>/<summary>`.

---

## Highest-impact fixes (shared components first)

Because most apps funnel through a handful of shared helpers, a small number of edits resolves the majority of findings:

| # | Fix | Resolves |
|---|-----|----------|
| 1 | **SettyPMS `Field` component** (`SettyPMS.html:2377`): render `<label htmlFor={id}>` and pass `id` to the child control | ~110+ unlabeled form controls in SettyPMS |
| 2 | **SettyPMS `Modal` component** (`SettyPMS.html:2415`): `role="dialog" aria-modal="true" aria-labelledby`, focus on open, Tab trap, Escape, focus restore | Most of the ~17 SettyPMS overlays |
| 3 | **Remove `button{outline:none}`** (`SettyPMS.html:2043`) and every `input:focus{outline:none}` rule (`SiteReport.html:60`, `SettyFieldPhotos.html:96`, `transmittal.html:144`, `SettyIntelligence.html:54`, `SettyAdmin.html:48`, `taskpane.html:159`); add `:focus-visible{outline:2px solid …; outline-offset:2px}` | Focus visibility suite-wide |
| 4 | **One live-region toast/status host per app**: `role="status" aria-live="polite"` on toast containers (`role="alert"` for errors); the pattern already exists once at `taskpane.html:811` (`#celebrationToast`) | All silent success/error/progress feedback |
| 5 | **Lighten the muted token** (`#64748B` → ≈`#8b98ab` on the dark surfaces; `--text-faint #8a8886` → ≈`#6e6c6a` on the light taskpane) | The most widespread contrast failure |
| 6 | **A labeled `IconButton` pattern**: `aria-label` on every glyph-only button (`✕ × ‹ › ✎ ↻ 🗑` etc.) | ~80+ nameless buttons suite-wide |
| 7 | **A keyboard-capable typeahead** (ARIA 1.2 combobox: `role="combobox"/"listbox"/"option"`, `aria-expanded`, `aria-activedescendant`, Up/Down/Enter/Escape) reused across SettyPMS (5 instances), taskpane project search, ContractExtractor project picker, SettyFieldPhotos project picker, SettyMarketing quick-find | All mouse-only autocompletes |
| 8 | **`mountPill()` in `setty-auth.js:297-314`**: create a real `<button>` | Keyboard sign-in on every page that uses the shared pill |
| 9 | **Add `for=` to every static label** (mechanical find/fix; every control already has an `id` in most files) | taskpane (41), SiteReport (~20), FieldPhotos (~10), transmittal (~12), SettyIntelligence (~36), Newsletter/Marketing (~21), SettyAdmin (~14) |
| 10 | **Global reduced-motion guard** `@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}` + gate the taskpane confetti and infinite pin-wiggle | Motion findings suite-wide |

---

## Findings by application

Severity scale: **Critical** (blocks a core task for keyboard/AT users) · **Serious** (major barrier) · **Moderate** · **Minor**.

### SettyPMS.html (main app, React SPA)

Baseline: 1 `aria-*` attribute and 1 `role` in 28k lines (the lone `role="switch"` at `:26350` is on a non-focusable div — net-negative); 0 `tabIndex`, 0 `htmlFor`, 0 landmarks, 0 headings in the rendered UI, 0 `aria-live`, 0 `scope=`, 0 `fieldset`.

**Critical**
- `2043` — global `button{outline:none}` with no `:focus`/`:focus-visible` replacement anywhere; keyboard position is untrackable across every button (2.4.7).
- `2377-2384` — `Field` renders its label as a `<div>`; every wrapped input/select/textarea is nameless (1.3.1, 3.3.2, 4.1.2). Even the 17 real `<label>`s (`2549`–`2605`, `9599`–`9671`) lack `htmlFor`.
- `2417`, `6045`, `6563`, `9594`, `9924`, `15991`, `19292`, `19808`, `19908`, `23048`, `24410`, `24596`, `24897`, `26492`, `27768`, `27957` — every overlay/modal lacks `role="dialog"`, `aria-modal`, accessible name, focus trap/restore; Escape works only in the photo lightbox (`15942`) (4.1.2, 2.4.3, 2.1.2).
- `14522-14552`, `19820-19843`, `24664-24685`, `24740-24806`, `24831-24871` — five typeaheads whose options are `onMouseDown` divs: no keyboard path at all (2.1.1, 4.1.2).
- `~44` click-only `div`/`span`/`tr` handlers with no `tabIndex`/`role`/keys — e.g. `2405` (KPI tiles), `6784` (DatePicker trigger), `12223` (checklist collapse), `14408` (calendar day cells), `16126` (photo folders), `26104`, `27957` (2.1.1).
- `10006-10009` — staff-assignment checkboxes hidden with `display:none`; assignee selection is mouse-only. Same anti-pattern at `18005`/`18566` where `readOnly`/`disabled` checkboxes decorate click-only rows, so emails and calendar events can't be selected by keyboard (2.1.1).

**Serious**
- No headings (all `<h1>`–`<h3>` matches are inside generated print/OneNote HTML strings) and no landmarks/skip link; `SectionTitle` (`2394`) renders divs (1.3.1, 2.4.1, 2.4.6).
- `6726-6895` — custom DatePicker: no combobox/dialog semantics, no Escape, no arrow-key navigation, closes only on outside `mousedown` (2.1.1, 4.1.2).
- Validation errors are non-live divs with no `aria-invalid`/`aria-describedby`/focus move: `2632-2636`, `6699-6706`, `15608`, `17963`, `18540`, `19867` (3.3.1, 4.1.3).
- All status/toast/loading feedback silent: `7531-7552`, `16893`, `17194`, `18880`, `20284-20292`, `22090-22111`, `24556`, `26878-26912` (`pmsNudge`/`pmsCelebrate`), `27749`, `27934`, `27969` (4.1.3).
- ~64 icon-only buttons with no accessible name (`✕`, `‹`/`›`, `✏`, `📧`, delete `x`s): e.g. `2421`, `6806`, `7777`, `9940`, `16000-16010`, `18841`, `19077`, `24427`, `26150` (4.1.2).
- `14218-14282` — the Gantt chart SVG has no `role="img"`, no name, and no text/table equivalent (1.1.1).
- ~94 placeholder-only-labeled inputs (`10166`, `15505`, `16074`, `18788`, `22923`, `24494`, …) and unlabeled in-table controls (`19067-19075`, `20027-20121`, `25475-25480`) (3.3.2, 4.1.2).
- Contrast: `textDim #64748b` at 10–11px ≈3.5–4.0:1 (`2000`); badge palettes ≈3.6–4.3:1 (`2003-2028`); primary button `#fff` on `#3b82f6` ≈3.7:1 (`2358`) (1.4.3).
- `22136-22374` — rich-text editors: `contentEditable` divs with no `role="textbox"`; glyph-only toolbar with no `aria-pressed`; self-resetting action `<select>`s; fake CSS-grid rate table (4.1.2, 1.3.1).

**Moderate**
- ~30 data tables use `<th>` without `scope`; batch-invoice `rowSpan` grouping (`20005`, `20052`) has no programmatic association; empty action-column headers (1.3.1).
- Tab strips (`17004-17044`, `25330-25338`, `27801-27821`) and nav (`27791`) lack tab ARIA / `aria-current`; active state is color + 2px border only (4.1.2).
- Focus never moves on view change (`setTab`/`setView`/`onBack`/`onNavigateToProject`) — focus dumps to `<body>` (2.4.3).
- Color-only status: calendar milestone dots (`14444`), red/green amounts (`14017`, `19082`, `20429`), timeline kind stripes (`16372`), transmittal chip shades (`19388`), overdue-by-background-only rows (`10209`) (1.4.1).
- Emoji-prefixed button names (~44) announced verbatim ("hourglass not done, Drafting") (1.1.1).
- No `prefers-reduced-motion` guard for transitions (`2037`, `2389`, `6906`) (2.3.3).

**Positive:** `lang="en"`, real `<title>`, zoom not blocked; some modals `autoFocus` their first field.

### taskpane.html / taskpane.js (Outlook add-in)

The best keyboard baseline in the suite (nearly everything is a native `<button>`/`<select>`), undone by labeling and announcements.

**Critical**
- 41 `<label>`s, **0** `for=` attributes; all 15 `<select>`s and 4 date inputs have no accessible name at all (`taskpane.html:947-1291`) (1.3.1, 3.3.2, 4.1.2).
- `taskpane.js:309-332` — project autocomplete results are click-only divs (no listbox roles, no arrow keys) (2.1.1, 4.1.2).
- `taskpane.js:8619-8638` — participant rows are click-only divs (2.1.1).
- Dark-theme leftovers on the light surface: `taskpane.js:8451` date text `#e2e8f0` on `#faf9f8` ≈**1.1:1**; `taskpane.html:1250-1251` milestone form `#151b2e` background with ≈2.8:1 labels (1.4.3).

**Serious**
- 15 status containers / 111 `setStatus` calls with no live region; errors never set `aria-invalid` or move focus (only one `.focus()` call in 9.4k lines) (4.1.3, 3.3.1).
- Auto-appearing content (suggestion chips, watchlist, date chips, "Logged as" chips, pending-filing recovery banner `taskpane.js:2178-2213`) is never announced (4.1.3).
- `#creditsOverlay` (`taskpane.html:814-821`) — full-screen overlay with no dialog semantics, no Escape, click-only dismissal (4.1.2, 2.1.1).
- `showView` (`taskpane.js:9164-9172`) never moves focus on view switch (2.4.3).
- No headings, no landmarks (1.3.1).
- `--text-faint #8a8886` ≈3.5:1 at 10–11px; hard-coded `#888`/`#94a3b8` in JS (1.4.3).
- Infinite `pinWiggle` animation with no pause and no `prefers-reduced-motion` anywhere (incl. 160-particle confetti) (2.2.2, 2.3.3).
- Glyph-only dismiss/refresh buttons (`taskpane.html:861`, `:877`, `:897`; `taskpane.js:3733`) — note `taskpane.js:3855` does it correctly (4.1.2).

**Moderate:** mode toggles without tab ARIA (`1080`, `1138`); focus ring reduced to a 1px box-shadow (`159-165`); `--border #e1dfdd` ≈1.3:1 for control boundaries (1.4.11); mutating button labels never announced; `.btn-deemph{opacity:.7}` drops primary-button contrast below AA.

**Functional bug worth checking (not a11y):** `showView` (`taskpane.js:9164`) omits `rfiResponseView`/`subReviewView` from its hard-coded list while `openRfiResponseView`/`openSubReviewView` call it with those ids — the Log Response / Log Review views appear unreachable.

### SiteReport.html

**Critical:** `1280-1387` — key-plan pin placement is entirely pointer-driven (click-to-place, drag-to-move, drag-to-rotate) with no keyboard alternative (2.1.1).
**Serious:** report cards / plan thumbnails / photo-picker cards are click-only divs (`870`, `1136`, `1226`, `1579`); both modals + sign-in overlay lack dialog semantics, focus management, and Escape (`448-476`, `266-270`); ~20 status call sites with no live region (`2620-2633`); ~20 unassociated labels (`365-435`, `1860`); validation errors silent and unfocused (`996`, `1957`); four `<img>` with no `alt` (`429`, `1138`, `1587`, `1837`); `input:focus{outline:none}` (`60`).
**Moderate:** punchlist item photos `alt=""` (`1791`); glyph-only buttons (`×`, `✎`, `⚐`); discipline headers and modal titles are divs, not headings; no landmarks/skip link.
**Minor:** `--muted #64748B` ≈3.7–4.0:1.

### SettyFieldPhotos.html

**Critical:** `369-373` — the photo dropzone is a click-only `<div>` over a `display:none` file input; keyboard users cannot add photos, which is the app's entire purpose (2.1.1).
**Serious:** project-picker options, folder accordion headers (no `aria-expanded`), and photo cards are click-only divs (`702`, `1399`, `1545`); lightbox lacks dialog semantics/focus trap (though Escape + arrows work, `1615-1620`); all toasts unannounced and auto-dismissing in 4s (`524`, `1766`); ~10 unassociated labels plus fully unlabeled gallery filters and per-photo batch checkboxes (`363`, `463-481`, `1546`); required-by-asterisk-only with toast-only errors (`380`, `1112`); `outline:none` on all fields (`96`).
**Moderate:** glyph-only lightbox/remove buttons; per-file upload state is a colored circle + `title` only (1.4.1); progress bar without `role="progressbar"` (`445`, `1139`); tabs without tab ARIA (`352`); `<h1>` lives only in the hidden auth screen; `--dim #64748B` ≈4.0:1; 9px filename overlays.

### transmittal.html

**Serious:** per-row discipline badge is a click-only `<span>` swapping in a hidden `<select>` — keyboard users can't change any sheet's discipline (`1259`, `1273-1279`); ~12 unassociated labels (`353-451`); per-row include-checkbox and four text inputs unlabeled (`1257`, `1266-1270`); ~40 status call sites silent through `setStatus` (`2287-2292`) during a multi-minute publish flow; errors unfocused/unmarked (`1404`, `1739-1759`); `outline:none` (`144`); sign-in overlay leaves background tabbable (`325-332`).
**Moderate:** **zero heading elements in the file**; `✓` and empty `<th>`s without `scope`/hidden text (`472-480`); disabled Step-2 buttons explained only via `title` (`496-498`); `renderTable()` rebuilds tbody via `innerHTML` and dumps focus (`1249-1300`); no landmarks.

### ContractExtractor.html

**Critical:** `82` + `3197` — file input `display:none`; upload (the app's core function) is mouse-only. `3253-3295` — custom project combobox with no roles or keyboard handling.
**Serious:** `FieldEditor` labels unassociated → all ~21 contract fields nameless (`2331-2347`); parse/OCR/write status banners and log silent (`3321-3435`); `#64748B` small text ≈3.7:1 (`137`, `145`).
**Moderate:** no landmarks; disabled Apply-and-Save reason lives in unannounced `title` (`3143-3180`).
**Positive:** clean h1→h2→h3 hierarchy, native buttons, intact focus rings.

### SettyIntelligence.html

**Critical:** sign-in chip is a click-only div (`166-169`, `1938`).
**Serious:** heat-map SVG bubbles and list rows are click-only, SVG unnamed (`981-997`, `1068-1080`); hover-only tooltip (`1071`, `1022`) violates 1.4.13; ~36 unassociated labels; five modals without dialog roles/trap/restore (though Escape and initial focus are implemented — `1693-1701`); toasts and loading swaps silent (`172`, `281`); `outline:none` (`54`); validation via generic toasts (`1842`).
**Moderate:** tabs without tab ARIA (`342`); heat-map table headers without `scope` (`1026`); severity/tier conveyed by colored dot alone (`733`, `998`); brief selector re-renders whole view and destroys focus (`428`); `--muted` ≈3.6–4.0:1; 👍/👎/🗑 buttons unnamed.

### SettyAdmin.html

The worst keyboard story in the suite.

**Critical:** all seven console tabs are click-only `<div>`s — keyboard users are locked out of Users & Roles, Backups, Filing Log, Integration, System Guide, and Claude/MCP (`300-301`); sign-in chip click-only div (`95`, `258`); project filter re-renders itself on every keystroke, destroying focus and caret (`660-661`, `638`).
**Serious:** permission-matrix checkboxes have no names at all (`403-414`); ~14 control types labeled only by placeholder/column position (`368-431`, `594-732`); all admin outcomes silent (`98`, `120`); full-view swaps unannounced with no focus management (`265-619`); heading outline is `h1` → styled divs → `h4` (16 `.sechead` divs); `outline:none` (`48`).
**Moderate:** 11 tables with unscoped headers and no captions; `--muted` on table headers ≈3.6:1; no landmarks; "Remove"/"Save" buttons with no row context.
**Positive:** native `<details>/<summary>`; status pills carry text alongside color.

### Newsletter.html / SettyMarketing.html / RFISubmittalSync_Preview.html

**Critical:** click-only div tab bars (`Newsletter.html:100-103`, `SettyMarketing.html:114-116`); span-based expand/collapse toggles with glyph-only state (`Newsletter.html:623/637`, `SettyMarketing.html:522`, `RFISubmittalSync_Preview.html:100`); toggle chips as `<span onclick>` with color-only state (`SettyMarketing.html:586`, `621`); mouse-only quick-find autocomplete (`SettyMarketing.html:171`, `472`); clickable-`<tr>`-only record access (`RFISubmittalSync_Preview.html:353`); editor overlays with no dialog semantics/Escape and a nameless `✕` span close control (`SettyMarketing.html:80-82`, `RFISubmittalSync_Preview.html:118-120`, `406-417`).
**Serious:** ~27 unassociated or placeholder-only labels across the three files; mislabeled project picker (`RFISubmittalSync_Preview.html:79-81` — the "Project" label points at the filter box); unlabeled generated editor fields (`:390`) and import checkboxes (`:334`); all logs/toasts/status non-live with color-only ok/err (`Newsletter.html:331-338`, `SettyMarketing.html:263-270`, `RFISubmittalSync_Preview.html:121/175`); `--faint #64748B` ≈3.1:1 hints; unlabeled `contenteditable` body editor and untitled preview iframe (`Newsletter.html:192`, `205`); newsletter images hard-coded `alt=""` (`:782`); generated email HTML with no `lang`/`<title>` and a 3.5:1 footer (`:721-726`); sign-in gate doesn't hide background (`SettyMarketing.html:97-102`).
**Moderate:** auto-opening up to six tabs on success (`Newsletter.html:874`); opacity-dimmed rows below contrast; contacts table with no header row (`SettyMarketing.html:530`); empty `mailto:` links (`:537`); "Void" pill ≈3.6:1 (`RFISubmittalSync_Preview.html:160`).

### auth-callback.html / setty-auth.js / manifest / sw.js

- **Critical:** `setty-auth.js:297-314` — the suite-wide sign-in pill is a click-only `<div>`; wherever it's the only sign-in control, sign-in is impossible without a mouse.
- **Serious:** `auth-callback.html:21-50` — sign-in outcome (success/failure + error text) written with `textContent` and never announced; page self-closes after 8s (2.2.1).
- **Minor:** callback page has no heading; status emoji announced literally; `manifest.webmanifest` lacks `"lang"`. `sw.js`: no findings.

---

## Suggested remediation sequence

1. **Unblock keyboard-only users (Critical, small diffs):** convert the click-only tab bars, sign-in chips/pill, expander toggles, and participant/option rows to `<button>`s; make the two `display:none` file inputs visually-hidden-but-focusable; render transmittal's discipline `<select>` directly; fix SettyAdmin's self-destroying filter input.
2. **Shared-component pass in SettyPMS:** `Field` → real labels; `Modal` → dialog semantics + focus trap + Escape; restore focus rings; one toast live-region host; labeled `IconButton`.
3. **Mechanical label association pass** across all static HTML (add `for=`/`id`; `aria-label` for in-table and filter controls, including row identity).
4. **Live regions + error semantics:** `role="status"`/`role="alert"` on every status/toast container; `aria-invalid` + `aria-describedby` + focus move on validation failure.
5. **One shared accessible typeahead** replacing the five SettyPMS instances plus the taskpane/ContractExtractor/FieldPhotos/Marketing pickers.
6. **Palette adjustments:** muted token, badge palettes, primary button, taskpane dark-theme leftovers and `--text-faint`.
7. **Structure pass:** real headings, landmarks, skip links, `scope` on table headers, tab ARIA.
8. **Motion:** global `prefers-reduced-motion` guard; gate confetti/pin-wiggle.
9. **Keyboard alternatives for pointer-first features:** SiteReport pin placement (arrow-key nudge + numeric X/Y/direction inputs), SettyIntelligence heat-map bubbles/tooltips, drag-and-drop flows.

Re-testing after remediation should include a keyboard-only walkthrough of each app's core task and a screen-reader pass (NVDA + JAWS on the taskpane inside Outlook, VoiceOver on the mobile-oriented field apps).

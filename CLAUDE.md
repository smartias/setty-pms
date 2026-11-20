# setty-pms — working notes for Claude sessions

Static HTML apps (no build step) deployed by Vercel from `main`, plus Supabase
edge functions under `supabase/functions/` (the `pms-mcp` connector). Data is
Supabase Postgres; SharePoint access goes through Microsoft Graph from the
browser (PMS pages) or from the connector (app permissions).

## Hard rules for `SettyPMS.html`

1. **Bump `window.__appVersion` (top of the file) in every PR that changes the
   file.** Convention: `YYYY-MM-DD-pms-vNNN-short-slug`, incrementing `vNNN`.
   The boot script at the bottom caches the Babel-compiled JSX in
   `localStorage` keyed by this string, and the "New version available"
   banner in open tabs fires only when it changes. A forgotten bump once
   shipped a fix that no existing user actually ran (PR #277). The cache key
   now also carries a source hash, so a fresh load recompiles anyway, but
   open tabs still need the bump to be told to reload.
2. **The file is CRLF.** Read and write it in binary mode and keep `\r\n`; a
   text-mode rewrite turns a 20-line change into a 33,000-line diff. Other
   CRLF files: `SettyFieldPhotos.html`, `SiteReport.html`, `transmittal.html`.
   `SettyAdmin.html`, `Accolades.html`, `taskpane.html`, the `.js` modules and everything under
   `supabase/` are LF.
3. **Two `text/x-pms-jsx` script blocks share one global scope.** Top-level
   `function` declarations in block 1 are visible in block 2. Do NOT use
   object-rest destructuring in function parameters (`({ a, ...rest })`):
   Babel's `_objectWithoutProperties/_excluded` helper collides across the
   two blocks. See the comment on `CommitInput`.
4. **Syntax check before pushing.** Extract each block and parse it with
   `@babel/parser` (`plugins: ["jsx"]`); `node --check` cannot read JSX. Run
   the unit tests with `node --test *.test.mjs` (repo root) and
   `node --test supabase/functions/pms-mcp/*.test.mjs`.
   The "Tests" workflow (`.github/workflows/tests.yml`) runs the same three
   things on every PR, plus a CRLF/LF check
   (`.github/scripts/check-source.mjs`); a red run means do not merge.

## CDN libraries (all pages)

- Every `<script src>` from jsdelivr, cdnjs or unpkg names an exact version
  and carries `integrity="sha384-..." crossorigin="anonymous"`. The browser
  refuses the file if its bytes differ, so **changing a library version means
  changing the hash in the same edit**, or that page stops loading the library:
  `curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A`
  (prefix the result with `sha384-`). The Tests workflow fails a tag that lacks
  either; it cannot check the hash is right, so load the page once.
- `supabase-js` is pinned (it used to float on `@2`). Scripts loaded lazily
  from JS (confetti, the pdf.js worker and fallback, xlsx) and `office.js`
  have no integrity attribute.

## SharePoint / Graph rules (PMS pages)

- **Create folders with `ensureSpSubfolder(driveId, parentPath, name)`**
  (defined next to `createMilestoneSpFolder`). It is GET-first, creates with
  `conflictBehavior: "fail"`, re-checks on conflict and throws a message that
  names the real cause. Never use `conflictBehavior: "replace"` on a folder:
  on current Graph it can delete and recreate the folder with its contents.
- **`graphFetch` returns `null` on 404 instead of throwing.** A POST against
  a missing parent comes back `null`; check `result?.id` before treating a
  write as done. Never wrap a Graph write in an empty `catch`.
- **Never assemble a SharePoint link by hand.** GET the item and use its
  `webUrl`. Project folders live at the root of the hardcoded
  `SP_DRIVE_ID_HARDCODED` drive, named `<projectNumber> - <name>`; the last
  segment of `project.projectFolderUrl` (via `safeDecodeFolderUrl`, trailing
  slash stripped) is the drive-root-relative path.
- Encode Graph paths per segment with `encodeSpPath`, not one
  `encodeURIComponent` over the whole path.

## Debugging "it still doesn't work"

- Check production actually deployed (`main` → Vercel) and then check the
  data: `pms_projects.project` (jsonb) and `pms_projects_history` show what
  the client really saved. No new field written after a deploy usually means
  the client is still running the old cached build (rule 1 above).
- Supabase edge logs show the browser's PostgREST calls; the connector logs
  are under `function_edge_logs`.
- Scheduled jobs: `pms-cron-alert` (pg_cron, every 15 min) calls
  `pms-user-emails/cron-alert`, which emails `CRON_ALERT_TO` when a job's last
  run failed, the nightly backup is stale, or background calls fail in bulk
  (`public.pms_cron_problems()`; one email per problem per 20 h, remembered in
  `pms_cron_alerts`). An admin call to `/cron-alert?dryRun=1` shows what it
  sees and sends nothing. pg_cron marks an HTTP job "succeeded" once the call
  is queued, so a job's own status says nothing about the function's answer.
- "The Outlook pane is slow / hung": read `pms_addin_telemetry` (one row per
  pane save: `total_ms`, `steps`, per-request `calls`). The migration that
  creates it carries the two queries worth running first.

## Git / PR conventions

- Merge commits (no squash) into `main`; PR titles are short imperative
  summaries of the change.
- Keep PRs to one concern; a version bump rides with the JSX change it
  belongs to.

## Proposal pipeline (Word export + AI drafting)

- `setty-docx.js` renders the proposal .docx from the SharePoint tokenized
  template and REPAIRS template defects at render time (numbering restarts,
  heading spacing, stale office address/FPID, fee fill, trailing blank
  pages). Its contract lives in `setty-docx.proposal.test.mjs` — a
  self-contained fixture reproducing the real template's structures
  (split runs, pPr paragraph-mark rPr, CRLF-era quirks). Run it on any
  change; extend the fixture when a new template structure bites.
- Word paragraph properties are ORDER-SENSITIVE inside `<w:pPr>`: insert via
  `withPPr`/`pPrInsert`, never by appending before `</w:pPr>` (elements after
  the paragraph-mark `<w:rPr>` are silently ignored by Word).
- Template text is fragmented across runs (rsid splits): replace values via
  `replaceInParagraph` (character-stream mapping), never by writing into
  runs by position.
- Scope boxes hold stamped clause HTML with `data-clause`, `data-discipline`,
  `data-phase` and prime tags; filters re-run at BOTH stamp time and Word
  export (`assembleProposalDocx`), so toggling disciplines/phases after
  import still adjusts the document.
- The drafting rules live in TWO places that must stay in sync:
  `buildClaudeDraftPrompt` (SettyPMS.html) and
  `supabase/functions/proposal-draft/index.ts`.
- Clause library = `pms_proposal_clauses` (Supabase). UPDATEs auto-archive
  and bump `version` via trigger; the Admin Console PATCHes rows directly,
  so targeted SQL edits are equivalent. Per-phase deliverables clauses are
  `inc-deliv-*`; the combined `inc-deliverables` bullets filter by phase
  codes from `project.phases` (PMs rename/reuse codes, so selection-by-key
  is the intent signal, tags are only guards).
- `pms_projects` rows use optimistic concurrency (`version` column): any
  direct SQL edit must bump `version` and the user must refresh open PMS
  tabs afterward or they'll hit save conflicts.

## Edge function deploys

- **Merging to `main` does not deploy edge functions to production.** After
  merging any change to an edge function, run the matching "Deploy ..."
  workflow from the Actions tab (one per function: "Deploy pms-mcp",
  "Deploy proposal-draft", "Deploy pms-user-emails"; `main` selected). For
  `pms-mcp`, the change is not live until
  `https://khxmgjilwhdguuepbhne.supabase.co/functions/v1/pms-mcp/health`
  reports the new `BUILD` (the workflow checks this and fails if it doesn't).
  `unsubscribe` has no workflow: deploy it with
  `supabase functions deploy unsubscribe --project-ref khxmgjilwhdguuepbhne --no-verify-jwt`
  and check `?health=1`.
- Why: `supabase/config.toml` lists all four functions, and Supabase's GitHub
  integration does build them on every PR preview (the "Supabase Preview"
  check). But its production run on `main` stops at the migration step, so
  its function-deploy step never runs. Production's migration history was
  written by hand-applied migrations whose version numbers differ from the
  file names in `supabase/migrations/` (e.g. `newsletter_drafts` is
  `20261119200000` in the repo but `20261119200220` in production), and the
  integration's `main` branch shows `MIGRATIONS_FAILED`. Seen 2026-11-20:
  PR #532 merged at 16:03 UTC, `/health` still showed the old build 13+
  minutes later, and `pms-mcp` changed only when the workflow ran (16:15).
  Until that history is repaired, treat the workflows as the only deploy path.
- `pms-user-emails` sends real email (welcome, and the Monday digest from
  pg_cron). The "Deploy pms-user-emails" workflow redeploys it and checks it
  answers, but cannot check the email itself: after changing it, test with an
  admin call to `/digest?dryRun=1` before Monday.
- **An edge function cannot serve an HTML page.** Supabase returns its
  responses as `text/plain` in a CSP sandbox, so the browser shows raw source.
  Put the page in the repo (`Unsubscribe.html`) and have it call the function
  for JSON (`unsubscribe`; `?health=1` reports its `BUILD`).
- Still bump `BUILD` in `pms-mcp/index.ts` with every change to it: it is the
  only way to tell which copy is live.

## Accolades.html (the Accolade-O-Meter)

- The page imports `accolades.js` with a `?v=` query. **Bump `VERSION` in
  `accolades.js` and the two matching values in `Accolades.html` (the import
  URL and `NEEDS_VERSION`) whenever `accolades.js` changes.** Browsers cache the
  module separately from the page; a stale copy once left the page calling
  functions the old module lacked and blanked half of it.
- Counting rules are in `accolades.js` (`accolades.test.mjs`). The page reaches
  Supabase tables `pms_accolade*`; later migrations are optional for it, and it
  hides the features whose tables or columns are missing.

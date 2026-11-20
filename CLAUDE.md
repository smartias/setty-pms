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
- Off-site backup: the "Off-site backup" workflow (`.github/workflows/backup.yml`,
  nightly 08:41 UTC) runs `.github/scripts/backup.sh`: `pg_dump` of `public`
  plus monthly CSV files of emails and project history, uploaded to the
  SharePoint folder in the `BACKUP_FOLDER_URL` secret through pms-mcp
  `/admin/backup/*` (upload sessions; paths limited by `backupExport.ts`).
  Runs are logged in `pms_backup_runs`; a missing night alerts as
  `backup-offsite-stale`. Restore: `docs/RESTORE.md` and
  `.github/scripts/restore.sh` (refuses a non-empty database). A new big table
  with rebuildable data belongs in the `--exclude-table-data` list.
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

- **A merge to `main` deploys to production.** Supabase's GitHub integration
  ("Deploy to production") runs on every merge: it applies new files in
  `supabase/migrations/`, then deploys the four functions listed in
  `supabase/config.toml` (`pms-mcp`, `proposal-draft`, `pms-user-emails`,
  `unsubscribe`). PR previews build the same functions (the "Supabase
  Preview" check). Working since 2026-11-20: PR #533 merged at 17:05:31 UTC
  and all four functions redeployed at 17:06:15.
- **That path has no health check.** After merging a change to `pms-mcp`,
  confirm
  `https://khxmgjilwhdguuepbhne.supabase.co/functions/v1/pms-mcp/health`
  reports the new `BUILD` (allow a couple of minutes). If it doesn't, run the
  "Deploy pms-mcp" workflow (Actions tab, `main` selected), which redeploys
  and verifies. The other "Deploy ..." workflows do the same for
  `proposal-draft` and `pms-user-emails`.
- **Merging a migration file applies it to production.** Don't also apply it
  by hand. MCP `apply_migration` records a migration under the time it ran,
  not the version in its file name, and the SQL editor records nothing.
  Either way the integration then tries to run the file again, its migration
  step fails, and a failed migration step skips the function deploy too. It broke auto-deploy
  until 2026-11-20, when production's history was reset to match the repo (the
  old rows are in `backups.schema_migrations_20261120`). If a hand-applied fix
  is unavoidable, record it under the file's exact version.
- `pms-user-emails` sends real email (welcome, and the Monday digest from
  pg_cron). The "Deploy pms-user-emails" workflow redeploys it and checks it
  answers, but cannot check the email itself: after changing it, test with an
  admin call to `/digest?dryRun=1` before Monday.
- **Database changes go in as files in `supabase/migrations/`, and production
  records them under the file's own timestamp.** On merge, Supabase compares
  the folder with production's `supabase_migrations.schema_migrations` and
  applies only new files; if the two lists disagree it applies nothing and
  shows the `main` branch as "migrations failed". That happened from
  2026-09-30 to 2026-11-20 because changes were applied by hand: the Supabase
  MCP `apply_migration` tool and the dashboard SQL editor record their OWN
  timestamp (or none), not the file's. The list was rewritten to match the
  folder on 2026-11-20; the old rows are in `backups.schema_migrations_20261120`.
  So: never apply a migration by hand. Merge the file and let the integration
  apply it. If one truly must go in by hand, record it under the file's
  version afterwards:
  `insert into supabase_migrations.schema_migrations(version, name, statements)
  values ('<14-digit prefix>', '<rest of file name>', '{}');`
- `20260918210000_pms_projects_broadcast_changes.sql` is recorded as applied
  but was never run in production (its September spike was rolled back), so
  the "project updated elsewhere" banner is off there on purpose. Turning it
  on is a deliberate change: run the file's statements, don't just merge.
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

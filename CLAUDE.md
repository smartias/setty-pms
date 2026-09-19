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
   `SettyAdmin.html`, `taskpane.html`, the `.js` modules and everything under
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
  `supabase/functions/proposal-draft/index.ts`. The edge function only
  updates on `deploy_edge_function` / `supabase functions deploy` — a repo
  merge alone does not ship it.
- Clause library = `pms_proposal_clauses` (Supabase). UPDATEs auto-archive
  and bump `version` via trigger; the Admin Console PATCHes rows directly,
  so targeted SQL edits are equivalent. Per-phase deliverables clauses are
  `inc-deliv-*`; the combined `inc-deliverables` bullets filter by phase
  codes from `project.phases` (PMs rename/reuse codes, so selection-by-key
  is the intent signal, tags are only guards).
- `pms_projects` rows use optimistic concurrency (`version` column): any
  direct SQL edit must bump `version` and the user must refresh open PMS
  tabs afterward or they'll hit save conflicts.

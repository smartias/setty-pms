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

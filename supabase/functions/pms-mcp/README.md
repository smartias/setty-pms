# pms-mcp

The read-only MCP server that exposes PMS data to the firm's enterprise Claude accounts. Runs as a Supabase Edge Function (Deno) using the Streamable-HTTP MCP transport.

- Endpoint: `https://khxmgjilwhdguuepbhne.supabase.co/functions/v1/pms-mcp/mcp`
- Health: `/functions/v1/pms-mcp/health` (unauthenticated, returns `{"ok":true,"build":"…"}`)
- Full runbook: the **Claude / MCP** tab of `SettyAdmin.html`

## This directory is now the source of truth

**It did not used to be.** For most of this function's life the only current copy was the live deployment, because deploys were done by pasting the whole file into a dashboard or an API call. On-disk copies drifted stale, and deploying one would silently regress features. The standing rule was "always pull the live function before editing".

That is no longer necessary. This directory was seeded from the deployed **v32** source, byte-for-byte verified, and the CLI can deploy straight from here.

**The rule going forward: edit here, deploy from here, and disk stays equal to live.**

If you have any doubt about whether that still holds, verify rather than assume. See below.

## `project_briefing`, and why it exists

Asked "what's going on with 280 Broadway", the connector used to answer out of the
structured PMS record: milestones, fee, contacts, open counts. Sara's verdict was that
this is not useful, because it is the same thing anyone can read off the PMS web app in
seconds. The substance of a status question is in the **meeting minutes** and the
**review comments**, and getting there took a second round trip every time.

`project_briefing` is the fix. One call returns the orientation block *and* the ranked
minutes *and* the review-comment attachments, with a `readNext` list and guidance that
tells the model to read the documents before answering. `get_project` now describes
itself as background and points here.

Two things it is easy to get wrong, both learned the hard way:

- **Minutes live in two places, and which one is per-project.** Some projects file them
  in the numbered `01 📋 Project Management` folder. Others — 280 Broadway among them —
  have an empty PM folder and keep every set of minutes in the `Emails` folder, as the
  attachment it arrived as. Searching only the PM folder finds nothing on those projects.
  Both are scanned. Note also that folder names carry numeric and emoji prefixes, so
  matching is by substring; an exact `subfolder: 'Project Management'` lookup returns zero.
- **There is no firm-wide naming convention for minutes.** They appear as
  `... - Minutes.pdf`, `Meeting minutes`, `Mtg 001 Minutes_Final.pdf`, `_Notes.pdf`, and
  on 280 Broadway as `2026.07.29_Design Meeting #16.pdf`, which contains neither
  "minutes" nor "notes". `scoreMeetingDoc()` handles the spread, and an agenda has to
  score *below* the minutes filed beside it or the wrong document gets read.

- **Paginate the folder listings.** Graph caps a page at 200 entries. Tabler has 3,226
  filed emails and 771 with attachments, so its Emails folder is the kind that overflows
  a single page. Reading only the first page treats a truncated slice as the whole folder
  and then picks the "newest" meetings out of it, which is worse than finding nothing
  because it looks like it worked. `meetingRecords()` follows `@odata.nextLink` up to
  `MAX_FOLDER_PAGES` and reports `truncated: true` when it stops early.
  `list_project_documents` now does the same, through the shared `listChildren()` helper,
  and sets `truncated` + `coverageWarning` on the response when it stops.

That heuristic is the fragile part, so it has tests, built from real filenames across six
projects:

```bash
node supabase/functions/pms-mcp/scoreMeetingDoc.test.mjs
```

The function is copied into the test rather than imported, because importing `index.ts`
would boot the server. Change the scoring in one place and you must change it in both.

## Maintenance

Everything in `project_briefing` fails **silently**. A filename that does not match scores
zero and vanishes; a renamed status quietly stops gating; a stale copy of a function keeps
passing its tests. Nothing throws. So the guards are built to make failure visible rather
than to rely on anyone remembering to look.

Already in place:

- **The heuristic has tests**, including a drift detector that reads this `index.ts` and
  fails if the copies in the test file no longer match the shipped functions. Verified to
  fail on a one-character change, so it is a real check and not decoration.
- **The project-folder lookup is memoized.** It is a linear scan of the drive root, which
  holds about one folder per project, paged at 200. At 148 projects that is one Graph call
  and the firm adds roughly 27 a year, so it would have quietly grown to two calls in about
  two years and kept climbing, on every briefing and every `list_project_documents`.
- **The construction-admin gate matches loosely** rather than by string equality, so
  recasing or renaming the status in the app does not silently disable it. The test asserts
  it still selects exactly one of the eleven statuses that exist in the data.
- **Truncation is reported.** `meetingRecords()` sets `truncated: true` when it hits the
  page bound, so a partial read is never passed off as complete.

The one thing worth checking periodically, because no code can detect it, is whether the
**filename heuristic is still matching how people name things**. New clients and new PMs
bring new conventions.

```sql
-- Coverage canary. Baseline 2026-07-31: 87 active projects, 81 with attachments,
-- 19 with at least one meeting-named attachment. Watch the trend, not the absolute:
-- a fall in the third number means naming has drifted away from the heuristic.
with active as (
  select p.id from pms_projects p
  where coalesce((p.project->'archived')::boolean, false) = false
    and p.project->>'status' in ('In Progress','In Construction Administration','In for Review','Top Priority')
), scored as (
  select a.id,
    count(*) filter (where lower(replace(replace(att,'_',' '),'.',' ')) ~ 'minutes?|meeting|mtg|notes') as md
  from active a
  join pms_project_emails e on e.project_id = a.id
  cross join lateral jsonb_array_elements_text(e.attachment_names) att
  group by a.id
)
select (select count(*) from active) as active_projects,
       count(*) as with_attachments,
       count(*) filter (where md > 0) as with_meeting_docs
from scored;
```

Two caveats on that query. It is a **proxy, not a replica**: it uses a looser pattern than
`scoreMeetingDoc` and it only sees the email-attachment path, not minutes filed in the
Project Management folder. And 19 of 81 is low because most projects genuinely do not
circulate minutes by email, not because the heuristic is broken. It is a trend line.

If it does drift badly, the escape hatch is to stop guessing from filenames altogether and
have the model pick from the folder listing. That costs a round trip and buys robustness.

Known and deliberately not fixed: 44 of 148 projects have no project number, so the
document half of a briefing cannot resolve a SharePoint folder for them at all.

## `extract_sheet_index`, and why it does not use the project tree

Found on 2026-08-01 during the Tabler (SAPX196006.00) sheet-index pilot, and worth
knowing before touching any of the SharePoint crawl code.

`projectTree()` is a breadth-first walk of every library, capped at
`TREE_MAX_REQUESTS = 150` **for the whole project**. On a large job the budget runs out
before the walk reaches deep set subfolders, and those files are then simply absent from
`tree.files`. Anything filtering that array by path concludes "no files found under X",
which reads like a bad path when the path is perfectly good. On Tabler that hid all 68
sheet PDFs under `Outgoing/2024-10-24_Revised 100% CD Submission/INDIVIDUAL PDF's/`, plus
the Addendum #1, Addendum #2 and Revised Bulletin #1 drawing folders — while
`list_project_documents` showed every one of them, because it lists on demand.

The tell that it is a budget problem and not a depth rule: under Addendum #1 the sibling
`Specifications` folder **was** visible and `Drawing` was not. It is order dependent, so
no depth limit or path convention will predict it.

So `extract_sheet_index` resolves the named `subfolder` through the Graph **path API**
(`/items/{root}:/{rel}:`) and crawls only beneath it — one request to resolve, then the
whole budget spent inside the folder the caller actually asked about. The whole-project
walk stays as a fallback for a path that is close but not exact, and when THAT is what
answered, the response says so in `scope.mode`. When neither finds anything, the response
distinguishes "no such folder" from "the crawl ran out of budget, this scan is
incomplete". Never let a truncated crawl report as an empty folder.

Two smaller things fixed in the same pass, both of which silently reported the wrong
answer rather than failing:

- **Set totals are PER DISCIPLINE.** Tabler's title blocks say "of 68" on E, "of 54" on M
  and "of 22" on T. `isPartialIssue` originally tested for exactly one distinct total
  across the whole result, so any multi-discipline package produced 2+ totals and reported
  `false` — Bulletin #13's 8 sheets across E and M were called a complete set.
  `summarizeDisciplines()` groups first, and an issue is partial when **any** discipline is
  short of its own stated total. A discipline with no stated total reports `null`, not
  `false`: unknown is not "complete".
- **Combined books blew the size cap.** Baseline sets often ship one combined PDF per
  discipline; Tabler's electrical book is 42MB against `MAX_DOC_BYTES` of 20MB, so it was
  dropped as a single quiet `unparsed` row. On a set that ships combined-only that loses a
  whole discipline. Sheet extraction walks pages and never returns the file body, so it now
  has its own `SHEET_MAX_BYTES` (64MB) with a per-call `SHEET_OVERSIZE_BUDGET`, oversized
  files are opened **last** so a book that fails cannot cost the individual sheets, and any
  file skipped for size appears in a top-level `oversizedFiles` with an `oversizedWarning`
  naming what is missing.

All three are covered in `sheetIndex.test.mjs`, including drift checks that fail if the
direct-resolve call or the per-discipline test is removed from `index.ts`:

```bash
node supabase/functions/pms-mcp/sheetIndex.test.mjs
```

## `search_drawings`, the drawing text index (Drawing Intelligence phase 2)

"Which sheets show the perchloric fume hood?" is answered from the TEXT LAYER of the
drawings: phase 0 proved the sheets are Revit vector exports carrying tags, keynotes,
schedules and the revision block as extractable text. Reading sheets through
`read_document` to answer it costs ~500k characters per set through the conversation,
so `search_drawings` puts the text in Postgres once per file and turns the question into
one indexed query.

- **Tables** (migration `20260816000000_drawing_text_index.sql`): `pms_drawing_text`, one
  row per SharePoint item + page, with the title-block fields the sheet parser already
  reads (sheet number, revision, revision date, layout) and a `pg_trgm` GIN index on the
  text; `pms_drawing_index_files`, one row per PDF with `status`/`attempts`, so a file that
  fails or is oversized is not retried forever. Both are connector-written CACHES, same
  posture as `pms_mcp_tree_cache`: not a business record, safe to truncate and rebuild.
  Nothing here touches the transmittal register.
- **Lazy fill, never a sweep.** Each call indexes up to `maxFilesToIndex` (default 10,
  cap 20, time-boxed at ~28s) not-yet-indexed PDFs under the project's Outgoing folder,
  then searches everything indexed. The result's `coverage` block says how many files
  are in scope, indexed, pending, skipped for size (>20MB, the combined books that time
  out on download) or given up after 3 attempts, and `complete` is true only when
  nothing is pending. A miss with `filesPending > 0` means "not read yet", and the
  description tells the model to call again. `indexOnly:true` pre-loads a project.
- **Current sets first, duplicates never** (`planDrawingScope`, 2026-08-17). Tabler has
  745 PDFs under Outgoing; most are the superseded 2019 CD sets or the combined-book copy
  of sheets that also ship individually. So the scope is planned: the newest date-prefixed
  set whose name reads like a full submission ("100% CD", "Final CD", "100 DD"...) and not
  like a partial (bulletin, addendum, RFI, resub) is the **baseline**; it and every set
  after it are the `currentSets` tier and index first, newest set first; older sets follow
  as `supersededSets`. Combined-PDF books in a set that also has an INDIVIDUAL folder are
  dropped from scope and counted as `duplicateBooksSkipped` (pass the combined folder as
  `subfolder` to read one anyway). `coverage.currentSets.complete` means "the drawings as
  issued today are fully indexed"; plain `complete` still means all of Outgoing, which
  only "when did it FIRST appear" needs. No baseline recognised = one tier = old behaviour.
- **The scope crawl is cached** (`drawingScopeFiles`, 15 min, in-memory + a row in
  `pms_mcp_tree_cache` under key `<prefix>#drawings:<subfolder>`). Measured 2026-08-17: the
  crawl alone (find the project folder across ~37 libraries, resolve Outgoing, walk 745
  files) took ~20 of the 28-second box on EVERY call, leaving ~8s to index, hence 3 files
  per call. Warm calls now spend the whole box indexing. A new bulletin folder is invisible
  for up to 15 minutes; a cache failure falls through to the walk.
- **The attempt is recorded BEFORE the download.** If the request dies mid-file there
  is no later chance to write; without the early mark a file that always times out would
  be retried on every call and starve the rest.
- **Search runs in SQL** (`pms_drawing_search`, service_role only). Query words are AND
  terms, a quoted phrase is one term, and a hyphen or space inside a term matches "-",
  " " or nothing, so `FCU-11` finds `FCU 11` and `FCU11`. User text is escaped, never regex.
  Snippet (360 chars around the first hit) and match count are computed with
  `regexp_instr`/`regexp_count` so a 12k-character page never leaves the database.
- **Results are grouped by sheet with every indexed revision listed newest first**, each
  with the set it was issued in (read off the folder path), page, snippet and webUrl.
  `earliestSeen` is phase 3's "first appeared on Rev N with Bulletin #M", honest only when
  `coverage.complete` is true. Revisions are ordered by `revisionDate`, never the label,
  because the label scheme changes mid-project (A/B/C, then 2, 3, 6...).
- **`history` per sheet** (`drawingSheetHistory`, 2026-08-17) makes absence explicit. One
  extra query fetches EVERY indexed revision of each matched sheet, hit or not, and the
  result carries `indexedRevisions`, `absentAt` (indexed revisions WITHOUT the term),
  `latestSeen` / `latestIndexed` / `stillPresentAtLatest` ("still there at Rev 13?"),
  `earliestIndexed` / `presentSinceEarliestIndexed` (if the term is already on the oldest
  indexed revision, "first appeared" may be earlier still), and `revisionDescription`, the
  revision block's own label (`BULLETIN #13`), so the answer can say "issued with Bulletin
  #13" off the sheet rather than the folder name. Revisions not yet indexed are unknown, not
  absent; the model is told so in the `note`.

```bash
node supabase/functions/pms-mcp/searchDrawings.test.mjs
```

## Deploying

Needs a Supabase personal access token, generated at **supabase.com → Account → Access Tokens**. It is account-wide, so revoke it when you are done.

```bash
$env:SUPABASE_ACCESS_TOKEN = "sbp_..."
npx supabase functions deploy pms-mcp `
  --project-ref khxmgjilwhdguuepbhne `
  --no-verify-jwt `
  --import-map supabase/functions/pms-mcp/deno.json
```

Run it from the repo root. `--no-verify-jwt` is required: the function does its own auth, and dropping the flag would put Supabase's JWT gate in front of the MCP endpoint and break every client.

## After every deploy

1. **Health check.** `curl .../pms-mcp/health` returns `{"ok":true,"build":"<BUILD>"}`. A 200 proves it compiled and booted, which catches most mistakes immediately — and `build` proves *your* copy is the one running, so bump the `BUILD` constant with every deploy and check it here rather than assuming.
2. **Confirm the auth gate.** An unauthenticated `POST` to `/mcp` should return `401`.
3. **Verify the deploy is byte-exact** against this directory, using `get_edge_function` and comparing hashes. This is what keeps the promise above true.
4. **Reconnect any Claude client** if tools or their descriptions changed. Clients cache the tool list at connect time, so existing sessions will not see changes until they disconnect and reconnect.

## Gotchas

- **Pass `--import-map` explicitly.** When `deno.json` ships alongside the function, the platform can otherwise re-apply a stale absolute path from a previous deploy and fail with "import map path does not exist".
- **`imagescript` must be the deno.land build** if drawing rendering is ever added. `npm:imagescript` crashes the edge worker on an unsupported native codec.
- **Cold starts run 1.5 to 8 seconds.** A `pms-mcp-keepwarm` pg_cron job pings `/health` every two minutes, but the first call right after a deploy can still be slow. One retry is normal.

## Configuration

No secrets live in this source. Everything sensitive is read from Edge Function secrets at runtime:

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MCP_SHARED_SECRET`, `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_SITE_ID`, `GRAPH_DOC_LIBRARY`

The tenant and client IDs appearing as literals in the code are public identifiers used as defaults, and are overridable by the environment.

## Auth model, worth knowing before changing anything

The Microsoft sign-in is an **authentication gate, not an identity**. `verifyEntraToken()` validates signature, issuer, audience and tenant, then returns a boolean and discards the payload. No user claim reaches any query, and every read uses the service-role key, which bypasses RLS by design.

So the Phase 5 role capabilities enforced in the database do **not** narrow what this connector returns. That is deliberate: it is read-only and surfaces what staff already see in PMS. But it means per-role visibility would be a build, not a configuration change, and it is not one line away.

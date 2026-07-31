# pms-mcp

The read-only MCP server that exposes PMS data to the firm's enterprise Claude accounts. Runs as a Supabase Edge Function (Deno) using the Streamable-HTTP MCP transport.

- Endpoint: `https://khxmgjilwhdguuepbhne.supabase.co/functions/v1/pms-mcp/mcp`
- Health: `/functions/v1/pms-mcp/health` (unauthenticated, returns `{"ok":true}`)
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
  `MAX_FOLDER_PAGES` and reports `truncated: true` when it stops early. Note that
  `list_project_documents` still takes only the first page; that predates this and is
  worth fixing separately.

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

Known and deliberately not fixed: `list_project_documents` still reads only the first page
of a folder listing, and 44 of 148 projects have no project number, so the document half of
a briefing cannot resolve a SharePoint folder for them at all.

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

1. **Health check.** `curl .../pms-mcp/health` should return `{"ok":true}`. A 200 there proves it compiled and booted, which catches most mistakes immediately.
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

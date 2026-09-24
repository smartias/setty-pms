# Pending deploy: connector 1.19.2 (project-number suffix matching)

Written 2026-09-24 for whoever has the Supabase CLI next. This replaces the
stale version of this file, which described the 15-Sep PR #271 deploy — that
one has clearly already shipped (the BUILD constant on `main` moved well past
`2026-09-15-sharepoint-nudge` since then). Delete this file once `/health`
shows the build below.

## What is waiting

PR #303, merged to `main` (`2db06c2`): `list_project_documents` (and every
tool that resolves a project's SharePoint folder by number) and
`search_field_photos` both missed real folders/sessions when a SharePoint
folder name or a stored `project_number` dropped the default `.00` phase
suffix that PMS's canonical project number always carries — confirmed live
on SAPX266021.00, whose actual folder is named `SAPX266021 - St. Nicholas of
Tolentine Feasibility Study` (no `.00`) and whose 5 field-photo sessions were
logged as `project_number: "SAPX266021"` (also no `.00`). Full story in
`HANDOFF-STATUS-2026-09-24.md` at the repo root.

Expected `/health` build after the deploy: **`2026-09-24-project-number-suffix-match`**.

## The short version

1. `main` already has PR #303 merged — nothing to merge first.
2. In PowerShell, from the repo root:
   ```powershell
   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."     # supabase.com → Account → Access Tokens
   .\supabase\functions\pms-mcp\deploy.ps1
   ```
   The script pulls main, checks the BUILD string on disk, deploys, and polls
   `/health` until the new build answers. It stops with a message if any step
   is off.
3. Start a fresh Claude conversation (the tool list is cached per connection).
4. Revoke the access token when done.

## If you would rather do it by hand

```powershell
cd C:\path\to\setty-pms          # the REPO ROOT — the folder that contains supabase\
git checkout main; git pull origin main
$env:SUPABASE_ACCESS_TOKEN = "sbp_..."
npx supabase functions deploy pms-mcp --project-ref khxmgjilwhdguuepbhne --no-verify-jwt
curl https://khxmgjilwhdguuepbhne.supabase.co/functions/v1/pms-mcp/health
```

Known traps (all in README → Deploying): run from the repo root, never from
`supabase\`; no `--import-map` flag; `--no-verify-jwt` is required; "Docker is
not running" is harmless; the first health call after a deploy can be slow.

## Smoke test, in a new Claude conversation

- `list_project_documents` on `SAPX266021.00` → the SharePoint folder is
  found (`count` > 0, `Photos` among the items), not "Nothing for this
  project in SharePoint yet."
- `search_field_photos` with `project: "SAPX266021.00"` → 5 sessions from
  2026-07-07 come back, not `count: 0`.

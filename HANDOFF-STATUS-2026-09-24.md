# Handoff status: pms-mcp project-number matching (missing folders / photos)

**Read this first in any Claude session, on either computer or account.**
Last updated 2026-09-24 16:00 UTC from a cloud session on the account that
also holds Sheetsa (its Supabase MCP connector lists only `Sheetsa` and
`Eque` — it cannot reach the live PMS project). **PMS work moves to the
other Claude account from here**, same handoff boundary as
`HANDOFF-STATUS-2026-09-20.md`.

This file is committed to the repo on purpose, same reason as the other
`HANDOFF-STATUS-*.md` files: the repo is the only place every computer and
every Claude account can see.

## What landed, merged but NOT YET DEPLOYED

| Where | Change | PR | Live? |
|---|---|---|---|
| `smartias/setty-pms` | `numberPrefixMatches()` in `supabase/functions/pms-mcp/index.ts`: SharePoint folder-by-number lookup (`findProjectFolderInDrive`/`projectFolder`, used by `list_project_documents` and most drawing/CA/document tools) and `search_field_photos`'s project filter now tolerate a project's SharePoint folder name or a stored `project_number` dropping the default `.00` phase suffix that PMS's canonical number always carries — without ever conflating it with a REAL different suffix like `.01`. `BUILD` bumped to `2026-09-24-project-number-suffix-match`, MCP `version` to `1.19.2`. New test file `projectNumberSuffix.test.mjs` (16 assertions). | [#303](https://github.com/smartias/setty-pms/pull/303) | **Merged to main (2db06c2). NOT deployed to Supabase Edge Functions — nothing has shipped this to the live connector yet.** |

**This is the one thing that actually matters for the next session: run the
deploy.** Everything below is context.

## How the bug was found and confirmed (live, against the deployed connector)

Sara reported the connector "missing the SharePoint folder" and "missing
photos uploaded from the Photos app" for project **SAPX266021.00** (St.
Nicholas of Tolentine Feasibility Study). Reproduced directly with the live
`PMS_Connector` MCP tools (not guessed from code reading):

- `list_project_documents(projectNumber: "SAPX266021.00")` → `count: 0`,
  "Nothing for this project in SharePoint yet." But `folderMatch: "Tolentine"`
  found the folder immediately — it's real, and holds a `Photos` subfolder at
  **546,401,101 bytes**. Its actual name is
  `SAPX266021 - St. Nicholas of Tolentine Feasibility Study` — **no `.00`** —
  while the PMS record's canonical `projectNumber` is `SAPX266021.00`. The
  lookup did a plain `startsWith(fullProjectNumber)`, which can never match.
- `search_field_photos(project: "SAPX266021.00")` → `count: 0`. But a
  no-filter call showed 5 real sessions (146 photos, 2026-07-07) whose stored
  `project_number` is `"SAPX266021"` — again no `.00` — so the substring
  filter against the full query missed them too.

Same root cause, two symptoms. Fix and tests are in PR #303 (see its
description for the full diff and reasoning).

## Also checked: Baltimore (BT) — NOT affected by this bug

BT has exactly one active project, `SIPX251008.00` (Tivoly EcoVillage
MGrid). Checked live:

- Its region row is configured `azure_files` (BT reads from the `SAOP`
  network-drive share, not SharePoint-by-folder-name), so it never goes
  through the code this PR touched. `list_project_documents` found its drive
  folder correctly.
- Its PMS-record `projectFolderUrl` (the SharePoint folder the PMS app
  creates on every project regardless of region) already carries the full
  `.00` suffix, so even the SharePoint path likely wouldn't have hit this
  specific bug anyway.
- `search_field_photos` returned 0 for it too, but that's not a bug — its
  drive `05-SIPX251008.00_PHOTOS/01-Pictures` folder is genuinely empty
  (checked directly).

## Known, separate, NOT fixed by this PR

`search_field_photos` only ever finds photos uploaded through the Field
Photos app to SharePoint (mirrored into `pms_field_photo_sessions`). It has
no visibility into photos saved straight onto a region's network drive —
this is BT and DC's normal filing path. Already documented in
`supabase/functions/pms-mcp/ROADMAP-drives.md` under "Not done yet" item 1,
unchanged by this session. Worth doing if BT/DC photos start landing on the
drive instead of through the app, but it's a separate, larger piece of work
(teaching `search_field_photos`, or `view_photos`, to also walk `az:` drive
folders) — not started.

## How to pick this up on the other account

1. **Deploy `pms-mcp`.** Needs a Supabase personal access token
   (supabase.com → Account → Access Tokens) and a machine with the Supabase
   CLI reachable — this cloud session could not do it: its Supabase MCP
   connector doesn't reach the live project (`khxmgjilwhdguuepbhne`), and its
   network egress to `*.supabase.co` is blocked by sandbox policy (proxy
   returns `403` on connect). From the repo root on a machine that can reach
   Supabase:
   ```powershell
   git checkout main; git pull origin main
   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."
   npx supabase functions deploy pms-mcp --project-ref khxmgjilwhdguuepbhne --no-verify-jwt
   ```
   or run `supabase/functions/pms-mcp/deploy.ps1`, which does the same plus
   polls `/health` until it answers. **`DEPLOY-NEXT.md` in this folder was
   stale (described an already-shipped Sep-15 deploy) and has been rewritten
   to describe this deploy instead — read it for the short version.**
2. **Verify:** `curl .../pms-mcp/health` should answer
   `{"ok":true,"build":"2026-09-24-project-number-suffix-match"}`. Then
   re-run `list_project_documents` and `search_field_photos` on
   `SAPX266021.00` and confirm the folder and its 5 photo sessions now show
   up.
3. **Reconnect any open Claude PMS session** after deploying — clients cache
   the tool list at connect time; a session started before the deploy won't
   see behavior changes without reconnecting (the tool *list* itself didn't
   change here, but do this out of habit — it's cheap and the repo's own
   README calls it out after every deploy).
4. Nothing else is pending from this thread: no open PRs, no scratch
   branches worth keeping.

## Checklist

- [x] Root cause found and reproduced live against the deployed connector
      (SAPX266021.00: SharePoint folder + 5 field-photo sessions missing)
- [x] Fix written (`numberPrefixMatches`), 16 new unit tests, full suite
      green (75/75 connector, 15/15 repo root)
- [x] PR #303 opened, no blocking review findings, merged to main
- [x] Checked BT (`SIPX251008.00`) — confirmed not affected by this bug
- [x] `DEPLOY-NEXT.md` rewritten to describe this pending deploy
- [ ] **Deploy `pms-mcp` to Supabase Edge Functions** — blocked on an access
      token + a machine with real network access to Supabase
- [ ] Post-deploy verification against the live connector
- [ ] (Separate, larger, not started) teach `search_field_photos` /
      `view_photos` to see drive-only photos for DC/BT

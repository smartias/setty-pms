# Regional drives: where the work stands, and what is left

Written 15 Sep 2026, brought current 17 Sep, so the thread can be picked up
from any session or account. Everything below is verifiable in the repo, the
live Supabase project (`khxmgjilwhdguuepbhne`), or the PRs named. The
connector's wider capability plan (QA review schedule, CA feedback loop,
skill library) is `ROADMAP.md` beside this file; this one is only the
network-drive thread.

## The situation

Setty runs hybrid. New York (and Baltimore) keep the project record in a
SharePoint site; Washington DC still works from mapped network drives. IT
(Nikhil) syncs each office drive into an Azure Files share. The Claude
connector (`pms-mcp`) reads both: SharePoint through Microsoft Graph, drives
through the Azure Files REST API with a read-only SAS per share.

Configuration lives in two tables, managed on the Admin console's Regions
tab (`SettyAdmin.html`):

- `pms_regions` — one row per PMS **team code** (NY, DC, BT): the SharePoint
  site, document library, and `storage_kind` (`sharepoint` or `azure_files`).
  (The single-share columns it once carried were dropped in 1.18.1.)
- `pms_region_shares` — one row per drive a region's projects live on:
  `label` (I, W, N, SAOP), `share_url`, `sas_env` (the NAME of the Edge
  Function secret holding that share's SAS). Saves go through
  `pms_region_save()` in one transaction.

Live rows as of 17 Sep 2026 (shares confirmed in `pms_region_shares`; the
single-share columns on `pms_regions` are gone):

| Team | Storage | Drives (label → share) | Secret |
|---|---|---|---|
| NY | SharePoint + annex | N → `newyorkstorage` root (SAP, SAIG, SAG entity folders, then year) | `AZURE_SAS_NY` |
| BT | SharePoint + annex | SAOP → `saoperation` | `AZURE_SAS_BT` |
| DC | Azure only | I → `ffxfileshare/SAi_Projects`; W → `ffxfileshare/SA_Private_Projects` | `AZURE_SAS_I`, `AZURE_SAS_W` |

The ffxfilestorage token expires **31 March 2028**. The filestoragesetty
token's expiry was not recorded here; check it and put both on a calendar.
Both storage accounts accept traffic from outside the corporate network
(confirmed by Nikhil, 14 Sep).

## Delivered (all merged to main)

| PR | What | Connector |
|---|---|---|
| #225–#229 (6 Sep) | Multi-region routing, storage-kind seam ("slice A"), Regions tab | 1.7.x |
| #260 | Regions tab validation + Delete; **slice B**: Azure Files browse/read provider (`azureFiles.ts`), `az:` ids, visibility gate on every drive path | 1.14.0 |
| #261 | `pms_region_shares`: a region carries N drives; ids become `az:<TEAM>.<LABEL>:<path>` | 1.15.0 |
| #262 | Regions tab: atomic save (`pms_region_save`), no silent empty share list; **drive layouts**: year folders (DC), entity + year (NY N: drive), DC's `NN-<number>_NAME` subfolders resolve by standard name | 1.15.1 |
| #263 | README deploy command; "What works where" matrix on the Regions tab | — |
| #264 | **Drive-based drawing index**: `search_drawings` indexes a drive project's Outgoing; `view_drawing`, `read_drawing_schedule`, `find_equipment`, `trace_references` work off it; `extract_sheet_index` and `get_current_set` compose the set from the index when there is no register | 1.16.0 |
| #265 | **Transmittal register-only mode** for drive projects (`transmittal.html` v19); Codex fixes on #264 | 1.16.1 |
| #265/#266 | **Drive discovery queue**: Admin console "Drive discovery" tab scans a share through the connector (`POST /admin/discover-projects`), lists project folders with no PMS record in `pms_project_candidates`, and creates the record (or dismisses the folder) on review. Names come from the `00-<number> <NAME>` folder; existing PMS names are never changed | 1.17.0 |
| #267/#268 | **Region filter** in the PMS app (list, Pipeline, Dashboard; `pms_projects_slim` carries `team`); discovery records the closest PMS record for near-miss numbers and offers **Link to it** | 1.17.1 |
| #268 | **`find_document` on a drive**: `projectTree()` walks the project folder on the share; ranking, phase filter and supersession status unchanged | 1.17.2 |
| #268 | **RFIs and submittals on a drive**: `read_rfi_submittal` returns the item's folder and files under `CA/8. RFIs` or `9. Submittals` (discipline folders in between), `search_rfis_submittals` lists CA item folders with no log entry (`driveOnly`); works on drive-only and drive-annex regions. `resolveChildFolder` contains-match is word-bounded ("CA" no longer finds "Load Forecasting") | 1.18.0 |
| #269 | **Legacy single-share columns dropped** from `pms_regions`; `pms_region_save` and the Regions tab use `pms_region_shares` only. Migration `20260915130000` applied live 16 Sep, after the connector no longer selected them | 1.18.1 |
| #278 | `view_drawing` **renders again**: `@hyzyla/pdfium` page objects are single-use and the package is pinned at 2.1.9; `GET /health?probe=render` proves the render path. Affects every drive-indexed sheet as much as SharePoint ones | 1.18.2 |
| #280 | `search_review_feedback` reads `pms_ca_review_feedback` (reviewer outcomes on Claude's CA suggestions). The submittal-rfi-review skill now treats **a set that exists only on N: as combined volumes** as a filing gap with the fix stated: save to SharePoint, split into sheet PDFs | 1.19.0 |
| #281 | Admin console v26: skill library sync card (which repo skills must be uploaded to the claude.ai library) | — |
| this PR | **Region site access**: a Graph 403/404 while resolving a region's site is rethrown as a `RegionAccessError` naming the site, the per-site `Sites.Selected` grant and the Regions-tab alternative; `list_project_documents` still returns `driveAnnex.folders` and flags a `projectFolderUrl` on another site; `GET /health?probe=regions` checks every region's site | 1.19.1 |
| `tools/newforma-import` | Newforma submittal / RFI log refresh into the PMS CA log (16 Sep export). Gives drive-era jobs their CA records, which is what the drive CA folder walk matches against | — |
| next | **Transmittal tool, register-only mode** (`transmittal.html` v19): a drive project's set is read off the mapped drive through the OS picker (names + title blocks), nothing is uploaded, the register row carries `files.driveFolder` instead of `sp_folder_url`; attachment is the only email delivery; `get_current_set` surfaces `driveFolder` | 1.16.1 |

Verified end to end on 14 Sep: `list_project_documents` on SIPX262012.00
(DC) found the project under `I:\2026`, resolved "Outgoing" to
`99-SIPX262012.00_OUTGOING`, and browsed the 20 project folders.

Team explainers published as Claude artifacts (private links held by Sara):
"Where Project Files Live" (all offices) and "New York Project Files" (NY:
SharePoint is the record, N: is a read-only annex). The same capability
matrix is on the Regions tab. Live connector as of 17 Sep: build
`2026-09-16-review-feedback`, 1.19.0, 44 tools.

## How it works, in one screen

- **Ids.** SharePoint files are `driveId|itemId` (unguessable). Drive files
  are `az:<TEAM>.<LABEL>:<path relative to the share prefix>` — a typed path,
  so `azurePathProject()` gates every use: the first non-grouping segment must
  be a registered project's folder (longest project-number prefix), on that
  team, and `projectRefVisible` for the caller. The share root and grouping
  folders (year, entity) are never listed for a caller.
- **Finding a project folder** (`azureProjectFolder`): share root → year
  folder read off digits 5–6 of the number → other year folders → entity
  folders ranked by prefix match with the guessed year → the best entity's
  other years. Bounded, every listing cached 300 s.
- **Subfolder names** (`resolveChildFolder`): exact → plain name behind the
  DC prefix → alias group (Emails↔INCOMING, QA/QC↔QA-QC, CA↔Construction
  Administration) → unique word-bounded contains.
- **CA on a drive** (`azureCaItems`): `CA` → folders ending in "RFIs" /
  "Submittals" (plus a bare legacy "RFI") → discipline folders (E, FA, FP, M,
  P, Misc; skipped when absent) → one folder per item, matched to the PMS
  record by number or spec section in the folder name.
- **Bytes** (`loadPdfBytes`): one loader for both storages, HEAD-then-GET on
  a share, size-capped, cached by id.
- **Drawing index on a drive**: `azureDrawingScope` walks the resolved Outgoing
  folder into `TreeFile` rows (`folderPath` relative to the project folder, so
  `drawingSetOf` still finds the set folder); the existing builder writes
  `pms_drawing_text` / `pms_drawing_index_files` with `az:` ids and the UNC
  path in `web_url`. `indexDerivedSet()` composes "every sheet at its newest
  indexed revision" for the two register-based tools.

## Not done yet, in the order I would do it

0. **Verify the CA folder matching on a real job.** `azureCaItems` and
   `folderMentionsNumber` were built from Sara's description and the
   `SAPX236006.00` CA tree, whose RFI and submittal folders held only the
   templates. Run `read_rfi_submittal` on a DC or NY job with filed
   submittals under `9. Submittals/<disc>/` and confirm `driveFiled` comes
   back; adjust the number matching if item folders are named differently.
1. **Photos.** `view_photos` could read image bytes from a drive by `az:` id;
   `search_field_photos` cannot (sessions are app uploads to SharePoint).
2. **Writes to drives** (transmittal staging, QA report filing, QAQC folders):
   a policy decision first (write-capable SAS widens what a leaked secret can
   do), then Azure Files `PUT`/create-directory in `azureFiles.ts`.
3. **Baltimore**: the first BT project got tagged before this was done.
   Tivoly EcoVillage MGrid (SIPX251008.00, created 17 Sep from SAOP drive
   discovery) routes to the BT row's site, and the connector gets
   `Graph 403 accessDenied` on `/sites/<BT site>/drives`: the app's
   `Sites.Selected` grant covers NYCProjects, not the Baltimore site. Its PMS
   record's `projectFolderUrl` is on NYCProjects anyway (the PMS app creates
   every folder on its hardcoded drive). Two ways out, either one unblocks
   every tool on BT: (a) IT grants the "Setty PMS - Claude Connector" app
   read on the Baltimore site, then confirm it has a Project Document
   Library and move/create the folder there; or (b) point region BT at
   NYCProjects in Admin → Regions until Baltimore's site is ready (no grant
   needed). `GET /pms-mcp/health?probe=regions` (1.19.1) shows the live
   answer per region. The SAOP annex was never the problem: the SharePoint
   call failed first and hid it; since 1.19.1 `list_project_documents`
   returns `driveAnnex.folders` alongside the access error.

## Known limits worth remembering

- A drive file's identity is its path: rename an Outgoing subfolder and its
  index rows are orphaned until `search_drawings indexOnly:true` rebuilds.
- No change feed on a share; the index refreshes on demand.
- One SAS sees everything on the share; the connector alone enforces project
  visibility. Never weaken `azurePathProject`.
- `deno check` on `index.ts` reports 9 pre-existing implicit-any errors in
  untouched code (sheet-reference helpers, folder provisioning). Deploys do
  not type-check; `node --test` is the gate that matters.
- `@hyzyla/pdfium` page objects are single-use and the package is pinned
  (1.18.2). A render failure in production shows up in the function logs
  and on `GET /pms-mcp/health?probe=render`.
- Deploy from a checkout that has pulled `main`: a deploy from a stale
  clone shipped the previous build once (15 Sep) with no error.

## Deploying and testing

See README → Deploying (repo root, no `--import-map`). After a deploy,
`/health` must show the new BUILD; then start a fresh Claude conversation so
the tool descriptions refresh. Smoke test on DC:

1. `list_project_documents` for SIPX262012.00 → project folder under 2026.
2. `search_drawings` with `indexOnly: true` until `coverage.filesPending` is 0.
3. `extract_sheet_index` (no subfolder) → sheets grouped by discipline,
   `basis` naming the drawing index.
4. `view_drawing` for one sheet → an image (or `GET /health?probe=render`
   to check the render path without a project).
5. `read_rfi_submittal` on a job with filed submittals → `driveFiled` with
   the item's folder and files.

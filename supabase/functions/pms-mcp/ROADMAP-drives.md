# Regional drives: where the work stands, and what is left

Written 15 Sep 2026 so the thread can be picked up from any session or
account. Everything below is verifiable in the repo, the live Supabase
project (`khxmgjilwhdguuepbhne`), or the PRs named.

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
- `pms_region_shares` — one row per drive a region's projects live on:
  `label` (I, W, N, SAOP), `share_url`, `sas_env` (the NAME of the Edge
  Function secret holding that share's SAS). Saves go through
  `pms_region_save()` in one transaction.

Live rows as of 15 Sep 2026:

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
| this PR | **Drive discovery queue**: Admin console "Drive discovery" tab scans a share through the connector (`POST /admin/discover-projects`), lists project folders with no PMS record in `pms_project_candidates`, and creates the record (or dismisses the folder) on review. Names come from the `00-<number> <NAME>` folder; existing PMS names are never changed | 1.17.0 |
| next | **Transmittal tool, register-only mode** (`transmittal.html` v19): a drive project's set is read off the mapped drive through the OS picker (names + title blocks), nothing is uploaded, the register row carries `files.driveFolder` instead of `sp_folder_url`; attachment is the only email delivery; `get_current_set` surfaces `driveFolder` | 1.16.1 |

Verified end to end on 14 Sep: `list_project_documents` on SIPX262012.00
(DC) found the project under `I:\2026`, resolved "Outgoing" to
`99-SIPX262012.00_OUTGOING`, and browsed the 20 project folders.

A team explainer, "Where Project Files Live", is published as a Claude
artifact (private link held by Sara); the same capability matrix is on the
Regions tab.

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
  DC prefix → alias group (Emails↔INCOMING, QA/QC↔QA-QC) → unique contains.
- **Bytes** (`loadPdfBytes`): one loader for both storages, HEAD-then-GET on
  a share, size-capped, cached by id.
- **Drawing index on a drive**: `azureDrawingScope` walks the resolved Outgoing
  folder into `TreeFile` rows (`folderPath` relative to the project folder, so
  `drawingSetOf` still finds the set folder); the existing builder writes
  `pms_drawing_text` / `pms_drawing_index_files` with `az:` ids and the UNC
  path in `web_url`. `indexDerivedSet()` composes "every sheet at its newest
  indexed revision" for the two register-based tools.

## Not done yet, in the order I would do it

1. **Region filter in the PMS app** (`SettyPMS.html`). Projects now carry a
   `team` code, but only the Admin console reads it: the app's project list,
   Pipeline view and Dashboard filter on PM / QA-QC / status / contract only,
   and `loadProjects` does not select `team`. Add a Region dropdown (NY / DC /
   BT / untagged, options from `pms_regions`) to the shared filter bar next
   to the status filter, apply it in the same `useMemo` that drives the list
   and Pipeline, and scope the Dashboard's cards and workload to the chosen
   region. Remember the choice per browser (`localStorage`) so a DC PM opens
   to DC. Once the discovery queue (item 1) starts registering DC and NY
   projects the unfiltered views get noisy, so do this before or with it.
2. **RFIs and submittals on a drive.** `search_rfis_submittals` /
   `read_rfi_submittal` read the PMS ledger and SharePoint; on the drives the
   record is the CA folder. Layout (Sara, 15 Sep, NY N: drive; DC matches):
   `70-<number>_CA` → numbered subfolders (`1. CA Admin`, `2. Record (Bid)
   Docs`, `3. Construction Schedule`, `4. Submittal Schedule`, `5. OAC Mtg
   Minutes`, `6. Site Visit Reports`, `7. DWG Updates`, `8. RFIs`,
   `9. Submittals`, `10. Post Design Changes`, `11. CA Project Closeout`,
   `12. CA POST Construction Follow-up`; older projects also have a bare
   `RFI` folder) → inside `8. RFIs` and `9. Submittals` a folder per
   discipline (`E`, `FA`, `FP`, `M`, `P`, `Misc`) → a folder per submittal
   or RFI. A drive branch would resolve `CA` by standard name (the
   `NN-<number>_` prefix is already stripped), walk `9. Submittals/<disc>`
   and `8. RFIs/<disc>`, and list each item folder as one submittal/RFI with
   its files by `az:` id; `read_document` already opens them. Pairing with
   the PMS ledger stays by number in the folder name.
3. **`find_document` on a drive.** SharePoint's search index has no drive
   equivalent; the replacement is a walk of the project tree ranking file
   names against the description (`scoreDocument` is already pure and
   reusable). `projectTree()` needs a drive branch like `subtreeFiles` got.
4. **Photos.** `view_photos` could read image bytes from a drive by `az:` id;
   `search_field_photos` cannot (sessions are app uploads to SharePoint).
5. **Drop the legacy single-share columns** on `pms_regions`
   (`azure_share_url`, `azure_sas_env`) once every environment runs ≥ 1.15.0.
   The console still writes the first share into them for compatibility.
6. **Writes to drives** (transmittal staging, QA report filing, QAQC folders):
   a policy decision first (write-capable SAS widens what a leaked secret can
   do), then Azure Files `PUT`/create-directory in `azureFiles.ts`.
7. **Baltimore**: confirm the BaltimoreTeam site has a Project Document
   Library before the first project is tagged BT.

## Known limits worth remembering

- A drive file's identity is its path: rename an Outgoing subfolder and its
  index rows are orphaned until `search_drawings indexOnly:true` rebuilds.
- No change feed on a share; the index refreshes on demand.
- One SAS sees everything on the share; the connector alone enforces project
  visibility. Never weaken `azurePathProject`.
- `deno check` on `index.ts` reports 9 pre-existing implicit-any errors in
  untouched code (sheet-reference helpers, folder provisioning). Deploys do
  not type-check; `node --test` is the gate that matters.

## Deploying and testing

See README → Deploying (repo root, no `--import-map`). After a deploy,
`/health` must show the new BUILD; then start a fresh Claude conversation so
the tool descriptions refresh. Smoke test on DC:

1. `list_project_documents` for SIPX262012.00 → project folder under 2026.
2. `search_drawings` with `indexOnly: true` until `coverage.filesPending` is 0.
3. `extract_sheet_index` (no subfolder) → sheets grouped by discipline,
   `basis` naming the drawing index.
4. `view_drawing` for one sheet → an image.

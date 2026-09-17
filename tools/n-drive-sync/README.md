# N: drive → SharePoint Outgoing sync

Phase one of the storage policy's enforcement agent. A scheduled PowerShell
script that finds files recently saved under a project's **Outgoing** folder
on the office network drive and copies them into the same project's Outgoing
folder in the region's SharePoint site when they are not there yet.

Scope is deliberate: Outgoing only, recent files only, one region at a time.
Phase two (report-only: flag anything new on the drive, and superseded sets
still on SharePoint) reuses the same walk and ledger and is not written yet.

**Status: not yet run against the live tenant.** The pure parts (folder
discovery, recency window, name checks, copy/replace/conflict decisions) have
unit checks in `Test-SyncFunctions.ps1`. The Graph calls follow the same
patterns the connector and the Field Photos app already use, but the first
`-Commit` run should be watched.

## What it does

For every project folder under the configured roots
(`N:\SAP\2025\SAPQ256919.01`, `N:\SAIG\...`, `N:\SAG\...`):

1. Finds the drive's Outgoing subfolder: name **contains** "outgoing",
   case-insensitive, the same rule the connector uses (folder names carry
   numbering and emoji prefixes).
2. Collects files last written inside the recency window. Lock and temp
   files are skipped (`~$*`, `*.tmp`, `Thumbs.db`, ...).
3. Resolves the project in SharePoint: the library root folder whose name
   **starts with** the project number (again the connector's rule), or a
   `projectOverrides` entry. Then its Outgoing subfolder, created as
   `Outgoing` when missing.
4. Decides per file, by relative path under Outgoing:
   | Situation | Action |
   |---|---|
   | Not in SharePoint | `copy` |
   | Same name, same byte size | `skip-exists` |
   | Same name, different size, SharePoint copy not newer | `replace` (SharePoint keeps the prior version) |
   | Same name, different size, SharePoint copy modified later than the drive copy | `conflict-sharepoint-newer`, left for a person |
   | Name SharePoint would reject | `invalid-name`, left for a person |
   | Over `maxFileBytes` | `skip-too-large` |
5. Uploads with the drive's created and modified times carried across
   (`fileSystemInfo`), so this copy does not flatten dates the way the bulk
   migration did. Files over 4 MB go through an upload session in 10 MiB
   chunks.
6. Appends every decision to `ledger.csv`, writes a Markdown run report, and
   records the run in `state.json`.

**Dry run is the default.** Without `-Commit` nothing is written to
SharePoint; uploads are logged as `would-copy` / `would-replace`.

### Why size, not dates

The bulk migration stamped every SharePoint file with the migration date, so
SharePoint's modified time says when a file moved, not when it changed.
Comparing dates would flag every migrated file as stale. Relative path plus
byte size is the equality test; the SharePoint date is consulted only to
avoid overwriting a file someone edited in SharePoint after the migration.

### The recency window

`sinceDays` (default 7) is the window on a first run. After a successful
`-Commit` run the next run resumes from the last success minus
`overlapHours`, so a file saved while the previous run was in progress is
not missed, and a gap between runs is caught up automatically. A stale state
file cannot trigger a full re-crawl: the window is floored at `sinceDays × 4`.
`-SinceDays N` overrides all of that for a one-off backfill.

## Setup

Runs on a Windows host with the drive mapped, under a service account, with
PowerShell 7 (`pwsh`).

1. **App registration** in Entra ID, client-credentials flow. Least
   privilege is `Sites.Selected` with write access granted to the region's
   site; `Sites.ReadWrite.All` also works. The connector's existing
   registration is read-only and should not be reused.
2. Store the client secret in an environment variable for the service
   account (name it in `clientSecretEnv`). The secret never goes in the
   config file.
3. Copy `config.example.json` to `config.json` beside the script and fill in
   `tenantId`, `clientId`, `siteUrl`, `docLibrary`, and `sources`.
   `config.json` is git-ignored.
4. Run the unit checks, then a dry run on one project:
   ```powershell
   pwsh -File .\Test-SyncFunctions.ps1
   pwsh -File .\Sync-OutgoingToSharePoint.ps1 -Project SAPQ256919.01 -SinceDays 30
   ```
   Read the report under `<stateDir>\reports\`. The **Needs a person** table
   lists projects with no SharePoint folder, conflicts, and rejected names.
5. Dry-run the whole region, then commit one project, then schedule:
   ```powershell
   pwsh -File .\Sync-OutgoingToSharePoint.ps1
   pwsh -File .\Sync-OutgoingToSharePoint.ps1 -Project SAPQ256919.01 -Commit
   ```
   ```cmd
   schtasks /Create /TN "SettyPMS N-drive Outgoing sync" /SC HOURLY ^
     /RU "DOMAIN\svc-pmssync" /RP * ^
     /TR "pwsh -NoProfile -ExecutionPolicy Bypass -File C:\SettyPMS\n-drive-sync\Sync-OutgoingToSharePoint.ps1 -Commit"
   ```

## Parameters

| Parameter | Meaning |
|---|---|
| `-ConfigPath` | JSON config; defaults to `config.json` beside the script |
| `-Commit` | Actually upload. Default is dry run |
| `-SinceDays N` | Override the window; ignores saved state |
| `-Project A,B` | Only these project numbers (prefix match) |
| `-MaxFiles N` | Cap uploads this run (config `maxFilesPerRun`, default 500); the rest are logged `deferred-cap` |
| `-NoState` | Do not read or write `state.json` |

Exit code 2 when any file errored; the ledger has the message.

## Outputs (under `stateDir`)

- `ledger.csv`: one row per decision, every run, append-only.
  Columns: RunId, Timestamp, Project, Action, Source, Target, Bytes, Detail.
- `reports\<runId>.md`: per-run summary with a **Needs a person** table.
- `state.json`: last run, last successful commit run, counts.

## Relationship to the connector

Folder rules match `supabase/functions/pms-mcp/index.ts` so a file this
script places is where `get_current_set`, `search_drawings` and
`find_document` expect it. The connector reads the drive shares through
Azure Files (`azureFiles.ts`) but never writes to them; this script never
reads SharePoint content, only listings. Neither touches the transmittal
register.

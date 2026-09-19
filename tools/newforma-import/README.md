# Newforma submittal / RFI log refresh

Refreshes the PMS CA log (`pms_projects.project.submittals` and `.rfis`) from a Newforma
**Multi-Project Report** export (`NewformaReport_YYYY_MM_DD_….xlsx`): the Submittal Log by
default, the RFI Log with `--type rfi`. Used for the 2026-06-23 and 2026-09-16 imports.

## What it does

- Parses the export: one header row per submittal, followed by its workflow rows
  (Received / Forwarded / Review Response / Closed) and attachment rows.
- Maps each submittal onto the PMS record shape the app and the connector expect
  (same mapping as the June import, so refreshed and new records look identical):
  - `status`: Newforma *Closed* → `Returned` (`Void` when the last action is "Closed - Void");
    *Pending/Expected* → `Pending Sub Review`; *Open* with a review response → `Returned`,
    forwarded → `Under Review`, otherwise `Received`.
  - `stamp`: from the latest Review Response action — Accepted as Noted / Reviewed as Noted /
    Furnish as Corrected / Make Correction Noted → `Approved as Noted`; Revise and Resubmit /
    Reviewed and Resubmit / Partial Resubmittal → `Revise and Resubmit`; Accepted / No Exceptions
    Taken / Reviewed → `Approved`; Rejected → `Rejected`; anything else → `—`.
  - `comments`: the Review Response remarks (all of them, dated, when there is more than one).
  - `dateReturned`: the latest Review Response date, else the Closed date.
  - `discipline`: single discipline as-is (HVAC → Mechanical); several → `Multi-Discipline`;
    Miscellaneous / blank → `Other`.
  - `resubNumber`: the revision segment of the Newforma id (`233113-001-2` → 2).
  - `notes`: `Imported from Newforma` + Newforma status, last action, review action, related
    items, reviewers and the source file name.
  - **RFI log** (`--type rfi`): `title` = Subject, `description` = Question, `response` = Answer
    (Newforma's `_x000D_` CR markers stripped), `dateResponded` = Response Date;
    `status`: Closed → `Closed` (`Void` on "Closed - Void"), Pending → `Pending Sub Response`,
    open with an answer → `Responded`, otherwise `Open`. Disciplines map onto the RFI list
    (several → `Multi-Discipline`, anything else → `Other`).
- Matches against what is already logged, per project:
  - by **item number**, normalised (trailing spaces/periods dropped, numeric segments compared
    as numbers, so `232113-012-1`, `232113-12-01` and `232113-012-1.` are one item);
  - Forma-synced records (`source: forma`, numbered `SUB-098`) by **Forma number + revision**
    read from the Newforma id (`233423-098-3` ↔ `SUB-098` rev 3);
  - RFIs logged by hand or by the Kahua sync (`RFI-026`, `CI00026`) by their number against a
    bare Newforma `026` — fill mode only, and never a record whose notes begin "testing";
  - never across report projects: a June-import id names the report project it came from
    (`nf-rfi-SAPX226021.00-019`), so two Newforma projects routed onto one PMS project (CSI
    Elevator + CSI Elevator MEP) keep their own `019`.
- Writes, per project, one version-guarded UPDATE:
  - existing **Newforma-origin** records (`id` `nf-sub-…` or `source: newforma`) are refreshed —
    Newforma is the system of record for them; `comments` only when Newforma has some, `notes`
    only if still the untouched import block;
  - existing **hand-logged / Forma-synced** records, and any record a person has edited in the
    PMS (`syncEditedBy` / `sheetRefs` present), only get blank fields filled;
  - everything else is appended. Nothing is deleted; `assignedTo`, `links`, `aiReview`,
    `spFolderUrl` are never touched.

Project routing is explicit (`targets.json`) because the export's numbers do not always match the
PMS: `SAPQ236917.0x` → `SAPX236917.0x`, Dutchess `SAPX17602x.00` → the `.01` CA project,
`SAPX216022.00` → `SAPX21602.00`, `SAPX236021.00` → `SAPX23602.00`. Projects not listed in
`targets.json` are skipped and reported.

## Running it

1. Snapshot what is logged (one row per project) — run in the SQL editor and save as `existing.json`:

   ```sql
   select project->>'projectNumber' as p, string_agg(concat_ws('|', s->>'id', s->>'number', coalesce(s->>'source',''),
     left(coalesce(s->>'notes',''),22),
     (case when coalesce(s->>'description','')='' then 'D' else '' end) || (case when coalesce(s->>'specSection','')='' then 'S' else '' end) ||
     (case when coalesce(s->>'from','')='' then 'F' else '' end) || (case when coalesce(s->>'discipline','')='' then 'I' else '' end) ||
     (case when coalesce(s->>'status','')='' then 'T' else '' end) || (case when coalesce(s->>'stamp','')='' or s->>'stamp'='—' then 'M' else '' end) ||
     (case when coalesce(s->>'dateReceived','')='' then 'R' else '' end) || (case when coalesce(s->>'dueDate','')='' then 'U' else '' end) ||
     (case when coalesce(s->>'dateReturned','')='' then 'E' else '' end) || (case when coalesce(s->>'comments','')='' then 'C' else '' end) ||
     (case when coalesce(s->>'notes','')='' then 'N' else '' end)), E'\n' order by ord) as rows
   from pms_projects, jsonb_array_elements(coalesce(project->'submittals','[]'::jsonb)) with ordinality t(s, ord)
   group by 1;
   ```
   Shape: `{ "<pms project number>": [ {"id","number","source","notes22","blank", "ext"?, "rev"?}, … ] }`
   (`ext`/`rev` are the Forma number and revision, needed only for `source: forma` rows).
   For the RFI log take the same snapshot over `project->'rfis'` with the RFI flag letters
   (`L` title, `D` description, `F` from, `I` discipline, `T` status, `R` dateReceived, `U` dueDate,
   `E` dateResponded, `C` response, `N` notes, `H` human-edited = `syncEditedBy` set or `sheetRefs` present)
   and `ext` = `extNumber` for Kahua rows.

2. `targets.json`: `{ "<report project number>": {"id": "<pms row id>", "projectNumber": "<pms number>"} }`.

3. Dry run — writes `plan/<project>.sql` (the exact UPDATE), `plan/<project>.json` and `plan/summary.json`:

   ```
   pip install openpyxl
   python3 import_newforma_submittals.py NewformaReport_….xlsx --targets targets.json --existing existing.json --out plan
   python3 import_newforma_submittals.py NewformaReport_….xlsx --type rfi --targets targets.json --existing existing_rfis.json --out plan_rfi
   ```

4. Apply — either run the `.sql` files, or let the script do it with a fresh version read per project:

   ```
   SUPABASE_ACCESS_TOKEN=… python3 import_newforma_submittals.py … --apply-mgmt <project ref>
   SUPABASE_URL=… SUPABASE_SERVICE_KEY=… python3 import_newforma_submittals.py … --apply
   ```

Re-running with the same export is idempotent apart from the version bump.

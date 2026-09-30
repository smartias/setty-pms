# Onboarding runbook: staff, roles, other offices' projects, new regions

Everything here runs in the Admin console (admin role required) and previews
before it writes. The writes are three admin-only RPCs in
`supabase/migrations/20260930140000_bulk_onboarding_and_renumber.sql`; the
parsing and typo matching are in `onboarding.js` (tests:
`node --test onboarding.test.mjs`).

Suggested order for an office: region → scan → register projects → staff →
check in Claude → roll out the Outlook add-in. The **Regions** tab has a
checklist card ("Onboard a new region") that tracks these steps live for any
region.

## 1. A new region

Regions tab → **Onboard a new region**. Add the region first if it isn't
listed yet (＋ Add the region first), then pick it.

1. **Region saved and enabled.** Team code (what goes in a project's Team
   field), name, storage. Every office but NY is *Network drive is the
   record*.
2. **Drive shares listed.** One row per drive the office's project folders
   live on: label (what people call it), the Azure share URL of the folder
   that holds the project folders, and the SAS secret name.
3. **Drive credential works.** In the Supabase dashboard → Edge Functions →
   Secrets, add one read + list SAS per share under exactly the secret name
   from step 2 (value = the token's query string, one line). Click **Check
   drives**: each share should say "✓ lists". This is the check to run when
   someone says the drive "isn't showing up in PMS". A missing or mistyped
   secret name shows here. The check needs connector build
   `2026-09-30-onboarding-linked-folders` or later.
4. **Drives scanned.** Drive discovery tab, see section 2.
5. **Projects registered.** Section 3.
6. **People set up.** Section 5.
7. **Check it in Claude.** In a fresh Claude conversation, run
   `list_project_documents` on a new number (it should return the drive
   tree with `az:` ids), then `search_drawings` on one with an Outgoing
   folder. Call it again until `filesPending` is 0 if you want it fully
   indexed before people start asking.

## 2. Scan the drives

Drive discovery tab, top card, one row per region and drive.

- **From year** skips year folders before that year (root and entity folders
  are always read). Use the oldest year on the project list, e.g. 2020.
- **Scan** loops up to 8 passes of 120 listings. "more to read" means click
  Scan again. "⚠ N folder(s) could not be listed" is a transient share error:
  hover for which ones, scan again later.
- The scan only finds folders whose names start with a project number.
- NY: SharePoint is the record and N: is an annex. Most NY folders already
  have a record; use section 4 to match them rather than creating new ones.

## 3. Register projects from a list (only the jobs on it)

Drive discovery → **📋 Register projects from a list**. Paste the rows from
Excel: project number, status, and optionally a name column. With or without
a header row.

- The console maps the sheet's status words onto PMS statuses ("Active" →
  In Progress, "CA" → In Construction Administration, "Closed" → Completed,
  …) and asks about any word it doesn't recognise.
- **Preview** shows, per number:
  - **create**: a scanned folder with no PMS record. It will be created with
    the folder's `00-` name (or the sheet's name column), the sheet's status,
    and the region of the drive it was found on.
  - **already registered**: left as it is (the PMS name and status win); its
    drive folder is marked as belonging to it.
  - **no folder**: no scan found it. Either scan that drive, or the sheet
    has a typo: the console offers close numbers from the scans ("did you
    mean …?"), and one click swaps it in.
  - **likely existing**: the folder is probably an existing record under a
    longer number. Use Link to it on the candidate row.
  - **needs name**: the folder had no `00-` name and the sheet has no name
    column. Add one and paste again.
- **Create N project record(s)** writes them. Only numbers on the list are
  touched; everything else stays in the review list.

Records created this way carry no PM, fee, milestone or contact data; those
come later from the WBS or the PMs.

## 4. Typos and remapping (NY especially)

Each "To review" candidate row now has **Link…** plus chips for close
numbers already in the PMS (one or two characters different, including
swapped digits). Pipeline jobs with no number yet are never offered.

Pick the record, and if the numbers differ the console asks which one is
right:

- **The record is right: link the folder, keep the PMS number.** Use this
  when the folder name has the typo. The folder is marked as that record's,
  and the connector finds it through that link even though its name doesn't
  match (needs the connector deploy below).
- **The folder is right: change the record's number.** Use this when the PMS
  record has the typo. It opens a preview of the renumber (below).

**✏️ Fix a record's project number** (same tab) does the renumber on its own,
for records with no candidate row. The preview lists every table that stores
the number and how many rows change: RFIs, submittals, their events,
meetings, meeting items, lessons, QA findings/reviews, CA review feedback,
per-project permissions, disciplines, scope AI, SETTYfy maps, the Newforma
map, field photo sessions, the photo catalog, and the drawing index. Emails
and the filing log key by the record id, so they need nothing. Accounting's AR
invoice import and telemetry are left alone.

It refuses a number that already belongs to another record (link to that
one instead) and a record with no number (a pipeline job: set it in the
PMS app).

After a renumber:
- It bumps the record's `version`, so anyone with that project open in the
  PMS must refresh or they'll hit a save conflict.
- It does not rename folders. If the preview warns that the SharePoint
  folder is still named with the old number, rename the folder in SharePoint
  (NY). Drive folders linked through discovery are still found.

## 5. Staff and roles in bulk

Users & Roles → **📋 Bulk add staff from a spreadsheet**. Paste the
employee list from Excel with its header row.

- Columns are found by header: email, first/last or full name, role or
  category, title, office, department. If the email column has an odd
  header, type its letter (Nikhil's list: **K**).
- **Office if the sheet has none**: the team to use when the sheet has no
  office column (e.g. BT for a Baltimore-only list).
- The sheet's categories map onto the 9 PMS roles (Project Manager/Director
  → project manager, Engineer/Designer/BIM → engineer, QA/QC → qaqc,
  Accounting, Contracts, Marketing, Operations/Office Manager/IT →
  operations). Anything unrecognised is listed with a role picker. **Admin
  is never guessed.**
- **Preview**, then **Add them**. For each person:
  - no `pms_user_roles` row → added with the mapped role and office (and the
    weekly digest if ticked);
  - existing row → **role and team are never changed**; a blank name or team
    is filled in, and any difference ("role kept as operations (sheet says
    staff)") is listed so you can change it on their row by hand;
  - staff directory (the PMS's Staff list) → matched by email, else by name
    where the entry has no email (it gets the email filled in), else a new
    entry with title and disciplines. Nothing is deleted or deactivated.
- After saving: **✉ Send welcome emails to the N new people**. SharePoint
  access (📁 SP access) is still per person and only matters for NY.
- The staff directory is saved by the PMS as one list: run this when nobody
  is editing the Staff page, and ask people with the PMS open to refresh.

Everyone with a role sees every project in every office unless the project
is marked 🔒 Confidential. Someone signed in with no row gets the `staff`
baseline.

## Outlook add-in

Deploy it to everyone once their account exists (section 5). For a
registered project it shows in the add-in's "suggested project" card. Confirm
files the email to that project's log.

## Deploy checklist for this change

1. Merge the PR (Vercel deploys the console from `main`).
2. Apply the migration `20260930140000_bulk_onboarding_and_renumber.sql`
   (Supabase connector `apply_migration`, or the SQL editor). Until then the
   Preview buttons fail with "function … does not exist".
3. Deploy the connector (`supabase/functions/pms-mcp/deploy.ps1`). `/health`
   should show build `2026-09-30-onboarding-linked-folders`. This ships
   the linked-folder lookup and the drive check in `?probe=regions`.

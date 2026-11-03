# Proposal: run RFIs and submittals through the client portal when Setty is prime

Status: PROPOSED 2026-11-03. Companion to
`supabase/functions/pms-mcp/PROPOSAL-portal-email-intake.md`, which covers
jobs where someone else's portal (Procore, Autodesk Forma, Newforma, PMWeb)
emails us the items. This one covers the jobs where Setty is the prime and
there is no portal at all: the contractor emails PDFs, and someone types
each one in. The goal is to get as close to Procore's submittal and RFI
process as the tools we already run allow, without buying or hosting
anything new.

## The ask, in one paragraph

On a prime job the contractor needs a place to submit an RFI or a
submittal, a number back, a due date, a response with a stamp, and a log
they can look at. Procore gives them all of that in one site. The PMS
already holds the Setty half: the log, the statuses, the stamps, the Claude
review, the overdue report, and (since 2026-11-02) an intake pipeline that
creates items with an **Unreviewed** flag until a person confirms them.
Each project also already has two portal folders in NYSharesite with
exactly the right permission model: the client writes to Uploads and reads
Deliverables. This proposal adds the contractor-facing half on top of those
folders: a submit convention, an intake sweep, numbering and
acknowledgement, a return path, and a generated log. It also names the
sign-in fixes the portal needs first, because the contractor's project
manager becomes the portal's main user and today's guest sign-in failures
would sink the pilot.

## Where it applies now

Prime CA projects in the PMS as of 2026-11-03 (NY team; the DC and BT lists
mostly have no prime recorded):

| Project | Number | Note |
| --- | --- | --- |
| County of Dutchess 10 Market Street CA | SAPX176021.01 | Site Meetings milestone through Jan 2027 |
| County of Dutchess 22 Market Street CA | SAPX176022.01 | Site Meetings milestone through Feb 2027 |
| Q119 Reso A Computer Lab | SAPQ236917.02 | SCA |
| Q126 Reso A Science Lab | SAPQ236917.01 | SCA |

The two Dutchess jobs are the natural pilot: one client, one contractor
each, active site meetings, and no outside portal.

## What exists today

- **The log.** RFIs and submittals live on the project record and are
  projected into `pms_ca_items` by trigger. Statuses, stamps (`SUB_STAMPS`
  in `caIntake.js`), due dates, discipline and assignee, the overdue report
  by PM, and the weekly digest all read from there.
- **Intake with a human gate.** The connector route
  `POST /pms-mcp/admin/ca-items-intake` (`caIntakeRun.ts`) creates items
  with `intakeReviewed: false`. The PMS shows them with an **Unreviewed**
  badge and a **Confirm** button that sets discipline and assignee
  (`isUnreviewedIntake`, SettyPMS.html). Unconfirmed items are kept out of
  overdue counts and reminders. This proposal adds a third source to that
  pipeline; it does not build a new one.
- **The Claude review.** `submittal-rfi-review` reads the cut sheet,
  checks the marked selection against the spec, and writes a suggested
  response and stamp back onto the item for accept or dismiss.
- **Portal folders.** `createClientPortalFolders` makes
  `<number>/<name> Uploads` (client can edit) and `<number>/<name>
  Deliverables` (client can view) in NYSharesite, plants `.url` shortcuts
  in the project folder, and `PortalSharingModal` grants both to a named
  person via Graph `/invite`. `ensureSpSubfolder` creates subfolders
  safely.
- **"Issued via Client Portal".** Milestone deliverables already record a
  `deliveryMode` of `portal` on their send-email rows, and the milestone
  chip reads "Issued … via Client Portal". The return path below reuses
  that pattern.
- **The connector's cross-site crawl** (`crossSiteDeliverables`,
  index.ts) already follows the Deliverables shortcut into NYSharesite for
  drawing indexing. It deliberately does not follow Uploads. The intake
  sweep below is the one place that would, limited to two subfolders.

## What Procore does that we would be copying

| Procore | Here, after this proposal |
| --- | --- |
| Contractor fills a form (subject, question, spec section, due date, attachments) | Contractor drops a filled form plus attachments into a folder (step 1) |
| Numbering by the system | Numbering by the PMS on Confirm (step 3) |
| Ball in court, notifications | Acknowledgement and response emails from the PM's mailbox (steps 3 and 4) |
| Reviewer responds with a stamp | Existing modal plus **Return via portal** (step 4) |
| Everyone sees the log | Generated RFI Log and Submittal Log workbooks in Deliverables (step 5) |
| Threaded comments, live status, in-browser validation | Not replicated. See "What this will not do". |

## Step 0. Make the portal sign-in reliable (before anything else)

The CHCR Grove case on 2026-11-03 showed the failure that would hit every
contractor: Microsoft's "account does not exist in tenant" page
(AADSTS90072 / 50020). PR #403 fixed the wording the app sends. The rest:

1. **IT confirms "SharePoint and OneDrive integration with Microsoft Entra
   B2B" is on.** Microsoft's troubleshooting page for this error says that
   with it off, shares made from SharePoint do not create a guest record,
   so plain folder links always fail for new guests. Not verifiable from
   the app; one question to IT.
2. **Resend invitation** button per person in `PortalSharingModal`. Calling
   `/invite` again is a no-op for permissions and makes Microsoft send a
   fresh invitation email. Half a day.
3. **Guest status per person** (Pending acceptance, Accepted, No guest
   record), read by the connector with an application permission
   (`User.Read.All`, an IT grant) and shown in the modal. When a share
   fails, the same route can read the Entra audit "status reason" that the
   app cannot see today (`AuditLog.Read.All`). About two days plus the
   grant.
4. **Warn on consumer email domains** (gmail, yahoo, hotmail, outlook) in
   the modal and suggest the person's work address. Work accounts sign in
   cleanly; personal Microsoft accounts are where the mismatches live.
   Half a day.
5. **Add a contact from inside the modal**, since today only directory
   contacts can be invited. Half a day.

Items 2, 4 and 5 are one PMS PR. Item 3 is a connector PR after IT grants
the permission. Item 1 is a question, not code.

## Step 1. The submit convention (one PMS PR)

When portal folders are created on a project whose prime is Setty, or on
demand from the Overview tab, also create under Uploads:

```
<name> Uploads/
  RFIs/
    _READ ME - how to submit an RFI.txt
    RFI form.xlsx
  Submittals/
    _READ ME - how to submit a submittal.txt
    Submittal transmittal form.xlsx
```

Both forms are one-sheet workbooks with named cells (subject, spec
section, question or description, contractor's own number, date needed,
cost or schedule impact yes/no, attachment list). The contractor fills the
form, saves it beside its attachments, and that is the submission. A
workbook was chosen over a PDF form because named cells read back reliably
through Graph's workbook API; PDF form fields are a fallback if a
contractor cannot use Excel.

File naming asked for in the readme, loosely enforced:
`<contractor number> - <subject>.xlsx` with attachments in a folder of the
same name. The intake does not depend on the name; it depends on the form.

Contractors who sync the folder to File Explorer get drag-and-drop
submission. The readme explains the sync button and the sign-in rules from
PR #403.

## Step 2. Intake sweep (one connector PR, one cron line)

A connector admin route, `POST /pms-mcp/admin/portal-ca-intake`, on the
same 15-minute pg_cron schedule and `x-pms-cron` secret as
`documents-sync` and `ca-items-intake`:

1. For each active project whose `clientUploadsFolderUrl` is set and whose
   prime is Setty (a project field; fall back to a per-project opt-in flag
   so a PM can turn it on for any job), resolve the Uploads folder through
   the Graph shares API, the way `crossSiteDeliverables` resolves the
   Deliverables shortcut.
2. List `RFIs/` and `Submittals/` (not the rest of Uploads). Any `.xlsx`
   not already seen is a candidate. Seen is by driveItem id, kept in the
   same state table the other sweeps use, so a re-upload of the same file
   is not a second item and a renamed file is.
3. Read the named cells with the workbook API. A form with no subject is
   logged as "incomplete" and skipped with a reason; nothing is guessed.
4. Create the item through `updateProjectRecord` with `source: "portal"`,
   `intakeReviewed: false`, the contractor's number in `externalNumbers`,
   the file and folder links, and the discipline inferred the way the
   tracker does it (spec division, then keywords). Append-only.
5. Report counts. Dry run until `PORTAL_CA_INTAKE_LIVE=1`, like the email
   intake.

Deno cannot import the repo-root `caIntake.js` at deploy, so the form
reader joins the connector's copy with the same drift test that guards
`sheetRefs.js`.

## Step 3. Numbering and acknowledgement (one PMS PR)

On **Confirm** of a portal item the PMS, not the contractor, assigns the
number: the next RFI number for the project, or the spec-section-based
submittal id the log already uses (`110000-001`, revision from a
resubmittal). Then:

- Move the form and its attachments into a numbered folder,
  `RFIs/RFI-012 - <subject>/`, so the contractor sees the number
  acknowledged in the folder they use. The move is a Graph PATCH of
  `parentReference`; the sweep's seen-list is by id, so it does not
  re-import.
- Open a draft email to the contractor contact from the PM's mailbox,
  prefilled: received, number, due date, link to the numbered folder. Same
  mechanism as the modal's 📧 button (`/me/messages` draft, opened in
  Outlook Web), so a person always sees it before it goes out.
- Set the due date from the form's "date needed" when it is at least the
  contract's review period away; otherwise from the review period, with
  the contractor's date kept in the notes.

The contractor's own number stays in `externalNumbers` so either number
finds the item.

## Step 4. Return via portal (one PMS PR)

A **Return via portal** button in the RFI and submittal modal, enabled when
the project has a Deliverables folder:

1. Builds the response document from the existing letterhead template
   (`get_letterhead_template` in the connector; the RFI response and the
   stamped submittal transmittal are two short templates) with the response
   text, stamp, reviewer and date already on the item. For a submittal,
   attaches the stamped cut sheet when the reviewer has saved one on the
   item.
2. Writes it to `<name> Deliverables/RFI Responses/RFI-012 - <subject>/`
   or `.../Submittal Returns/<id>/` with `ensureSpSubfolder` and the
   existing upload path. Never overwrites: a second return of the same item
   gets a `-r2` suffix.
3. Records a `send-email` row with `deliveryMode: "portal"` on the item, so
   the modal and the log show "Returned via Client Portal on <date>" the
   way milestone chips do.
4. Opens the draft email to the contractor with the link, as in step 3.
5. Sets the item status (Responded, or Returned with the stamp) only when
   the person sends; the draft window reports back the same way the
   milestone send does.

The contractor already has read access to Deliverables, so nothing is
shared per item.

## Step 5. The contractor's log view (one connector change)

After any change to a portal project's items, the connector regenerates
two workbooks in Deliverables: `RFI Log.xlsx` and `Submittal Log.xlsx`
(number, subject, received, due, status, stamp, returned on, link to the
return folder). Generated from `pms_ca_items`, overwritten in place, with
the generation time in the sheet header. This is Procore's list page for a
contractor who only has a folder. It rides the same 15-minute sweep as
step 2, writing only when the project's items changed since the last
write.

## What this will not do

- **No in-browser form with validation.** A contractor can leave a cell
  blank; the intake skips it with a reason and the readme says why.
- **No threaded comments or live status.** The log workbook is minutes
  behind, not live, and a question about an item goes by email.
- **No contractor-side numbering.** If a contractor insists on their own
  numbering, it is kept as the external number, not the PMS number.

If the pilot shows contractors asking for the form and the live list, the
next step up is a SharePoint List in NYSharesite as the register: guests
can add items through the list's own form, the connector can read and
write it through the Graph Lists API, and SharePoint provides versions,
attachments and alerts. It is closer to Procore but needs a list per
project (or one list with item-level permissions, which is messier for
guests) and a second sweep. It is deliberately not in this proposal.

## Pre-check before any of it

Two questions, no code:

1. How many RFIs and submittals did the two Dutchess jobs and the two Reso
   A jobs receive in the last six months, and by what route (emailed PDF,
   paper at the site meeting)? Count from the project email logs with
   `search_emails` and from the CA log. If the total is under a dozen, the
   pilot measures nothing and this waits for a bigger prime job.
2. Has the contractor on each pilot job got a Microsoft work account? If
   they only have a personal address, step 0 item 1 must be confirmed
   first.

## How we know it worked

Measured for eight weeks after step 4 ships on the pilot jobs:

| Measure | Target |
| --- | --- |
| Items submitted through the folders rather than by email | 80% or more |
| Submissions the sweep skipped as incomplete | under 10%, falling after the first month |
| Minutes to confirm, number and acknowledge an item | under two |
| Returns delivered via portal with the status set correctly | 95% or more |
| Contractor sign-in problems after step 0 | none that need IT |

Pass: all five, and the contractor says it is usable without prompting.
Fail on the first: the folder is not where contractors go, and the List
option moves up. Fail on the second: fix the form before widening.

## Risks and what limits them

- **The contractor cannot sign in.** Step 0 comes first and is the pilot's
  gate. The modal's new guest-status column tells us before the first RFI
  whether the person has redeemed their invitation.
- **A form is filled wrong or not at all.** Nothing is created from a form
  without a subject; the readme and the Confirm step catch the rest. A
  mis-read form becomes a wrong item only if a person confirms it.
- **The sweep reads the client's whole Uploads folder.** It does not: two
  named subfolders only, and only `.xlsx` files in them. Attachments are
  linked, not read.
- **Two sources for one item.** A contractor who both uploads and emails
  the same RFI produces one portal item and one filed email. The email
  intake is Procore-only today, so no twin is created by a sweep; a person
  adding one by hand sees the portal item in the list first.
- **A move or rename in SharePoint by the contractor** after numbering.
  Links are by item id, so they survive a rename; a move out of the
  numbered folder is reported in the next sweep as "file left its folder"
  and nothing else changes.
- **Version conflicts** on the project record. Every write goes through
  the version-guarded save; a conflict aborts and retries on the next
  sweep.

## Out of scope

- Change orders, meeting minutes and field reports. The folders can hold
  them, but no intake or return is built for them here.
- Replacing the email intake for jobs with an outside portal; that
  proposal stands on its own.
- Any change to the Claude review.
- Hosting a web form or app for contractors.

## Sequence and cost

| Step | Depends on | Effort | Ships as |
| --- | --- | --- | --- |
| 0. Sign-in fixes | IT answer on B2B integration | about three days plus one grant | one PMS PR, one connector PR |
| Pre-check | nothing | one hour | two numbers in this file |
| 1. Submit convention and forms | step 0 | one day | one PMS PR |
| 2. Intake sweep | step 1 | two to three days | one connector PR, deploy, one cron line |
| 3. Numbering and acknowledgement | step 2 | one to two days | one PMS PR |
| 4. Return via portal | step 3 | two to three days | one PMS PR (templates from the connector) |
| 5. Generated logs | step 2 | one day | one connector change |

The estimates assume the workbook API reads named cells from a guest's
upload without a licensing surprise (it should; the file is in our
tenant) and that the pilot contractors use Excel. The List alternative is
not estimated.

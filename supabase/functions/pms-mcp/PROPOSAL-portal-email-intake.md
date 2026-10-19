# Proposal: log RFIs and submittals from portal emails automatically

Status: PROPOSED (2026-10-19). Nothing built. Written for the decision to move
RFI and submittal processing from Newforma into the PMS: if the volume goes up
five to six times, typing each item in by hand is the step that breaks first.

## The ask, in one paragraph

Contractors and architects send every new RFI and submittal as a notification
email from their portal (Procore, Autodesk Forma, Newforma Info Exchange,
DASNY PMWeb). Those emails carry the number, the subject, the due date, who
sent it and, for RFIs, the question. The PMS already has a page that reads
those emails and imports the items, but someone has to open the page, pick
the project, tick the rows and press Import. This proposal makes that step
run on its own every 15 minutes, fixes the three portal formats the parser
misses today, and leaves one thing for a person: confirming the discipline
and assignee on each new item. Measured over four weeks, the pass rule is
that nine out of ten portal items appear in the PMS within one business day
without anyone typing them.

## What exists today (and why this is a small step, not a new system)

`RFISubmittalSync_Preview.html` ("RFI / Submittal Tracker", linked from the
PMS and the Admin Console; `RFISubmittalSync_README.md`) already does the
hard part:

- Reads `pms_project_emails` for portal notifications (sender or subject
  pattern), parses them per vendor (`parseProcore`, `parseForma`,
  `parseNewformaFwdRfi`, `parseNewformaFwdSub`), collapses the events for one
  item (new, response, closed, revision) into one row, and matches it against
  the logged items: **NEW**, **matched**, or **UPDATE** (a newer revision).
- Infers the discipline from the spec division or keywords, lets the person
  override it per row, and imports the ticked rows append-only through the
  same version-guarded save the PMS uses, with a 60-second undo.
- Stores slim records: metadata plus `sourceEmailId` and the folder link, not
  the email body.

Its guide says of portal items: "Coming soon: these sync in on their own."
That is this proposal.

Its one dependency is also this proposal's: it only sees emails that were
**filed into the PMS** with the Outlook add-in. An item nobody filed is
invisible to it.

## What the portal emails actually look like

Read from the filed log on 2026-10-19 (`search_emails`, `read_email`).

| Portal (sender) | Subject shape | Structured fields in the body | Parser today |
| --- | --- | --- | --- |
| Procore, Gilbane (`…@procoretech.com`) | `Action Required: J10313.000, Brooklyn Public Library New Lots Library: New RFI #RFI-91, Condensate lines in cellar` | `RFI RFI-91: <subject>`, `Due Date:`, `Asked by:`, `Question:`, `Date Initiated:`, `Subject:`, `Cost Impact:`, `Distribution List:`, "View in Procore" | **Misses it.** The regex expects `New RFI #91`; Procore now writes `#RFI-91`, so this email parses to nothing |
| Newforma Info Exchange, forwarded by the architect (Page/Stantec on Tabler) | `RFI Forwarded: Refrigeration Liquid Line Insulation (R&S-RFI#6) - Stony Brook University, Tabler Quad New... - RFI:RFI-074:SM1mU` | `Project:`, `Question:`, `To:`, `From:`, `Purpose: To Answer`, `Due back: 1/7/2026`, `Sender ID: RFI-074`, `RFI ID:`, `Expiration Date:`, `Transferred Files` (PDF names) | Subject only: number and title. Due date, question, sender and files are left blank although the body carries them |
| Newforma Project Center, Setty's own CA coordinators | `Submittal Forwarded: SAPX176006.00_DASNY CUNY Queens COLL Labs - Closeout Submittal - Submittal:017800-001-0:u5vTT` | `Project:`, `Purpose: For Review`, `Due back: 3/31/2026`, `Sender ID: 017800-001-0`, `Transferred Files` | Subject only, same gap. Also sees `Submittal Responded to and Closed:` subjects, which should close an item, not create one |
| Autodesk Forma (`no-reply@mail.forma.autodesk.com`) | `Submittal #56 …`, "new revision" | `Item Details`: `Spec Section`, `Status`, `Due Date`, `Ball in court` | Parsed |
| DASNY PMWeb | `DASNY PMWeb - <project> - Change Requests - 002 - …`; `PMWeb Branch: Submittal Sets 056 - 357820 - CSI-Student Ctr Dining Hall - Wiring Devices` | Not yet read in full; a sample is needed before the parser is written | Not parsed |

Two things in those samples matter for matching:

- **One item, three numbers.** On Tabler the contractor calls it `R&S-RFI#6`,
  the architect's Newforma calls it `RFI-074`, and the Procore original has
  its own number ("Received 2 files from Procore"). The log must keep every
  external number it has seen for an item, not one.
- **The same item can arrive twice**, once from Procore and once forwarded
  through Newforma. The second must attach to the first, not create a twin.

## The proposal, in three steps

### Step 1. One parser module, tested on real emails (about two days)

Move the four parsers out of the page into `caIntake.js` (shared by the
tracker and the connector, like `sheetRefs.js`), and:

- Fix Procore for the `#RFI-91` subject and read its body labels (due date,
  asked by, question, date initiated, cost and schedule impact flags).
- Read the Newforma body labels (`Due back`, `Sender ID`, `Purpose`, the
  question block, the transferred file names) instead of the subject alone.
  Treat `Responded to and Closed` and `Reviewer Response` subjects as status
  events on an existing item.
- Add PMWeb once a full sample has been read.
- Return, for every email, `{vendor, kind, externalNumbers[], subject,
  question, from, dateReceived, dueDate, specSection, revision, event,
  files[]}` or null, and nothing else: no project lookup, no write.
- Tests: a fixture file of real notification emails with names and bodies
  trimmed, one per portal and per event. The Procore miss above is the first
  test case, since it is a bug in production today.

### Step 2. The sync runs on its own (about two days, after step 1)

A connector admin route, `POST /pms-mcp/admin/ca-items-intake`, on the same
15-minute pg_cron schedule and `x-pms-cron` secret as `documents-sync`:

1. Read `pms_project_emails` rows newer than the last run whose sender or
   subject matches a portal pattern (the same filter the tracker uses).
2. Parse each with `caIntake`. Skip anything that returns null.
3. Match against `pms_ca_items` (the indexed table, so this is one query,
   not a blob scan): by any external number on the project first, then by
   the Newforma spec-based id prefix, then by subject when the number is
   unknown. A match with a status or revision event updates the item's
   status, revision and links. No match creates the item.
4. Write through `updateProjectRecord`, the connector's existing
   version-guarded path, with `source: 'intake'`, `sourceEmailId`,
   `externalNumbers`, and `intakeReviewed: false`. Append-only, idempotent
   by (project, vendor, external number), exactly like the page's import.
5. Report counts in the response and log anything skipped with a reason.

In the PMS, an item with `intakeReviewed: false` shows an **Unreviewed**
badge on the RFI and Submittal tabs with one button, "Confirm", that sets the
discipline and assignee (prefilled from the inference) and clears the flag.
Until confirmed, the item is excluded from the overdue counts, the follow-up
reminders and the weekly digest, so an intake mistake never pages anyone.
Nothing about the Claude review changes: it runs on confirmed items as
today.

The tracker page keeps its manual import for the cases the sync cannot
reach (an emailed PDF, a phoned-in RFI).

### Step 3. A mailbox the portals write to directly (only if step 2 shows a gap)

Step 2 still depends on someone filing the notification with the add-in.
The firm already has a shared CA mailbox, `SettyCA@setty.com`, that the
Newforma forwards and most CA correspondence are copied to. If the four-week
measurement shows items arriving in portals that never reach the filed log,
the next step is to read that one mailbox with Microsoft Graph from the
connector (which already uses Graph application permissions for SharePoint):

- IT grants `Mail.Read` restricted to the SettyCA mailbox by an application
  access policy, nothing wider.
- Each portal notification is copied to SettyCA by a mailbox rule or by
  adding the address to the portal's distribution list.
- The sync reads new messages there, files them into `pms_project_emails`
  (so they also appear in the project's email log), and continues as step 2.

This is deliberately last: it needs IT and an Entra permission grant, and it
may not be needed if filing discipline plus step 2 reaches the target.

## Pre-check before any of it (one query, ten minutes)

How many portal notifications already sit in the filed log, per portal and
per month, and how many of those items are in the CA log? Run in the
Supabase SQL editor:

```sql
select date_trunc('month', email_date) as month,
       case when from_address ilike '%procoretech%' then 'Procore'
            when from_address ilike '%forma.autodesk%' then 'Forma'
            when subject ilike 'RFI Forwarded:%' or subject ilike 'Submittal Forwarded:%' then 'Newforma'
            when subject ilike '%PMWeb%' then 'PMWeb' else 'other' end as portal,
       count(*) as emails, count(distinct project_id) as projects
from public.pms_project_emails
where email_date > now() - interval '6 months'
  and (from_address ilike '%procoretech%' or from_address ilike '%forma.autodesk%'
       or subject ilike 'RFI Forwarded:%' or subject ilike 'Submittal Forwarded:%'
       or subject ilike '%PMWeb%')
group by 1, 2 order by 1 desc, 2;
```

If the count is small, filing is the bottleneck and step 3 moves up. If it
is large, steps 1 and 2 pay for themselves immediately.

## How we know it worked

Measured for four weeks after step 2 ships, from the sync's own counts and
the CA log:

| Measure | Target |
| --- | --- |
| Portal items that appear in the PMS within one business day, without typing | 90% or more |
| Items the sync created that a person then voided as not an RFI or submittal | under 2% |
| Duplicate items created for one real item | zero after the first week |
| Minutes per item to confirm (discipline, assignee) | under one |

Pass: all four. Fail on the first: step 3. Fail on the second or third: fix
the parser or matching before widening anything. The numbers go into this
file with the decision.

## Risks and what limits them

- **Wrong project.** Filed emails already carry the project, so step 2
  cannot mis-file. Step 3 would have to resolve the project from the subject
  (the portals print the project number or name); an unresolved one goes to
  a holding list, never a guess.
- **Duplicates across portals.** Matching on every known external number
  plus the Newforma spec-id prefix covers the Tabler case. New patterns get a
  fixture and a test, not a special case in the page.
- **Status changes nobody asked for.** Only explicit portal events change a
  status (closed, responded, new revision). A forward or reminder never does.
- **Volume.** The sync reads a few hundred emails a day at most and writes a
  handful of slim records; the blob grows by kilobytes per item. Nothing in
  the database or the 2-second CPU budget is near a limit.
- **A portal changes its email format.** The sync logs every email it could
  not parse with a reason, and the weekly count of unparsed portal emails is
  the alarm.

## Out of scope

- Replying to the portal from the PMS. The response path stays as it is.
- Importing the historical Newforma logs for projects not yet moved. That is
  the existing export-and-import pass, run per project.
- Any change to the Claude review or the scoring experiment running this week.

## Sequence and cost

| Step | Depends on | Effort | Ships as |
| --- | --- | --- | --- |
| 0. Pre-check query | nothing | 10 minutes | a number in this file |
| 1. Parser module + fixtures | step 0 | about two days | one PR, no deploy |
| 2. Sync route + Unreviewed badge | step 1 | about two days | one connector PR + one PMS PR, deploy, one cron line |
| 3. SettyCA mailbox via Graph | step 2's measurement, IT | about two days plus the permission grant | one connector PR |

The estimates assume the formats above hold; PMWeb is the unknown until a
full sample is read.

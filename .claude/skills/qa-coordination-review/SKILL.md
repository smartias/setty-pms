---
name: qa-coordination-review
description: >
  Run an internal QA review of a project's drawing set using the Setty PMS
  connector (setty-pms), in four passes: the firm's QA Deliverables Checklist
  item by item (with a cross-discipline pass against the architectural,
  structural and life safety drawings), the knowledge layer (project lessons, best practices, agency
  preferences, engineering standards), a general engineering sanity review,
  and a punch list for the team grouped by discipline. QA is PROACTIVE: it is
  for DESIGN-phase sets, through bid, with the goal of removing the causes of
  RFIs and change orders before the set goes out. Use whenever someone asks
  for a QA review, internal coordination review, deliverable review, drawing
  review, or back-check of a design submission or bid set — "run QA on the
  Tabler set", "review the DD submission before it goes out", "coordination
  review for the 100% CD", "check the addendum before it issues". Not for
  construction: an RFI, a submittal, or the bulletin that answers one is
  reviewed with the submittal-rfi-review skill. Produces a punch list
  and findings report with sheet-level evidence for a human sign-off, then
  records the findings in that project's QA ledger (the QA Reviews tab) and
  files the report. It never marks checklist items complete, never closes an
  external comment, never saves findings to the knowledge layer, and never
  issues or touches Outgoing.
---

# QA Coordination Review

You are performing Setty's internal QA review of an MEPFP drawing set. The
deliverable is a **punch list the team works from**, backed by a findings
report a human reviewer signs off on.

## What QA is for — and where it stops

QA is **proactive**. Its purpose is to reduce or eliminate RFIs and change
orders by catching their causes while the set can still be changed for free:
in design, a few days before each submission, and through bid (the bid set
and its addenda). Everything in this skill serves that.

After bid it is too late to be proactive. An RFI or a submittal is
**reactive**: something has already gone to a contractor, and the question
is how to answer it. That work belongs to construction administration and
the `submittal-rfi-review` skill, not here.

So:

- **Do** review SD, DD, CD, permit and bid sets, and bid addenda before they
  issue.
- **Do not** run this review on a construction bulletin, an RFI response
  set, or "the current set" of a project in construction. If asked to, say
  that QA is for design-phase sets, name the last design or bid set on the
  project, and offer either to review that set (as a look-back) or to hand
  the bulletin to `submittal-rfi-review` with the RFI that caused it. Go
  ahead with a look-back only when the user confirms that is what they want,
  and label the report as a look-back, not a pre-issue review.
- **Never record a flag from an RFI or submittal review as a QA finding.**
- The record of what contractors asked on past jobs IS useful here, as
  input: the checklist's "RFI Prevention" items (qa-600 series) were written
  from real RFI logs. That is how the reactive record makes the next job's
  QA more proactive.

## Run order — follow it top to bottom

Every review runs these steps in this order. Each step has its own section
below with the detail.

| # | Step | Output |
|---|---|---|
| 0 | **Setup**: lifecycle moment, prime vs sub, the set, the phase, index coverage | Report header |
| 1 | **Carry-over**: prior reviewer comments and open ledger findings, back-checked against this set | Carry-over section |
| 2 | **Backgrounds inventory**: what other disciplines' drawings we hold, and how current | Backgrounds section |
| 3 | **Pass 1 — Checklist**: every checklist item gets a disposition | Checklist coverage table |
| 3b | **Cross-discipline pass**: MEPFP against architecture, structure, the life safety plan and the non-MEP specs, area by area | Coverage plan and cross-discipline table |
| 3c | **Bidder's eye pass** (CD, permit, bid and addendum sets): read the set as someone who has to price it | Checklist coverage table |
| 4 | **Pass 2 — Knowledge layer**: lessons, best practices, agency preferences, engineering standards applied to this set | Knowledge section |
| 5 | **Pass 3 — Engineering review**: does the design make engineering sense | Engineering flags |
| 6 | **Punch list and report** | The deliverable |
| 7 | **Record and file**: ledger rows, report in SharePoint | Ledger ids, folder link |

A resubmission or a bid addendum — a set that CHANGES an earlier one —
adds the **change record and ripple analysis** (its own section) inside
Pass 1.

If you run short of budget, do NOT silently drop a step: finish the steps
in order as far as you can, and say in the report header exactly where you
stopped and what was not done.

## Rules that govern everything

1. **Evidence, not verdicts.** Every finding cites sheets, revisions, and the
   text or image that supports it. Every clean check states what was actually
   examined. You never mark a checklist item "passed" on the team's behalf —
   the report is input to their sign-off, and the wording of findings is
   "flag", "verify", "appears", never "violation" or "error" unless the
   evidence is mechanical (a duplicate sheet number is a fact; a clearance
   problem is a flag).
2. **Say what you could not check.** The review is only as good as the index
   coverage and the text layer. Report coverage numbers, textless sheets, and
   every checklist item you did not attempt — a review that looks complete
   but silently skipped half the set is worse than no review.
3. **What this review may write, and nothing else.** The review itself only
   reads. It writes in exactly two places, both at the end (Step 7): the QA
   findings ledger (`record_qa_findings`, and `update_qa_finding` for
   back-check status moves) and the filed report (`file_qa_report`). It
   never marks checklist items complete, never closes an EXTERNAL comment
   (those stop at `ready_to_backcheck` for a human), never writes to
   Outgoing or the transmittal register, and never issues or sends anything.
4. **Findings stay with the project.** What this review finds belongs in
   THIS project's QA ledger (the QA Reviews tab) and nowhere else. The
   knowledge layer is READ in Pass 2 and never written: do not call
   `save_knowledge` with a finding, a punch-list item, or a "lesson" drawn
   from this review, project-scoped or firm-wide, and do not offer to. If
   the user, unprompted, asks for something to be saved as a lesson, that is
   a separate request outside this skill.

## Step 0 — Setup

### Where in the lifecycle — say it, and let it shape the review

QA is not one event. Identify which moment this review serves and state it
in the report header:

1. **Internal QA (1–2 weeks BEFORE official issuance).** The set under
   review is NOT in the transmittal register yet, and it does NOT belong in
   Outgoing — Outgoing is reserved for what actually went out (per Sara).
   Convention: a top-level **QAQC** folder in the project library with dated
   subfolders ("<QAQC folder>/YYYY-MM-DD_<phase> QAQC"), named via the tab's
   set picker or by the user; pass that path as `subfolder` (the crawler
   resolves explicit subfolders from the project root, and a QAQC path can
   never be mistaken for an issued set). The path must be spelled EXACTLY
   as the folder is named — the provisioned folder is "09 ✅ QAQC", not
   "QAQC" — so use the path the tab's prompt gives you, or read the real
   names with `list_project_documents` before passing one. Every finding here is
   FIX-BEFORE-ISSUE: severity leans practical (what would embarrass us,
   draw agency comments, or come back as an RFI or a change order). Use
   severity `cost` for anything a contractor would price or dispute, and
   `rfi-bait` for anything a bidder would have to ask about. This is the
   highest-leverage review — run every pass in full.
2. **Pre-issuance coordination comments.** Comments from the architect or
   other disciplines on the QAQC set ingest as `kind:'comment-log'`
   (`source:'architect'`/`'other'`) and are worked BEFORE issuance — the
   goal is that the official set goes out with those rows closed.
3. **Design-review comments: agency / AHJ / owner.** These arrive after a
   design submission (SD, DD, CD), ingest as comment-logs with their source,
   carry priority over internal findings, and follow the human-close rule.
   They are back-checked against the NEXT design submission, so the set
   that goes to bid has them closed.
4. **Bid.** The bid set and each addendum before it issues. Bidders'
   questions answered by addendum are the last free chance to fix a cause;
   an addendum is reviewed like a resubmission (change record and ripple).

If the project is already in construction, see "What QA is for" above:
this review does not apply to what is issued from here on.

### Prime vs sub: establish Setty's role FIRST

Establish the contractual role with `get_project` (the prime/client field;
a job contracted directly with the owner agency with subconsultants under
Setty is a PRIME job — SUNY Upstate TX-1 Fan is the model case). When
unsure, ask the user; the two modes review different things.

**Setty is a SUB (default mode):** MEPFP is the scope. Other disciplines'
sheets are backgrounds to coordinate against; their comments ingest only
when MEPFP-impacting, titled "For reference: ...".

**Setty is PRIME — the scope model inverts.** Setty is responsible for
EVERYTHING and for coordinating everyone, so:

- **Every discipline's sheets are in scope**, not backgrounds. A missing
  or stale subconsultant deliverable is a FINDING (severity by
  consequence), never a "backgrounds not reachable" note.
- **Include the prime-coordination checklist items** (qa-500 series —
  `details.primeOnly: true` in get_qa_checklist): cover-index vs delivered
  set per discipline, cross-firm title-block consistency, every discipline
  picking up each addendum, comment routing, package completeness
  (spec TOC vs sections shipped, narratives, owner forms). On sub jobs
  DROP these items.
- **The for-reference rule is OFF.** Every external comment — architectural,
  civil, all of it — ingests as a full row with the responsible
  discipline/subconsultant named in the action, and is tracked to closure.
  The owner holds Setty accountable for all of them.
- **Run ripple analysis across ALL disciplines**, not MEPFP-only: an
  architectural change that should have moved a structural sheet is
  Setty's coordination gap on a prime job.
- **Severity leans harder on coordination gaps** — an uncoordinated
  change between two subs is Setty's professional exposure, not somebody
  else's problem.

### The set, the phase, the coverage

1. **Resolve the project and the set under review.** `get_current_set` gives
   the current issued set. During design that is the last submission; at bid
   it is the bid set plus the addenda issued so far. On a project in
   construction it also folds in bulletins, which are NOT a QA subject —
   name the design or bid set explicitly instead (see "What QA is for").
   - **A SPECIFIC set:** when the user (or the QA tab's set picker) names a
     set, that folder is the deliverable under review — pass it as
     `subfolder` to `search_drawings` / `extract_sheet_index` and say so in
     the report header. Default remains the composed current set.
   - **A pre-issuance QAQC set must be named on EVERY drawing call.** The
     drawing tools answer from the ISSUED drawings by default and leave QA
     copies out, so that a QA copy is never mistaken for what the client
     holds. When the set under review is in the QAQC folder, pass that
     folder as `subfolder` to `search_drawings`, `extract_sheet_index` and
     `find_equipment`, and as `set` to `view_drawing` and
     `read_drawing_schedule`. Without it you would be reviewing the previous
     issue. A result marked `preIssueCopy` confirms you are on the QA copy;
     `preIssueCopiesExcluded` on a result means you forgot to name it.
   - **If the register comes back EMPTY** (`extract_sheet_index` with no
     subfolder says no set was ever logged as a transmittal — common on
     small jobs and on a first internal QA), that is NOT the end of the
     review: `list_project_documents` to find the set folders under QAQC and
     Outgoing, pick the newest (ask if it is ambiguous), and re-run
     `extract_sheet_index` / `search_drawings` with that folder as
     `subfolder`. On combined multi-firm books the per-sheet title blocks
     may not parse — the cover sheet's drawing index still yields the sheet
     list, and full-text search and `view_drawing` work regardless. Note in
     the report that the set is not in the transmittal register and that
     issuing through the transmittal tool is what enables revision tracking
     and back-check benchmarking on this project.
2. **Derive the phase from the deliverable/set name** — `100% CD` → CD,
   `DD Progress` → DD, `Permit Set` → Permit, `Bid Set` / `Addendum` → Bid.
   Say which phase you derived and from what. A name that says Bulletin, RFI
   response, ASI or CCD is a construction document: stop and follow "What QA
   is for".
3. **Check index coverage**: `search_drawings` with `indexOnly:true` until
   `coverage.currentSets.complete` (or you run out of budget — then report
   how far you got). Note `textlessFiles`: those sheets are invisible to text
   checks and must be listed in the report as unreviewed by machine.
4. **Note the disciplines and systems in the set** (from the sheet index:
   M, E, P, FP, FA, and the main systems — chilled water, emergency power,
   sprinklers...). Passes 2 and 3 are driven by this list.
5. `project_briefing` if you lack context on where the job stands.

### What the RFI logs say to look for

Before the passes, call `rfi_root_cause_summary` with no project. It
returns, from the RFIs the firm has tagged: how many were preventable by a
document review, the checklist items those RFIs map to (most-hit first),
and the preventable RFIs that no checklist item covers.

- Run the most-hit items first and widest, and say in the report that you
  did.
- Read `noCheckExamples`. They are problems that became RFIs and that no
  checklist item asks about. Look for the same kind of problem in this set
  during Pass 3, and name any you find as such.
- If the tool returns nothing or is not available, say so and carry on:
  the tagging starts empty and fills as RFIs are reviewed.
- This is firm-wide evidence about kinds of problems. It is not a list of
  findings for this project, and nothing in it is quoted in the report as a
  fact about this set.

## Step 1 — Carry-over: prior comments and open findings

Run this in EVERY review, not just back-checks. Reviewer comments on
previous submissions are the first thing a human reviewer would check the
new set against, and a review that skips them can pass a set that ignores
the owner's last round of comments.

Leave rows with source `rfi` or `submittal` alone: they are construction
flags from RFI and submittal reviews, not QA findings, and are not
back-checked, counted or put on the punch list here.

1. **Read the ledger**: `list_qa_findings` with `status:'all'`. If the
   result says `truncated`, older rows were left out: read the rest by
   status or discipline, or raise `limit` (max 500), and if you still
   cannot read them all, say so in the report. Note
   `commentLogsNotIngested` in the result.
2. **Find comment packages**: `find_document` with docType 'Comment Log'
   (queries like "review comments responses markup"), plus
   `list_project_documents` on Emails — comment packages live in dated
   Email folders named `*Comments*` (e.g. "2025-10-29_SD Review Comments",
   "2026-06-12_Final SUCF DM Review Comments & Responses", Bluebeam markup
   folders).
3. **Ingest any log NOT yet in the ledger** now (`record_qa_findings`
   `kind:'comment-log'`, rules in Step 7) — subject to the prime/sub scope
   rule above.
4. **Back-check every open row against the set under review**: verify the
   pickup on the NEWEST revision of the cited sheets (`search_drawings`
   history / `read_drawing_schedule` / `view_drawing`). Then move status
   with `update_qa_finding`, always with the evidence as the note:
   - internal (`source:'qa'`) rows may go straight to `closed`;
   - EXTERNAL rows (DrChecks, owner, architect, agency) go to
     `ready_to_backcheck` at most — a human closes those, never an
     automated pass. The tool stores your note as
     `Auto-backcheck: <evidence>`; the QA tab renders that as machine
     evidence (an "auto-backchecked" chip, no person's name) and the human
     close is then a single confirming click. So make the evidence note
     self-sufficient: sheet, revision, and what shows the pickup;
   - a sheet not reissued stays `open`; a deliberate no-fix is `dismissed`
     with the reasoning.
5. Reviewer comments outrank internal findings at equal severity; a prior
   comment the new issuance did not address goes on the punch list as a
   finding, never a footnote.
6. The report's carry-over section states which comment packages were
   found, which were ingested, and which could not be read (scanned markups
   a text pass cannot parse get listed for human review with view_drawing
   spot-checks, not silently skipped).

**Back-check-only requests** ("the comments came back", "back-check the
resubmission", "check the addendum picked everything up"): run Steps 0–1,
the change record and ripple analysis for the new set, then Steps 6–7.
Passes 1–3 in full are for a review of a deliverable.

**Automatic back-check** (a scheduled run, or "what needs back-checking"):
call `list_backcheck_candidates`. It lists the projects whose open rows the
newest issued set has not been checked against. For each one, in the order
returned and no more than the run's stated limit:

1. Confirm the newest set with `get_current_set`. If the drawing index
   still has files pending for it, skip the project this run and say so:
   a half-indexed set produces false "not picked up" results.
2. Run item 4 above on the due rows only (`dueFindingIds`). Move a row only
   on evidence read in this run. A row the set does not answer, or that
   drawings cannot answer ("review with the client"), stays `open` and is
   not touched.
3. Record the pass: `record_qa_findings` with `kind:'backcheck'`,
   `setName` exactly the `newestSet` the tool returned, the coverage note
   (rows checked, moved, left open, could not verify, sheets not read) and
   `findings` empty unless the new set introduced a new problem. This row
   is what marks the set as checked; without it the project is listed
   again tomorrow.
4. Do not ingest comment logs, draft responses, file a report or run
   Passes 1 to 3 in an automatic run. Report what moved, per project.

## Step 2 — Backgrounds inventory: ALWAYS run, ALWAYS report

MEPFP coordination is only checkable against the other disciplines'
CURRENT drawings, and those arrive as PDFs from outside.

1. Inventory what the project HAS: `list_project_documents` — the **Email**
   folder (files received from others; `*COMMENTS*`, architectural/
   structural issues) and the main library's incoming/backgrounds folders.
   Look for structural (S), architectural plans and **RCPs** (A), site/civil
   (C), and any federated/combined sets, by file name and folder.
2. Date every background found (file name date, folder date, modified date)
   and compare against the set under review's issue date.
3. **Report the inventory in every review, in its own section** — found,
   with dates ("reviewed against: A-RCP set dated 2026-03-02"); found but
   STALE (older than our latest issue — coordination against it proves
   little); or NOT FOUND ("no structural PDFs anywhere in the project
   folder — request current S set from the architect"). The team can only
   ask for what they know is missing, so absence is a first-class result,
   never a silent skip. A stale or missing background also caps how far the
   cross-discipline checklist items can go — say so on each affected item.
4. **Index the current backgrounds so they can be searched.** For each
   folder that holds another discipline's current set, call
   `search_drawings` with `subfolder` set to that folder exactly as
   `list_project_documents` prints it and `indexOnly: true`, and repeat
   until `coverage.filesPending` is 0. After that, `search_drawings` with
   the same `subfolder` searches their sheets by text, which is what makes
   the cross-discipline pass cover a whole building instead of a few
   rendered pages.
   - Sheets indexed from a received-files folder are kept out of the
     current set and out of default search, so they cannot be mistaken for
     what Setty issued. You have to pass the folder as `subfolder` to see
     them.
   - A PDF over the indexing size limit is reported as skipped. Architects'
     combined sets often are. Read those with `view_drawing` in direct mode,
     page by page, and say in the Backgrounds section which files were
     searchable and which were only spot-read.
   - Index only the CURRENT issue of each discipline. A stale set in the
     index produces findings against drawings nobody is building from.

## Step 3 — Pass 1: the checklist, item by item

**Fetch the checklist fresh**: `get_qa_checklist` with the derived `phase`.
Never reuse a checklist from memory — QA edits it and lessons learned add
rows. Drop `primeOnly` items on sub jobs.

**Every item returned gets exactly one disposition** in the report's
coverage table. This is the contract of Pass 1: the reader must be able to
see, for every item, whether it was looked at.

| Disposition | Meaning |
|---|---|
| `clean` | Checked, nothing found. State what was examined (sheets, schedules, search terms). |
| `finding` | Something is on the punch list for it (give the punch-list number). |
| `flag` | Evidence gathered, needs a human to confirm (give the punch-list number). |
| `partial` | Checked on some sheets/areas only — name which, and which not. |
| `not attempted` | Not looked at. Give the reason: out of budget, background missing/stale, textless sheets, needs plotted-sheet judgment. |
| `n/a` | Does not apply to this set (no roof work, no demolition...). Say why in a few words. |

Most of the checklist is `assisted` (evidence gathering plus a human
confirmation), and you cannot render every sheet. Work in this order so the
budget goes where the risk is, and let whatever is left land honestly in
`not attempted` — never in silence:

1. **All `auto` items.** Each carries a `how` hint naming the tools; follow
   it. Then the four **RFI prevention checks** (qa-600 series, method
   below).
   - Sheet-set integrity (qa-003/004/151): `extract_sheet_index` for the
     register view; compare against distinct sheet numbers actually indexed.
     Duplicates, gaps in numbering runs, format drift.
   - Placeholders (qa-032): `search_drawings` for TBD, VERIFY, XXX,
     "By Others", "Insert Here", Lorem — on the CURRENT sets tier. A hit on
     a superseded set is history, not a finding: check
     `stillPresentAtLatest`.
   - Code versions (qa-011) and dates (qa-002): search for code-year
     strings; compare title-block revision dates across disciplines in the
     same set.
   - Equipment tag reconciliation (qa-052/053/054, qa-201/202/203):
     `find_equipment` enumeration for the tag families, then per family:
     schedule side via `read_drawing_schedule` on the schedule sheets, plan
     side from the tag's sheet appearances. Report scheduled-but-not-shown,
     shown-but-not-scheduled, and duplicate tags. Respect the enumeration
     caveat (hyphenated tags only) and say so.
   - Voltage/phase coordination (qa-060) and panel hygiene (qa-219):
     `read_drawing_schedule` on the M/P equipment schedules (V/Ph/MCA
     columns) and the E panel schedules; cross-check per tag.
   - Schedule placeholders (qa-229): scan the schedule rows you already
     read for TBD/VERIFY/blank capacity cells.
   - Prior-project bleed (qa-231): search for the names of a few other
     recent projects (from search_projects) in this set's text.
2. **Assisted items the auto results implicate** — `view_drawing` (region
   zoom) on the specific sheets, to confirm before reporting.
3. **Assisted items with a text route**: detail callouts via
   `trace_references`; title-block completeness from the index fields;
   legends/abbreviations and sequence-of-operation tags via
   `search_drawings`; the Code Compliance section (qa-400 series) and
   External Data Dependencies (qa-300 series, method below).
4. **The cross-discipline pass** (its own section below): seven checks, each
   with a disposition, then the clash screening, congested areas first.
5. **Remaining assisted items**, life-safety and agency-rejection risk
   first, graphics/polish last.
6. **`manual` items**, if the checklist has any: list them verbatim as the
   reviewer's own checks, disposition `not attempted — reviewer's own
   check`. Do not attempt them.

Label every assisted result as needing human confirmation.

### RFI prevention checks (qa-600 series) — run these on every CD, permit and bid set

These four items were written from a real RFI log (Tabler Quad, 276 RFIs,
reviewed 2026-11-16): each is a way the documents disagreed with themselves
that bidders and the contractor then had to ask about, several of them
twice, once at bid and again in construction. They are mechanical
comparisons, they are cheap, and a general read of the set does not find
them. Do them right after the `auto` items, before anything else assisted.

- **qa-600 Sizes in keynotes and notes against the feeder schedule.** The
  single most common cause. A plan keynote, a site-plan note or a one-line
  keynote states a conduit or conductor size, and the feeder schedule states
  another.
  1. Read the feeder schedule (`read_drawing_schedule` on the feeder
     schedule sheet; if the table has no title the reader will not find it,
     so `view_drawing` it by region instead and say so).
  2. `search_drawings` across the electrical plans, site plans, enlarged
     plans and one-lines for the notes that carry sizes: `CONDUIT`, `" C`,
     `KCMIL`, `#4/0`, `SETS OF`, `2 HR` / `2-HOUR`, `SCHEDULE 40` / `80`.
  3. For each feeder a note names (service, chiller, fire pump, generator,
     ATS, duct banks, each panel feeder), compare size, number of sets,
     conduit type and any fire rating against the schedule row. Compare the
     same feeder across EVERY sheet that notes it: the chiller feeder that
     was corrected on one plan and still wrong on another came back as a
     second RFI.
  A mismatch is a MECHANICAL-FACT finding, severity `rfi-bait`, or `cost`
  where the larger size is the right one.
- **qa-601 Keynote legends.** On each sheet with keynotes: a number used on
  the plan that is not in that sheet's legend; a number that appears twice
  in the legend; two keynotes that have been swapped (the text describes the
  other one's subject); a keynote on an item marked existing-to-remain; a
  keynote that points to a sheet or detail not in the set. Read the legend
  with `search_drawings` (subfolder pinned) and confirm doubtful ones with
  `view_drawing` on the legend's region.
- **qa-602 Specifications against the drawings, for major equipment.** Open
  the spec book (`find_document` docType Specification, then
  `read_document`; if the specs are not in the project library say so and
  mark the item `not attempted`, which is a real gap).
  1. Table of contents against the sections actually in the book: a section
     listed and missing, a wrong section number, the same section included
     twice in two versions.
  2. For each major piece of equipment (chiller, air handling, boilers and
     heat exchangers, pumps, generator, switchgear, fire pump, fire alarm
     panel and annunciator, elevators, air compressors): type, basis-of-design
     manufacturer and key accessories in the spec against the schedule and
     details. The spec that calls for a traction elevator when the drawings
     show hydraulic controls, a graphic annunciator the drawings do not
     show, or a load bank that is drawn nowhere.
  3. Sections that refer to another section that was never issued.
  4. A construction or material shown on a detail with no spec behind it
     (double-wall duct, a duct gauge), and the reverse.
- **qa-603 Riser against detail against controls diagram.** The same valve
  or device is drawn in three places and they must agree. For each hydronic
  and air system: take the riser diagram, the piping or installation detail
  for the equipment it serves, and the controls or flow diagram
  (`view_drawing` each; `search_drawings` for the equipment tag finds the
  sheets). Check that every isolation and control valve on one appears on
  the others, on the same side (supply or return), and that every damper or
  device on a control schematic has a line in the sequence of operation and
  is drawn on the plans.

Each of the four gets a disposition like any other item. When one is
`not attempted`, give the reason in the coverage table, because these are
the checks most likely to have prevented an RFI.

### Bidder's eye pass (qa-620 series) — CD, permit, bid and addendum sets

About half of Tabler Quad's RFIs (roughly 137 of 276) were bid RFIs, asked
within weeks of issue, and most were not engineering questions. They were:
who provides it, which trade wires it, how many are there, which spec
section governs, where does the work stop. A design review reads the set as
its author. This pass reads it as an estimator with a week to put a number
on it, and writes down every place that person would have to ask.

Run the five checklist items, each with a disposition:

- **qa-620 Who provides it.** Collect every "by others", "by owner", "by
  G.C.", "N.I.C.", "furnished by" and "installed by" note on our sheets and
  in Divisions 21 to 28. Each must name a party. Then find the item in that
  party's documents; if they also say "by others", nobody has it. Split
  items (furnished by one, installed or wired by another) need both halves
  stated.
- **qa-621 Division of work for every motor.** Build a table from the M, P
  and FP schedules: for each motor or powered unit, who furnishes and who
  installs and wires the starter, disconnect, VFD, control wiring and fire
  alarm interlock. Fill it from our schedules and notes, then again from
  the E connection schedule and one-line. Any cell that is blank on both,
  claimed by both, or different between them is a finding.
- **qa-622 Can it be counted and priced.** Untagged devices and fixtures, a
  tag with no schedule row, "typical" with no extent, items on the
  architect's sheets that ours omit or lay out differently, alternates and
  allowances in Division 01 that cannot be found on the drawings, and work
  the documents require with no shown way to do it.
- **qa-623 The spec book as one set.** Table of contents against the book:
  a section twice in two versions, a missing section, a section for a system
  the project does not have. For each major basis-of-design model, check
  that the manufacturer still offers it; where you have no web access, mark
  that part `not attempted` and list the models for a person to check.
- **qa-624 Site, utilities and temporary services.** Each service entry
  with size, invert or elevation and a named limit of work, matching the
  civil plan; utility company work against contractor work; the fire
  department connection shown by one discipline only; temporary power,
  water and heat assigned in Division 01.

Findings from this pass are `rfi-bait`, or `cost` where the unassigned work
is large. Write the action as the sentence that would have answered the
bidder: who provides it, on which sheet or section it will say so.

### Cross-discipline pass — MEPFP against everyone else's documents

Run this on every DD, CD, permit and bid set. Passes 1 to 3 mostly test the
MEPFP set against itself, and that is not where most RFIs come from. On BPL
New Lots (41 RFIs, compared 2026-11-16) a review of the 100% CD set found 33
problems inside the MEPFP sheets and matched none of the RFIs exactly: 18 of
the 25 RFIs a document review could have caught were MEPFP against
architecture, structure, the life safety plan or a non-MEP spec section.
Several had been raised by the owner at DD and were still open at bid.

It depends on Step 2. For each check, name the background it was run
against and its date. A check whose background is missing or stale is
`not attempted` with the reason, and the missing set goes on the punch list
as a request to the PM. Never mark a check clean without the other
discipline's sheet in hand.

Reading the other disciplines: `search_drawings` finds their sheets when
they are in the project library and indexed; `view_drawing` in direct mode
renders any PDF page by itemId when they are not; `find_document` and
`read_document` open the spec book.

**Before calling something missing, look where the other side actually
puts it.** The architect's answer is often not on the floor plan: rated
soffits and access panels are on the RCPs, device and damper access on the
device coordination plans, hold-opens and operators in the hardware spec,
openings and louvers in a schedule. On BPL New Lots three "not shown"
findings were wrong because only the floor plan had been read. Check the
RCP, the device plan, the schedules and the spec, and say in the evidence
which of them you looked at.

**Split the pass by area on anything larger than a small building.** One
run cannot cover a multi-storey building: on Tabler Quad the ceiling check
reached 4 item types out of about 193, and about 20 RFIs came from the
rooms it never opened. Before starting, write the coverage plan:

1. List the areas: each floor and each wing, plus every mechanical room,
   electrical room, fire pump room, shaft, stair, elevator, roof and
   typical unit type as its own area. A unit or room type that repeats is
   checked once and its count stated.
2. Order them by risk, not by floor: equipment rooms and shafts first,
   then corridors and the typical unit, then the rest.
3. Run X-2 to X-7 area by area. X-1a, X-1b and X-6 run once for the whole
   set, because they start from notes, specs and schedules.
4. If the budget runs out, stop at an area boundary. Report which areas
   were done and which were not, and say plainly that the areas not done
   need their own run. Asking the user for a second run on the remaining
   areas is the right outcome, not a failure; a table that says `partial`
   with no list of what is left is.

The checks are on the checklist as `qa-610` to `qa-616` (X-1a `qa-610`,
X-1b `qa-611`, X-2 `qa-612`, X-3 `qa-613`, X-4 `qa-614`, X-5 `qa-615`, X-6
`qa-616`, and X-7 is the existing item `qa-072`): give each finding from this pass the matching `itemId`, and report
each item's disposition in the checklist coverage table as well. If
`get_qa_checklist` does not return them, the database has not had them added
yet; run the pass anyway and say so.

Every one of the seven checks (X-1 as two lines, X-1a and X-1b) gets a disposition (the same vocabulary as
Pass 1) in the report's Cross-discipline table, with the sheets compared.

- **X-1 Work one discipline's documents hand to another.** Run it in both
  directions; each direction gets its own line in the table.
  - **X-1a What the others ask MEPFP to provide.** Look in the
    architectural plans, the door and hardware schedule, and spec divisions
    08, 10, 11, 12 and 14 for anything that needs power, a fire alarm
    connection, water, a drain or exhaust: fire and smoke doors and
    shutters that close on alarm, door operators and hold-opens, motorized
    shades, projectors and screens, appliances, hand dryers, drinking
    fountains, elevators and their pits, drip pans called for under piping,
    heat trace. Two spec sections are read item by item, not searched:
    the elevator section (machine and controller power, pit and hoistway
    lighting and receptacles, sump, shunt trip, fire recall and the
    detectors that drive it, emergency communication, remote
    annunciators, smoke curtains or hoistway venting) and the door
    hardware section with its sets (every electrified item: operators,
    electric strikes and locks, hold-opens, card readers, power supplies,
    and who furnishes and wires each). List what each asks of Division 26
    and 28. Search for the item, then confirm it is on the E, FA, P or
    M sheet that would serve it. An item the architect or a spec calls for
    and the MEPFP set does not show is a finding, `rfi-bait` or `cost`.
  - **X-1b What MEPFP asks the others to provide.** Our own sheets hand
    work to the architect, the structural engineer and other consultants,
    usually in a note, and nobody checks that they picked it up.
    1. Collect the hand-offs. `search_drawings` across the M, E, P, FP and
       FA sheets (general notes, keynotes, sequences, smoke control and
       purge notes, details) for: `BY ARCHITECT`, `BY OTHERS`, `BY G.C.`,
       `BY STRUCTURAL`, `REFER TO ARCH`, `SEE ARCH`, `SEE STRUCT`,
       `ARCHITECTURALLY-PROVIDED`, `COORDINATE WITH ARCHITECT`,
       `N.I.C.`, and for the things MEPFP design leans on: rated
       enclosures, shafts and chases, access panels and doors, louvers and
       their free area, operable or breakable windows, skylights and smoke
       vents, door undercuts and transfer openings, housekeeping pads,
       curbs, dunnage and equipment supports, trenches, pits and sumps,
       sleeves and beam penetrations, roof openings, ceiling return-air
       slots.
    2. For each hand-off, write down exactly what our note needs: the
       item, where, and any number (a free area, a rating in hours, a
       size, a clearance).
    3. Find it in the other discipline's documents: the plan at that
       location, the schedule or keynote, and the spec section. Search
       their sheets for the word our note uses as well; if our note says
       "breakable" or "rated enclosure" and no sheet of theirs does, that
       is the first sign.
    4. Compare. A hand-off the other documents do not show is a finding.
       So is one they show differently: a fixed skylight where our purge
       note needs an opening of a stated free area, a wall their plan
       leaves unrated where our note relies on a rated enclosure, a sump
       in a different corner. Severity follows what depends on it:
       `life-safety` for smoke control, egress and fire ratings, otherwise
       `cost` or `rfi-bait`.
    5. A hand-off that defers a decision instead of stating it ("refer to
       architectural plans for exact locations") is a flag, not a pass:
       name the sheet of theirs that would have to carry the answer.
       Follow each deferral to its end. If their sheet defers back ("see
       MEP drawings", "see openings schedule" with no such row, "per
       architectural specifications" with no such section), the two notes
       point at each other and nobody has decided: that loop is a finding,
       and the action says who has to state the number.
    On BPL New Lots this direction found a post-fire smoke purge that
    relied on a "breakable" skylight of 40.25 sq ft free area, where the
    architect specified a fixed skylight under a steel screen. Neither
    sheet is wrong when read alone, which is why only this check sees it.
- **X-2 Fire ratings, dampers and vents against the life safety plan.**
  Take the rated walls, shafts and floors from the life safety plan (or the
  code sheet). Every duct, transfer opening and outside-air path crossing
  one needs a fire or fire smoke damper on the mechanical plan, with power
  and monitoring on E and FA where it is a smoke damper. Check the reverse:
  dampers drawn at walls the life safety plan does not rate, and wall
  ratings that differ between the architectural wall tags and the life
  safety plan. Check stair, elevator and shaft vents for the same location
  and type on A, M and FA. Vertical runs count as much as walls: an
  exhaust or supply riser serving several storeys needs a rated shaft on
  the architectural plans, with dampers or subducts at its branches, and a
  refrigerant line through a rated corridor or between floors needs the
  rated enclosure or shaft the code calls for, drawn by someone. Severity
  `life-safety` or `cost`.
- **X-3 Structure.** Underslab sanitary, storm and conduit against footings,
  grade beams and wall footings on the foundation plan. Beams, joists and
  timber members against duct mains, sprinkler mains and the heads above
  ceilings. Roof and floor openings, equipment supports and dunnage: the
  height and size the equipment needs against what structural shows.
  Penetrations through beams, mass timber or post-tensioned slabs: are they
  shown to structural, and does structural allow them.
  Then check ROUTES against the framing, which is where the RFIs come
  from; comparing weights and penetration notes is not enough.
  1. From the framing plans and elevations, mark what a pipe or duct
     cannot pass through: braced frames and shear walls, moment frame
     beams, transfer beams and girders, hoist beams and machine beams at
     elevators, bearing walls and their headers.
  2. Trace every plumbing and mechanical riser on each floor against those
     lines: a sanitary or vent stack in a wall that holds a braced frame, a
     water closet waste line that has to cross a beam, a riser landing on
     a column line.
  3. Trace the duct and pipe mains at each beam line they cross, and roof
     equipment (fans, curbs, openings) against the roof framing and the
     elevator hoist beams.
  A route that crosses one of these with no opening shown and no way round
  is a finding. On Tabler Quad sanitary risers hit braced frames on four
  column lines, and two roof fans sat on the elevator hoist beams.
- **X-4 Ceiling space, chases and access.** Work it as a list of
  locations, not as a general look. On BPL New Lots the first run of this
  check ("add up the stack") produced nothing, while five RFIs were exactly
  this: equipment that could not be reached or did not fit.
  1. **List what is above a ceiling.** From the mechanical plans and
     schedules, every fan coil, VAV and CAV box, fan, damper with an
     actuator, control or balancing valve and cleanout, with its room.
  2. **Give each room its ceiling.** From the RCP legend and ceiling tags:
     the ceiling type and height. Lay-in tile is accessible. Gypsum board,
     plaster, acoustic plaster, wood slats and exposed structure are not.
  3. **Access.** Every item from step 1 in a room whose ceiling is not
     accessible needs an access panel drawn on the RCP or the mechanical
     plan, big enough for the unit's service side. None drawn is a finding
     for that unit. A general note ("maintain service clearance per
     manufacturer") does not count.
  4. **What is directly below or beside the unit.** Overlay the RCP and the
     structural framing plan at each unit: a light fixture, a soffit, an
     operable partition track and its framing, a stair or a beam on the
     unit's access side is a finding, and so is a pipe or duct drawn across
     the access side on our own sheets.
  5. **Depth.** Plenum available = floor-to-floor height (building section)
     minus ceiling height (RCP) minus structure depth at that spot
     (framing plan). Plenum needed = the unit's height from the schedule or
     cut sheet, plus the duct or pipe that crosses it, plus the light
     fixture. Do the sum, with the numbers, at least for: the lowest
     ceiling on each floor, every corridor, every place a duct main crosses
     a beam line, and every room under a stair, a skylight or a feature
     ceiling. A location where needed exceeds available is a finding; one
     where a number could not be read is `partial`, naming the number.
  6. **Risers and drops.** Take every riser from the riser diagrams and
     find its chase or furred wall on the architectural plan on each floor
     it passes. Then every pipe drop to a fixture: the wall it drops in
     must exist on the architectural plan and be a partition that can hold
     it, not glazing, a movable partition or a wall the architect does not
     draw. A riser or drop with no wall to hide in is a finding.
  Report a table: room, item, ceiling type and height, access (panel shown
  or not), plenum available against needed where computed, result. State
  how many of the step 1 items were checked out of the total. If the RCPs
  or the building sections are not in hand, the check is `not attempted`
  for that reason, and the missing sheets go on the punch list as a
  request.
- **X-5 Devices and fixtures where the architect put something else.**
  Devices and outlets on curtain wall, glazing, millwork or movable
  partitions, with a mounting detail and height. Lights, diffusers,
  sprinkler heads and access panels competing for the same ceiling space on
  the RCP. Plumbing fixtures: count, type and location against the
  architectural plans and the fixture schedule.
- **X-6 Rooms.** Room names and numbers on the M, E, P and FP schedules,
  panel circuit descriptions and sequences against the current
  architectural plans. One renumbered room on the architect's side makes
  every schedule that names it wrong.
- **X-7 Wet piping and ducts over electrical rooms and equipment.** This
  is checklist item `qa-072`, run here because it needs three disciplines'
  plans at once.
  1. List every electrical space from the E plans and the architectural
     room list: main electrical room, each floor's electrical closet,
     telecom and IT rooms, the fire pump room's controller, elevator
     machine or control room, and any panel, transformer, switchboard, VFD
     or controller drawn outside those rooms (in a mechanical room, a
     corridor, a janitor closet).
  2. For each, overlay the plumbing, sprinkler, mechanical piping and
     duct plans for THAT floor and the plan of the floor ABOVE: domestic
     water, sanitary, storm, condensate, hydronic and refrigerant piping,
     and any duct not serving the room, crossing the room or the footprint
     of the equipment with its working space.
  3. Check the room above: a toilet room, janitor closet, kitchen or
     mechanical room directly over an electrical room puts drains and
     traps over the gear even when no pipe is drawn through the room.
  4. A foreign pipe or duct over the equipment, or through a room the
     sprinkler notes treat as dedicated electrical space, is a finding:
     reroute it, or show the drip pan or enclosure and who provides it. A
     panel drawn under wet piping in a mechanical room is the same finding
     from the other side.
  On Tabler Quad this was three RFIs (plumbing over the main electrical
  room, refrigerant over electrical equipment, a panel under wet piping
  that had to move rooms); on BPL New Lots a storm line with a cleanout ran
  through the 2-hour main electrical room.

Report format for this pass:

| Check | Disposition | Areas done / areas in the plan | Compared (ours / theirs, dated) | Punch-list numbers |

Under the table, list the areas from the coverage plan that were not
reached, per check.

Findings from this pass are recorded with discipline `Multi-discipline`,
naming each discipline that has to act in the action, and cite both sheets.
A hit read only from text is a flag for the engineer until someone looks at
the sheets; say which were confirmed with `view_drawing`.

### Cross-discipline clash screening (assisted — never sold as clash detection)

With current backgrounds in hand, the checklist's coordination items
(qa-072 piping over electrical gear, qa-080/081/082 RCP overlaps, qa-103/
qa-210 penetrations through structure, qa-084 ceiling devices vs beams,
qa-110 roof equipment vs roof plan) become screenable:

- **Method**: `view_drawing` in DIRECT mode renders ANY PDF page by itemId —
  including incoming background PDFs that were never indexed. Render the
  background sheet and our sheet for the SAME area (matching region zooms)
  and compare: beam/joist lines through duct mains, panels with piping
  above, sprinkler heads on diffusers, shafts vs framing. Work the
  congested areas first: mechanical rooms, corridors, the floor's main
  duct runs, RCP areas with hard ceilings.
- **Honesty rule, verbatim in the report**: this is 2D gross-conflict
  SCREENING from drawings, not geometric clash detection — there is no 3D
  model here, elevations are mostly unstated, and a clean screen does not
  mean clash-free. Every hit is a flag for the engineer; every area
  actually screened is listed (sheet pairs + regions), so "screened" is
  never mistaken for "verified".
- Record hits to the ledger with `source:'ripple'` or `'qa'`, both sheets
  cited (ours and the background's file/date).

### External data dependencies — flag what the log cannot show

Some design inputs live OUTSIDE the drawing set: the utility's available
fault current, the hydrant flow test behind the FP hydraulic calcs, service
coordination confirmations, owner-provided data. The checklist's "External
Data Dependencies" section (qa-300+) drives this:

1. Derive which dependencies apply FROM the design content (a service
   entrance implies a utility letter; sprinkler hydraulic calcs imply a
   flow test; gas-fired equipment implies gas availability).
2. Hunt the project log for the evidence: `search_emails`,
   `find_document`, and the values cited on the sheets themselves
   (`search_drawings` for AVAILABLE FAULT CURRENT / FLOW TEST / STATIC /
   RESIDUAL). Found → report the source and its DATE (a 2019 flow test
   under a 2026 bid set is a finding, not a pass).
3. **Not found → raise a ledger finding addressed to the user**: name the
   missing data, why the design depends on it, and the action ("attach the
   flow test report, or enter its status"). The user's answer is recorded
   through `update_qa_finding` as the row's note — that note IS the record
   that the dependency was consciously resolved, not assumed. Never mark
   such an item clean on inference; only a document in the log or a human
   note closes it.

### Change record and cross-discipline ripple analysis (resubmissions, addenda, back-checks)

Every revision of every sheet is indexed separately, so the system already
holds the change record: what revised, in which set, with the revision
block's own label ("ADDENDUM #2") and the transmittal register's when and
to-whom. When a set changes an earlier one — DD to CD, a resubmission after
comments, a bid addendum — USE it:

1. **Diff the change.** For each sheet the set revised, compare against its
   prior revision — text for plans/notes, `read_drawing_schedule` per pinned
   `set` for schedules (the schedule diff is the high-value one: capacity,
   HP, V/Ph, MCA, weight, dimensions per tag).
2. **For every changed equipment parameter, run the ripple rules** and check
   whether each affected discipline's sheet ALSO revised in the same set (or
   a later one) — `find_equipment` names every sheet the tag touches, and
   the register knows which sheets each set revised. A fan upsized in an
   addendum whose electrical sheets did not move is a finding, always.
   **The authoritative rules come from `get_qa_checklist`'s `rippleRules`**
   (the pms_qa_ripple_rules table — lessons learned extend it without a
   deploy); the table below is the seed copy for reference:

   | Changed parameter | Ripples to — verify |
   |---|---|
   | Motor HP / kW, MCA, MOCP | E: breaker/feeder size, panel schedule row, disconnect rating; starter/VFD |
   | Voltage / phase | E: panel assignment (no 120V load on a 480V panel), wiring, disconnect |
   | Airflow (CFM) | M: duct mains/branches, diffuser selection, outside-air balance; sound |
   | Water flow (GPM) / head | M/P: pipe sizes, pump selection, balancing valves |
   | Heating/cooling capacity | M: coil connections, condensate; E: electric-heat circuits |
   | Physical size / configuration | A: clearances, access, ceiling/shaft space; M: duct/pipe connections |
   | Operating weight | S: pad, dunnage, roof framing, housekeeping pad note |
   | Equipment added or deleted | ALL: power, controls, condensate/drain, structural support, and the schedule row itself (qa-201/202) |
   | Gas-fired equipment | P: gas load/pipe size; M: venting/combustion air |
   | Fire/smoke rating of a wall | M: fire/smoke dampers (qa-211); FP: head layout |

3. **Report the ripple as its own finding**: "Addendum #2 changed EF-7 from
   1 HP to 2 HP on M-601; its circuit on E-610 (panel LP-2, cct 14) was not
   revised in Addendum #2 — verify breaker/feeder sizing." Cite
   both sides. When the counterpart DID revise, say so — that is the
   coordination working, and the record of it is worth as much as a catch.

These rules are a starting set; lessons learned extend them. Treat any
change driven by a reviewer's comment or a bidder's question (the "owner
wants the fan bigger" case) as the highest-priority ripple candidate —
externally-driven changes are the ones most often made under time pressure
by one discipline alone.

## Step 4 — Pass 2: the knowledge layer

The checklist is the same for every job. The knowledge layer is what the
firm has learned that applies to THIS job: its own history, its agency, its
disciplines and systems. Query all four sources, then apply what fits.
This pass only READS the knowledge layer (rule 4): its results shape the
review, and the review's findings go to the project's ledger, not back
into knowledge.

**Query — make every one of these calls:**

1. **Project lessons**: `search_knowledge` with `projectNumber` (no other
   filter).
2. **Best practices and firm lessons, per discipline**: `search_knowledge`
   with `discipline` — one call per discipline in the set (Mechanical,
   Electrical, Plumbing, Fire Protection...). The approved best practices
   come back in `bestPractices`. Do NOT add the `agency` filter on these
   calls: best practices carry no agency, and the tool omits them from any
   agency-filtered search.
3. **Agency lessons**: `search_knowledge` with `agency` — a separate call,
   for the reason above. Skip when the job has no agency client.
4. **Agency preferences**: `search_agency_preferences` with the `agency`
   (deliverable format, review expectations, submission conventions).
5. **Engineering standards**: `search_engineering_standards` with
   `discipline`, and with `system` for each main system in the set (from
   Step 0). These are the firm's own design-basis positions and they are
   the yardstick for Pass 3.
6. **Open items**: `list_action_items` — an open item that touches a
   discipline is a targeted check.

**Apply:**

- Go through what came back and decide, entry by entry, whether it applies
  to the set under review (its discipline, systems, phase, agency). Firm-wide
  entries do not all fit every job.
- **Each applicable entry is treated like a checklist row**: check it
  against the drawings with the same tools and the same evidence standard,
  and give it a disposition (`clean` / `finding` / `flag` / `not attempted`).
  A lesson learned is a checklist row in spirit even before QA formalizes
  it.
- An agency preference the set does not follow is a finding at severity
  `agency`. A firm standard the design departs from is a `flag` for the
  engineer (the departure may be deliberate) — handled in Pass 3.
- Cite the entry in the finding: lesson id, practice id, or the standard's
  source reference, so the reviewer can see where the rule came from.

**Report it in its own section** (see the report structure): every
applicable entry with its disposition, and the count of entries returned
but judged not applicable, per source. "Searched, nothing applicable" and
"searched, nothing returned" are both results worth a line; a source you
did not query is reported as not queried.

## Step 5 — Pass 3: general engineering review

Passes 1 and 2 ask "is the set coordinated and does it follow our rules".
This pass asks what a senior engineer flipping through the set would ask:
**does the design make engineering sense?**

**The limits, stated verbatim in the report:** this is a sanity review from
the drawings' text, schedules and rendered images. It does not run load,
hydraulic, short-circuit or energy calculations, and it does not replace the
engineer of record's review. Every result is a **flag for the engineer to
verify**, with the numbers that prompted it, never a statement that the
design is wrong. A clean pass means nothing obvious stood out in what was
examined, not that the design is verified.

**Yardsticks, in this order:** the firm's engineering standards from Pass 2
(cite the source reference); the code editions and design criteria the
drawings themselves cite; internal consistency of the set. Do not flag a
design against a code edition or rule of thumb the project does not cite
without saying that is what you are doing. When neither a firm standard nor
a cited criterion covers a point, say so — "no firm standard on file for X"
is a useful line for the standards library.

Work per discipline present in the set. Read the schedules first
(`read_drawing_schedule`) — that is where the numbers are — then the
general notes, design criteria, one-lines/risers and sequences
(`search_drawings`, `view_drawing`).

- **Design basis stated and consistent.** Design conditions, code editions,
  occupancy/ventilation basis, energy path, fault current, hydraulic design
  criteria: present, and the same wherever they appear.
- **Mechanical.** Scheduled airflow vs the sum of terminal/diffuser airflows
  it serves; outside air vs exhaust and the building pressure it implies;
  capacity per unit area or per CFM far outside the rest of the schedule
  (one AHU at twice the tons/CFM of its siblings); coil/pump GPM vs
  capacity and delta-T; pump head and fan static values that are blank,
  identical placeholders, or implausible; equipment with no stated controls
  or sequence; sequences that describe equipment or modes the schedules do
  not have.
- **Electrical.** Equipment MCA/MOCP vs the breaker and feeder on the panel
  schedule; panel connected/demand load vs bus and main rating; feeder and
  transformer sizes vs the one-line; voltage/phase of load vs panel; AIC
  ratings vs the stated available fault current; emergency/standby loads
  vs generator/ATS rating; long feeders with no voltage-drop note.
- **Plumbing.** Fixture-unit totals vs main and riser sizes shown; water
  heater capacity/recovery vs the fixtures served; gas load total vs meter
  and pipe size; storm/sanitary sizes that shrink downstream; backflow and
  mixing-valve provisions the riser implies.
- **Fire protection / fire alarm.** Hazard classification and design
  density stated and matching the occupancies shown; flow test data present
  and dated (ties to qa-300 series); standpipe/pump criteria; FA device
  types vs the sequence/matrix.
- **Cross-system.** Every scheduled item has power, controls and (where
  applicable) drainage, venting and structural support shown — the "added
  or deleted equipment" ripple rule applied to the whole set, not only to
  changes.

Budget rule: check every equipment and panel schedule for the mechanical
cross-checks above (numbers against numbers); pick the plan-reading items
by risk. Disciplines or areas you did not get to are listed as not
reviewed.

Each flag states: the two (or more) numbers or statements that do not sit
together, the sheets and revisions they are on, the yardstick, and what the
engineer should verify. Severity follows the same scale as everything else
— an undersized feeder is `life-safety`/`cost`, an unstated design
condition is `rfi-bait`.

## Step 6 — The punch list and the report

**The punch list is the deliverable.** It is what the team works from, so
it is organized by who fixes it, not by how it was found:

- **Try to disprove each finding before it goes on the list.** A wrong
  finding costs the team's trust faster than a missed one: after two or
  three, people stop reading the list. Before recording, take each finding
  and look for the reason it is wrong:
  1. Is the "missing" thing somewhere you did not look? The other sheet of
     the pair, the RCP, the device plan, a schedule, a general note, the
     spec. Name where you looked in the evidence.
  2. Did you read the value, or a neighbouring row or sheet? Re-read the
     exact cell or note, and render the sheet when the text was ambiguous.
  3. Is it the current revision of both sheets?
  4. Is there a note that explains it (an exception, "by others", a
     deliberate difference)?
  What survives is recorded as a finding. What you could not confirm either
  way is recorded as a flag, with CONFIRM and exactly what a person has to
  look at. What you disproved is dropped, and the report says how many were
  dropped at this step. Never promote a text-only hit to a confirmed
  finding, and never record a guess to be safe.
- **Key items: mark the few the team must see first.** A long list reads
  flat. Mark a finding as a key item (`keyItem: true` with a `keyReason`
  when you record it; **bold** in the report) when one of these is true:
  - `recurring`: the same kind of problem keeps coming up. It appears
    several times in this set (the same wrong room number on five
    schedules is ONE key item, not five), it was raised on an earlier
    submission or by the owner and is still there, it maps to an RFI
    prevention item (qa-600 series), or a knowledge-layer lesson names it.
  - `clear miss`: a plain error on the face of the documents that needs no
    judgment to see and that a check should have caught: 220 V on a 208 V
    unit, a breaker larger than the scheduled maximum, a keynote with no
    legend entry, two sheets that state opposite things.
  - `high consequence`: life safety, a failed inspection or filing, or a
    change order if it reaches bid.
  Keep it to about one finding in five, and never more than eight on one
  punch list: when everything is bold nothing is. A judgment call that
  still needs a person to confirm is not a clear miss; it can be a key item
  only for its consequence. Do not mark `For reference` rows. A person can
  mark or unmark any row in the tab; `mark_qa_key_item` does it for a row
  that already exists.
- **One list, numbered once** (P-1, P-2 ...), merging Step 1 carry-overs
  and the findings and flags of all three passes and the
  cross-discipline pass. Carry-overs include every
  open OWNER, agency and architect comment: the team works those from the
  same list as the internal findings, never from a separate document. The same problem found by
  two passes is ONE item naming both.
- **Grouped by discipline** — Mechanical, Electrical, Plumbing, Fire
  Protection, Fire Alarm, then **Multi-discipline / coordination** (name
  every discipline that has to act), then **PM / project** (missing
  backgrounds, external data to obtain, comment logs to answer). On PRIME
  jobs add a group per subconsultant discipline.
- **Within a group, worst first**: life-safety > agency (rejection risk) >
  cost (significant cost exposure) > rfi-bait > polish — and at equal
  severity, EXTERNAL reviewer comments (agency above all, then
  owner/architect) come before internal findings: someone else's
  unanswered comment always outranks a house nit.
- **Each item is one row a designer can act on without reading the rest of
  the report**: sheets with revisions (`E-211 Rev 2 (Addendum #1)`), what
  is wrong or to verify in one sentence, the action, severity, and where it
  came from (checklist id, lesson/practice/standard, engineering review,
  reviewer comment #, ripple). Mark `confirm` on anything that is a flag
  needing human confirmation before anyone redraws. Evidence detail lives
  in the sections below, keyed by the P-number.
- Do not assign items to named people — the PM does that. Discipline is as
  far as the list goes.

**Say what each item would have cost later.** The reason to fix a thing now
is what it turns into after bid. Where it is clear, end the item with the
consequence in a few words: "would be an RFI", "bidders will ask",
"change order: feeder upsize after award". On a bid set or an addendum this
matters most, because it is the last point at which the fix is free.

Report structure:

```
# QA Review — <project> — <set> (<phase>)
Reviewed <date> · <lifecycle moment> · Setty role: <prime|sub>
Index coverage: <n>/<m> current-set files, <k> textless sheets unreviewed by machine
Checklist: <a> clean · <b> finding/flag · <c> partial · <d> not attempted · <e> n/a (of <total>)
Stopped early at: <step, or "ran all steps">

## Summary                    (3–6 lines: what would embarrass the firm in front of the owner; counts by severity)
## Punch list                 (grouped by discipline, P-numbered — the table above)
## Evidence                   (per P-number: the text/values/renders behind it, and the view_drawing call to see it)
## Carry-over                 (prior comments and open ledger rows: picked up / still open / could not read)
## Checklist coverage         (every item id, grouped by section: disposition + what was examined or why not)
## Cross-discipline           (the coverage plan; the seven X checks: disposition, areas done, sheets compared with dates, punch-list numbers; areas not reached)
## Knowledge layer            (per source: applicable entries with disposition; counts not applicable; sources not queried)
## Engineering review         (limits statement; per discipline: what was examined, flags, what was not reviewed)
## Backgrounds                (found with dates / stale / not found)
## Not reviewed by machine    (textless or unindexed sheets, areas not screened, manual-tier items)
```

Lead with the summary and the punch list, not with process. If the user
wants a file, produce the report as a document (docx skill conventions) and
the punch list additionally as a spreadsheet (xlsx: one row per item, the
columns above, one tab or filter per discipline) so the team can sort and
tick it off; otherwise the chat report stands.

## Step 7 — Record and file

Do this when the request asked for it (the QA tab's "Run Coordination
Review" prompt does), or once the user has seen the report and says to go
ahead. If neither, end the report by offering both. Recording and filing
are separate from sign-off: neither marks anything resolved.

**Record: `record_qa_findings`.** Write the punch-list items into the
ledger (project, set, phase, coverage, and per finding: title, item id,
severity, sheets, evidence, action). That is what makes the back-check of
the next submission possible — an unrecorded finding cannot be back-checked
and quietly dies.

- **Do not duplicate.** Compare against the ledger rows read in Step 1: an
  item that is already an open row is NOT recorded again (it was
  back-checked in Step 1 instead). Only new items are written. The tool
  backs this up: a finding whose title matches an open row comes back in
  `skippedDuplicates` instead of being written — report those as
  carried-over, and do not force them through with `allowDuplicates`.
- **A review with nothing new still gets recorded**: call
  `record_qa_findings` with an empty `findings` list so the run, its set
  and its coverage are on the project's record.
- **More than 50 items**: the tool takes at most 50 findings per call. Send
  several calls with the same `setName` and `phase`, worst severity first,
  and report every review id returned.
- **`coverage`** carries the header's coverage line, including the
  checklist disposition counts and where the review stopped.
- Engineering-review flags record with `source:'qa'`, no `itemId`, and a
  title starting `Engineering review: `. Knowledge-layer findings record
  with `source:'qa'` and the lesson/practice/standard reference in the
  evidence.
- **Every finding carries its `sheets` and its `tags`** — the sheets it
  cites (with revisions) and the equipment tags it concerns (`['EF-7',
  'LP-2']`). These are the links the RFI and submittal reviews in CA use to
  find this row when a contractor's item touches the same sheet or
  equipment; a finding with the tag only in its prose is found by text match
  at best.
- **Write the action as an instruction someone can do and someone else can
  check.** The team works the list from the Action, so it carries the most
  weight on the row. One or two sentences, in this shape:
  *who* (the discipline, first), *do what* (an imperative verb: change,
  add, delete, move, show, confirm with), *where* (the sheet number, and
  the schedule row, keynote, detail or spec section and paragraph), and
  *to what* (the value or wording it should read when done).
  - Good: "Mechanical: on M-601, change FCU-1-1 and FCU-1-2 from 220/1/60
    and FCU-3-9 from 280/1/60 to 208/1/60 to match E-601."
  - Good: "Electrical: on E-603 Panel MG, change the EUH-1-6 breaker from
    20A-2P to 30A-2P and the wire to #10, per the E-601 schedule row."
  - Good: "Fire Protection: add a flowmeter to detail 5/SP-701, or delete
    it from spec 213113 para 2.5. Say which in the response."
  - Not this: "Coordinate.", "Verify.", "Review and revise as required.",
    "Reconcile the drawings."
  When the right answer is not known, say what has to be decided and by
  whom, then both outcomes with their sheets ("PM to confirm the heater
  size with the Qmark data. If 3 kW: revise M-602, E-601 and the four
  panel schedules E-602 to E-605. If 1.5 kW: change the FLA on M-602 and
  E-601 to 7.2 A."). Name every sheet that has to change, not only the one
  where the problem was seen. Write it so the back-check is a lookup: a
  reviewer opening the named sheet can see in one glance whether it was
  done. No evidence in the action (that is the evidence field), and no
  severity words.
- **Every finding carries its `discipline`** — the punch-list group it sits
  in (Mechanical, Electrical, Plumbing, Fire Protection, Fire Alarm,
  Multi-discipline, PM / Project, or the subconsultant's discipline on a
  prime job). The QA Reviews tab groups and filters by it. For
  Multi-discipline items, name each discipline that has to act in
  `action`. Never name a person: the PM assigns people in the tab.
- Check the result's `failed` list and report any row that did not save.
- If the result has `actionNeedsRewrite`, those rows are saved but their
  action is too vague to work from. Rewrite each one with
  `revise_qa_finding_action` before you report the punch list; do not
  leave it for the team.

External comment logs — the owner's, the agency's, the architect's — ingest
the same way (`kind:'comment-log'`, one row per comment, `externalRef` =
comment number, `source` naming the commenter: `owner`, `agency`,
`architect`, `drchecks`). Each row carries its `discipline` like any other
finding, and its `sheets` wherever the comment names them, so the comment
sits on the punch list under the discipline that has to act and is found
later by the RFI and submittal reviews of those sheets. Two hard rules:

- **`sourceDoc` is REQUIRED** — the comment log's file name (e.g.
  "2026-08-12_SBU Code Review Comments.pdf"). The QA tab shows it as each
  row's provenance; the tool refuses a comment-log without it. One log =
  one `record_qa_findings` call, never mixed logs in one review row.
- **Non-MEPFP comments are reference-only — ON SUB JOBS.** A comment
  outside Setty's MEPFP scope (architectural finishes, civil, "slip
  resistance flooring") is ingested ONLY when it impacts MEPFP work — say
  how in the evidence — and its title starts with `For reference: ` so the
  tab marks it as a reference row. Comments with no MEPFP impact are left
  out entirely; the log itself is the record of them. **When Setty is
  PRIME this rule is OFF** (see "Prime vs sub" above): every comment
  ingests as a full row with the responsible discipline/sub in the action.

**File: `file_qa_report`.** The report belongs in the project record, not
just the chat: file it into a new dated folder under "Design Reports and
Narratives" (`title` like 'QA Coordination Review' or 'Back-check — 100%
CD Resubmission'; markdown as contentText, docx/xlsx as contentBase64), pass
`reviewIds` with the review id(s) `record_qa_findings` returned so the QA
Reviews tab links the report from the review, and hand the user the
folder's webUrl. Record first, then file, so the ids exist. Filing never touches Outgoing and never
issues anything.

End by telling the user, in a few lines: how many punch-list items by
discipline and severity, what was recorded (review ids) and filed (the
link), and what the review did NOT cover.

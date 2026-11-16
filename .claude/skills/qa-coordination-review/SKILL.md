---
name: qa-coordination-review
description: >
  Run an internal QA review of a project's drawing set using the Setty PMS
  connector (setty-pms), in four passes: the firm's QA Deliverables Checklist
  item by item, the knowledge layer (project lessons, best practices, agency
  preferences, engineering standards), a general engineering sanity review,
  and a punch list for the team grouped by discipline. Use whenever someone
  asks for a QA review, internal coordination review, deliverable review,
  drawing review, or back-check of a submission, set, bulletin, or
  deliverable — "run QA on the Tabler set", "review the DD submission before
  it goes out", "coordination review for the 100% CD". Produces a punch list
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

## Run order — follow it top to bottom

Every review runs these steps in this order. Each step has its own section
below with the detail.

| # | Step | Output |
|---|---|---|
| 0 | **Setup**: lifecycle moment, prime vs sub, the set, the phase, index coverage | Report header |
| 1 | **Carry-over**: prior reviewer comments and open ledger findings, back-checked against this set | Carry-over section |
| 2 | **Backgrounds inventory**: what other disciplines' drawings we hold, and how current | Backgrounds section |
| 3 | **Pass 1 — Checklist**: every checklist item gets a disposition | Checklist coverage table |
| 4 | **Pass 2 — Knowledge layer**: lessons, best practices, agency preferences, engineering standards applied to this set | Knowledge section |
| 5 | **Pass 3 — Engineering review**: does the design make engineering sense | Engineering flags |
| 6 | **Punch list and report** | The deliverable |
| 7 | **Record and file**: ledger rows, report in SharePoint | Ledger ids, folder link |

Bulletin, addendum and back-check reviews add the **change record and
ripple analysis** (its own section) inside Pass 1.

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
   FIX-BEFORE-ISSUE: severity leans practical (what would embarrass us or
   draw comments), cost severity applies only if the job is already bid.
   This is the highest-leverage review — run every pass in full.
2. **Pre-issuance coordination comments.** Comments from the architect or
   other disciplines on the QAQC set ingest as `kind:'comment-log'`
   (`source:'architect'`/`'other'`) and are worked BEFORE issuance — the
   goal is that the official set goes out with those rows closed.
3. **Post-issuance: agency / AHJ / owner comments.** These arrive after the
   official submission, ingest as comment-logs with their source, carry
   priority over internal findings, and follow the human-close rule.
   Back-check runs against each subsequent bulletin.

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
  picking up each addendum/bulletin, comment routing, package completeness
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
   the current issued set. In CA, "the set" is the baseline full submission
   PLUS every bulletin/addendum after it — that composed view is what
   search_drawings' `currentSets` tier covers.
   - **A SPECIFIC set:** when the user (or the QA tab's set picker) names a
     set, that folder is the deliverable under review — pass it as
     `subfolder` to `search_drawings` / `extract_sheet_index` and say so in
     the report header. Default remains the composed current set.
   - **If the register comes back EMPTY** (`extract_sheet_index` with no
     subfolder says no set was ever logged as a transmittal — common on
     small CA jobs and on a first internal QA), that is NOT the end of the
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
   `DD Progress` → DD, `Bulletin #13` → Bulletin, `Addendum` → Bid. Say which
   phase you derived and from what.
3. **Check index coverage**: `search_drawings` with `indexOnly:true` until
   `coverage.currentSets.complete` (or you run out of budget — then report
   how far you got). Note `textlessFiles`: those sheets are invisible to text
   checks and must be listed in the report as unreviewed by machine.
4. **Note the disciplines and systems in the set** (from the sheet index:
   M, E, P, FP, FA, and the main systems — chilled water, emergency power,
   sprinklers...). Passes 2 and 3 are driven by this list.
5. `project_briefing` if you lack context on where the job stands.

## Step 1 — Carry-over: prior comments and open findings

Run this in EVERY review, not just back-checks. Reviewer comments on
previous issuances are the first thing a human reviewer would check the new
set against, and a review that skips them can pass a set that ignores the
owner's last round of comments.

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

**Back-check-only requests** ("a new bulletin landed, back-check it",
"the comments came back"): run Steps 0–1, the change record and ripple
analysis for the new set, then Steps 6–7. Passes 1–3 in full are for a
review of a deliverable.

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
   it.
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
4. **Cross-discipline items** (method below), congested areas first.
5. **Remaining assisted items**, life-safety and agency-rejection risk
   first, graphics/polish last.
6. **`manual` items**, if the checklist has any: list them verbatim as the
   reviewer's own checks, disposition `not attempted — reviewer's own
   check`. Do not attempt them.

Label every assisted result as needing human confirmation.

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

### Change record and cross-discipline ripple analysis (bulletins, addenda, back-checks)

Every revision of every sheet is indexed separately, so the system already
holds the change record: what revised, in which set, with the revision
block's own label ("BULLETIN #13") and the transmittal register's when and
to-whom. When reviewing a bulletin or back-checking, USE it:

1. **Diff the change.** For each sheet the set revised, compare against its
   prior revision — text for plans/notes, `read_drawing_schedule` per pinned
   `set` for schedules (the schedule diff is the high-value one: capacity,
   HP, V/Ph, MCA, weight, dimensions per tag).
2. **For every changed equipment parameter, run the ripple rules** and check
   whether each affected discipline's sheet ALSO revised in the same set (or
   a later one) — `find_equipment` names every sheet the tag touches, and
   the register knows which sheets each set revised. A fan upsized in a
   bulletin whose electrical sheets did not move is a finding, always.
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

3. **Report the ripple as its own finding**: "Bulletin #14 changed EF-7 from
   1 HP to 2 HP on M-601; its circuit on E-610 (panel LP-2, cct 14) was not
   revised in Bulletin #14 or since — verify breaker/feeder sizing." Cite
   both sides. When the counterpart DID revise, say so — that is the
   coordination working, and the record of it is worth as much as a catch.

These rules are a starting set; lessons learned extend them. Treat any
reviewer/RFI-driven change (the "owner wants the fan bigger" case) as the
highest-priority ripple candidate — externally-driven changes are the ones
most often made under time pressure by one discipline alone.

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

- **One list, numbered once** (P-1, P-2 ...), merging Step 1 carry-overs
  and the findings and flags of all three passes. The same problem found by
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
  the report**: sheets with revisions (`E-211 Rev 6 (Bulletin #13)`), what
  is wrong or to verify in one sentence, the action, severity, and where it
  came from (checklist id, lesson/practice/standard, engineering review,
  reviewer comment #, ripple). Mark `confirm` on anything that is a flag
  needing human confirmation before anyone redraws. Evidence detail lives
  in the sections below, keyed by the P-number.
- Do not assign items to named people — the PM does that. Discipline is as
  far as the list goes.

**Post-bid cost posture.** From bid issuance on, every change is a potential
change order. On any review of a bid set, bulletin, or addendum: state each
item's cost consequence explicitly; a design change that could have been
caught pre-bid is severity 'cost' at minimum; the ripple analysis asks not
only "did the other discipline pick it up" but "what does this change cost
now that a contractor holds a price".

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
severity, sheets, evidence, action). That is what makes the next bulletin's
back-check possible — an unrecorded finding cannot be back-checked and
quietly dies.

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
- **Every finding carries its `discipline`** — the punch-list group it sits
  in (Mechanical, Electrical, Plumbing, Fire Protection, Fire Alarm,
  Multi-discipline, PM / Project, or the subconsultant's discipline on a
  prime job). The QA Reviews tab groups and filters by it. For
  Multi-discipline items, name each discipline that has to act in
  `action`. Never name a person: the PM assigns people in the tab.
- Check the result's `failed` list and report any row that did not save.

External comment logs ingest the same way (`kind:'comment-log'`, one row
per comment, `externalRef` = comment number, `source` naming the
commenter) with two hard rules:

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
Narratives" (`title` like 'QA Coordination Review' or 'Back-check —
Bulletin #14'; markdown as contentText, docx/xlsx as contentBase64), pass
`reviewIds` with the review id(s) `record_qa_findings` returned so the QA
Reviews tab links the report from the review, and hand the user the
folder's webUrl. Record first, then file, so the ids exist. Filing never touches Outgoing and never
issues anything.

End by telling the user, in a few lines: how many punch-list items by
discipline and severity, what was recorded (review ids) and filed (the
link), and what the review did NOT cover.

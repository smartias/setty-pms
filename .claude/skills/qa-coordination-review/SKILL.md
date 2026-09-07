---
name: qa-coordination-review
description: >
  Run an internal coordination QA review of a project's issued drawing set
  against the firm's QA Deliverables Checklist, the project's open items, and
  the knowledge layer (lessons learned, agency preferences), using the Setty
  PMS connector (setty-pms). Use whenever someone asks for a QA review,
  internal coordination review, deliverable review, drawing review, or
  back-check of a submission, set, bulletin, or deliverable — "run QA on the
  Tabler set", "review the DD submission before it goes out", "coordination
  review for the 100% CD". Produces a findings report keyed to checklist item
  ids with sheet-level evidence for a human sign-off; it never marks checklist
  items complete and never files anything.
---

# QA Coordination Review

You are performing Setty's internal coordination review of an issued (or
about-to-issue) MEPFP drawing set. The deliverable is a findings report a
human reviewer signs off on. Three rules govern everything below:

1. **Evidence, not verdicts.** Every finding cites sheets, revisions, and the
   text or image that supports it. Every clean check states what was actually
   examined. You never mark a checklist item "passed" on the team's behalf —
   the report is input to their sign-off, and the wording of findings is
   "flag", "verify", "appears", never "violation" or "error" unless the
   evidence is mechanical (a duplicate sheet number is a fact; a clearance
   problem is a flag).
2. **Say what you could not check.** The review is only as good as the index
   coverage and the text layer. Report coverage numbers, textless sheets, and
   the manual-tier items prominently — a review that looks complete but
   silently skipped half the set is worse than no review.
3. **Read-only.** Nothing here writes to the PMS, the register, or SharePoint.

## Setup: scope, phase, checklist

1. **Resolve the project and the set under review.** `get_current_set` gives
   the current issued set (or the named deliverable if the user pointed at
   one — a specific bulletin, an about-to-issue folder). In CA, "the set" is
   the baseline full submission PLUS every bulletin/addendum after it — that
   composed view is what search_drawings' `currentSets` tier covers.
2. **Derive the phase from the deliverable/set name** — `100% CD` → CD,
   `DD Progress` → DD, `Bulletin #13` → Bulletin, `Addendum` → Bid. Say which
   phase you derived and from what.
3. **Fetch the checklist fresh**: `get_qa_checklist` with that `phase`. Never
   reuse a checklist from memory — QA edits it and lessons learned add rows.
   The result's `automation` classes drive the run plan below.
4. **Check index coverage**: `search_drawings` with `indexOnly:true` until
   `coverage.currentSets.complete` (or you run out of budget — then report
   how far you got). Note `textlessFiles`: those sheets are invisible to text
   checks and must be listed in the report as unreviewed by machine.
5. **Pull the project layer**: `list_action_items` (open items),
   `search_knowledge` for the project/agency (lessons learned, agency
   preferences), and `project_briefing` if you lack context on where the job
   stands. Open items and lessons feed the review: an open item that touches
   a discipline is a targeted check; a lesson learned is an extra checklist
   row in spirit even before QA formalizes it.

## Backgrounds inventory — ALWAYS run, ALWAYS report

MEPFP coordination is only checkable against the other disciplines'
CURRENT drawings, and those arrive as PDFs from outside. Before the tiers:

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
   cross-discipline items below can go — say so on each affected item.

## Cross-discipline clash screening (assisted — never sold as clash detection)

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

## External data dependencies — flag what the log cannot show

Some design inputs live OUTSIDE the drawing set: the utility's available
fault current, the hydrant flow test behind the FP hydraulic calcs, service
coordination confirmations, owner-provided data. The checklist's "External
Data Dependencies" section (qa-300+) drives this pass:

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

## Running the tiers

**Auto items** (each carries a `how` hint naming the tools — follow it):

- Sheet-set integrity (qa-003/004/151): `extract_sheet_index` for the
  register view; compare against distinct sheet numbers actually indexed.
  Duplicates, gaps in numbering runs, format drift.
- Placeholders (qa-032): `search_drawings` for TBD, VERIFY, XXX,
  "By Others", "Insert Here", Lorem — on the CURRENT sets tier. A hit on a
  superseded set is history, not a finding: check `stillPresentAtLatest`.
- Code versions (qa-011) and dates (qa-002): search for code-year strings;
  compare title-block revision dates across disciplines in the same set.
- Equipment tag reconciliation (qa-052/053/054, qa-201/202/203):
  `find_equipment` enumeration for the tag families, then per family:
  schedule side via `read_drawing_schedule` on the schedule sheets, plan
  side from the tag's sheet appearances. Report scheduled-but-not-shown,
  shown-but-not-scheduled, and duplicate tags. Respect the enumeration
  caveat (hyphenated tags only) and say so.
- Voltage/phase coordination (qa-060) and panel hygiene (qa-219):
  `read_drawing_schedule` on the M/P equipment schedules (V/Ph/MCA columns)
  and the E panel schedules; cross-check per tag.
- Schedule placeholders (qa-229): scan the schedule rows you already read
  for TBD/VERIFY/blank capacity cells.
- Prior-project bleed (qa-231): search for the names of a few other recent
  projects (from search_projects) in this set's text.

**Assisted items**: pick the highest-risk subset for the phase — you cannot
render every sheet. Good picks: detail callouts spot-check via
`trace_references`; title-block completeness from the index fields; agency
items against `search_agency_preferences`; then `view_drawing` (region zoom)
on the specific sheets your auto findings implicate, to confirm before
reporting. Label every assisted finding as needing human confirmation.

**Manual items**: list them verbatim at the end of the report as the
reviewer's own checks. Do not attempt them.

## The report

Lead with the findings that would embarrass the firm in front of the owner,
not with process. Structure:

```
# Internal Coordination Review — <project> — <set> (<phase>)
Reviewed <date> · Index coverage: <n>/<m> current-set files, <k> textless sheets unreviewed by machine

## Findings                    (numbered; each: checklist item id, sheets, evidence, suggested action)
## Verified clean              (auto checks that ran and found nothing — say what was examined)
## Needs human confirmation    (assisted flags, each with its evidence and the view_drawing call to see it)
## Not reviewed by machine     (manual-tier items + textless/unindexed sheets)
## Project layer               (open items and lessons learned that intersect the set)
```

Findings reference sheets as `E-211 Rev 6 (Bulletin #13)`. Severity is
ordered by consequence, not checklist order: **life-safety > agency
(rejection risk) > cost (significant cost exposure) > rfi-bait > polish** —
and at equal severity, EXTERNAL reviewer comments (agency above all, then
owner/architect) come before internal findings: someone else's unanswered
comment always outranks a house nit.

**Post-bid cost posture.** From bid issuance on, every change is a potential
change order. On any review of a bid set, bulletin, or addendum: state each
finding's cost consequence explicitly; a design change that could have been
caught pre-bid is severity 'cost' at minimum; the ripple analysis asks not
only "did the other discipline pick it up" but "what does this change cost
now that a contractor holds a price". The same lens applies when the
submittal reviewer (roadmap) lands: a submittal deviating from the bid
documents is a cost event, not just a technical one. If the user wants a file, produce the
report as a document via the open-items-log or docx skill conventions;
otherwise the chat report stands.

**Then persist: `record_qa_findings`.** After the user has seen the report,
write the findings into the ledger (one call: project, set, phase, coverage,
the findings with item ids/severity/sheets/evidence). That is what makes the
next bulletin's back-check possible — an unrecorded finding cannot be
back-checked and quietly dies. External comment logs ingest the same way
(`kind:'comment-log'`, one row per comment, `externalRef` = comment number,
`source` naming the commenter).

## Change record and cross-discipline ripple analysis

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
   bulletin whose electrical sheets did not move is a finding, always:

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

## Back-check mode

If the user asks to back-check (a new bulletin landed, or external review
comments came back): `list_qa_findings` for the project's open rows (ingest
a new comment log first via `record_qa_findings kind:'comment-log'` — the
registers live in the Email folder as `*COMMENTS*` files), and for each open
row verify the pickup on the NEWEST revision of the cited sheets
(`search_drawings` history / `read_drawing_schedule` / `view_drawing`).
Then move status with `update_qa_finding`, always with the evidence as the
note: internal (`source:'qa'`) rows may go straight to `closed`; EXTERNAL
rows (DrChecks, owner, architect, agency) go to `ready_to_backcheck` at
most — a human closes those, never an automated pass. A sheet not reissued
stays `open`; a deliberate no-fix is `dismissed` with the reasoning.

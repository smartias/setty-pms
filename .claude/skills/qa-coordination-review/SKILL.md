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
ordered by consequence (life safety / agency rejection / contractor RFI bait
/ polish), not by checklist order. If the user wants a file, produce the
report as a document via the open-items-log or docx skill conventions;
otherwise the chat report stands.

## Back-check mode

If the user asks to back-check (a new bulletin landed, or external review
comments came back): load the prior findings (or the comment log —
`list_project_documents` Email folder, `*COMMENTS*` files, read row by row),
and for each open item verify the pickup on the NEWEST revision of the cited
sheet (`search_drawings` history / `read_drawing_schedule` / `view_drawing`).
Report per item: evidence found (ready to close), no change detected (still
open), or sheet not reissued. For EXTERNAL comments (DrChecks, owner,
architect) never report "closed" — report "evidence found, ready to
backcheck"; the human closes those.

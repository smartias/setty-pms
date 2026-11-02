---
name: project-risk-review
description: >
  Run a project risk review for a Setty project using the PMS connector
  (setty-pms): schedule and deliverable risk, construction-administration
  backlog, QA and technical risk, and client/scope signals, each rated with
  the evidence that earned the rating. Use whenever someone asks about a
  project's risk, health, exposure, or trouble — "risk review on Tabler",
  "how healthy is SAPX176021", "what's our exposure on the BPL job", "is
  anything about to blow up on this project", "which of my projects needs
  attention". Produces a triage report for the PM or director to act on; it
  never changes PMS data, never closes or reassigns anything, and never
  contacts anyone.
---

# Project Risk Review

You are assessing one Setty project's risk for the PM or director who asked.
The deliverable is a rated triage report with evidence — a decision aid, not
a verdict. Every rating must trace to records you actually read; a section
you could not evidence is reported as NOT ASSESSED, never guessed.

## Orientation first

1. `get_project` — fee, phases, contractual role (prime vs sub), the team,
   and `relatedProjects`. A related-projects group (phases, sister
   buildings) shares risk: note siblings and, when the user asks about "the
   job", say which record you assessed.
2. `project_briefing` — the latest meeting minutes and review comments say
   what is actually going on. Read the `readNext` documents BEFORE rating
   anything: a milestone that looks stalled in the PMS may be on hold by
   agreement recorded in the minutes, and that is a different risk.
3. Today's date anchors everything. "Overdue" and "aging" are computed
   against it — state the as-of date in the report header.

## The four risk sections — rate each Red / Yellow / Green

Work all four unless the user narrows the scope. For each: gather, then
rate, then list the evidence rows that earned the rating. A section with no
data is NOT ASSESSED with one line saying what was missing.

### 1. Schedule & deliverables

`list_milestones` (include completed for context). Flags, strongest first:

- A due date in the past on a milestone under 100% — overdue. Pinned due
  dates (hand-set) outrank derived ones.
- Due within ~30 days with % complete far behind the time elapsed in its
  window — at risk. Say both numbers.
- No milestone activity and no filed correspondence for 60+ days on an
  active phase — a stalled project is a risk even when nothing is "late".
- Cross-check the minutes from `project_briefing`: a hold, a re-baseline,
  or an owner-caused delay recorded there reframes the flag — report the
  reframe, with the document cited.

### 2. CA backlog (RFIs & submittals)

`search_rfis_submittals` with `openOnly:true` on the project. Flags:

- Open RFIs past their due date, and any open item older than ~14 days with
  Setty as ball-in-court — age each from its received date.
- Submittals in review beyond ~10 working days; resubmittal loops (Rev 2+
  on the same number) — repeated rounds are a coordination-risk marker, not
  just a schedule one.
- `driveOnly` folders (filed on the drive, never logged): unlogged CA is
  invisible risk — list them and suggest `backload_ca_item`, do not run it.

### 3. QA & technical risk

`list_qa_findings` (default open + ready_to_backcheck), plus
`needsResponse:true` for unanswered external comments. Flags:

- Open findings with severity life-safety or agency — automatic Yellow
  floor for this section; life-safety older than one review cycle is Red.
- External comments (DrChecks/owner/agency) with no accepted response, and
  `commentLogsNotIngested` — a register sitting in the inbox is unworked
  risk nobody is tracking.
- `search_knowledge` for the project/discipline: approved lessons and
  `bestPractices` that plainly apply to this job's systems but have no
  corresponding closed finding or design response are latent risk — name
  the lesson/practice and where the gap shows. `search_agency_preferences`
  for the project's agency: an active requirement the record shows unmet is
  an agency-rejection risk.

### 4. Client & scope signals

`summarize_project_emails` (recent filed correspondence) and
`list_action_items` for the project. Flags:

- Escalation tone: repeated chasers on the same item, a director or owner
  principal entering a thread that was running at staff level, "per my last
  email" energy. Quote the shortest line that shows it, with date.
- Scope creep: requests in email for work not matching `get_project`'s
  `scopeContent` (the authoritative scope). Name the ask and the scope line
  it falls outside; suggest `get_add_service_template` as the follow-up,
  do not draft one unasked.
- Open action items owned by Setty with no visible movement.
- Email is a partial record — only FILED mail is visible. Say so in
  coverage whenever this section's rating leans on it.

## The report

Header: project number + name, as-of date, Setty's role, overall rating.
Overall = the worst section, unless one Yellow is purely administrative —
then say why you held the overall below it.

Per section: the rating, then findings as rows — **what / evidence (record
ids, dates, numbers) / suggested action / suggested owner** (from the
project team in `get_project`; never invent names). Keep suggested actions
small and concrete: "chase RFI 014 with the GC, 21 days in their court" is
actionable; "improve communication" is not.

Close with **Coverage** — what was not checkable (no filed email, textless
records, sections not assessed) — and the three items you would do first.

## Rules

- READ-ONLY. This skill never writes to the PMS: no status changes, no
  backfills, no follow-ups created, nothing sent. Suggest the write tool
  for the human instead.
- Ratings are triage, not judgment of the team. Keep the report free of
  blame language; attribute delays to records, not people, and never
  speculate about performance.
- Fee and billing figures from `get_project` may appear as context (e.g. a
  small-fee job with a large open-comment burden) but never estimate
  profitability or overrun — that is not in the record.
- A finding worth keeping (an agency behavior, a decision, a constraint)
  may be offered ONCE for `save_knowledge` under that tool's own rules —
  only after the user says yes.
- A portfolio question ("which of my projects needs attention") is a sweep,
  not a deep review: `list_action_items` (all projects) and open CA via
  `search_rfis_submittals` firm-wide, then offer the full review on the
  worst two or three. Do not run four sections on every project unasked.

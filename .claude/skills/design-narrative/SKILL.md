---
name: design-narrative
description: >
  Generate a design narrative / Basis of Design (BOD) for a Setty project
  using the PMS connector (setty-pms): built from the issued drawings, meeting
  notes, filed emails, and any PREVIOUS design narratives on the project,
  including a drawing index describing what each sheet shows, and the
  construction cost estimate when one has been entered in the PMS. Use whenever
  someone asks to generate, draft, update, or prepare a design narrative,
  BOD, basis of design, systems narrative, or engineer's report for a
  project or phase — "generate the design narrative for Tabler", "draft the
  DD BOD", "update the narrative for the CD submission". Produces an
  editable document for the engineer's review; it never invents design
  decisions — everything traces to the record.
---

# Design Narrative / Basis of Design

You are drafting the engineering narrative that accompanies a submission:
what systems are provided, why, to what criteria, and where each is shown.
Two rules above all:

1. **Every design statement traces to the record.** A decision comes from a
   meeting minute, an email, a prior narrative, or the drawings themselves —
   and contentious or unusual ones cite their source ("per 2026-03-12 OPM,
   owner directed…"). Where the record is silent, write the engineering
   default the DRAWINGS show and mark it clearly as read-from-drawings; where
   even the drawings are silent, leave a bracketed [ENGINEER TO CONFIRM: …]
   — never invent a basis.
2. **This is a draft for the engineer**, produced as an editable document.
   Say what was sourced from where at the end, and list every bracket left
   for them.

## Gather (in this order)

1. **Prior narratives** — `find_document` with docType 'Narrative' (and a
   name search for "narrative" / "basis of design" / "BOD"). A previous
   phase's narrative sets the structure, voice, and system descriptions to
   UPDATE rather than rewrite; read it in full with `read_document`. Also
   check the Design folders (internal calcs may carry criteria).
   A QA review leaves a "Design as read" narrative on the project's QA
   Reviews tab, and older QA report files in the "Design Reports and
   Narratives" folder carry a section of that name.
   That is NOT a prior narrative: it was read from the drawings by the QA
   review and no engineer wrote or approved it. Use it as a map of the set and of what the drawings
   do not state, and verify every value against the drawings yourself.
2. **The issued set** — `get_current_set` for what/when; derive the phase
   from the set name. `extract_sheet_index` (no subfolder) for the full
   current drawing list per discipline.
3. **Decisions** — `project_briefing`, `search_notes` (OPM minutes, design
   meetings), `search_emails` for directives ("owner selected", "VE",
   "proceed with"), and the QA ledger (`list_qa_findings`) for open items
   that belong in the narrative as qualifications.
4. **Systems facts from the drawings** — `read_drawing_schedule` on the
   schedule sheets for capacities and selections (chiller tonnage, DOAS
   CFM, service size); `search_drawings` for code summaries, design
   criteria blocks, and basis-of-design manufacturer callouts. Cite values
   AS SCHEDULED — the narrative must not contradict the drawings.
5. **External data** — fault current, flow test, utility coordination (the
   qa-300+ items): state them with their source and date, or bracket them.
6. **Construction cost** — `get_cost_estimates` with the project. It reads,
   and writes nothing, what the PMS Construction Costs tab holds: the
   construction cost on record and its history, and each saved cost
   estimate review (newest first) with the estimate's document, deliverable,
   date and preparer, its total and what the total includes, the
   mechanical / electrical / plumbing / fire protection / technology amounts
   and MEP share, the change since the estimate before it, the reviewer's
   open questions, and where the estimate and the drawings disagree.
   - Use the newest review whose deliverable is this phase, or the newest
     review if none names the phase; say which one you used.
   - Quote every figure exactly as stored, with the estimate's name and
     date. Never price, round, total or split anything yourself, and never
     include the A/E fee: construction cost only.
   - If the tool refuses for lack of the fees permission, say so in the
     sources list and leave `[ENGINEER TO CONFIRM: construction cost basis]`
     in the cost section; do not look for the number elsewhere.
   - Do not start a cost estimate review from here. If an estimate sits in
     the project folder but has no review in the PMS, name the file in the
     sources list and tell the user it can be reviewed with the
     cost-estimate-review skill (or "Send to Claude for review" on the
     Construction Costs tab), then rerun the narrative.

## Structure

Follow the prior narrative's outline when one exists. Otherwise:

1. **Project description & phase** — scope, building, delivery context.
2. **Codes & standards** — as cited on the 001-series sheets, per
   discipline; flag any cross-discipline disagreement instead of papering
   over it.
3. **Per-discipline Basis of Design** (M / E / P / FP, and T where present):
   design criteria (indoor/outdoor conditions, ventilation basis, service
   sizes, available fault current, flow test basis), systems provided (from
   plans, risers, schedules — with scheduled capacities), major equipment
   basis of design (manufacturer/model from schedules), and controls intent
   (from the sequence/control sheets).
4. **Construction cost estimate** — only when `get_cost_estimates` returned
   something. From the estimate review used: the estimate's name, the
   phase it prices, its date and who prepared it; the total construction
   cost and its basis as stated (what it includes and leaves out); the
   mechanical, electrical, plumbing, fire protection and technology amounts
   with the MEP share, for the disciplines the review broke out; and the
   change from the previous estimate, where the review gives one. A
   one-line cost history (each recorded figure with its date and source)
   when there are several. A discipline the estimate did not break out is
   "not broken out in the estimate", never estimated by you. With no
   estimate review but a figure in the history, give that figure, its date
   and its source in one sentence. With nothing recorded, leave the section
   out and say so in the sources list.
5. **Assumptions & qualifications** — open items log entries, unresolved
   QA/external-data findings, anything bracketed. Where the estimate review
   lists open questions or disagreements between the estimate and the
   drawings, add the high-severity ones here as `[ENGINEER TO CONFIRM: …]`
   items, worded as questions: they are the reviewer's notes, not decided
   positions, so they do not go in the narrative's body as fact.
6. **Drawing index** — every sheet in the current set, per discipline:
   sheet number, title, and ONE sentence on what it shows, written from the
   sheet title and (where a title is generic) the sheet's indexed content.
   Mark sheets added or revised since the prior narrative's phase.

## Output

Produce a .docx via the docx skill (firm letterhead conventions via
get_letterhead_template where wanted), or a clean markdown draft if the
user prefers chat. End with: sources used (documents, minutes, emails by
date, and the cost estimate review used, or "no cost estimate recorded in
the PMS"), and the list of [ENGINEER TO CONFIRM] brackets.

**Filing**: after the user has seen the draft, file it with
`file_qa_report` into a new dated folder under the project's "Design
Reports and Narratives" folder (`title` like 'DD Design Narrative'; docx
as contentBase64) and hand back the folder's webUrl. That folder is also
where the NEXT narrative run looks for the prior narrative. File nowhere
else, and never before the user has seen it.

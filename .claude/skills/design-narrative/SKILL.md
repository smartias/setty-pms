---
name: design-narrative
description: >
  Generate a design narrative / Basis of Design (BOD) for a Setty project
  using the PMS connector (setty-pms): built from the issued drawings, meeting
  notes, filed emails, and any PREVIOUS design narratives on the project,
  including a drawing index describing what each sheet shows. Use whenever
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
4. **Assumptions & qualifications** — open items log entries, unresolved
   QA/external-data findings, anything bracketed.
5. **Drawing index** — every sheet in the current set, per discipline:
   sheet number, title, and ONE sentence on what it shows, written from the
   sheet title and (where a title is generic) the sheet's indexed content.
   Mark sheets added or revised since the prior narrative's phase.

## Output

Produce a .docx via the docx skill (firm letterhead conventions via
get_letterhead_template where wanted), or a clean markdown draft if the
user prefers chat. End with: sources used (documents, minutes, emails by
date), and the list of [ENGINEER TO CONFIRM] brackets. Do not file the
document anywhere — hand it to the user.

---
name: cost-estimate-review
description: Read a construction cost estimate for a Setty project with the Setty PMS connector (setty-pms) and save a review of it to the PMS, where the engineer sees it on the Schedule tab. Works out the total construction cost and what the estimate carries for mechanical, electrical and plumbing (plus fire protection and technology when broken out), says what changed since the previous estimate, and, when asked, reconciles the estimate's MEP scope against the current issued drawing set. Use whenever someone asks to review, ingest, read, check or compare a cost estimate, opinion of probable cost, budget estimate or bid tabulation ("review the DD cost estimate on Tabler", "what is the MEP cost in this estimate", "what changed since the last estimate", "does the estimate match the drawings"), or sends one from the PMS with "Send to Claude for review". It records the estimate's total in the project's construction cost history. It never changes a fee, never prices anything itself, and never states a number the document does not contain.
---

# Cost estimate review

An estimator, construction manager or contractor prices the design. Setty is
usually asked to review the MEP part before a deliverable goes out. This skill
reads the estimate, pulls out what it carries for each of our disciplines,
compares it with the last estimate reviewed, and, when asked, checks its scope
against the drawings. The result is saved to the project and shown on the PMS
Schedule tab. The engineer decides what to say back to the estimator.

Three rules hold throughout:

- **Every number comes from the document.** A figure you worked out (adding
  lines, taking a markup off) is allowed only if its `basis` or `note` says how.
- **Do not price anything.** A scope item the estimate misses is a finding in
  words, never a dollar amount of your own.
- **Say what you could not determine.** A combined line you could not split,
  a sheet you could not read, a total with no stated basis: each goes in
  `unknowns`.

## Step 1 — Get the packet

`get_cost_estimate_packet` with the project (and the document name, if one was
given). It marks the review as under way in the PMS and returns:

- `estimateToReview` and `candidateDocuments`, each with an `itemId`. If the
  request names no document and more than one candidate could be the current
  estimate, ask the user which. `alreadyReviewed` marks one that has a review.
- `request.reconcileAgainstDrawings`: whether to run Step 5.
- `constructionCostOnRecord` and `costHistory`.
- `previousReviews`: the totals this estimate will be compared with.
- `startedNote`: read it. If it says the review cannot be saved, tell the user
  before doing the work.

If the estimate is not in `candidateDocuments` (the file index is refreshed
about daily), find it with `find_document` or `list_project_documents`; an
estimate that came by email is under the project's Emails folder
(`search_emails`, `read_email`).

## Step 2 — Read the estimate

`read_document` with the `itemId`. A workbook comes back sheet by sheet: read
the summary sheet and every MEP trade sheet. For a long PDF use `find` for
"SUMMARY", "DIVISION 23", "MECHANICAL", "ELECTRICAL", "PLUMBING" and `pages`
for the ranges. Pages marked `[OCR]` were read from an image: treat their
numbers as needing a second look, and say so in `unknowns` if you rely on one.

Note, from the document itself: who prepared it, its date, the design phase
and drawing set it prices, the gross area if given, and the stated assumptions
and exclusions.

## Step 3 — The total and the disciplines

**Total construction cost.** The bottom line for the base scope, with general
conditions, overhead and profit, contingency and escalation. Put exactly what
it includes and leaves out in `totalBasis` (alternates, soft costs, owner's
contingency, escalation date). If the document gives no project total (a
trade-only or MEP-only estimate), leave `total` out and set
`recordTotal: false`.

**Disciplines.** Take each from the estimate's own trade or division subtotal:

| Discipline | Usual CSI divisions | Usual headings |
| --- | --- | --- |
| `mechanical` | 23, 25 | HVAC, mechanical, building automation, controls |
| `electrical` | 26 | Electrical, power, lighting |
| `plumbing` | 22 | Plumbing |
| `fireProtection` | 21 | Fire suppression, sprinkler |
| `technology` | 27, 28 | Communications, fire alarm, security, AV |

- **One basis for all of them.** Estimates mark up in different places. If
  each trade line already carries its markups, use those. If markups are only
  at the bottom, give direct costs and say "direct cost, before general
  conditions, OH&P, contingency and escalation" in each `basis`. Do not spread
  markups yourself unless the estimate shows the percentages, and then say so.
- **Never split a combined line by guessing.** "Plumbing and fire protection"
  as one number goes under one discipline, with a `note` saying what is folded
  in, and a line in `unknowns`.
- **Fire alarm** is usually in Division 28 and sometimes inside electrical.
  Say where the estimate put it.
- A discipline the estimate does not break out is left out, not set to zero.
- Old-format estimates use Divisions 15 (mechanical, including plumbing and
  fire protection) and 16 (electrical). Report what they give and say so.

**Breakdown.** The larger line items under each discipline (air handling
units, chillers, ductwork, piping, controls, switchgear, feeders, lighting,
generator, fixtures). These are what make the next comparison useful. Twenty
to forty lines is plenty.

## Step 4 — What changed since the previous estimate

The dollar and percentage change for the total and each discipline is computed
when you save, from `previousReviews`. Your part is the reasons, in `notes`:

- Compare the `breakdown` lines and quantities where both estimates have them:
  scope added or removed, quantities, unit prices, a different markup.
- Say when the two are **not on the same basis** (one with markups and one
  without, a different escalation date, alternates moved into base). A change
  that is only a change of basis must not read as a cost increase.
- A reason you are inferring, not reading, is written as a question for the
  estimator.

With no previous review, say this is the first estimate reviewed. If the
project folder holds an earlier estimate that was never reviewed
(`candidateDocuments`), tell the user it can be reviewed too, oldest first, to
build the comparison.

## Step 5 — Reconcile against the drawings (only when asked)

Run this when `reconcileAgainstDrawings` is true or the user asks. It is a
scope check, not a re-estimate.

1. `get_current_set` for the set; name it exactly in `reconciliation.against`.
   If the estimate says which set it priced and that is not the current one,
   that is the first finding.
2. **Major equipment.** `read_drawing_schedule` on the M, P, E and FP
   schedules; `find_equipment` for tags. Compare counts and sizes with the
   estimate's lines: chillers, boilers, air handlers, pumps, fans, terminal
   units by count, switchgear, panels, transformers, generator, fixtures.
3. **Systems drawn and not priced.** Walk the sheet index
   (`extract_sheet_index`) and the equipment schedules for systems with no
   line in the estimate: a generator, a kitchen exhaust system, fire pump,
   lightning protection, a BMS, heat tracing.
4. **Priced and not drawn.** A line in the estimate with nothing on the
   drawings. Often an allowance: say so.
5. **Quantities far apart**, where the estimate gives quantities: fixture
   counts, device counts, panel counts.

Each difference is one finding: `severity` (high = a system or major equipment
missing or doubled; medium = a count or size that differs; low = a note),
`discipline`, `issue`, what the `estimate` carries, what the `drawings` show,
and the `sheets`. Before writing a finding, look for the thing under another
name or on another sheet; an estimate rolls small items into larger lines.

If the reconciliation cannot be done (no issued set in the index, an estimate
with no quantities or equipment lines), set `reconciliation.notRun` to the
reason and do not invent findings.

## Step 6 — Save and report

`save_cost_estimate_review` with the document (name and `itemId`),
`deliverable`, `estimateDate`, `preparedBy`, `total` and `totalBasis`,
`disciplines`, `breakdown`, `notes`, `unknowns`, and `reconciliation` when
Step 5 ran. The tool:

- refuses discipline amounts that add up to more than the total (one of them
  is on a different basis: fix and resend);
- returns `changesSincePrevious`;
- adds the total to the construction cost history, unless `recordTotal` is
  false. No fee changes.

Then tell the user, briefly:

1. The total and its basis.
2. Mechanical, electrical, plumbing: amount and share.
3. What moved since the previous estimate and why, where the document shows it.
4. Reconciliation findings, highest first, with sheets.
5. What could not be determined.

The review is on the project's Schedule tab in the PMS. It is a reading aid
for the engineer, not an approval of the estimate, and nothing is sent to the
estimator.

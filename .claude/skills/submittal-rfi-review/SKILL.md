---
name: submittal-rfi-review
description: >
  Review one construction-administration SUBMITTAL or RFI against the current
  issued drawing set and specs, using the Setty PMS connector (setty-pms), and
  produce a suggested response, internal notes to human-verify, and cost/scope
  red flags for the reviewing engineer. Use whenever someone asks to review,
  check, or draft a response to a submittal or RFI, or asks "what stamp should
  this submittal get", "is this substitution a problem", "draft a response to
  RFI 12", "review the VAV submittal against the drawings". Also backfills the
  log: if the item is not in the PMS yet (the Newforma cutover), it reads the
  filed submittal PDF or transmittal email, logs the record, then reviews it.
  Produces suggestions the engineer accepts or edits in the RFI/Submittal
  modal; it never sends anything and never changes the human's response or
  stamp on its own.
---

# Submittal / RFI Review

You are reviewing ONE construction-administration item — a submittal or an RFI —
for a Setty MEPFP engineer. The deliverable is a **suggested response** (plus a
suggested **stamp** for submittals), **internal notes** of what the reviewer must
verify by hand, and a list of **cost/scope red flags**. Everything is a
suggestion the engineer accepts, edits, or dismisses in the PMS; nothing you
produce is sent, and you never overwrite what a person already wrote.

Three rules govern everything below, same spirit as the coordination review:

1. **Evidence, not verdicts.** Every point cites the spec section, the schedule
   value, or the sheet and text that supports it. Compare the SUBMITTED value
   against the SPECIFIED / SCHEDULED basis of design and show both. Words are
   "appears", "verify", "flag" — not "violation" — unless the evidence is
   mechanical (a submitted voltage that is simply not what the panel provides).
2. **Say what you could not check.** The review is only as good as the spec and
   drawing coverage. If the spec section isn't in the project library, if the
   schedule sheet is textless, if a value needs the physical cut sheet a text
   pass can't read — say so in the coverage note and in the internal notes.
   A review that looks complete but silently skipped the governing spec
   paragraph is worse than no review.
3. **Read-only on the documents.** You never modify drawings, specs, or issue
   anything. The only writes are `backload_ca_item` (log the item) and
   `save_ca_review` (persist the suggestion onto the record) — both are
   version-guarded and neither touches SharePoint or the transmittal register.

## Post-bid cost posture — the reason this review exists

In CA, the bid documents are a contract and a contractor holds a price. Every
submittal is a chance to catch a **deviation from the bid documents** before it
becomes a change order or a claim, and every RFI response is a chance to create
one by answering loosely. So the cost lens is not an afterthought here — it is
the point:

- A submittal that substitutes a different manufacturer, model, capacity,
  voltage, or configuration than the basis of design is a **cost/scope event**,
  not just a technical one. Flag it even when the substitution is technically
  acceptable — the engineer decides whether accepting it gives away scope.
- An RFI answer that adds work, changes a detail, or resolves an ambiguity in
  the contractor's favor is a cost exposure. Draft the response so it stays
  within the contract documents and says so; flag where it can't.
- When the answer is genuinely a design change (the field condition forces it,
  the owner asked for it), say that plainly in the internal notes so the
  engineer routes it as a change, not a quiet giveaway.

For the voice and structure of a defensible field response — first-principles,
owner as the ultimate audience, never admitting fault — the
**engineering-judgment** skill is the reference; lean on it for the suggested
response wording on any contested RFI or rejected submittal.

## Step 0 — Resolve the item, or backfill it first

1. `read_rfi_submittal` (project + type + number) for the full text: the
   submittal description / the RFI question, spec section, discipline, status,
   any response already there, and linked items.
2. **If the item is NOT logged yet** (common during the Newforma cutover — the
   PDF or the Procore/Forma notification is filed but the log row doesn't
   exist), backfill it:
   - Find the source: `find_document` / `list_project_documents` for the
     submittal PDF or the transmittal folder; `search_emails` / `read_email`
     for the Procore/Forma notification email. Extract the number, spec section,
     discipline, dates, ball-in-court, and the description.
   - `backload_ca_item` with those fields and `sourceDoc` naming the file/email
     you pulled them from. It is append-only by number and idempotent — safe to
     call; it will not clobber an existing row (pass `update:true` only to merge
     into one you know is incomplete).
   - Then continue the review against the item you just logged.
3. Note the item's own **referenced drawings / spec section** — that is where
   the review starts.

## Step 1 — Establish the review basis (what you check against)

1. `get_current_set` for the composed current issued set — in CA that is the
   baseline submission plus every bulletin/addendum since. Say which set you
   reviewed against; it goes in `reviewedAgainstSet`.
2. **The governing spec.** For a submittal, the spec section is the contract
   requirement it must meet. `find_document` for the spec (docType Specification
   / the section number), or `search_drawings` for the section text if specs are
   indexed. Read the salient requirements: basis-of-design product, required
   performance, acceptable manufacturers, "or equal" language, submittal
   requirements. If the spec section is not in the library, SAY SO — you are
   then reviewing against the drawings only, which is a real coverage gap.
3. **The drawings.** `find_equipment` to locate the tag family the submittal
   covers and every sheet it touches; `read_drawing_schedule` on the schedule
   sheet for the scheduled capacities (CFM, GPM, HP, V/Ph, MCA, weight,
   dimensions); `view_drawing` on the plan/detail where it installs when
   clearance, connection, or configuration is in question. For an RFI, `trace_
   references` and `view_drawing` on the sheets the question is about.
4. `search_knowledge` for the project/agency — lessons learned and agency
   preferences that bear on this item (a manufacturer the owner has rejected
   before, a detail this agency always comments on).

## Step 2 — The review

**Submittal** — does the submitted product meet the contract, and what does
accepting it cost?

- Reconcile the SUBMITTED values against the SCHEDULED and SPECIFIED basis of
  design, field by field: model, capacity, electrical characteristics,
  dimensions/weight, accessories, finishes. Every mismatch is evidence.
- Run the ripple lens on any deviation, the same rules the coordination review
  uses: a changed HP/MCA ripples to the electrical circuit and panel; a changed
  weight ripples to structural support; a changed dimension ripples to
  clearances and connections. A submittal accepted without checking the ripple
  is how an uncoordinated change enters the job post-bid.
- Land a suggested **stamp** from Setty's vocabulary — **Approved**, **Approved
  as Noted**, **Revise and Resubmit**, **Rejected** — and justify it. "Approved
  as Noted" carries the notes that must go back; draft them. If it deviates from
  the bid documents, the stamp and the red flags must both reflect that even
  when the product itself is fine.

**RFI** — what do the contract documents actually say, and how do we answer
without giving away scope?

- Answer from the drawings and specs first: quote what the set already shows,
  so the response resolves the question by pointing at the contract rather than
  adding to it. Where the documents are genuinely silent or in conflict, say so
  and give the engineer the options with their cost consequence.
- Draft the suggested response in Setty's voice (engineering-judgment skill):
  direct, grounded in first principles, owner as the ultimate audience, no
  admission of fault.

**Internal notes** — for BOTH: what must a human verify before this goes out?
Values you could not confirm from the text (the physical cut sheet, a
performance curve, a field dimension), spec paragraphs the engineer should read
themselves, coordination with another discipline, anything the machine screened
but a person signs.

## Step 3 — Persist

Call **`save_ca_review`** with: `reviewedAgainstSet`, `specSections` checked,
an honest `coverage` note, the `suggestedResponse`, `suggestedStamp` (submittals
only), `internalNotes`, and `redFlags` (each with a severity — **life-safety >
agency > cost > rfi-bait > polish**).

- It writes an `aiReview` block onto the CA record; the RFI/Submittal modal
  shows it as an **accept/dismiss suggestion** and does NOT change the human's
  response or stamp. The engineer decides.
- Red flags of severity **life-safety, agency, or cost** are automatically
  mirrored into the **QA findings ledger** (the QA Reviews tab), so a deviation
  from the bid documents is tracked and back-checked like any other finding
  instead of being buried in one submittal. Set severities deliberately: a
  substitution with change-order exposure is `cost`; a submission the reviewing
  agency will bounce is `agency`.

Then present the review in the chat exactly as you saved it, lead with the red
flags and the suggested stamp/response, and tell the engineer it is waiting in
the item's modal for their sign-off. If they want it filed as a memo in the
project record, `file_qa_report` puts a markdown review memo under "Design
Reports and Narratives" — the same filing path the coordination review uses.

Never send an email, never mark the item responded/returned, never set the
stamp — those are the engineer's clicks in the PMS.

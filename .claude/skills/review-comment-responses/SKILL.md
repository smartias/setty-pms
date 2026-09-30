---
name: review-comment-responses
description: >
  Draft Setty's responses to external design-review comments (DrChecks,
  owner, architect, agency, code reviewer) for a project, using the Setty PMS
  connector (setty-pms): for every open comment in the QA ledger, verify what
  the current drawings show, choose a disposition (comply / partial / clarify
  / no-change / already-addressed / not-in-scope / defer), write the response
  in Setty's voice with the sheets and revisions it rests on, save the drafts
  with save_comment_responses so they appear in the PMS QA Reviews tab for
  the engineer's sign-off, and build the Comments & Responses register that
  goes back to the reviewer. Use whenever someone asks to respond to, answer,
  or draft responses for review comments, DrChecks, owner comments, agency
  comments, a comment log or comment register, a backcheck response, or says
  "the comments came back", "respond to the SUCF comments", "fill in the
  response column", "what do we say to comment 14". Also ingests a comment
  log that is not in the ledger yet. Drafts only: it never sends anything,
  never writes the human response, and never closes an external comment.
---

# Review Comment Responses

The reviewer sent a numbered list of comments. The deliverable back is the
same list with a **Setty response** beside every number, and it goes out
with (or ahead of) the revised set. This skill produces those responses as
**drafts the engineer accepts, edits, or rejects in the QA Reviews tab**,
and produces the register document. The comment rows already live in the
ledger (`pms_qa_findings`, one row per comment, `source` naming the
commenter, `external_ref` = the comment number, the review row's
`source_doc` = the log it came from); this skill adds the response side.

Three rules, same as every QA skill here:

1. **Evidence, not assertion.** Every response names the sheet and revision,
   schedule row, spec paragraph, or correspondence it rests on. "Comply" with
   no sheet cited is not a response. If the fix is not on the drawings yet,
   say what will change and where; do not describe a revision that has not
   been drawn.
2. **Say what you could not verify.** A textless sheet, a spec book not in
   the library, a field condition: name it in `needsVerify` so the engineer
   knows what to eyeball before it goes back. A response that reads finished
   but rests on an unchecked assumption is worse than a flagged one.
3. **Drafts only.** `save_comment_responses` writes the row's `ai_response`
   block and nothing else. The human response, the register that actually
   goes out, and any status close are the engineer's clicks. Never send an
   email; never move an external row past `ready_to_backcheck`.

## Step 0: Resolve the project, the role, and the log

1. `get_project` for the project. Establish **prime vs sub** the way the
   qa-coordination-review skill does: a job contracted directly with the
   owner agency with subconsultants under Setty is PRIME. It changes what a
   response can say (below).
2. `list_qa_findings` with `needsResponse:true`. That is the work list:
   external rows with no accepted response. Group by `review_id`; each group
   is one comment log (`pms_qa_reviews.source_doc`). If several logs are
   open, confirm with the user which one is going back now, or work them in
   date order and say so.
3. **If the result carries `commentLogsNotIngested`**, a register arrived by
   email that nobody ingested. Ask before ingesting unless the user pointed at
   that log; then read it (`read_email` with the recordId for the attachment,
   or `find_document` docType 'Comment Log' for the filed copy) and ingest
   with `record_qa_findings kind:'comment-log'`, `sourceDoc` = the attachment
   name, one row per comment, `externalRef` = the comment number, `source`
   naming the commenter. Prime/sub scope rule applies: on a sub job, comments
   outside MEPFP ingest only when they touch MEPFP work, titled "For
   reference: ..."; on a prime job every comment ingests as a full row.
4. If `list_qa_findings` returns nothing to respond to, say so and stop. Do
   not invent comments from a PDF you were not asked to ingest.

## Step 1: Establish what you are responding against

The response describes the drawings **as they will go back**, so pin the set:

- `get_current_set` for the current issued set, or the named resubmission /
  bulletin folder if the user pointed at one (a `QAQC/` folder is a
  pre-issuance set; responses drafted against it say "revised on the
  resubmission" not "revised on Bulletin #X").
- Note the set name; it goes in `respondingSet` on every draft so the tab
  shows which issue the response accompanies.
- `search_agency_preferences` for the reviewing agency (SUCF, DASNY, SCA,
  DDC, NYCHA...): known preferences and past rejections shape how firmly a
  no-change response can be worded and what a "comply" has to show.
- `search_knowledge` on the project and the agency for prior decisions the
  responses should be consistent with.

## Step 2: Verify each comment against the drawings

For every row in the work list, before drafting anything:

1. Read the comment (`title`, `evidence`, `sheets`, `external_ref`). The
   sheets cited by the reviewer are where to look first.
2. **Check the newest revision of each cited sheet**: `search_drawings` with
   the sheet number (the per-sheet `history` block says which revisions exist
   and whether the text changed), `read_drawing_schedule` for schedule values,
   `view_drawing` when the comment is about something graphic (clearance,
   routing, a symbol). Where the comment cites a spec, `find_document`
   docType 'Spec' and `read_document` with `find:` the section.
3. Decide what is TRUE now:
   - The requested change is on the newest revision: **comply**, cite the
     sheet and revision, describe the change in one clause.
   - Part of it is on the drawings and part is not, or will not be: **partial**,
     say which part and why the rest is not incorporated.
   - The drawings already answered it at the revision the reviewer had:
     **already-addressed**, cite where (sheet, detail, note number).
   - No change is warranted and the drawings, as they are, satisfy the intent:
     **clarify**, explain what the reviewer may have missed, cite it.
   - No change is warranted because the request conflicts with code, the
     design basis, or an owner decision on record: **no-change**, state the
     basis (code section, calc, meeting minute) plainly. This is the one
     disposition that needs the engineer's explicit agreement; always set
     `needsVerify`.
   - Outside Setty's contract: **not-in-scope**, name who owns it. On a SUB
     job this is the normal answer for architectural, structural and civil
     comments (the row is a "For reference" row). On a PRIME job this
     disposition is nearly never right: Setty is responsible for the
     subconsultant's answer, so the response names the sub and their pickup,
     and `needsVerify` says the sub must confirm.
   - Needs an owner decision, a survey, or belongs to a later phase: **defer**,
     say what decision or input is needed and when it will be addressed.
4. **Post-bid posture.** If the project is in bid or construction, a comment
   that forces a change is a cost event. The response still answers the
   comment; `needsVerify` says "post-bid change: confirm change-order handling
   with the PM before this goes back", and if the exposure is real, record it
   as a `cost` finding with `record_qa_findings` so the ledger tracks it.

Never mark a comment "complied" because the reviewer asked for something
reasonable. Only the drawings decide the disposition.

## Step 3: Write the response

Setty's voice (the **engineering-judgment** skill is the reference):

- 2 to 4 sentences. First word carries the disposition ("Complied.",
  "Clarification:", "No change:", "Noted; outside Setty's scope..."). Then the
  sheet and revision, then the substance.
- Name sheets with revisions: "M601 Rev 12", "E-402 (Bulletin #3)". Name spec
  sections by number. Name schedule tags.
- No hedging words ("we believe", "should"). No apologies. No promises about
  cost or schedule. Where the engineer must decide, the sentence goes in
  `needsVerify`, not in the response.
- A reviewer who is wrong is answered with the code section or the calc, not
  with adjectives. Where Setty was wrong, say what changed and where, without
  narrative.
- Comments raised on the same issue across several sheets get consistent
  wording; say "See response to comment N" only when the register format
  allows cross-reference, otherwise repeat the answer.

## Step 4: Persist the drafts

Call **`save_comment_responses`** once per comment log (up to 50 responses a
call): `projectNumber`, `respondingSet`, and for each row `findingId`,
`disposition`, `responseText`, `evidence` (the verification from Step 2),
`sheets` with revisions, `needsVerify` where anything is unconfirmed, and
`docLinks` for every sheet and spec the response cites (`webUrl` from
`get_current_set`, `search_drawings`, or `find_document`; https only).

- It writes each row's `ai_response` block. The QA Reviews tab shows it as a
  **draft with Accept / Edit & accept** on the row; accepting writes the human
  response with the engineer's name. Nothing was returned to the reviewer.
- A row that already carries a human response is reported
  `humanResponseExists`; your draft sits beside it and does not replace it.
  Say so in the chat.
- **Status is separate.** For a `comply` whose change is on the newest
  revision, `update_qa_finding` to `ready_to_backcheck` with the sheet and
  revision as the note (the tool stamps it "Auto-backcheck: ..."). External
  rows are NEVER closed here; a person confirms. `not-in-scope` and `defer`
  rows stay `open`. Do not dismiss anything.

## Step 5: The register that goes back

Reviewers want their own list back with the response column filled, in their
format where one exists (a DrChecks export is answered in DrChecks by the
engineer; the register you build is the working copy). Build it with the
**xlsx** skill (or docx if the log arrived as a Word table):

| Comment # | Reviewer | Sheet / Section | Comment | Disposition | Setty Response | Revised sheets |

One row per ledger row, in the reviewer's numbering order, the response text
exactly as saved. Add a short cover block: project, set the responses
accompany, date, "DRAFT: pending engineer review" until the engineer says
otherwise. Then **`file_qa_report`** with title `Review Comment Responses -
<source_doc without extension>` so the register lands in a dated folder
under Design Reports and Narratives, and hand back the folder link.

## Report in the chat

Lead with counts by disposition, then the `no-change` and `defer` rows in
full (those are the ones the engineer will argue with), then everything
flagged `needsVerify`, then the link to the filed register. Say plainly:
"Drafts are in QA Reviews for your sign-off; nothing has gone back to the
reviewer."

## Do not

- Do not write a response for an internal finding (`source` qa / ripple /
  submittal / rfi). The tool refuses them; do not try to route around it.
- Do not describe a drawing change that is not on a revision you read.
- Do not send, forward, or draft an email to the reviewer unless asked, and
  then only as a draft for the engineer.
- Do not close or dismiss an external row.

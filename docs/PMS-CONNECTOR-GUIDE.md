# Setty PMS in Claude: how to use the connector

The Setty PMS connector lets Claude read the project record, filed email, documents, issued drawings, RFIs, submittals and the QA ledger, and draft back into the PMS. This is the user guide; the shareable page is published from it.

## Connect once

1. In Claude, open Settings, then Connectors, and click Connect on Setty PMS.
2. Sign in with your Setty Microsoft account. If a permissions screen appears, accept it. The sign-in renews itself.
3. Start a new chat and ask about a project.

## How to ask

**Name the project.** Give the project number when you have it (SAPX256014.00). The name works too, and pipeline projects only have a name. One project per question keeps answers clean.

**Say what you want back.** A list, a summary, a draft, a table. Claude picks the right tool from how you phrase the ask.

**Ask for the source.** "Which sheet?", "Which email?", "Link it." Every answer can point at the file, sheet or record it came from. Check it before you act on it.

**Keep going.** Follow-up questions keep the project context. "And the electrical?" after a mechanical question works.

**Save what matters.** "Save that" writes a finding to the shared project knowledge so the next person finds it.

## Prompts that work

Project numbers are real jobs; swap in yours.

### Catch me up

Start here for any project you have not looked at in a while.

- `Catch me up on SAPX256014.00`  
  One call pulls the record, the latest meeting minutes, open items, recent email and what is due next.
- `What is due in the next two weeks on the Tabler project?`  
  Milestones with pinned dates come back first.
- `Which of my projects have overdue milestones or open action items?`  
  Works across everything your role can see.

### Documents and folders

Describe the document; you do not need to know where it lives.

- `Find the current fire protection narrative for SIPX252003.00`  
  Ranked by filename, the Outgoing folder and recency, with a link to open it.
- `Show me the folder tree for SAPX239010.00 under Outgoing`  
  Browse a known folder when you want to see what is actually there.
- `Read the 100% CD basis of design for the Lynchburg Library and summarize the HVAC approach`  
  Reads PDF, Word and Excel. Long files come back in pages.

### Drawings

Claude can search the text on issued sheets, look at a sheet, and read schedules.

- `Which sheets on SAPX229002.00 show FCU-11?`  
  Searches equipment tags, keynotes, room names and notes. Tags with or without hyphens both work.
- `What is the current issued set for the Queens College accessibility project?`  
  Comes from the transmittal register, with the sheet index and revisions.
- `Read the AHU schedule on M-601 for SAPX249006.00 and list the CFM for each unit`  
  Schedules come back as rows you can put in a table.
- `Show me sheet E-201 so I can see the panel locations`  
  Renders the sheet as an image so Claude can describe what is drawn.

### RFIs and submittals

Review one item at a time against the current set.

- `List the open RFIs on SAPX256011.00 and who is waiting on us`  
  Filter by status, discipline or keyword.
- `Review submittal 23-05-00-004 on the Vanderbilt project against the drawings and draft a response`  
  Claude checks the marked selection on the cut sheet against what was specified and suggests a stamp. You decide.
- `Which sheets does RFI 017 refer to, and are they still current?`  
  References are checked against the register so superseded sheets are flagged.

### QA reviews

Internal coordination reviews and external comment logs live in the QA ledger.

- `Run a QA coordination review on the 100% CD set for SIPX261005.00`  
  Works the firm's checklist against the issued set and writes findings to the ledger for your sign-off.
- `The DASNY comments came back on SAPX176006.00. Draft our responses.`  
  Each draft names the sheets it rests on and lands in the QA Reviews tab for you to edit.
- `What is still open in the QA ledger for the GU Elstad project?`  
  Shows internal findings and external comments with their live status.

### Email and notes

Filed project email and OneNote notes are searchable.

- `Summarize the last two weeks of email on SAPX239010.00`  
  Full bodies, newest first.
- `Find the email where the owner approved the chiller substitution`  
  Searches subject, sender, body and attachment names.
- `What did we agree with the architect at the last site meeting on the UMD Thrive Center?`  
  Meeting notes and action items, with the OneNote link.

### People and firms

The firm directory covers about 2,600 outside contacts and the staff roster.

- `Get me Daniel H from Dattner's email`  
  First name plus an initial is enough.
- `Who do we know for cost estimating on SCA work? WBE preferred.`  
  Searches by what a firm does and what it is certified as, and says whether we have worked with them.
- `What work is running under the Perkins Eastman master agreement?`  
  Term contracts and the task orders under each.

### Firm knowledge and standards

Reviewed knowledge, agency preferences and engineering standards are all searchable.

- `What is our standard for chilled water pipe insulation?`  
  The firm's design-basis positions, each with its code or spec source.
- `How does CUNY want submittals handled?`  
  Verified process rules per agency.
- `Save that: DASNY rejected the VFD substitution on this project because of harmonics`  
  "Save that" or "add this to the project record" writes a durable finding others can find.

### Proposals and templates

Formal documents start from the firm's templates, never from scratch.

- `Draft an additional services letter on SAPX256014.00 for the added commissioning scope`  
  Uses the firm's add-service template with the project details filled in.
- `Draft a letter to the owner on letterhead about the schedule change`  
  Letterhead format with placeholders you complete.

### Field photos

Photos from the Field Photos app are searchable by project, phase and date.

- `Show me the rough-in photos from the last site visit on SAPX229002.00`  
  Claude can look at the photos and describe equipment, nameplates and conditions.

## Bigger jobs Claude knows how to run

Four workflows are set up as skills. Ask in plain words; Claude follows the firm's procedure and produces a draft for your review. It never files, sends or closes anything on its own.

**Design narrative.** "Draft the DD basis of design for SAPX239010.00" builds a narrative from the issued drawings, notes, filed email and any earlier narratives, with a drawing index. Everything traces to the record; you edit before it goes anywhere.

**QA coordination review.** "Run QA on the 100% CD set for the Thrive Center" works the QA Deliverables Checklist against the set and the project's open items. Findings go to the ledger keyed to checklist items for your sign-off.

**Review comment responses.** "Respond to the DrChecks comments on SIPX268014.00" drafts a disposition and response for every open comment and builds the register that goes back to the reviewer. You approve each one.

**Submittal and RFI review.** "Review the VAV submittal against the drawings" checks the marked selection on the cut sheet against the schedule and spec, suggests a stamp and response, and flags cost or scope red flags.

## What to expect

**It only shows what your PMS role allows.** Fee and billing fields are hidden unless you have the fees permission. A project you cannot see in the PMS does not exist for Claude either. A PMS admin can change access.

**New projects need setting up first.** A job that was just won or transferred is not searchable until it has a PMS record. If Claude says no project carries the number, ask a PMS admin.

**Documents refresh about daily.** Claude searches a file index that is rebuilt roughly every day. For a file added an hour ago, ask Claude to browse the folder live instead.

**Drawings index as you go.** The first search on a project reads a few sheets; ask the same question again to index more. Projects people use are now pre-indexed in the background.

**Archived projects are hidden by default.** Say "include archived" to search closed-out work.

**It drafts; it does not send.** Claude never sends email, issues a transmittal or closes a comment. Drafts land in the PMS for you to review and act on.

**Verify sheet references.** Claude reads text layers and can misread a scanned sheet. If a sheet reference matters, open it.

## When something is off

**The connector shows disconnected.** Open Settings, Connectors, Setty PMS, and reconnect. You will sign in with your Setty Microsoft account once. Since October 8 the sign-in renews itself; if it keeps dropping, tell Sara with the time it happened.

**"No project matching".** Check the number (the .00 phase suffix is optional). If the job is new, it may not be set up yet; ask a PMS admin.

**A document is missing from results.** Ask Claude to browse the folder live, or check the file is actually in the project's SharePoint folder. The daily index will pick it up.

**Something looks wrong.** Send Sara or Nikhil the question you asked and the time. Every call is logged and can be traced.

Maintained by Sara Arias. Send new prompts and questions to Sara and they will be added here.

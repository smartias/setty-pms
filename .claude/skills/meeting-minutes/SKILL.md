---
name: meeting-minutes
description: >
  Turn a voice memo transcript or rough typed notes from a meeting into
  minutes in Setty's format and file them to the project with the Setty PMS
  connector (setty-pms): decisions, action items with an owner and a date,
  and open items. Use whenever someone gives you what happened in a meeting
  and wants it written up or filed: "here's my voice memo from the OAC
  meeting", "write up minutes for today's coordination call on Tabler",
  "file these meeting notes", "minutes for the site walk". Drafts first and
  files only after the user approves the draft. On approval, action items
  owned by Setty staff become tracked action items and what outside parties
  owe goes on the user's follow-up list. Never emails the minutes to anyone,
  never invents a decision, owner or date that the user did not give.
---

# Meeting Minutes

You are writing up one meeting for the person who was in it. Their input is
short and after the fact: a two-minute voice memo transcript, or rough notes.
The deliverable is minutes they can send and a filed record the project team
can find. The memo is the only source. A decision, owner or date that is not
in it is not in the minutes.

## 1. Get the four facts

Before drafting you need:

1. **The project.** `search_projects` with the name or number they used. If
   two projects fit, ask which. If none fits, say so and stop.
2. **The date** the meeting happened. "Today" is today's date; anything else
   unclear, ask.
3. **What the meeting was**: a short title, for example "Design coordination
   meeting with Dattner" or "OAC meeting 12". Two meetings on the same
   project and day need different titles: the title is how a second filing
   of the same meeting is recognised.
4. **Who was there**, as far as the memo says. Do not pad the list.

Ask for all the missing ones in one message, not one at a time. Do not ask
for anything else.

## 2. Draft the minutes

Use exactly this layout. Leave a section out when it has nothing in it.

    MEETING MINUTES
    Project:    <number> <name>
    Meeting:    <title>
    Date:       <Month D, YYYY>
    Attendees:  <Name (Firm)>, ...
    Prepared by: <the user>

    DECISIONS
    1. <What was settled, in one sentence that stands on its own.>

    ACTION ITEMS
    1. <What is owed.>  Owner: <name or firm>.  Due: <date, or "not set">.

    OPEN ITEMS
    1. <What is unresolved and what it is waiting on.>

    DISCUSSION
    <Short paragraphs by topic. Only what the memo supports.>

    Please send corrections within 3 business days; otherwise these minutes
    stand as the record of the meeting.

Rules for the items:

- **Decision**: something settled. "We talked about moving the AHU" is
  discussion; "the AHU moves to the roof" is a decision.
- **Action item**: a named person or firm owes something. Write it so it
  reads correctly on a list with no other context: "Send revised panel
  schedule for LP-2 to Dattner", not "send the schedule".
- **Open item**: unresolved and nobody committed to resolve it. If somebody
  did commit, it is an action item.
- **Owner**: who the memo says. "I'll do it" is the user. If the memo names
  no owner for an action item, write "Owner: not set" and list it under the
  questions below. Do not guess from who usually does that work.
- **Due date**: only a date that was stated or clearly agreed ("by Friday"
  is a date; work it out from the meeting date). "Soon" and "ASAP" are not
  dates: write "not set".
- Keep the user's facts and numbers exactly. Fix grammar, not content.
- One item per commitment. A sentence carrying two commitments is two items.

## 3. Show the draft and ask once

Show the whole draft in the chat. Under it, list in one short block:

- every action item with no owner or no date, as a question;
- anything in the memo you could not place or could not understand, quoted.

Then ask whether to file it. Change what they ask you to change and show the
changed part again. Do not file on silence, and do not file a draft the user
has not seen in its final form.

## 4. File it

Only after the user says to file, call `file_meeting_minutes` once:

- `projectNumber`, `meetingDate` (YYYY-MM-DD), `title`, `attendees`.
- `meetingType`: `internal` when only Setty staff attended, `site` for a
  site visit, otherwise `client`.
- `minutes`: the DISCUSSION text, and the corrections line.
- `items`: every decision, action item and open item from the draft, one
  entry each, worded as in the draft. `owner` is the name as written; use
  `me` for the user. Set `ownerIsSetty: true` only when you know the owner
  is Setty staff and the name is a nickname or partial. Leave `dueDate` out
  when the draft says "not set".
- `confirmed: true`, because the user read the items and said to file them.
  If you are filing something the user has NOT read item by item (a batch,
  an old transcript they handed over unread), leave `confirmed` out.

## 5. Report what happened

Read the response and tell the user plainly, in a few lines:

- that the minutes are filed, on which project;
- how many action items are now **tracked** on the project
  (`counts.trackedActionItems`) and how many **follow-ups** were added to
  their list (`counts.followupsCreated`), naming who owes each;
- anything **held for review** (`heldForReview`): say why, in the response's
  words, and that it is confirmed in the Intelligence console under Meeting
  Items. Held is not tracked; do not say it is;
- any action item with no owner (`unowned`): nothing tracks it until it has
  one;
- `alreadyFiled: true` means nothing was written because this meeting is
  already on file. Say that, and show what is on file;
- that nothing was emailed. Offer the minutes text ready to paste into an
  email to the attendees; sending it is theirs to do.

If the tool returns an error, give the user the error and its `nextStep`.
Do not try another tool to get around it, and do not tell them it is filed.

## What this skill never does

- Email or share the minutes with anyone.
- Add a decision, owner, date or attendee the user did not give.
- File before the user has approved the final draft.
- Close, edit or reject items already on file: that is done by a reviewer in
  the Intelligence console.

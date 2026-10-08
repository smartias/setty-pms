# Setty PMS connector in Claude: quick start

**What it is.** A connector that lets Claude read the live PMS, project files, filed emails, meeting minutes, drawings, RFIs and submittals, and the firm Knowledgebase, so you can ask questions in plain English instead of hunting through folders. It is read-only except for the few things listed under "What it can save."

## Connect it (one time, about 60 seconds)

1. Open Claude and go to **Settings > Connectors**.
2. Find **SETTY PMS** in the list and click **Connect**. [confirm exact connector name]
3. A Microsoft sign-in opens in your browser. Sign in with your **@setty.com** account. If you are already signed into Windows or Edge with it, this is one click.
4. Return to Claude and start a **new conversation**. Open the tools menu and check that SETTY PMS is switched on.

What you can see depends on your PMS role. Fee information and Confidential projects are hidden from people who are not cleared for them. That is by design.

## Try these first

Name the project (number or short name) in your question.

| You want | Ask |
|---|---|
| A status update | "Give me a briefing on 280 Broadway." |
| A document | "Find the latest mechanical specs for Tabler." |
| Meeting history | "What did we decide about the chillers in the last three design meetings on 280 Broadway?" |
| Open work | "What are the open action items on Tabler?" |
| RFIs and submittals | "List open RFIs and submittals on 280 Broadway and flag anything overdue." |
| Drawings | "Which sheets show the AHU-3 schedule, and what is the current set?" |
| Equipment | "Where is VAV-1204 shown and scheduled?" |
| Emails | "Summarize the filed emails on Tabler since September." |
| A person or company | "Who is our contact at the owner's rep on 280 Broadway?" |
| Firm knowledge | "What lessons learned do we have on rooftop unit curb coordination?" |

Ask for sources. Claude can cite the file or meeting it read, and you should open it before relying on anything that goes in a deliverable.

## What it can save

- **Knowledge entries and QA findings** are saved as suggestions for an engineer to review. Nothing is final until a person signs off.
- **Draft comment responses** appear in the PMS QA Reviews tab for the engineer to edit and approve.
- Files can be uploaded to a project's SharePoint folder when you ask for it.

It never sends email, never closes a review comment, and never marks a checklist item complete on its own.

## Habits that help

- **One question at a time works best.** Very large requests (for example "review every project") run many lookups at once and are the most likely to time out. Split them up.
- **Start a new conversation** if answers get odd or tools go missing. Long conversations drift.
- **Name the project.** Without it, Claude has to search first, which is slower and less reliable.
- **Check dates.** Ask which set or revision it used, and confirm it is current.

## If it stops working

1. Start a new conversation and try again.
2. **Settings > Connectors > SETTY PMS**: disconnect, then connect again. This fixes most "it asked me to sign in again" problems, because the Microsoft sign-in expires after about an hour of inactivity.
3. Still stuck? Email **itissues@setty.com** with the time, the project and what you asked. The time matters: IT can match it to the server logs.

## Who to ask

Questions about how to use it: [name]. Access or role problems: [name, PMS admin]. Outages: itissues@setty.com.

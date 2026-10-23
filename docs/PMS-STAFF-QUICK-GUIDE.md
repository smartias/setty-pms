# Setty PMS: quick help for staff

One page for everyone using the PMS, the Outlook add-in and the Claude connector.
Try the fixes in section 2 before you report anything; they clear most problems.

> Fill in before sharing: the PMS web address, the Teams channel for questions,
> and the names in section 6.

## 1. What you are using

| Tool | What it is | How you open it |
|---|---|---|
| **PMS** | The project record: projects, milestones, RFIs, submittals, QA reviews, notes, proposals | Browser, at https://smartias.github.io/setty-pms/SettyPMS.html#dashboard. Bookmark it. |
| **Outlook add-in** | Files an email to a project's log from inside Outlook, and offers a "suggested project" for the email you are reading | The Setty PMS button in Outlook's ribbon. It is installed for you centrally. |
| **Claude connector** | Lets Claude answer questions about a project from the PMS record, filed email, documents and drawings, and draft back into the PMS | Claude, then Settings, Connectors, Setty PMS. See the [connector guide](PMS-CONNECTOR-GUIDE.md). |
| **Field Photos** | Phone app for site photos, tied to a project | Install from the link your office shares. |

You sign in to all of them with your Setty Microsoft account. There is no separate PMS password.

## 2. Try this first

Work down the list and stop when it is fixed.

1. **A blue banner says "New version available"**: click **Reload**. You were running an old copy of the app.
2. **Hard refresh the page**: Ctrl+Shift+R on Windows, Cmd+Shift+R on Mac. This forces the browser to fetch the current version.
3. **A banner says "Your Microsoft session expired"**: click **Reconnect** and sign in. Nothing on the page is lost.
4. **Sign out, close every PMS tab, open one tab, sign in again.** Having two PMS tabs open at once is the most common cause of odd behaviour.
5. **Still stuck**: report it (section 6). Do not keep retrying a save that fails.

## 3. Messages you may see

**"Someone else saved this project while you were editing."**
Two people edited the same project at the same time. The PMS shows you each field that differs and asks which value to keep. Choose per field and save. Nothing was lost on either side.

**"Your Microsoft session expired, so SharePoint/Teams can't be reached."**
Click Reconnect. Microsoft signs people out after a while; the PMS keeps your work while you sign back in.

**"New version available (date). Reload to update."**
A fix went out while your tab was open. Reload.

**In Claude: "No project matching..."**
Check the number. The `.00` suffix is optional. If the job was won or transferred recently it may not have a PMS record yet; ask a PMS admin.

**In Claude: the connector shows disconnected.**
Settings, Connectors, Setty PMS, Reconnect. You sign in once with your Setty account.

**In Outlook: "The Setty PMS add-in has moved."**
Your Outlook is pointing at an old copy of the add-in. Remove the Setty add-in from Outlook and ask IT for the current install. You cannot fix this yourself by signing in again.

## 4. Things that are not bugs

- **A new project is not in the PMS or Claude.** Projects need a record before anyone can see them. Ask a PMS admin to register it.
- **You can see every project, including other offices.** That is by design. Marking a project Confidential hides it from the Claude connector only; everyone signed in can still open it in the PMS web app. If a job must stay private, keep it out of the PMS for now.
- **You cannot see fee or billing fields.** Those are hidden unless your role has the fees permission.
- **A file you added an hour ago is not in Claude's results.** The document index rebuilds about daily. Ask Claude to browse the folder live instead.
- **Closed-out projects are missing from Claude.** Say "include archived".
- **Claude found a sheet reference that looks wrong.** It reads drawing text and can misread a scan. Open the sheet before you act on it.
- **Claude will not send the email or issue the transmittal.** It drafts into the PMS for you to review and send. That is deliberate.

## 5. Good habits

- One PMS tab at a time.
- When an admin says the staff list or a project was changed outside the PMS, refresh your tab before editing.
- Get SharePoint links from the PMS folder button, not by typing a path.
- In Claude, name one project per question and ask for the source ("which sheet?", "which email?").

## 6. How to report a problem

Post in `<Teams channel>` or message `<PMS contact>`. Include:

1. Which tool: PMS, Outlook add-in, Claude connector or Field Photos.
2. The project number.
3. What you did and what you expected.
4. The exact message on screen. A screenshot is best.
5. The time it happened. Every call is logged, and the time is how it gets traced.
6. Whether steps 1 to 4 in section 2 changed anything.

"It doesn't work" with a time and a screenshot gets fixed the same day. Without them it usually cannot be found.

## 7. For PMS admins

The admin side (adding people, roles, registering projects, scanning drives, the Outlook add-in deployment) is in the [onboarding runbook](../ONBOARDING-RUNBOOK.md). Debugging notes for the code are in `CLAUDE.md` at the repository root.

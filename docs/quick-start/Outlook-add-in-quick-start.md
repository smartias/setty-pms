# Setty PMS Outlook add-in: quick start

**What it is.** An add-in inside Outlook that matches the email you are reading to a PMS project and lets you file it to that project's email log, so the record lives with the project and Claude can find it later.

> DRAFT NOTE FOR IT: The add-in source is in the separate `smartias/setty-pms-addin` repository, which I could not read. Everything below comes from `ONBOARDING-RUNBOOK.md` in this repo. Items marked [confirm] need checking against the live add-in before this goes to staff. Add screenshots for each step.

## Open it

1. In Outlook, open any email.
2. On the ribbon, click the **Setty PMS** button. [confirm button name and location in new Outlook vs classic]
3. The first time, sign in with your **@setty.com** account when the task pane opens.

If the pane says the add-in has moved or cannot sign in, it needs to be reinstalled. Ask IT for the current manifest, remove the old Setty add-in, and install the new one.

## File an email to a project

1. Open the email you want to file.
2. Look at the **suggested project** card in the task pane. The add-in matches the email to a registered project.
3. If the suggestion is right, click **Confirm**. The email is filed to that project's log.
4. If it is wrong or missing, choose the project yourself. [confirm: is there a project picker?]

Only projects that are registered in the PMS can be suggested. If yours is missing, ask the project's PM to check that it is set up.

## Why it matters

Filed emails are what the PMS connector in Claude searches and summarizes. An email that is never filed cannot appear in a project briefing or an email summary. Filing takes seconds and is the single most useful habit for getting good answers from Claude.

## Also in Word [confirm]

The same add-in has a Word surface. [confirm what it does for staff, for example proposal drafting or letterhead templates, before describing it]

## If it does not work

1. Close and reopen the email, then reopen the pane.
2. Sign out and back in from the pane. [confirm location]
3. Still stuck? Email **itissues@setty.com** with the time and what you saw.

## Who to ask

Questions about using it: [name]. Installation or sign-in problems: itissues@setty.com.

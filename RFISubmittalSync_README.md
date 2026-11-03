# RFI / Submittal Tracker

A focused, lightweight companion to SettyPMS for **logging and tracking RFIs and submittals
on Construction-Administration jobs** — either by hand, or by pulling them straight out of
**Procore / Autodesk Forma** notification emails so staff don't re-key them.

It is a **separate app, but shares the PMS data**: it reads and writes the same
`pms_projects` records SettyPMS uses, so nothing diverges. It loads fast because it reads
only the RFI/submittal arrays, not the whole project.

## How staff use it

In short:

1. **Sign in** (the suite's shared sign-in, top-right). The log records who added or
   changed each item from the sign-in name; a save while signed out is logged as "(unknown)".
2. **Pick a project.** One searchable box: type a project number, name, GC or platform and
   pick from the list (arrow keys and Enter work too). Only jobs marked **"In Construction
   Administration"** are listed; "All projects" shows every CA job at once.
3. **See everything logged.** Click any RFI/submittal row to open and **edit** it. Use
   **+ Add** to log a new one by hand (for emailed / PDF transmittals that don't come through
   Procore/Forma). The search box filters long lists.
4. **Pull in Procore/Forma items.** New ones appear in the amber **📥 To import** strip —
   tick and import. They become normal records you can then edit.
5. **Send a submittal/RFI to Claude for review** (🤖 in the editor). Opens your Claude
   seat prefilled with the `submittal-rfi-review` skill: it reviews the item against the
   current issued set and the governing spec (for submittals, it reads the cut sheet and
   confirms the **marked selection**), then writes a suggested response, stamp, internal
   notes, and cost/scope red flags back onto the record via the connector. They show up in
   the editor as an **accept/dismiss** panel — a 🤖 marks rows with a review waiting for
   sign-off. Accepting only **copies** text into the fields; nothing is ever sent, stamped,
   or returned automatically. **🤖 Backload from PDF/email** (per section) does the same for
   an item not in the PMS yet — Claude finds the filed PDF / notification email, logs it,
   then reviews it. Same records as the main PMS, so a review saved from either surface
   shows in both.

6. **Open-items report by PM** (📊 button, top-right). Pick a Project Manager (taken from
   the project's *Project Manager* field), RFIs and/or submittals, and "open only" /
   "overdue only". It covers every CA project, not just the one picked. **🖨 Open printable
   report** gives a page grouped by project (number links into the PMS item, "Files" to its
   SharePoint folder, overdue rows in red) that you print or save as PDF; **⬇ CSV** gives
   the same rows with clickable links for Excel.

7. **CA platform per project.** The bar above the lists says which portal the job runs
   on (Procore, Autodesk Build, Newforma, Kahua, PMWeb, or email only), the GC, and a link
   straight to the project's page on that platform. Until someone confirms it, the
   platform is a guess from the filed notification emails (shown with a `?`, and
   in the picker as e.g. `· Procore?`). **Confirm…** saves it to the project
   (`project.caPortal`) and adds the link to the project's External links, so the
   main PMS shows it and installs it as a folder shortcut. Passwords never go here.

## Safe by design

- **Import is append-only / NEW-only** — it only adds items not already logged, and is
  idempotent (re-importing does nothing).
- **Manual add / edit / delete** goes through the same **version-guarded** save the main PMS
  uses: if someone else saved the project while you had it open, your write aborts cleanly
  (it tells you to re-pick and retry) instead of clobbering them. Safe for multiple staff.
- **Edits preserve the rest of the record** — fields this app doesn't show (links, assignees,
  etc.) are kept intact when you save.
- **Slim sync records** — imported items store metadata + a link to the source email
  (the 📁 button), not a copy of the body, so they barely add to the project's size.

## Parsers

The portal email parsers (Procore RFIs and submittals, Autodesk Forma, Newforma
forwards) live in `caIntake.js`, tested by `node --test caIntake.test.mjs`. A
new email format gets a fixture there first.

## Dependency

The sync only sees emails **filed into the PMS** (via the Outlook add-in or the sweep tool).
Freshness = "has the Procore/Forma notification been filed yet." Manual logging works regardless.

## Sources currently parsed

- **Procore** (`Gilbane_Building_Company@procoretech.com`) → RFIs
- **Autodesk Forma** (`no-reply@mail.forma.autodesk.com`) → submittals

## Deploy

Static HTML — no build, no backend of its own. Serve over HTTPS from the same web root as
`SettyPMS.html`. Uses the same Supabase anon config as the main app; RLS governs access and
this tool writes with the same permissions as the app.

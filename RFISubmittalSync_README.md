# RFI / Submittal Tracker

A focused, lightweight companion to SettyPMS for **logging and tracking RFIs and submittals
on Construction-Administration jobs** — either by hand, or by pulling them straight out of
**Procore / Autodesk Forma** notification emails so staff don't re-key them.

It is a **separate app, but shares the PMS data**: it reads and writes the same
`pms_projects` records SettyPMS uses, so nothing diverges. It loads fast because it reads
only the RFI/submittal arrays, not the whole project.

## How staff use it

The app has a built-in **"How this works"** guide at the top — that's the primary reference.
In short:

1. Put **your name** in the "You" box (top-right) so the log shows who added/changed each item.
2. **Pick a project.** The dropdown shows only jobs marked **"In Construction Administration"**;
   a ⚡ marks the ones with Procore/Forma emails filed.
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

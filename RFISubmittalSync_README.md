# RFI / Submittal Sync

A focused, lightweight companion to SettyPMS for pulling **RFIs and submittals out of
Procore / Autodesk Forma notification emails** and into the PMS — so the staff who do
Construction Administration don't have to re-key them by hand.

It is a **separate app, but shares the PMS data**: it reads and writes the same
`pms_projects` records SettyPMS uses, so nothing diverges.

## How staff use it

1. Open `RFISubmittalSync_Preview.html` (served from the same web root as the other tools).
2. Pick a project. The dropdown shows only projects marked **"In Construction Administration."**
   A ⚡ marks the ones that actually have Procore/Forma emails filed.
3. Review the table: each RFI/submittal is collapsed from its whole email thread to its
   latest status, and tagged **NEW** (not in the PMS) or **matched** (already logged).
4. Tick the NEW ones you want and click **📥 Import selected → PMS**. Done.

## What it will and won't do (by design)

- **Append-only, NEW-only.** It only adds items not already logged. It never edits or
  deletes a record you logged by hand.
- **Idempotent.** Re-running is safe — already-imported items are skipped.
- **Version-guarded.** If someone else saved the project while you were looking, the write
  aborts cleanly instead of clobbering them — safe for multiple staff at once.
- **Slim records.** It stores metadata + a link back to the source email (the 📁 button),
  not a copy of the email body — so it barely adds to the project's size. Full text stays
  in `pms_project_emails`.

## Dependency

It only sees emails that have been **filed into the PMS** (via the Outlook add-in or the
sweep tool). Freshness = "has the Procore/Forma notification been filed yet."

## Sources currently parsed

- **Procore** (`Gilbane_Building_Company@procoretech.com`) → RFIs
- **Autodesk Forma** (`no-reply@mail.forma.autodesk.com`) → submittals

## Deploy

Static HTML — no build, no backend of its own. Serve it over HTTPS from the same web root
as `SettyPMS.html` / `ContractExtractor.html`. It uses the same Supabase anon config as the
main app (embedded, same as SettyPMS). RLS governs access; this tool writes with the same
permissions as the app.

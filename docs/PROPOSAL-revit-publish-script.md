# Proposal: Revit publish script and issue manifest

Status: draft for review. Nothing here is built.

## Problem

The PMS reads issued drawings from their PDF text layer and identifies each
sheet by parsing its title block. Both depend on how a person exported the PDF.
On the Homeport submittal review, E-651.00 had been saved as an image, so it had
no text and could not be checked against spec 26 51 19. The export checklist
(`docs/PDF-EXPORT-CHECKLIST.md`) asks people to get ten settings right every
time. That will not hold across offices and across issues, so the export should
be automatic and consistent.

## Goal

One command in Revit publishes an issue: vector PDFs named the way the PMS
expects, filed in the right Outgoing folder, with a manifest that says exactly
what was issued. A person cannot produce an image-only sheet by accident, and
the PMS no longer has to guess sheet numbers or revisions from page text.

## Non-goals

- The PMS does not read Revit models. It keeps indexing what was issued.
- No change to how the transmittal register or submittals work.
- AutoCAD projects are out of scope for v1 (see Open questions).

## What the script does

Inputs, chosen in a short dialog: the project (number and name), the issue name
(for example `100% CD`, `Bulletin #13`), the issue date, and the set of sheets
(default: every sheet checked "issue" in a sheet parameter, or a Revit sheet
set).

Steps, in order:

1. **Export each sheet as its own vector PDF.** Raster processing off, fonts
   embedded, one sheet per file. Never "print to image", never flattened, no
   password or security.
2. **Name each file by sheet number.** `E651.00.pdf` or
   `E651.00 - Title.pdf`. The PMS accepts a whole stem that is a sheet number,
   or a sheet number followed by its title, and confirms the number against the
   page text (`sheetFromFilename.ts`). The sheet number comes from the model, so
   it is always correct and always in one format.
3. **Verify every PDF before filing it.** Open the exported file, extract the
   text of page 1, and check that it holds at least 50 characters and contains
   the sheet number. If any sheet fails, stop and list the failures. Do not file
   a partial set silently.
4. **Write the manifest** (below) next to the PDFs.
5. **File to Outgoing.** Copy PDFs and manifest into the project's Outgoing
   folder in a dated set folder named by the firm's convention. Use the mapped
   SharePoint path, or the Graph API if no sync is available. Do not
   overwrite an existing set folder. If it exists, stop and ask.
6. **Optionally export schedules** (panel, equipment, fixture, lighting) as
   `.xlsx` into a `Schedules` subfolder of the set, one per schedule, named by
   schedule. The PMS reads Excel and this is more reliable than reading
   schedules off the sheet.
7. **Print a summary:** sheets issued, any failures, the folder written to.

A combined book can still be produced for the contractor, but it goes in a
folder named for it (the PMS already recognizes combined folders and skips a
book that duplicates individual files). The individual sheets are the record.

## Revit versions and model hosting

Offices run a mix of Revit versions, and models are either hosted in Autodesk
Construction Cloud (ACC) or kept on the network, depending on the project.

**Hosting does not change the export.** The script runs inside Revit on the
user's machine with the model open, so it reads sheets and revisions from the
open model whether that model came from ACC or a network drive. Hosting only
matters for filing, and filing always goes to the project's Outgoing folder in
SharePoint or on the mapped drive, never back to ACC. Autodesk's cloud APIs are
not needed, and a project does not have to be on ACC for any of this to work.

**Version does change the export.** Revit's built-in PDF export only exists in
newer versions (2022 and later). Older versions can only print to a PDF driver.
So the script has two export paths:

| Revit version | Export path | Risk |
|---|---|---|
| 2022 and later | Built-in PDF export, vector, one file per sheet | Low |
| Earlier than 2022 | Print to the firm's standard PDF driver, one file per sheet | Driver settings can rasterize or flatten |

The verification step (step 3) is what makes the older path safe: a sheet that
comes out as an image fails the text check and the set is not filed. Whichever
path is used, the manifest records it (`generatedBy.revit` and `exportPath`).

Because pyRevit runs on a wide range of Revit versions, it stays the
recommended host. Before building, confirm the oldest version still in use. If
a version is too old for pyRevit, that office needs the manual checklist until
the model is upgraded.

## Manifest

A small JSON file named `issue-manifest.json` in the set folder.

```json
{
  "kind": "issue-manifest",
  "schemaVersion": 1,
  "project": { "number": "SAPX000000.00", "name": "Project name" },
  "issue": { "name": "Bulletin #13", "date": "2026-11-18", "phase": "CD" },
  "generatedBy": { "tool": "revit-publish", "version": "0.1", "revit": "2025", "exportPath": "native-pdf" },
  "sheets": [
    {
      "sheetNumber": "E651.00",
      "title": "Panel Schedules",
      "revision": "3",
      "revisionDate": "2026-11-18",
      "revisionDescription": "BULLETIN #13",
      "discipline": "E",
      "file": "E651.00 - Panel Schedules.pdf",
      "pdfBytes": 481233,
      "textChars": 5120,
      "sha256": "..."
    }
  ],
  "schedules": [
    { "name": "Panelboard Schedule - LP-1", "file": "Schedules/LP-1.xlsx" }
  ]
}
```

`textChars` and `sha256` come from the verification step. They let the PMS tell
a text sheet from an image sheet without opening it, and tell whether a file
changed after issue.

## PMS side (small, separate change)

When `issue-manifest.json` is present in a set folder:

- Use its sheet number, title, revision and revision description instead of
  parsing the title block. Keep the page-text confirmation as a cross-check and
  report a mismatch rather than trusting either side silently.
- Record the issue name and date from the manifest, which removes guessing from
  the folder name.
- Report any sheet in the manifest with no matching file, and any file with no
  manifest entry.
- Index PDFs as today, so search still works. If a sheet has `textChars` below
  the threshold, flag it so someone re-exports it.

When there is no manifest, nothing changes. Older projects and other offices
keep working as they do now. A manifest never overrides the actual files.

## Where it lives

Options, in order of effort:

| Option | Effort | Notes |
|---|---|---|
| pyRevit script | Low | Easiest to ship to a few users, lives in the repo, python for PDF check and Graph upload |
| Dynamo graph | Low to medium | Familiar to some staff, harder to review and version |
| Compiled Revit add-in (C#) | Highest | Best UX and deployment control, needs a developer and a release process |

Recommendation: start with a pyRevit script in this repo under `tools/`, run it
on one real project, then decide whether to harden it into an add-in.

## Rollout

1. Build the script and run it against one past project's model. Compare its
   PDFs to the filed set.
2. Add the manifest reader to the PMS behind the "manifest present" check.
3. Pilot on one live project through one issue.
4. Update `docs/PDF-EXPORT-CHECKLIST.md`: Revit users use the script, and the
   manual checklist stays for AutoCAD and for vendor files.

## Risks

- **A script is another thing to maintain** across Revit versions. Pin the
  supported versions and test on upgrade.
- **Wrong sheet selection.** If the "issue" flag is stale, the set is wrong.
  The summary lists every sheet before filing and asks for confirmation.
- **Wrong destination.** Filing into the wrong project folder is worse than a
  slow export. The script resolves the folder from the project number and shows
  the full path before writing.
- **Manifest drift.** If someone edits a PDF after publishing, the hash no longer
  matches. The PMS reports it and does not fail.

## Open questions

1. Answered: a mix of Revit versions, with models in Autodesk Construction
   Cloud or on the network depending on the project. Still needed: the OLDEST
   version in use, which PDF driver the older versions use today, and whether
   any version is too old for pyRevit.
2. What is the exact set-folder naming convention under Outgoing in each office?
3. Do offices already have a sheet parameter that marks what is being issued?
4. Is there a Graph or SharePoint sync pattern already approved for scripts to
   write to Outgoing, or must files go through the mapped drive?
5. How many projects still use AutoCAD for the sheets, and does AutoCAD need an
   equivalent (a `.scr` or LISP publish routine)?
6. Who owns the script once it is built?

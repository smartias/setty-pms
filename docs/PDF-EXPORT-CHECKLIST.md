# PDF export checklist: making drawings readable by the PMS

The PMS indexes drawings and reads submittal PDFs from their **text layer**: the
real text inside the PDF. A page saved as a picture has no text layer, so
search, the drawing index and submittal checks cannot see it. (This is what
happened to E-651.00 on the Homeport submittal.) The PMS can now OCR a few
image-only pages per call, but OCR is slower, costs money and can misread
numbers. A good export is always better.

Menu names change between versions. Check each setting against your own
template and mark anything that differs here.

## 1. Quick test (30 seconds, do this on every new template)

1. Open the exported PDF.
2. Try to select a general note and a title block value with the text tool.
3. Search for an equipment tag (for example `FCU-11`) and the sheet number.

If you cannot select or find the text, stop and fix the export. The PMS will not
be able to read it either.

## 2. Revit

- [ ] Export with **vector** processing. Do not turn on "always use raster
      processing" (Revit's native PDF export) or any print option that
      rasterizes the sheet.
- [ ] If you print through a PDF driver, use one that embeds text. Never use a
      "print to image", "flatten" or "secure" option.
- [ ] Title block: sheet number, sheet title and revision are **text** in the
      title block family, not an inserted image or a logo-style graphic.
- [ ] Sheet numbers follow one format across disciplines, for example
      `E-651.00`, `M-201`. One sheet per PDF page.
- [ ] Revision schedule on the sheet carries the revision number, date and
      description (for example `BULLETIN #13`) as text.
- [ ] Information that matters (notes, schedules, keynotes) is Revit text or a
      schedule, not a pasted image. Text inside an imported raster image is not
      readable.
- [ ] Linked PDFs or images used as underlays are not the only place a note
      appears.

## 3. AutoCAD / Civil 3D

- [ ] Set `PDFSHX` to `1` so SHX font text is saved as searchable text.
- [ ] Plot TrueType text as **text**, not as geometry (PDF options: "TrueType
      text as geometry" off).
- [ ] Prefer TrueType fonts in the title block so the text survives any export.
- [ ] Plot with a vector PDF plotter (for example DWG To PDF), not a raster
      plotter.
- [ ] Title block attributes (sheet number, title, revision) are live
      attributes, not exploded to linework.

## 4. After export (all tools)

- [ ] Do not scan, flatten or re-print a PDF that already has text. Both throw
      the text layer away.
- [ ] No password or "no copying" security on the file. It can block text
      extraction.
- [ ] Markups from Bluebeam or Acrobat: save normally. Do not use
      "flatten to image".
- [ ] Specs are exported as text PDFs, with section numbers such as `26 51 19`
      in the text so a search finds them.

## 5. Filing in SharePoint

- [ ] File **individual sheet PDFs** in the set folder, not only a combined
      book. The index reads individual files first and skips a combined book
      that duplicates them. A combined-only set still works but is slower to
      index, and the very large books (over about 40MB) are read in pieces
      without OCR.
- [ ] Name each file with the sheet number, for example
      `E-651.00 - Panel Schedules.pdf`. The filename is the fallback when a
      title block will not parse.
- [ ] File the spec sections a submittal will be checked against (for example
      26 51 19) in the project folder before the submittal arrives.
- [ ] If a sheet can only be produced as an image (an old scan, a vendor
      drawing), also save the best available text version beside it, and say
      so in the file name.

## 6. When a page still comes back empty

- The PMS marks OCR'd text `[OCR]` and tells you when it could not OCR a page.
  Treat OCR'd values (breaker sizes, ratings, quantities) as needing a check
  against the sheet.
- If a file is reported under `textlessFiles` or `unparsed` with "no extractable
  text (scanned?)", re-export it from the model using the steps above.

## Owner

Keep this file current when a template or software version changes. Where a
menu name here is wrong for your version, correct it in this file.

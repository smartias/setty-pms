# PDF export checklist: making drawings readable by the PMS

## Why this matters

The PMS indexes drawings and reads submittal PDFs from their **text layer**: the
real text stored inside the PDF. A page saved as a picture has no text layer, so
search, the drawing index and submittal checks cannot see anything on it. This
is what happened to E-651.00 on the Homeport submittal: the sheet could not be
checked against spec 26 51 19, and the review had to say so.

What a bad export costs us:

- **Missed coordination.** Search for a tag, note or spec section skips the sheet,
  so a conflict that the sheet shows is never found.
- **Weaker submittal and QA reviews.** The reviewer has to open the sheet by hand
  or flag that the check was incomplete.
- **Slower, costlier fallbacks.** The PMS can now OCR a few image-only pages per
  call, but OCR is slow, costs money per page and can misread numbers (a 100A
  breaker read as 160A is exactly the kind of error that matters).

A good export fixes all of this at the source, once, for everyone downstream.

Each item below says what to do and why. Menu names change between versions, so
check each setting against your own template and correct this file where it
differs.

## 1. Quick test (30 seconds, on every new template)

1. Open the exported PDF.
2. Select a general note and a title block value with the text tool.
3. Search for an equipment tag (for example `FCU-11`) and the sheet number.

**Why:** this is the same thing the PMS does. If you can select and find the
text, the PMS can. If you cannot, nothing downstream will work, and it is far
cheaper to learn that on one sheet than after the whole set is issued.

## 2. Revit

- [ ] Export with **vector** processing. Do not turn on "always use raster
      processing" (Revit's native PDF export) or any print option that
      rasterizes the sheet.
      **Why:** raster processing turns the whole sheet, text included, into
      pixels. The result looks identical on screen and is blank to the PMS.
- [ ] If you print through a PDF driver, use one that embeds text. Never use a
      "print to image", "flatten" or "secure" option.
      **Why:** those options exist to make a PDF look fixed and uneditable, and
      they do it by discarding the text layer or locking it.
- [ ] Sheet number, sheet title and revision are **text** in the title block
      family, not an inserted image or a logo-style graphic.
      **Why:** the index finds each sheet by parsing its title block. If the
      sheet number is not text, the sheet cannot be identified, searched by
      number or compared between revisions.
- [ ] Sheet numbers follow one format across disciplines, for example
      `E-651.00`, `M-201`. One sheet per PDF page.
      **Why:** people and the PMS look sheets up by number. Mixed formats
      (`E651`, `E-651.0`, `E 651.00`) split one sheet into several in search
      and in revision history.
- [ ] The revision schedule on the sheet carries revision number, date and
      description (for example `BULLETIN #13`) as text.
      **Why:** the index records every revision of a sheet. That is how it
      answers "when did this first appear" and "was it in the set the
      contractor priced."
- [ ] Notes, schedules and keynotes are Revit text or schedules, not a pasted
      image.
      **Why:** text inside an inserted raster image is not text to the PMS, and
      the information it carries (panel schedules, SPD ratings) is often what a
      submittal is checked against.
- [ ] A linked PDF or image underlay is never the only place a note appears.
      **Why:** the underlay's own text layer may be missing, and the sheet then
      looks complete on paper but is empty to the PMS.

## 3. AutoCAD / Civil 3D

- [ ] Set `PDFSHX` to `1` so SHX font text is saved as searchable text.
      **Why:** by default SHX text can be drawn as lines. It looks right on
      screen but there are no characters in the file to search.
- [ ] Plot TrueType text as **text**, not as geometry (PDF options: "TrueType
      text as geometry" off).
      **Why:** text converted to geometry is shapes, not characters.
- [ ] Prefer TrueType fonts in the title block.
      **Why:** they carry through any export path reliably, so the sheet number
      and revision are never lost.
- [ ] Plot with a vector PDF plotter (for example DWG To PDF), not a raster
      plotter.
      **Why:** a raster plotter produces a picture of the sheet.
- [ ] Title block attributes (sheet number, title, revision) are live
      attributes, not exploded to linework.
      **Why:** exploded attributes become lines, so the title block stops
      being readable.

## 4. After export (all tools)

- [ ] Do not scan, flatten or re-print a PDF that already has text.
      **Why:** each of these converts the page to an image. A sheet that was
      searchable when it left the model can arrive empty because of a later
      "print to PDF" step.
- [ ] No password or "no copying" security on the file.
      **Why:** it can block text extraction, and the file then fails to index.
- [ ] Save Bluebeam and Acrobat markups normally. Do not use "flatten to
      image".
      **Why:** markups are fine, but flattening to an image destroys the text
      underneath them.
- [ ] Export specs as text PDFs, with section numbers such as `26 51 19` in the
      text.
      **Why:** the PMS jumps to a section by finding its number. A spec book
      without readable numbers cannot be searched, and a submittal cannot be
      checked against it.

## 5. Filing in SharePoint

- [ ] File **individual sheet PDFs** in the set folder, not only a combined
      book.
      **Why:** the index reads individual files first and skips a combined
      book that repeats them. A combined-only set still works but is slower to
      index, and very large books (over about 40MB) are read in pieces without
      OCR, so any image-only sheet inside them stays unreadable.
- [ ] Name each file with the sheet number, for example
      `E-651.00 - Panel Schedules.pdf`.
      **Why:** when a title block will not parse, the filename is the fallback
      the PMS uses to identify the sheet.
- [ ] File the spec sections a submittal will be checked against (for example
      26 51 19) in the project folder before the submittal arrives.
      **Why:** the Homeport review could not finish its check because the spec
      section was not filed. A review can only compare against what is in the
      record.
- [ ] If a sheet can only be produced as an image (an old scan, a vendor
      drawing), save the best available text version beside it and say so in
      the file name.
      **Why:** it gives the PMS and reviewers something reliable to read
      instead of depending on OCR.

## 6. When a page still comes back empty

- The PMS marks OCR'd text `[OCR]` and says when it could not OCR a page.
  Treat OCR'd values (breaker sizes, ratings, quantities) as needing a check
  against the sheet itself.
  **Why:** OCR is a best guess at reading a picture. It is good enough to find
  a sheet and read most notes, and not good enough to trust a single digit.
- If a file is reported under `textlessFiles` or `unparsed` with "no
  extractable text (scanned?)", re-export it from the model using the steps
  above.
  **Why:** fixing the export once removes the problem for every later search
  and review. OCR only works around it per page, per call.

## Owner

Keep this file current when a template or software version changes. Where a
menu name here is wrong for your version, correct it in this file.

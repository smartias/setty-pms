# docx-templates

Deterministic rendering of Setty's canonical documents.

## Why this exists

`get_template` / `get_add_service_template` return the template as a **plain text
string**. The letterhead is not in that payload and never has been.

`Setty - Additional Services Agreement TEMPLATE.docx` is 524 KB across 38 parts.
`word/media/image1.png` alone is 471,198 bytes — the SETTY logo. The tagline lives in
`word/header1.xml`, fonts in `styles.xml` + `theme1.xml`, list numbering in
`numbering.xml`, the office addresses in `footer1/footer2.xml`. None of it ships.

So a model asked to "follow the template" is redrawing the document from a skeleton and
inventing the font, the margins and the header fresh every time. That is the drift. It is
deterministic, not random, and no amount of prompting fixes it.

Second cause: the two-column blocks (To/Date header, Presented By/Accepted By) are **tab
stops**, which flatten to padding in text and only line up in a monospace font.

**The fix is to never generate the document.** Copy the real `.docx` and substitute inside
it. Everything untouched survives byte-for-byte, so fidelity is preserved by construction
rather than by effort.

## Layout

    engine.py     substitution engine. stdlib only, ports 1:1 to Deno.
    probe.py      dump a template's paragraphs/bookmarks to author a config against.
    prep.py       canonical template -> tokenized template, with verification.
    render.py     tokenized template + fields -> finished document. The shippable core.
    configs/      one JSON per template: what to tokenize and how.
    samples/      example field payloads.
    build/        generated. Not committed.

## Use

    python probe.py --list
    python probe.py "CAD RELEASE FORM.dotx"
    python prep.py                                     # build + verify all
    python render.py addservice samples/x.json out.docx

`prep.py` reads from the SharePoint templates folder via OneDrive. Override with
`SETTY_TEMPLATE_DIR`. It never writes to the originals.

## Status

All six WordprocessingML templates build and verify: 84 tokens, every package part
preserved, every look-carrying part unchanged, zero untokenized placeholders remaining.

`Building Report Cards - MEP.xltx` is a **spreadsheet**, not a Word package. The engine
does not apply. It needs separate handling.

`SubagreementTemplate-Sara-Samsung-PC-2022-11-23.dotx` has a byte-identical
`document.xml` (237,380 bytes) to `SubagreementTemplate.dotx` and differs only in
SharePoint metadata. It is a duplicate; archive it rather than tokenizing it. Leaving both
in place makes fuzzy `name` matching in `get_template` nondeterministic.

## Traps, all of them hit for real during the build

**Counting replacements is not verification.** The first tokenizer reported 12/12 "ok"
while having silently destroyed 6 tokens. `prep.py` now reads the output file back and
asserts every token is physically present. Never trust an attempt count.

**Word splits values across runs.** In the add service template 4 of 11 target values are
not literal strings in `document.xml`: the date, the project/add-service line, the scope
title, and the first fee. Naive find-and-replace fails on exactly the highest-stakes
fields and succeeds everywhere else.

**Zero-width runs swallow text.** Runs carrying no `<w:t>` (tab stops, bookmark markers)
have zero width. Select one as a write target and the replacement evaporates with no
error. Only text-bearing runs may enter the character map.

**.dotx content type.** Six of eight templates are `.dotx`, whose `[Content_Types].xml`
declares `word/document.xml` as a *template* part. Write those bytes under a `.docx` name
and Word refuses the file: "Word was unable to read this document. It may be corrupt."
`template_to_document()` rewrites it.

**Strip call-outs before substituting.** The subagreement carries 5 red author-instruction
text boxes ("press Ctrl-A then F9", "delete all the red text boxes"). A call-out drawing
contains its own nested `<w:p>`, which makes paragraph parsing around it unreliable —
`[SETTY P/N]` and `[Storage Path]` hid behind that mis-parse and escaped substitution
entirely when stripping ran last. Any config using paragraph-**index** ops must therefore
be authored against a template with no call-outs, or re-probed after stripping.

**Stale REF fields.** The subagreement mirrors bookmarks through 9 `REF` fields with
cached results, which is why the template tells the user to press Ctrl-A+F9 three times.
`mark_fields_dirty()` flags them so Word refreshes on open.

## Open items

- **Header column overflow.** The add service To/Date block is tab stops, so a long
  `{{PROJECT_NAME}}` overflows and the wrap returns to the left margin, displacing the
  client firm line. 39 chars breaks, 28 fits. Real fix is a 2-column table.
- **Flatten fields.** Rendered documents still contain `REF` fields, which Word shades
  grey when field shading is set to Always. Replacing each field with its literal result
  would make the output fully self-contained.
- **The templates disagree on the New York address.** Add service footer says
  `149 W 36th Street, 8th Floor`; subagreement says `121 West 27th Street, Suite 1100`.
  One is stale.
- **Do not guess honorifics.** `CONTACT_NAME` wants "Ms./Mr."; inferring that from a name
  is the same class of error as guessing pronouns. Keep it a supplied field.
- **Missing-field policy** is `ON_MISSING=leave|blank|fail`, default `leave`, which keeps
  `{{TOKEN}}` visible as a to-do. Decision pending.
- **Port `render.py` to Deno** for `supabase/functions/pms-mcp`, and expose it as a **new**
  `render_document` tool. Never as a new parameter on `get_template`: clients cache tool
  schemas at connect and silently strip unknown params, so stale sessions would quietly
  get the old text path. Connector tools also cache at add, so rollout needs a
  remove-and-re-add.

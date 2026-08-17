"""
Minimal-dependency .docx token renderer.

Substitutes {{TOKENS}} inside a real .docx package WITHOUT rebuilding the
document. Every part we do not touch (header, logo, styles, theme, numbering,
footers) is copied through byte-for-byte, so letterhead fidelity is preserved
by construction rather than by effort.

The only hard part is that Word splits a logical string across several <w:r>
runs (spell-check state, rsid boundaries, stray formatting). So replacement is
done per paragraph, over the *joined* run text, then spliced back into the
minimal span of runs that covered the match.

stdlib only -> the logic ports to Deno/TS for the edge function 1:1.
"""

import re
import zipfile
import shutil

# --- XML helpers -------------------------------------------------------------

RUN_RE = re.compile(r"<w:r(?:\s[^>]*)?>.*?</w:r>", re.S)
TEXT_RE = re.compile(r"(<w:t(?:\s[^>]*)?>)(.*?)(</w:t>)", re.S)
PARA_RE = re.compile(r"<w:p(?:\s[^>]*)?>.*?</w:p>|<w:p(?:\s[^>]*)?/>", re.S)
RPR_RE = re.compile(r"<w:rPr>.*?</w:rPr>", re.S)


def xml_escape(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def run_text(run):
    """Concatenated visible text of one <w:r>."""
    return "".join(m.group(2) for m in TEXT_RE.finditer(run))


def set_run_text(run, new_text):
    """Put new_text in the run's FIRST <w:t>, blank any others."""
    seen = [False]

    def sub(m):
        if not seen[0]:
            seen[0] = True
            open_tag = m.group(1)
            # preserve leading/trailing spaces
            if "xml:space" not in open_tag:
                open_tag = open_tag[:-1] + ' xml:space="preserve">'
            return open_tag + new_text + m.group(3)
        return m.group(1) + m.group(3)

    return TEXT_RE.sub(sub, run)


# --- paragraph-scoped replacement -------------------------------------------

def replace_in_paragraph(para, old, new, nth=None):
    """
    Replace `old` with `new` inside one paragraph, tolerating runs that split
    `old` across boundaries. Formatting of the run where the match STARTS is
    applied to the whole replacement. Returns (new_para, n_replacements).

    Only TEXT-BEARING runs take part in the character map. Runs that carry no
    <w:t> (tab stops, bookmark markers, drawing anchors) have zero width and
    must never be chosen as a write target -- doing so drops the replacement
    silently, because there is no text element to write into.
    """
    runs = list(RUN_RE.finditer(para))
    if not runs:
        return para, 0

    entries = []          # (run_index, start_offset, end_offset)
    texts = {}            # run_index -> current text
    pos = 0
    for i, r in enumerate(runs):
        if not TEXT_RE.search(r.group(0)):
            continue      # zero-width: preserve verbatim, never target
        t = run_text(r.group(0))
        entries.append((i, pos, pos + len(t)))
        texts[i] = t
        pos += len(t)

    joined = "".join(texts[i] for (i, _, _) in entries)
    if old not in joined:
        return para, 0

    starts = [m.start() for m in re.finditer(re.escape(old), joined)]
    if nth is not None:
        # 1-based; pick a single occurrence. Ops on the same (para, find) must
        # be applied in DESCENDING nth so earlier occurrences keep their index.
        if not (1 <= nth <= len(starts)):
            return para, 0
        starts = [starts[nth - 1]]

    dirty = set()
    count = 0
    # Right-to-left so offsets of earlier matches stay valid.
    for s in reversed(starts):
        e = s + len(old)
        fi = next((k for k, (_, a, b) in enumerate(entries) if a <= s < b), None)
        li = next((k for k, (_, a, b) in enumerate(entries) if a < e <= b), None)
        if fi is None or li is None:
            continue

        f_run, fa, _ = entries[fi]
        l_run, la, _ = entries[li]
        head = texts[f_run][: s - fa]
        tail = texts[l_run][e - la :]

        if fi == li:
            texts[f_run] = head + new + tail
            dirty.add(f_run)
        else:
            texts[f_run] = head + new
            dirty.add(f_run)
            for k in range(fi + 1, li):
                texts[entries[k][0]] = ""
                dirty.add(entries[k][0])
            texts[l_run] = tail
            dirty.add(l_run)
        count += 1

    out = []
    cursor = 0
    for i, r in enumerate(runs):
        out.append(para[cursor : r.start()])
        out.append(set_run_text(r.group(0), texts[i]) if i in dirty else r.group(0))
        cursor = r.end()
    out.append(para[cursor:])
    return "".join(out), count


def replace_all(xml, mapping):
    """Apply {old: new} across every paragraph. Returns (xml, {old: hits})."""
    hits = {k: 0 for k in mapping}
    pieces = []
    cursor = 0
    for pm in PARA_RE.finditer(xml):
        pieces.append(xml[cursor : pm.start()])
        para = pm.group(0)
        for old, new in mapping.items():
            para, n = replace_in_paragraph(para, old, new)
            hits[old] += n
        pieces.append(para)
        cursor = pm.end()
    pieces.append(xml[cursor:])
    return "".join(pieces), hits


def set_paragraph_text(para, text):
    """Blank every run, put `text` in the first. Paragraph style is kept."""
    runs = list(RUN_RE.finditer(para))
    if not runs:
        return para
    out, cursor, first = [], 0, True
    for r in runs:
        out.append(para[cursor : r.start()])
        out.append(set_run_text(r.group(0), text if first else ""))
        first = False
        cursor = r.end()
    out.append(para[cursor:])
    return "".join(out)


def apply_ops(xml, ops):
    """
    Paragraph-scoped substitutions, for templates that reuse one generic
    placeholder ('[Insert Date]') for several different fields. Each op is
    {para, find, token, nth?} or {para, set, token} to replace the paragraph's
    whole text. `para` is the 0-based index among paragraphs that PARA_RE
    finds -- the same index probe.py prints.
    Returns (xml, {token: hits}).
    """
    # Descending nth within a (para, find) group, so nth refers to the
    # placeholder's position in the ORIGINAL document, not a shifting one.
    ordered = sorted(ops, key=lambda o: (o["para"], o.get("find") or "",
                                         -(o.get("nth") or 0)))
    hits = {o["token"]: 0 for o in ops}

    spans = list(PARA_RE.finditer(xml))
    by_index = {}
    for o in ordered:
        by_index.setdefault(o["para"], []).append(o)

    out, cursor = [], 0
    for i, m in enumerate(spans):
        out.append(xml[cursor : m.start()])
        para = m.group(0)
        for o in by_index.get(i, []):
            if o.get("set"):
                para = set_paragraph_text(para, o["token"])
                hits[o["token"]] += 1
            else:
                para, n = replace_in_paragraph(para, o["find"], o["token"],
                                               o.get("nth"))
                hits[o["token"]] += n
        out.append(para)
        cursor = m.end()
    out.append(xml[cursor:])
    return "".join(out), hits


# --- list expansion ----------------------------------------------------------

def expand_list(xml, token, items):
    """
    Replace the paragraph containing `token` with one cloned paragraph per item,
    inheriting that paragraph's style (bullet/numbering/indent/font).
    An empty `items` removes the paragraph entirely.
    Returns (xml, found_bool).
    """
    for pm in PARA_RE.finditer(xml):
        para = pm.group(0)
        joined = "".join(run_text(r.group(0)) for r in RUN_RE.finditer(para))
        if token not in joined:
            continue
        clones = []
        for it in items:
            clone, _ = replace_in_paragraph(para, token, xml_escape(it))
            clones.append(clone)
        return xml[: pm.start()] + "".join(clones) + xml[pm.end() :], True
    return xml, False


# --- legacy Word form scaffolding -------------------------------------------

INSTRUCTION_MARKERS = (
    "This form has fields",
    "Ctrl-A",
    "red text boxes",
    "To populate the header",
)


def _balanced_spans(xml, tag):
    """(start, end) of each balanced <tag ...> ... </tag>, outermost only."""
    open_re = re.compile(r"<%s(?:\s[^>]*)?>" % re.escape(tag))
    close = "</%s>" % tag
    spans, pos = [], 0
    while True:
        m = open_re.search(xml, pos)
        if not m:
            return spans
        depth, i = 1, m.end()
        while depth:
            nxt_o = open_re.search(xml, i)
            nxt_c = xml.find(close, i)
            if nxt_c == -1:
                return spans
            if nxt_o and nxt_o.start() < nxt_c:
                depth += 1
                i = nxt_o.end()
            else:
                depth -= 1
                i = nxt_c + len(close)
        spans.append((m.start(), i))
        pos = i


def strip_instruction_textboxes(xml, markers=INSTRUCTION_MARKERS):
    """
    Remove the red author-instruction call-outs ("press Ctrl-A then F9",
    "delete all the red text boxes") that these templates carry for the manual
    Word workflow. They are drawing anchors, not body text, so they survive
    paragraph-level editing and would otherwise print on a client document.

    Each call-out exists twice, as the mc:Choice and mc:Fallback rendering of
    one <mc:AlternateContent>, so removing the whole AlternateContent takes
    both. Returns (xml, n_removed).
    """
    removed = 0
    for tag in ("mc:AlternateContent", "w:pict"):
        while True:
            hit = None
            for a, b in _balanced_spans(xml, tag):
                block = xml[a:b]
                if "<w:txbxContent>" not in block:
                    continue
                text = "".join(m.group(2) for m in TEXT_RE.finditer(block))
                if any(k in text for k in markers):
                    hit = (a, b)
                    break
            if not hit:
                break
            xml = xml[: hit[0]] + xml[hit[1]:]
            removed += 1
    return xml, removed


def accept_revisions(xml):
    """
    Accept all tracked changes, so editing marks never reach a client.

    The proposal template still carries 1 insertion and 6 deletions from
    whoever last edited it. Word shows them as markup, and they print.

    Accepting means: keep what <w:ins> wraps, drop <w:del> and its content
    entirely (<w:delText> lives inside it), and discard the *Change elements
    that record prior formatting. Returns (xml, n_accepted).
    """
    n = 0

    # <w:del>...</w:del> -- remove the element and everything inside.
    while True:
        m = re.search(r"<w:del\b[^>]*>", xml)
        if not m:
            break
        end = xml.find("</w:del>", m.end())
        if end == -1:
            break
        xml = xml[: m.start()] + xml[end + len("</w:del>"):]
        n += 1
    # A self-closing <w:del/> inside <w:trPr> is a tracked ROW deletion: the
    # whole row goes, not just the marker. Stripping only the marker is what
    # left an empty 2x2 grid printing on every proposal. A table with no rows
    # left is removed too (Word will not open one).
    tr_pat = re.compile(r"<w:tr\b[^>]*>.*?</w:tr>", re.S)
    def _drop_deleted_row(m):
        nonlocal n
        row = m.group(0)
        trpr = re.search(r"<w:trPr>.*?</w:trPr>", row, re.S)
        if trpr and re.search(r"<w:del\b[^>]*/>", trpr.group(0)):
            n += 1
            return ""
        return row
    xml = tr_pat.sub(_drop_deleted_row, xml)
    tbl_pat = re.compile(r"<w:tbl>.*?</w:tbl>", re.S)
    xml = tbl_pat.sub(lambda m: "" if "<w:tr" not in m.group(0) else m.group(0), xml)

    n += len(re.findall(r"<w:del\b[^>]*/>", xml))
    xml = re.sub(r"<w:del\b[^>]*/>", "", xml)

    # <w:ins> -- unwrap, keeping the inserted content.
    n += len(re.findall(r"<w:ins\b[^>]*>", xml))
    xml = re.sub(r"<w:ins\b[^>]*>", "", xml)
    xml = xml.replace("</w:ins>", "")
    xml = re.sub(r"<w:ins\b[^>]*/>", "", xml)

    # Formatting-change records: keep the current formatting, drop the history.
    for tag in ("w:rPrChange", "w:pPrChange", "w:sectPrChange", "w:tblPrChange",
                "w:trPrChange", "w:tcPrChange", "w:tblGridChange"):
        pat = re.compile(r"<%s\b[^>]*>[\s\S]*?</%s>|<%s\b[^>]*/>" % (tag, tag, tag))
        n += len(pat.findall(xml))
        xml = pat.sub("", xml)

    return xml, n


def mark_fields_dirty(xml):
    """
    Flag every Word field for re-evaluation on open.

    These templates use REF fields mirroring bookmarks, and ship with STALE
    cached results -- which is why the template tells the user to press
    Ctrl-A then F9. A rendered document must not require that, so every field
    gets w:dirty="true" and Word refreshes it when the file is opened.
    Returns (xml, n_marked).
    """
    pat = re.compile(r'<w:fldChar(?![^>]*w:dirty)([^>]*?)w:fldCharType="begin"')
    xml, n = pat.subn(r'<w:fldChar\1w:fldCharType="begin" w:dirty="true"', xml)
    return xml, n


# --- package I/O -------------------------------------------------------------

TEXT_PARTS = ("word/document.xml", "word/header", "word/footer")
CONTENT_TYPES = "[Content_Types].xml"

TEMPLATE_CT = ("application/vnd.openxmlformats-officedocument"
               ".wordprocessingml.template.main+xml")
DOCUMENT_CT = ("application/vnd.openxmlformats-officedocument"
               ".wordprocessingml.document.main+xml")


def template_to_document(content_types_xml):
    """
    Convert a .dotx package into a .docx one.

    Six of the eight Setty templates are .dotx, whose [Content_Types].xml
    declares word/document.xml as a TEMPLATE part. Write those bytes under a
    .docx name and Word refuses the file outright: "Word was unable to read
    this document. It may be corrupt." The rendered deliverable is a document,
    not a template, so the content type has to be rewritten to match.
    """
    return content_types_xml.replace(TEMPLATE_CT, DOCUMENT_CT)


def transform(src, dst, fn):
    """
    Copy the package, running fn(part_name, xml_str) -> xml_str on the text
    parts and on [Content_Types].xml. Every other part is copied byte-for-byte,
    which is what preserves the letterhead, fonts, numbering and media.
    """
    zin = zipfile.ZipFile(src)
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            editable = item.filename == CONTENT_TYPES or (
                item.filename.startswith(TEXT_PARTS)
                and item.filename.endswith(".xml"))
            if editable:
                data = fn(item.filename, data.decode("utf-8")).encode("utf-8")
            zout.writestr(item, data)
    zin.close()

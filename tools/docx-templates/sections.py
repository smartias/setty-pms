"""
sections.py -- map and drop Word SECTIONS in a .docx.

A proposal is cover page + cover letter + body + Attachment A + info sheet, and
not every job wants every part. Deleting the cover letter by hand afterwards is
the annoyance this removes.

Word already models those as SECTIONS. An intermediate section break lives as a
<w:sectPr> inside the <w:pPr> of the LAST paragraph of that section; the final
section's properties sit directly in <w:body>. So dropping a section means
removing its top-level body children up to and including the paragraph carrying
its sectPr, and the sections around it keep their own page setup, headers and
footers untouched.

Everything here walks TOP-LEVEL children of <w:body> only. The regex used
elsewhere for paragraphs is non-greedy and mis-nests when a paragraph contains
another (text boxes do exactly that), which would corrupt the indices.

    python sections.py map "build/proposal/TemplateProposal.docx"
"""

import re
import sys
import zipfile

TAG_RE = re.compile(r"<(/?)(w:p|w:tbl|w:sectPr|w:bookmarkStart|w:bookmarkEnd)(?:\s[^>]*)?(/?)>")
TEXT_RE = re.compile(r"<w:t(?:\s[^>]*)?>([\s\S]*?)</w:t>")


def body_span(doc):
    a = doc.index("<w:body>") + len("<w:body>")
    b = doc.rindex("</w:body>")
    return a, b


def top_level_children(doc):
    """
    [(kind, start, end)] for each direct child of <w:body>, in document order.
    kind is 'p', 'tbl' or 'sectPr' (the final one).
    """
    a, b = body_span(doc)
    out, i = [], a
    while i < b:
        m = re.compile(r"<(w:p|w:tbl|w:sectPr)(?:\s[^>]*)?>").search(doc, i, b)
        if not m:
            break
        tag = m.group(1)
        # A self-closing <w:p .../> has no close tag. Detect it by the literal
        # "/>" ending, NOT by a capture group: the attribute pattern [^>]* is
        # greedy and swallows the slash, so a group would come back empty and
        # the element would be treated as unclosed. That single mistake made
        # the walker run to the end of the body and report the whole proposal
        # as one 517 KB "paragraph".
        if m.group(0).endswith("/>"):
            out.append((tag.split(":")[1], m.start(), m.end()))
            i = m.end()
            continue
        # walk to the matching close, counting nested opens of the same tag
        depth, j = 1, m.end()
        open_re = re.compile(r"<%s(?:\s[^>]*)?>" % re.escape(tag))
        close = "</%s>" % tag
        while depth:
            no = open_re.search(doc, j, b)
            nc = doc.find(close, j, b)
            if nc == -1:
                break
            if no and no.start() < nc and not no.group(0).endswith("/>"):
                depth += 1
                j = no.end()
            else:
                depth -= 1
                j = nc + len(close)
        out.append((tag.split(":")[1], m.start(), j))
        i = j
    return out


def child_text(doc, span):
    return "".join(TEXT_RE.findall(doc[span[1]:span[2]]))


def sections(doc):
    """
    [{index, first_child, last_child, terminator, text_preview}] where
    terminator is the child index carrying the sectPr, or None for the final
    section (whose sectPr lives directly in w:body).
    """
    kids = top_level_children(doc)
    secs, start = [], 0
    for i, k in enumerate(kids):
        if k[0] == "sectPr":
            continue
        body = doc[k[1]:k[2]]
        # a sectPr inside this child's own pPr terminates a section
        if k[0] == "p" and re.search(r"<w:pPr>[\s\S]*?<w:sectPr", body):
            secs.append((start, i))
            start = i + 1
    if start < len(kids):
        secs.append((start, len(kids) - 1))
    return kids, secs


def drop_sections(doc, indices):
    """Remove whole sections by index. Returns new document.xml."""
    kids, secs = sections(doc)
    cuts = []
    for si in sorted(set(indices), reverse=True):
        if si < 0 or si >= len(secs):
            raise SystemExit(f"no section {si} (have 0..{len(secs)-1})")
        a, b = secs[si]
        cuts.append((kids[a][1], kids[b][2]))
    for start, end in cuts:          # already reverse-ordered
        doc = doc[:start] + doc[end:]
    return doc


# Named parts of the Setty proposal, by section index. The body (5, 6) is not
# listed because it is never optional. Verified against Template Proposal.docx
# 2026-08-16; re-run `sections.py map` if the template is restructured.
PROPOSAL_PARTS = {
    "cover_page":  [0, 1, 2, 3],
    "cover_letter": [4],
    "terms":       [7],          # Attachment A
    "firm_info":   [8, 9, 10, 11],
}


def drop_parts(doc, names):
    idx = []
    for n in names:
        if n not in PROPOSAL_PARTS:
            raise SystemExit(f"unknown part {n!r}; have: {', '.join(PROPOSAL_PARTS)}")
        idx += PROPOSAL_PARTS[n]
    return drop_sections(doc, idx)


def rewrite(src, dst, fn):
    zin = zipfile.ZipFile(src)
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "word/document.xml":
                data = fn(data.decode("utf-8")).encode("utf-8")
            zout.writestr(item, data)
    zin.close()


if __name__ == "__main__":
    cmd, path = sys.argv[1], sys.argv[2]
    doc = zipfile.ZipFile(path).read("word/document.xml").decode("utf-8")

    if cmd == "drop":
        out, names = sys.argv[3], sys.argv[4].split(",")
        before = len(top_level_children(doc))
        rewrite(path, out, lambda d: drop_parts(d, names))
        after = len(top_level_children(
            zipfile.ZipFile(out).read("word/document.xml").decode("utf-8")))
        print(f"dropped {', '.join(names)}: {before} -> {after} body children")
        print(f"wrote {out}")
        raise SystemExit(0)

    kids, secs = sections(doc)
    print(f"top-level body children: {len(kids)}   sections: {len(secs)}\n")
    for i, (a, b) in enumerate(secs):
        texts = [t for t in (child_text(doc, kids[j]).strip() for j in range(a, b + 1)) if t]
        head = texts[0][:58] if texts else "(no text)"
        tail = texts[-1][:40] if len(texts) > 1 else ""
        print(f"  section {i:>2}: children {a:>3}-{b:<3} ({b-a+1:>3} items, {len(texts):>3} with text)")
        print(f"              first: {head!r}")
        if tail:
            print(f"              last : {tail!r}")

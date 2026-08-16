"""
bookmarks.py -- read and tokenize Word BOOKMARKS.

The proposal template carries 52 named bookmarks left by an older Word
automation (txtProjectNameCover, txtClientNameLetter, txtFeeDollars1 ...).
They are a much better tokenization anchor than matching the example's text:

  * they say what each field IS, in the template author's own words
  * they disambiguate the same value appearing in several places, which string
    matching cannot (the project name is on the cover, in the letter and in the
    body, and each has its own bookmark)
  * they survive editing, because Word maintains them

A bookmark is a pair of empty marker elements around the content:

    <w:bookmarkStart w:id="7" w:name="txtProjectName"/> ...runs... <w:bookmarkEnd w:id="7"/>

so tokenizing one means replacing the text of the runs BETWEEN the markers.

    python bookmarks.py list "…/TemplateProposal.docx"
"""

import re
import sys
import zipfile

BM_START = re.compile(r'<w:bookmarkStart[^>]*w:id="(\d+)"[^>]*w:name="([^"]+)"[^>]*/>')
BM_END = re.compile(r'<w:bookmarkEnd[^>]*w:id="(\d+)"[^>]*/>')
RUN_RE = re.compile(r"<w:r(?:\s[^>]*)?>[\s\S]*?</w:r>")
TEXT_RE = re.compile(r"(<w:t(?:\s[^>]*)?>)([\s\S]*?)(</w:t>)")


def spans(doc):
    """{name: (content_start, content_end)} for every non-internal bookmark."""
    starts = {}
    for m in BM_START.finditer(doc):
        starts[m.group(1)] = (m.group(2), m.end())
    out = {}
    for m in BM_END.finditer(doc):
        hit = starts.get(m.group(1))
        if not hit:
            continue
        name, content_start = hit
        if name.startswith("_"):          # _GoBack and friends
            continue
        out[name] = (content_start, m.start())
    return out


def text_of(doc, span):
    return "".join(t[1] for t in TEXT_RE.findall(doc[span[0]:span[1]]))


def set_text(doc, span, value):
    """
    Replace the bookmark's content with `value`, keeping the FIRST text-bearing
    run's formatting and blanking the rest. Returns the new document.

    Runs with no <w:t> (tab stops, field chars) are left alone: writing into one
    silently loses the value, which is the same trap the token engine hit.
    """
    inner = doc[span[0]:span[1]]
    runs = list(RUN_RE.finditer(inner))
    bearing = [r for r in runs if TEXT_RE.search(r.group(0))]
    if not bearing:
        return doc, False

    def blank(run):
        return TEXT_RE.sub(lambda m: m.group(1) + m.group(3), run)

    def fill(run, val):
        done = [False]

        def sub(m):
            if done[0]:
                return m.group(1) + m.group(3)
            done[0] = True
            open_tag = m.group(1)
            if "xml:space" not in open_tag:
                open_tag = open_tag[:-1] + ' xml:space="preserve">'
            return open_tag + val + m.group(3)
        return TEXT_RE.sub(sub, run)

    out, cursor = [], 0
    for r in runs:
        out.append(inner[cursor:r.start()])
        if r is bearing[0]:
            out.append(fill(r.group(0), value))
        elif TEXT_RE.search(r.group(0)):
            out.append(blank(r.group(0)))
        else:
            out.append(r.group(0))
        cursor = r.end()
    out.append(inner[cursor:])
    return doc[:span[0]] + "".join(out) + doc[span[1]:], True


def apply(doc, mapping):
    """
    {bookmark_name: token} -> (doc, filled, missing, empty).
    Applied right-to-left so earlier offsets stay valid.
    """
    found = spans(doc)
    missing = [n for n in mapping if n not in found]
    todo = sorted(((found[n], n) for n in mapping if n in found),
                  key=lambda x: x[0][0], reverse=True)
    filled, empty = [], []
    for span, name in todo:
        doc, ok = set_text(doc, span, mapping[name])
        (filled if ok else empty).append(name)
    return doc, filled, missing, empty


if __name__ == "__main__":
    doc = zipfile.ZipFile(sys.argv[2]).read("word/document.xml").decode("utf-8")
    found = spans(doc)
    print(f"{len(found)} named bookmarks\n")
    for name, span in sorted(found.items(), key=lambda kv: kv[1][0]):
        t = text_of(doc, span).strip()
        runs = len(RUN_RE.findall(doc[span[0]:span[1]]))
        flag = "  " if t else "EMPTY"
        print(f"  {flag} {name:<30} ({runs:>2} runs) {t[:52]!r}")

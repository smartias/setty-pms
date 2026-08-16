"""
probe.py -- dump a template's structure so a config can be authored against it.

    python probe.py "CAD RELEASE FORM.dotx"
    python probe.py --list

Prints every non-empty paragraph with its index and run count, plus the parts
inventory and any legacy bookmarks. Run-count > 1 on a value you intend to
tokenize is the warning sign: that value is split across runs and only the
engine's run-tolerant replace will find it.
"""

import os
import re
import sys
import zipfile

from engine import PARA_RE, RUN_RE, run_text

TEMPLATE_DIR = os.environ.get(
    "SETTY_TEMPLATE_DIR",
    os.path.join(
        os.environ.get("USERPROFILE", ""),
        "OneDrive - Setty and Associates",
        "NYC Projects - Project Document Library",
        "SAPX26XXX - NY 2026 Templates and Standards",
        "01 \U0001F4CB Project Management",
        "Templates for MCP Connector",
    ),
)

OOXML_WORD = (".docx", ".dotx", ".docm", ".dotm")


def list_templates():
    if not os.path.isdir(TEMPLATE_DIR):
        raise SystemExit(f"template dir not found:\n  {TEMPLATE_DIR}\n"
                         f"set SETTY_TEMPLATE_DIR to override")
    return sorted(os.listdir(TEMPLATE_DIR))


def probe(name):
    path = name if os.path.isabs(name) else os.path.join(TEMPLATE_DIR, name)
    ext = os.path.splitext(path)[1].lower()
    print(f"### {os.path.basename(path)}")
    print(f"    {os.path.getsize(path):,} bytes")

    if ext not in OOXML_WORD:
        print(f"    !! {ext} is not a WordprocessingML package -- engine does not apply")
        return

    z = zipfile.ZipFile(path)
    names = z.namelist()
    media = [n for n in names if n.startswith("word/media/")]
    print(f"    parts: {len(names)}   media: {len(media)}   "
          f"headers: {len([n for n in names if 'header' in n and n.endswith('.xml')])}   "
          f"footers: {len([n for n in names if 'footer' in n and n.endswith('.xml')])}")

    doc = z.read("word/document.xml").decode("utf-8")
    bms = re.findall(r'<w:bookmarkStart[^>]*w:name="([^"]+)"', doc)
    bms = [b for b in bms if not b.startswith("_")]
    if bms:
        print(f"    bookmarks: {', '.join(bms)}")
    if "<w:sdt>" in doc:
        print(f"    content controls: {doc.count('<w:sdt>')}")
    if "<w:ffData" in doc:
        print(f"    legacy form fields: {doc.count('<w:ffData')}")
    print(f"    tables: {doc.count('<w:tbl>')}")

    print("    --- paragraphs ---")
    for i, m in enumerate(PARA_RE.finditer(doc)):
        runs = list(RUN_RE.finditer(m.group(0)))
        txt = "".join(run_text(r.group(0)) for r in runs)
        if txt.strip():
            mark = "*" if len(runs) > 1 else " "
            print(f"    [{i:>3}]{mark}({len(runs):>2}r) {txt[:150]!r}")
    print()


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or args[0] == "--list":
        for n in list_templates():
            print(" ", n)
    else:
        for a in args:
            probe(a)

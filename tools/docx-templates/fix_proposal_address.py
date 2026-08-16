"""
One-off: correct the New York address in the proposal template.

The template carried TWO wrong addresses, in three parts:

  word/document.xml  cover page   "139 West 36th Street"   -> typo, 149 is correct
  word/footer1.xml   page footer  "535 8th Avenue, 21s"    -> the OLD office, and
  word/footer3.xml   page footer  "535 8th Avenue, 21s"       truncated mid-word

Correct is "149 W 36th Street, 8th Floor", New York, NY 10018. Confirmed by Sara
and independently by the sa-ny entry in SettyPMS PROPOSAL_ENTITIES, which was
corrected away from 535 8th Avenue in the same session.

The zip is already 10018 in both places and is left alone.

    python fix_proposal_address.py <in.docx> <out.docx>
"""

import os
import shutil
import sys
import zipfile

from engine import replace_all, transform

COVER = {"139 West 36th Street": "149 W 36th Street"}
# The footer text is truncated at "21s", so match what is actually there.
FOOTER = {"535 8th Avenue, 21s": "149 W 36th Street, 8th Floor"}

FORBID = ["139 West 36th", "535 8th Avenue"]


def main(src, dst):
    backup = src + ".before-address-fix"
    if not os.path.exists(backup):
        shutil.copy2(src, backup)
        print(f"  backup: {os.path.basename(backup)}")

    counts = {}

    def fn(name, xml):
        if name == "word/document.xml":
            xml, hits = replace_all(xml, COVER)
            counts[name] = sum(hits.values())
        elif name.startswith("word/footer"):
            xml, hits = replace_all(xml, FOOTER)
            if sum(hits.values()):
                counts[name] = sum(hits.values())
        return xml

    transform(src, dst, fn)

    for k, v in sorted(counts.items()):
        print(f"  {k:<22} {v} replacement(s)")

    # Verify against the bytes written, across every text part.
    z = zipfile.ZipFile(dst)
    bad = []
    for n in z.namelist():
        if not (n.startswith("word/") and n.endswith(".xml")):
            continue
        body = z.read(n).decode("utf-8", "replace")
        for f in FORBID:
            if f in body:
                bad.append(f"{n}: {f}")
    good = sum(1 for n in z.namelist()
               if n.startswith("word/") and n.endswith(".xml")
               and "149 W 36th Street" in z.read(n).decode("utf-8", "replace"))
    print(f"\n  parts now carrying the correct address: {good}")
    if bad:
        raise SystemExit("  STILL WRONG:\n    " + "\n    ".join(bad))
    print("  no wrong address survives anywhere in the package")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

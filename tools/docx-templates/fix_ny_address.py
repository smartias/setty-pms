"""
One-off maintenance: correct the stale New York office address.

Confirmed by Sara 2026-08-16: the current NY office is
    149 W 36th Street, 8th Floor / New York, NY 10018

A scan of all eight templates found the OLD address (121 West 27th Street,
Suite 1100 / New York, NY 10001) in exactly two of them, both Subagreement
copies. Everything else was already correct. Phone and fax numbers did not
change, so only the street line and the zip are touched.

This edits the CANONICAL templates in SharePoint. Originals are backed up to
build/backup/ first, and SharePoint's own version history is the second net.
Run prep.py afterwards to regenerate the tokenized copies.

    python fix_ny_address.py            # dry run, shows what would change
    python fix_ny_address.py --apply
"""

import os
import shutil
import sys
import zipfile

from engine import PARA_RE, RUN_RE, replace_all, run_text, transform
from probe import TEMPLATE_DIR

HERE = os.path.dirname(os.path.abspath(__file__))
BACKUP = os.path.join(HERE, "build", "backup")

TARGETS = ["SubagreementTemplate.dotx",
           "SubagreementTemplate-Sara-Samsung-PC-2022-11-23.dotx"]

FIX = {
    "121 West 27th Street, Suite 1100": "149 W 36th Street, 8th Floor",
    "New York, NY 10001": "New York, NY 10018",
}

# Guard: never let the old address survive, never touch anything but footers.
FOOTER_PARTS = ("word/footer",)


def footer_text(path):
    z = zipfile.ZipFile(path)
    out = []
    for n in z.namelist():
        if n.startswith(FOOTER_PARTS) and n.endswith(".xml"):
            xml = z.read(n).decode("utf-8", "replace")
            for m in PARA_RE.finditer(xml):
                t = "".join(run_text(r.group(0)) for r in RUN_RE.finditer(m.group(0)))
                if t.strip():
                    out.append(t)
    return out


def apply_fix(name, dry):
    src = os.path.join(TEMPLATE_DIR, name)
    if not os.path.exists(src):
        print(f"  SKIP (not found): {name}")
        return True

    before = footer_text(src)
    stale = [t for t in before if any(k in t for k in FIX)]
    if not stale:
        print(f"  OK (already correct): {name}")
        return True

    print(f"  {name}")
    for t in stale:
        print(f"      before: {t!r}")
    if dry:
        return True

    os.makedirs(BACKUP, exist_ok=True)
    shutil.copy2(src, os.path.join(BACKUP, name))

    tmp = os.path.join(HERE, "build", "_fix_" + name)

    def fn(part, xml):
        # Footers only. Content types stay as-is: these remain .dotx templates.
        if not (part.startswith(FOOTER_PARTS) and part.endswith(".xml")):
            return xml
        xml, _ = replace_all(xml, FIX)
        return xml

    transform(src, tmp, fn)

    # Verify before overwriting the canonical.
    zi, zo = zipfile.ZipFile(src), zipfile.ZipFile(tmp)
    same_parts = {i.filename for i in zi.infolist()} == {i.filename for i in zo.infolist()}
    untouched = [p for p in zi.namelist()
                 if not (p.startswith(FOOTER_PARTS) and p.endswith(".xml"))
                 and zi.read(p) != zo.read(p)]
    after = footer_text(tmp)
    still_stale = [t for t in after if any(k in t for k in FIX)]
    fixed = [t for t in after if "149 W 36th Street" in t or "NY 10018" in t]
    zi.close()
    zo.close()

    ok = same_parts and not untouched and not still_stale and fixed
    for t in fixed:
        print(f"      after : {t!r}")
    if not ok:
        print(f"      FAILED  parts:{same_parts}  mutated:{untouched}  "
              f"stale-left:{still_stale}")
        os.remove(tmp)
        return False

    shutil.move(tmp, src)
    print(f"      applied, backup in build/backup/")
    return True


if __name__ == "__main__":
    dry = "--apply" not in sys.argv
    print(f"{'DRY RUN (pass --apply to write)' if dry else 'APPLYING'}\n")
    results = [apply_fix(n, dry) for n in TARGETS]
    print(f"\n{sum(results)}/{len(results)} ok")
    if not dry:
        print("now run: python prep.py subagreement")
    sys.exit(0 if all(results) else 1)

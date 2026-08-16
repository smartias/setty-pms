"""
render.py -- fill a tokenized template. This is the shippable core.

    python render.py addservice fields.json "out.docx"

Everything the caller supplies arrives as `fields`. Everything else in the
package is copied through untouched, so letterhead fidelity is preserved by
construction rather than by effort.

Returns/reports a warnings list. A caller must not file a document that still
has unfilled contract fields without a human looking at it.
"""

import json
import os
import re
import sys

from engine import expand_list, replace_all, transform, xml_escape

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_DIR = os.path.join(HERE, "configs")
BUILD_DIR = os.path.join(HERE, "build")
TOKEN_RE = re.compile(r"\{\{[A-Z_0-9]+\}\}")

# What to do with a token the caller never supplied:
#   leave -- keep {{TOKEN}} visible as a to-do (default; safe and loud)
#   blank -- delete it silently
#   fail  -- refuse to produce the document
ON_MISSING = os.environ.get("ON_MISSING", "leave")


def load_config(template_id):
    path = os.path.join(CONFIG_DIR, f"{template_id}.json")
    if not os.path.exists(path):
        ids = [f[:-5] for f in sorted(os.listdir(CONFIG_DIR)) if f.endswith(".json")]
        raise SystemExit(f"unknown template {template_id!r}; have: {', '.join(ids)}")
    return json.load(open(path, encoding="utf-8"))


def render(template_id, fields, dst):
    cfg = load_config(template_id)
    src = os.path.join(BUILD_DIR, cfg["output"])
    if not os.path.exists(src):
        raise SystemExit(f"tokenized template missing: {src}\nrun: python prep.py {template_id}")

    list_tokens = cfg.get("render_lists", [])
    warnings = []

    def fn(name, xml):
        for tok in list_tokens:
            key = tok.strip("{}")
            items = fields.get(key)
            if items is None:
                continue
            if isinstance(items, str):
                items = [items]
            xml, found = expand_list(xml, tok, items)
            if found and not items:
                warnings.append(f"{key}: empty list, paragraph removed")

        mapping = {f"{{{{{k}}}}}": xml_escape(v)
                   for k, v in fields.items() if not isinstance(v, list)}
        xml, _ = replace_all(xml, mapping)

        for m in TOKEN_RE.finditer(xml):
            warnings.append(f"UNFILLED {m.group(0)}")
        if ON_MISSING == "blank":
            xml = TOKEN_RE.sub("", xml)
        return xml

    transform(src, dst, fn)
    warns = sorted(set(warnings))
    if ON_MISSING == "fail" and any(w.startswith("UNFILLED") for w in warns):
        raise SystemExit("render refused, unfilled tokens:\n  " + "\n  ".join(warns))
    return warns


if __name__ == "__main__":
    if len(sys.argv) < 4:
        raise SystemExit(__doc__)
    tid, fpath, out = sys.argv[1], sys.argv[2], sys.argv[3]
    warns = render(tid, json.load(open(fpath, encoding="utf-8")), out)
    print(f"wrote {out}")
    print("warnings:" if warns else "warnings: none")
    for w in warns:
        print("  -", w)

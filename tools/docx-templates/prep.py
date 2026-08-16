"""
prep.py -- turn the canonical SharePoint templates into tokenized templates.

    python prep.py            # all configs
    python prep.py esi cad-release

Writes build/<output>. Nothing here touches the originals.

ORDER MATTERS. Index-based operations (ops, blank_paragraphs) run FIRST,
because collapsing a list group changes paragraph indices for everything after
it. Then list collapses, then global auto-mapping.

Verification is not optional and not advisory: a config that cannot prove every
token landed in the file it just wrote is a failed build. Counting attempted
replacements proved worthless -- an early version reported 12/12 "ok" while
having silently destroyed 6 tokens by writing into runs that had no <w:t>.
"""

import json
import os
import re
import sys
import zipfile

from engine import (CONTENT_TYPES, INSTRUCTION_MARKERS, PARA_RE, RUN_RE,
                    TEMPLATE_CT, accept_revisions, apply_ops,
                    mark_fields_dirty, replace_all, run_text,
                    set_paragraph_text, strip_instruction_textboxes,
                    template_to_document, transform)
import bookmarks
from probe import TEMPLATE_DIR

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_DIR = os.path.join(HERE, "configs")
BUILD_DIR = os.path.join(HERE, "build")
TOKEN_RE = re.compile(r"\{\{[A-Z_0-9]+\}\}")
PLACEHOLDER_RE = re.compile(r"\[[^\]\r\n]{1,60}\]")


def ptext(para):
    return "".join(run_text(r.group(0)) for r in RUN_RE.finditer(para))


def collapse(xml, first_text, last_text, token):
    """Replace the paragraph span [first_text .. last_text] with one token para."""
    spans = list(PARA_RE.finditer(xml))
    i = next((k for k, m in enumerate(spans)
              if ptext(m.group(0)).strip() == first_text), None)
    j = next((k for k, m in enumerate(spans)
              if ptext(m.group(0)).strip() == last_text), None)
    if i is None or j is None:
        raise SystemExit(f"  collapse failed for {token}: "
                         f"first={'ok' if i is not None else 'MISSING'} "
                         f"last={'ok' if j is not None else 'MISSING'}")
    proto = set_paragraph_text(spans[i].group(0), token)
    return xml[: spans[i].start()] + proto + xml[spans[j].end():]


def collapse_to_prototypes(xml, cfg):
    """
    Replace a whole run of body paragraphs with TWO prototype paragraphs, one
    for a heading and one for body text, each carrying a token.

    Cloning real paragraphs is the only way to keep house formatting here:
    every paragraph in INCLUDED SERVICES is Heading1 with numbering, and the
    heading and body differ by indent level, not by style name. Writing new
    paragraphs from scratch would lose the numbering and the indents.

    The renderer then clones whichever prototype each scope block needs.
    """
    import sections as S
    kids = S.top_level_children(xml)
    texts = [S.child_text(xml, k).strip() for k in kids]
    try:
        lo = next(i for i, t in enumerate(texts) if t.startswith(cfg["after"]))
        hi = next(i for i, t in enumerate(texts) if t.startswith(cfg["before"]))
    except StopIteration:
        raise SystemExit(f"  block_range anchors not found: "
                         f"{cfg['after']!r} .. {cfg['before']!r}")

    # First two non-empty children after the anchor are the heading and body
    # examples; use them as the prototypes.
    body_idx = [i for i in range(lo + 1, hi) if texts[i]]
    if len(body_idx) < 2:
        raise SystemExit("  block_range: need at least two non-empty paragraphs")
    proto_h = set_paragraph_text(kids[body_idx[0]][1] and
                                 xml[kids[body_idx[0]][1]:kids[body_idx[0]][2]],
                                 cfg["heading_token"])
    proto_b = set_paragraph_text(xml[kids[body_idx[1]][1]:kids[body_idx[1]][2]],
                                 cfg["body_token"])
    start = kids[lo + 1][1]
    end = kids[hi - 1][2]
    return xml[:start] + proto_h + proto_b + xml[end:]


def blank(xml, indices):
    spans = list(PARA_RE.finditer(xml))
    out, cursor = [], 0
    for i, m in enumerate(spans):
        out.append(xml[cursor:m.start()])
        out.append(set_paragraph_text(m.group(0), "") if i in indices else m.group(0))
        cursor = m.end()
    out.append(xml[cursor:])
    return "".join(out)


def expected_tokens(cfg):
    toks = set()
    for v in cfg.get("auto", {}).values():
        toks.update(TOKEN_RE.findall(v))
    for v in cfg.get("bookmarks", {}).values():
        toks.update(TOKEN_RE.findall(v))
    for o in cfg.get("ops", []):
        toks.update(TOKEN_RE.findall(o["token"]))
    for l in cfg.get("lists", []):
        toks.update(TOKEN_RE.findall(l["token"]))
    return toks


def build(cfg):
    # source_path overrides the SharePoint templates folder, for a template that
    # is not filed there yet (the proposal).
    src = (os.path.join(HERE, cfg["source_path"]) if cfg.get("source_path")
           else os.path.join(TEMPLATE_DIR, cfg["source"]))
    dst = os.path.join(BUILD_DIR, cfg["output"])
    if not os.path.exists(src):
        raise SystemExit(f"  source not found: {src}")

    stripped = {"boxes": 0, "fields": 0}
    report = {}

    def fn(name, xml):
        if name == CONTENT_TYPES:
            return template_to_document(xml)   # .dotx -> .docx, see engine.py

        # STRIP FIRST. A call-out drawing contains its own nested <w:p>, which
        # makes paragraph parsing around it unreliable; two placeholders in the
        # subagreement ([SETTY P/N], [Storage Path]) hid behind that mis-parse
        # and escaped substitution entirely when stripping ran last.
        # Consequence: any config using paragraph-INDEX ops must be authored
        # against a template with no call-outs, or re-probed after stripping.
        xml, b = strip_instruction_textboxes(xml)
        xml, f = mark_fields_dirty(xml)
        # Accept tracked changes before anything else reads the text: a value
        # split across an <w:ins> boundary is invisible to run-level matching,
        # and editing marks must never reach a client either way.
        xml, rev = accept_revisions(xml)
        stripped["boxes"] += b
        stripped["fields"] += f
        stripped["revisions"] = stripped.get("revisions", 0) + rev
        if name != "word/document.xml":
            return xml

        # Bookmarks BEFORE value matching: their spans are exact, and doing
        # them first means the value pass cannot chew through a field that a
        # bookmark already owns. Value matching then catches the cases where a
        # bookmark covers only PART of its value -- this template truncates the
        # project name mid-word in two of three places.
        if cfg.get("bookmarks"):
            xml, bm_filled, bm_missing, bm_empty = bookmarks.apply(xml, cfg["bookmarks"])
            report["bookmarks"] = (len(bm_filled), bm_missing, bm_empty)
        if cfg.get("ops"):
            xml, _ = apply_ops(xml, cfg["ops"])
        if cfg.get("blank_paragraphs"):
            xml = blank(xml, set(cfg["blank_paragraphs"]))
        for l in cfg.get("lists", []):
            xml = collapse(xml, l["first"], l["last"], l["token"])
        # Applied LAST-FIRST: each collapse removes children, so doing the
        # later sections first keeps the earlier anchors where the text
        # scan expects them.
        for br in reversed(cfg.get("block_ranges", [])):
            xml = collapse_to_prototypes(xml, br)
        if cfg.get("auto"):
            xml, _ = replace_all(xml, cfg["auto"])
        return xml

    os.makedirs(BUILD_DIR, exist_ok=True)
    transform(src, dst, fn)

    # ---- verify against the bytes we actually wrote ----
    zin, zout = zipfile.ZipFile(src), zipfile.ZipFile(dst)
    out_doc = zout.read("word/document.xml").decode("utf-8")

    want = expected_tokens(cfg)
    lost = sorted(t for t in want if t not in out_doc)
    leaked = sorted(s for s in cfg.get("forbid_in_output", []) if s in out_doc)

    parts_in = {i.filename for i in zin.infolist()}
    parts_out = {i.filename for i in zout.infolist()}
    look = [p for p in parts_in
            if p.startswith(("word/media/", "word/header", "word/footer"))
            or p in ("word/styles.xml", "word/numbering.xml",
                     "word/theme/theme1.xml", "word/fontTable.xml")]
    # Marking fields dirty legitimately edits headers/footers, so normalise that
    # one attribute away before asserting the look-carrying parts are untouched.
    def norm(b):
        return b.replace(b' w:dirty="true"', b"")

    changed = [p for p in look if norm(zin.read(p)) != norm(zout.read(p))]

    left = sorted(set(PLACEHOLDER_RE.findall(
        "".join(ptext(m.group(0)) for m in PARA_RE.finditer(out_doc)))))

    # A .dotx content type under a .docx name makes Word reject the file.
    ct_ok = TEMPLATE_CT not in zout.read(CONTENT_TYPES).decode("utf-8")

    # No author-instruction call-out may survive into a client document.
    all_text = "".join(
        zout.read(p).decode("utf-8", "replace") for p in sorted(parts_out)
        if p.startswith(("word/document", "word/header", "word/footer"))
        and p.endswith(".xml"))
    survived = [k for k in INSTRUCTION_MARKERS if k in all_text]

    ok = (not lost and not leaked and not changed
          and parts_in == parts_out and ct_ok and not survived)
    print(f"  {'PASS' if ok else 'FAIL'}  {cfg['id']:<24} "
          f"tokens {len(want) - len(lost)}/{len(want)}   "
          f"parts {len(parts_out)}/{len(parts_in)}   "
          f"look {len(look) - len(changed)}/{len(look)}   "
          f"ct:{'docx' if ct_ok else 'TEMPLATE'}   "
          f"stripped {stripped['boxes']} boxes, refreshed {stripped['fields']} fields, "
          f"accepted {stripped.get('revisions', 0)} revisions"
          + (f"   bookmarks {report['bookmarks'][0]}" if report.get("bookmarks") else ""))
    if report.get("bookmarks"):
        _, bm_missing, bm_empty = report["bookmarks"]
        if bm_missing:
            print(f"        BOOKMARKS NOT FOUND: {', '.join(bm_missing)}")
        if bm_empty:
            print(f"        bookmarks collapsed to zero length, cannot fill: "
                  f"{', '.join(bm_empty)}")
    if survived:
        print(f"        INSTRUCTION TEXT SURVIVED: {', '.join(survived)}")
    if lost:
        print(f"        LOST TOKENS : {', '.join(lost)}")
    if leaked:
        print(f"        LEAKED VALUES: {', '.join(repr(x) for x in leaked)}")
    if changed:
        print(f"        MUTATED PARTS: {', '.join(changed)}")
    if left:
        print(f"        still untokenized ({len(left)}): "
              f"{', '.join(repr(x) for x in left[:8])}"
              f"{' ...' if len(left) > 8 else ''}")
    return ok


if __name__ == "__main__":
    wanted = sys.argv[1:]
    cfgs = []
    for f in sorted(os.listdir(CONFIG_DIR)):
        if not f.endswith(".json"):
            continue
        c = json.load(open(os.path.join(CONFIG_DIR, f), encoding="utf-8"))
        if not wanted or c["id"] in wanted:
            cfgs.append(c)
    if not cfgs:
        raise SystemExit(f"no configs matched {wanted}")

    print(f"template dir: {TEMPLATE_DIR}\n")
    results = [build(c) for c in cfgs]
    print(f"\n{sum(results)}/{len(results)} templates built and verified")
    sys.exit(0 if all(results) else 1)

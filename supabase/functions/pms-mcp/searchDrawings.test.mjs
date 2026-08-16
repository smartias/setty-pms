// Tests for search_drawings' pure helpers in index.ts.
//
//   node supabase/functions/pms-mcp/searchDrawings.test.mjs
//
// The helpers are COPIED below (index.ts boots a server at import). A drift
// check at the bottom fails if the copies stop matching the shipped source.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ── copies from index.ts ────────────────────────────────────────────────────
function drawingQueryPatterns(query) {
  const terms = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(String(query || ""))) !== null) terms.push((m[1] ?? m[2]).trim());
  return terms
    .filter(Boolean)
    .map((t) =>
      t.split(/[-\s]+/).filter(Boolean)
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("[-\\s]?"))
    .filter(Boolean)
    .slice(0, 6);
}

function drawingSetOf(folderPath) {
  const parts = String(folderPath || "").split("/").filter(Boolean);
  const i = parts.findIndex((p) => p.toLowerCase().includes("outgoing"));
  if (i >= 0 && parts[i + 1]) return parts[i + 1];
  return parts[0] || "/";
}
// ── end copies ──────────────────────────────────────────────────────────────

// Patterns are POSIX regexes for Postgres `~*`; check them with JS regex, whose
// syntax agrees for everything emitted here (escapes, [-\s]?, literals).
const matches = (pat, text) => new RegExp(pat, "i").test(text);

// One term, hyphen/space/nothing inside a tag are interchangeable.
{
  const [p] = drawingQueryPatterns("FCU-11");
  assert.equal(p, "FCU[-\\s]?11");
  assert.ok(matches(p, "... FCU-11 ..."));
  assert.ok(matches(p, "... FCU 11 ..."));
  assert.ok(matches(p, "... FCU11 ..."));
  assert.ok(!matches(p, "... FCU-1 ..."));
}

// Words are separate AND terms; a quoted phrase is one term with flexible gaps.
{
  const ps = drawingQueryPatterns('"perchloric fume hood" 208V');
  assert.deepEqual(ps, ["perchloric[-\\s]?fume[-\\s]?hood", "208V"]);
  assert.ok(matches(ps[0], "PERCHLORIC FUME HOOD EXHAUST"));
  assert.ok(!matches(ps[0], "PERCHLORIC ACID ... FUME HOOD"));
  assert.deepEqual(drawingQueryPatterns("perchloric fume hood"), ["perchloric", "fume", "hood"]);
}

// User text is never regex: metacharacters are escaped, so a query like
// "(N) 4" or "1.5\"" cannot break or widen the search.
{
  const ps = drawingQueryPatterns("(N) 4\" 350KW.");
  assert.deepEqual(ps, ["\\(N\\)", "4\"", "350KW\\."]);
  assert.ok(matches(ps[0], "(N) DUCT"));
  assert.ok(!matches(ps[0], "N DUCT"));
  assert.ok(matches(ps[2], "350KW."));
  assert.ok(!matches(ps[2], "350KWX"));
}

// Empty and junk input yield no patterns; term count is capped.
{
  assert.deepEqual(drawingQueryPatterns(""), []);
  assert.deepEqual(drawingQueryPatterns("   "), []);
  assert.deepEqual(drawingQueryPatterns("- -- -"), []);
  assert.equal(drawingQueryPatterns("a b c d e f g h").length, 6);
}

// Set name comes off the path segment after Outgoing, whatever the Outgoing
// folder is actually called on that project.
{
  assert.equal(drawingSetOf("Outgoing/2025-04-10_Bulletin #1/Drawings"), "2025-04-10_Bulletin #1");
  assert.equal(drawingSetOf("99 📤 Outgoing/2024-10-24_Revised 100% CD Submission/INDIVIDUAL PDF's/E"), "2024-10-24_Revised 100% CD Submission");
  assert.equal(drawingSetOf("Incoming/Architect/2026-01-05 Backgrounds"), "Incoming");
  assert.equal(drawingSetOf(""), "/");
}

// ── drift check ─────────────────────────────────────────────────────────────
{
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "index.ts"), "utf8");
  const me = readFileSync(fileURLToPath(import.meta.url), "utf8");
  for (const name of ["drawingQueryPatterns", "drawingSetOf"]) {
    const grab = (s, sig) => {
      const at = s.indexOf(sig);
      assert.ok(at >= 0, `${name} not found`);
      const end = s.indexOf("\n}\n", at);
      // Strip the TS annotations the source carries so both sides compare as JS.
      return s.slice(at, end + 2)
        .replace(/: string\[\]/g, "")
        .replace(/: string/g, "")
        .replace(/: RegExpExecArray \| null/g, "");
    };
    const a = grab(src, `function ${name}(`);
    const b = grab(me, `function ${name}(`);
    assert.equal(b, a, `${name} in this test has drifted from index.ts`);
  }
}

console.log("searchDrawings.test.mjs: all assertions passed");

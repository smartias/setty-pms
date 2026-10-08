// Project resolution for the project-scoped tools: exact id/number/name,
// then a bare number to its first phase, then a name the way people say it.
// Mirrors the fallback logic in resolveProjectId (index.ts); the drift checks
// at the bottom fail if the shipped source stops carrying it.
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

const SEARCH_STOPWORDS = new Set(["a","an","the","with","for","of","on","at","in","and","to","by","project","job","study","our"]);

function resolve(visible, identifier) {
  const id = identifier.toLowerCase().trim();
  const hit = visible.find((r) => [r.pid, r.pn, r.nm].filter(Boolean).some((f) => String(f).toLowerCase() === id));
  if (hit) return hit.pid;
  if (/^[a-z]{4}\d{5,6}$/.test(id)) {
    const phase = visible.find((r) => String(r.pn || "").toLowerCase().startsWith(id + "."));
    return phase?.pid ?? null;
  }
  const terms = id.split(/[^a-z0-9.#&-]+/).map((t) => t.replace(/\.+$/, "")).filter((t) => t.length > 1 && !SEARCH_STOPWORDS.has(t));
  if (terms.length) {
    const matches = visible.filter((r) => { const hay = `${r.pn || ""} ${r.nm || ""}`.toLowerCase(); return terms.every((t) => hay.includes(t)); });
    if (matches.length === 1) return matches[0].pid;
    if (matches.length > 1 && matches.every((r) => r.pn)) {
      const jobs = new Set(matches.map((r) => String(r.pn).toLowerCase().replace(/\.\d{2}$/, "")));
      if (jobs.size === 1) return matches[0].pid;
    }
  }
  return null;
}

const ROWS = [
  { pid: "p1", pn: "SAPX266021.00", nm: "St. Nicholas of Tolentine Feasibility Study" },
  { pid: "p2", pn: "SAPX239010.00", nm: "VIB Belmont Reno Phase 1" },
  { pid: "p3", pn: "SAPX239010.01", nm: "VIB Belmont Reno Phase 2" },
  { pid: "p4", pn: "SIPX261005.00", nm: "UMD CP Thrive Center" },
  { pid: "p5", pn: "SAPX256011.00", nm: "Queens College Accessibility" },
  { pid: "p6", pn: "SAPX176006.00", nm: "Queens College Lab Renovation" },
  { pid: "p7", pn: null, nm: "Homeport II" },
  { pid: "p8", pn: "SAPX21602.00", nm: "Legacy Five Digit Job" },
];

test("exact number, id and name still win", () => {
  assert.equal(resolve(ROWS, "SAPX266021.00"), "p1");
  assert.equal(resolve(ROWS, "p4"), "p4");
  assert.equal(resolve(ROWS, "umd cp thrive center"), "p4");
});
test("a bare number resolves to its first phase", () => {
  assert.equal(resolve(ROWS, "SAPX239010"), "p2");
  assert.equal(resolve(ROWS, "sapx266021"), "p1");
  assert.equal(resolve(ROWS, "SAPX999999"), null);
  assert.equal(resolve(ROWS, "SAPX21602"), "p8", "legacy five-digit number");
});
test("a name as people say it resolves when it fits one job", () => {
  assert.equal(resolve(ROWS, "St Nicholas of Tolentine"), "p1", "missing period and suffix words");
  assert.equal(resolve(ROWS, "the Thrive Center job"), "p4", "stopwords ignored");
  assert.equal(resolve(ROWS, "Homeport"), "p7", "pipeline project with no number");
});
test("several phases of one job count as one job; two jobs stay ambiguous", () => {
  assert.equal(resolve(ROWS, "VIB Belmont"), "p2", "first phase of the one matching job");
  assert.equal(resolve(ROWS, "Queens College"), null, "two different jobs: leave it to search_projects");
  assert.equal(resolve(ROWS, "Queens College Lab"), "p6");
});
test("drift: ambiguity is request-scoped and reports the total", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const seg = src.slice(src.indexOf("async function resolveProjectRef"), src.indexOf("const MAX_BODY_CHARS"));
  assert.ok(seg.includes("const scope = _resolveScope.getStore();"), "candidates live on the request scope, not a module map");
  assert.ok(!src.includes("_ambiguousRefs"), "the module-level map is gone");
  assert.ok(seg.includes("ref: identifier, total: matches.length,"), "the total survives the cap");
  assert.ok(src.includes("Ask the user which of these they mean"), "wrapper turns the miss into a question");
  assert.ok(src.includes("const row = await _resolveScope.run(scope, () => resolveProjectRef(String(args[refKey])));"), "wrapper normalises the argument before the handler");
});
test("drift: the shipped resolver carries the same fallbacks", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const seg = src.slice(src.indexOf("async function resolveProjectRef"), src.indexOf("const MAX_BODY_CHARS"));
  for (const line of [
    "if (BARE_NUMBER_RE.test(id)) {",
    "const BARE_NUMBER_RE = /^[a-z]{4}\\d{5,6}$/;",
    "const terms = id.split(/[^a-z0-9.#&-]+/).map((t) => t.replace(/\\.+$/, \"\")).filter((t) => t.length > 1 && !SEARCH_STOPWORDS.has(t));",
    "if (matches.length === 1) return matches[0];",
    'const jobs = new Set(matches.map((r: any) => String(r.pn).toLowerCase().replace(/\\.\\d{2}$/, "")));',
  ]) assert.ok(src.includes(line) || seg.includes(line), "index.ts resolver lost: " + line);
});

test("drift: the name-is-enough tip keys off what was passed in, and leaves the call to Claude", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.ok(src.includes("const passedRef = refKey ? String(args[refKey]).trim() : \"\";"), "wrapper captures the reference before normalisation");
  assert.ok(src.includes("test(passedRef)"), "tip tests the passed reference, not the substituted number");
  assert.ok(src.includes("Say this only if the USER'S OWN message contained a project number."), "tip leaves the judgment to Claude");
  assert.ok(!src.includes("The user typed a project number."), "the tip no longer asserts what the user typed");
});

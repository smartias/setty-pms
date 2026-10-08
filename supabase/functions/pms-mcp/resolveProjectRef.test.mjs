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
  if (/^[a-z]{4}\d{6}$/.test(id)) {
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
test("drift: an ambiguous name records its candidates for the follow-up question", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const seg = src.slice(src.indexOf("async function resolveProjectId"), src.indexOf("const MAX_BODY_CHARS"));
  assert.ok(seg.includes("_ambiguousRefs.set(id, matches.slice(0, 8)"), "resolver records the candidates");
  assert.ok(src.includes("Ask the user which of these they mean"), "wrapper turns the miss into a question");
});
test("drift: the shipped resolver carries the same fallbacks", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const seg = src.slice(src.indexOf("async function resolveProjectId"), src.indexOf("const MAX_BODY_CHARS"));
  for (const line of [
    'if (/^[a-z]{4}\\d{6}$/.test(id)) {',
    "const terms = id.split(/[^a-z0-9.#&-]+/).map((t) => t.replace(/\\.+$/, \"\")).filter((t) => t.length > 1 && !SEARCH_STOPWORDS.has(t));",
    "if (matches.length === 1) return matches[0].pid;",
    'const jobs = new Set(matches.map((r: any) => String(r.pn).toLowerCase().replace(/\\.\\d{2}$/, "")));',
  ]) assert.ok(seg.includes(line), "index.ts resolveProjectId lost: " + line);
});

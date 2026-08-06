// Project search: describing a job rather than naming it.
//
// Mirrors the implementation in index.ts. The fixtures are REAL rows: the
// St. Therese job is the one that prompted this (Sara: "people might refer to a
// project citing the agency, name and prime, ie Feasibility Study with SCA for
// Morphosis"), and searching that exact phrase returned zero before this change.
import { strict as assert } from "node:assert";
import test from "node:test";

const SEARCH_STOPWORDS = new Set([
  "a", "an", "the", "with", "for", "of", "on", "at", "in", "and", "to", "by",
  "project", "job", "study", "our",
]);

const AGENCY_ALIASES = {
  sca: "school construction authority",
  ddc: "department of design and construction",
  dasny: "dormitory authority",
  cuny: "city university",
  suny: "state university",
  sucf: "state university construction fund",
  ogs: "office of general services",
  edc: "economic development corporation",
  dep: "department of environmental protection",
  dot: "department of transportation",
  nycha: "housing authority",
  hpd: "housing preservation development",
};

const projectHaystack = (p) => [
  p.name, p.projectNumber, p.status, p.owner, p.prime, p.clientName,
  p.projectType, p.projectCity, p.projectState, p.buildingCategory,
  p.contractNumber, p.primeProjectNumber,
].filter(Boolean).join(" ").toLowerCase();

function scoreProjectMatch(p, terms) {
  if (!terms.length) return 1;
  const hay = projectHaystack(p);
  let hits = 0;
  for (const t of terms) {
    const alias = AGENCY_ALIASES[t];
    if (hay.includes(t) || (alias && hay.includes(alias))) hits++;
  }
  return hits === terms.length ? hits : 0;
}

const termsOf = (raw) => String(raw || "").toLowerCase().trim()
  .split(/[^a-z0-9.#&-]+/)
  .filter((t) => t && t.length > 1 && !SEARCH_STOPWORDS.has(t));

const search = (pool, raw) => {
  const terms = termsOf(raw);
  if (!terms.length) return pool;
  return pool.map((p) => ({ p, s: scoreProjectMatch(p, terms) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || String(a.p.name).localeCompare(String(b.p.name)))
    .map((r) => r.p);
};

const STTHERESE = {
  name: "St. Therese of Lisieux Feasibility Study", projectNumber: "",
  status: "Proposal Due", owner: "School Construction Authority - New York City",
  prime: "Morphosis Architects", clientName: "Morphosis Architects",
  projectType: "Type II New Construction",
};
const Q526 = {
  name: "SCA Q526", projectNumber: "", status: "Proposal Submitted",
  owner: null, prime: "Morphosis Architects", clientName: "Morphosis Architects",
  projectType: "Type II New Construction",
};
const BROADWAY = {
  name: "280 Broadway", projectNumber: "SAPX256018.00", status: "In Progress",
  owner: "NYC DDC", prime: "Slade Architecture", clientName: "Slade Architecture",
  projectType: "Renovation", projectCity: "New York",
};
const TABLER = {
  name: "SUNY Stony Brook Tabler Quad Red Hall", projectNumber: "SAPX196006.00",
  status: "In Progress", owner: "SUNY Stony Brook", prime: "Perkins Eastman",
  projectType: "Renovation",
};
const POOL = [STTHERESE, Q526, BROADWAY, TABLER];

test("THE CASE THAT PROMPTED THIS: a spoken description finds the job", () => {
  // Agency by acronym, prime by firm, type by word. None of these is the name.
  const hits = search(POOL, "Feasibility Study with SCA for Morphosis");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, "St. Therese of Lisieux Feasibility Study");
});

test("the old whole-string match could never have worked", () => {
  // Guards the actual defect: the query as one substring appears in no field.
  const whole = "feasibility study with sca for morphosis";
  assert.ok(!POOL.some((p) => projectHaystack(p).includes(whole)));
});

test("an agency acronym matches the spelled-out agency", () => {
  const hits = search(POOL, "SCA");
  assert.ok(hits.some((h) => h.name.startsWith("St. Therese")), "full agency name must match 'SCA'");
  assert.ok(hits.some((h) => h.name === "SCA Q526"), "literal 'SCA' in a name must still match");
});

test("prime firm alone finds every job with that prime", () => {
  const hits = search(POOL, "Morphosis");
  assert.equal(hits.length, 2);
});

test("prime plus agency returns BOTH Morphosis SCA jobs, which is correct", () => {
  // Both really are Morphosis jobs for the SCA: St. Therese carries the agency
  // in `owner`, and Q526 carries "SCA" in its NAME with owner left blank. An
  // earlier version of this test expected 1 and was simply wrong about the data.
  const hits = search(POOL, "Morphosis SCA");
  assert.equal(hits.length, 2);
});

test("the type word is what narrows two sibling jobs to one", () => {
  const hits = search(POOL, "Morphosis SCA feasibility");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, "St. Therese of Lisieux Feasibility Study");
});

test("EVERY term must match: an unrelated term returns nothing", () => {
  // Partial matching would return all Morphosis jobs here, which is worse than
  // nothing when the caller is about to act on the answer.
  assert.equal(search(POOL, "Morphosis DASNY").length, 0);
});

test("existing behaviour still works: name and number", () => {
  assert.equal(search(POOL, "280 Broadway")[0].name, "280 Broadway");
  assert.equal(search(POOL, "SAPX196006.00")[0].projectNumber, "SAPX196006.00");
  assert.equal(search(POOL, "Tabler")[0].name, "SUNY Stony Brook Tabler Quad Red Hall");
});

test("status search still works", () => {
  const hits = search(POOL, "Proposal Due");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].status, "Proposal Due");
});

test("stopwords alone are not a query", () => {
  // "the project for our job" is all stopwords: must list everything rather
  // than match nothing, since no real constraint was expressed.
  assert.equal(search(POOL, "the project for our job").length, POOL.length);
});

test("single characters are dropped", () => {
  // "a" and "of" would otherwise be terms nothing satisfies.
  assert.deepEqual(termsOf("St. Therese of Lisieux"), ["st.", "therese", "lisieux"]);
});

test("city is searchable", () => {
  assert.equal(search(POOL, "Slade New York")[0].name, "280 Broadway");
});

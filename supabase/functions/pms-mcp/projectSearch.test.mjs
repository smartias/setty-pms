// Project search: describing a job rather than naming it.
//
// Runs the shipped rules (projectSearch.ts). The fixtures are REAL rows: the
// St. Therese job is the one that prompted this (Sara: "people might refer to a
// project citing the agency, name and prime, ie Feasibility Study with SCA for
// Morphosis"), and searching that exact phrase returned zero before this change.
import { strict as assert } from "node:assert";
import test from "node:test";

import {
  searchTerms as termsOf, projectHaystack, projectSearchExtras, matchProject, searchProjectPool,
  matchDriveCandidates, wordStartMatch, CLOSE_MATCH_MAX,
} from "./projectSearch.ts";

// What search_projects returns as `projects`: the projects carrying every term.
const search = (pool, raw) => searchProjectPool(pool, termsOf(raw)).full.map((r) => r.project);

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

// ── Secondary fields, close matches, drive folders (2026-11-24) ──────────────
// 147 of 366 searches came back empty in the 30 days before this. Replayed
// against the portfolio: 20 named a project by something outside the primary
// fields, 21 named a drive folder with no PMS record, 64 had at least half
// their terms on a real project.
const withExtras = (p, r) => ({ ...p, searchExtras: projectSearchExtras(r) });
const HOSPITAL = withExtras(
  { name: "Tower Fit-Out", projectNumber: "SAPX246011.00", status: "In Progress", owner: "DASNY", prime: "Perkins Eastman" },
  { projectAddress: "2 Battery Park Plaza", projectManager: "Dana Whitfield", drivePath: "\\\\nyc\\Projects\\2024\\SAPX246011 TOWER FITOUT",
    directory: [{ company: "Gilbane Building Company", name: "Pat Moreno", email: "pm@gilbane.example" }],
    teamMembers: [{ name: "Lee Okafor", role: "Engineer" }] },
);
const POOL2 = [...POOL, HOSPITAL];

test("a firm in the project directory finds the project, and the answer says where", () => {
  const r = searchProjectPool(POOL2, termsOf("Gilbane"));
  assert.equal(r.full.length, 1);
  assert.equal(r.full[0].project.name, "Tower Fit-Out");
  assert.deepEqual(r.full[0].match.matchedOn, { gilbane: "project directory" });
});

test("site address, project manager and team are searchable", () => {
  assert.equal(search(POOL2, "Battery Park")[0].name, "Tower Fit-Out");
  assert.equal(search(POOL2, "Whitfield DASNY")[0].name, "Tower Fit-Out");
  assert.equal(search(POOL2, "Okafor")[0].name, "Tower Fit-Out");
  assert.equal(matchProject(HOSPITAL, ["okafor"]).matchedOn.okafor, "team");
});

test("secondary fields match at the start of a word only", () => {
  assert.equal(search(POOL2, "bane").length, 0, "'bane' is inside Gilbane, not a word start");
  assert.ok(wordStartMatch("gilbane building co", "gil"));
  assert.ok(!wordStartMatch("textile works", "tx"));
  assert.ok(wordStartMatch("a.b (c++)", "(c++"), "regex characters in a term are literal");
});

test("an email address in the directory is not searched", () => {
  assert.equal(search(POOL2, "example").length, 0);
});

test("a primary match outranks a directory match", () => {
  const perkinsJob = withExtras({ name: "Annex", projectNumber: "SAPX250001.00" }, { directory: [{ company: "Perkins Eastman" }] });
  const hits = search([perkinsJob, TABLER], "Perkins");
  assert.deepEqual(hits.map((h) => h.name), ["SUNY Stony Brook Tabler Quad Red Hall", "Annex"]);
});

test("projects carrying every term never come with close matches", () => {
  const r = searchProjectPool(POOL2, termsOf("Morphosis SCA"));
  assert.equal(r.full.length, 2);
  assert.equal(r.close.length, 0);
});

test("one wrong word returns the nearest projects apart from the answer", () => {
  const r = searchProjectPool(POOL2, termsOf("Morphosis DASNY"));
  assert.equal(r.full.length, 0, "still no project carries both");
  assert.deepEqual(r.close.map((c) => c.project.name).sort(), ["SCA Q526", "St. Therese of Lisieux Feasibility Study", "Tower Fit-Out"]);
  const st = r.close.find((c) => c.project.name.startsWith("St."));
  assert.deepEqual(st.match.matched, ["morphosis"]);
  assert.deepEqual(st.match.missing, ["dasny"]);
});

test("a close match needs half the terms, one of them in the primary fields", () => {
  assert.equal(searchProjectPool(POOL2, termsOf("Tabler chiller plant replacement")).close.length, 0, "1 of 4 terms is not close");
  assert.equal(searchProjectPool(POOL2, termsOf("Tabler chiller")).close[0].project.name, "SUNY Stony Brook Tabler Quad Red Hall");
  assert.equal(searchProjectPool(POOL2, termsOf("Gilbane warehouse")).close.length, 0, "a shared directory entry alone is not close");
  assert.equal(searchProjectPool(POOL2, termsOf("Zebra")).close.length, 0, "a single term has no close matches");
});

test("close matches are capped and the total is reported", () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ name: "Library " + i, projectNumber: "", status: "In Progress" }));
  const r = searchProjectPool(many, termsOf("Library Queens"));
  assert.equal(r.close.length, CLOSE_MATCH_MAX);
  assert.equal(r.closeTotal, 9);
});

test("no terms lists the pool unchanged", () => {
  assert.equal(searchProjectPool(POOL2, []).full.length, POOL2.length);
});

const FOLDERS = [
  { project_number: "SIPX268040.00", name_from_folder: "HOUSTON TRANSIT HUB", folder_name: "SIPX268040", team: "DC", year: "2026" },
  { project_number: "SIPX202054.00", name_from_folder: null, folder_name: "SIPX202054 EDGEWOOD LABS", team: "DC", year: "2020" },
];

test("a drive folder with no PMS record is found by name or by number", () => {
  assert.deepEqual(matchDriveCandidates(FOLDERS, ["houston"], null),
    [{ projectNumber: "SIPX268040.00", folderName: "HOUSTON TRANSIT HUB", team: "DC", year: "2026" }]);
  assert.equal(matchDriveCandidates(FOLDERS, ["sipx202054"], "sipx202054")[0].folderName, "SIPX202054 EDGEWOOD LABS");
  assert.equal(matchDriveCandidates(FOLDERS, ["edgewood", "labs"], null).length, 1);
  assert.equal(matchDriveCandidates(FOLDERS, ["edgewood", "hospital"], null).length, 0, "every term must be on the folder");
  assert.equal(matchDriveCandidates(FOLDERS, [], null).length, 0);
  assert.equal(matchDriveCandidates(null, ["houston"], null).length, 0);
});

test("the shipped handler uses these rules and keeps close matches out of `projects`", async () => {
  const { readFileSync } = await import("node:fs");
  const shipped = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.ok(shipped.includes("const found = searchProjectPool(pool, terms);"));
  assert.ok(shipped.includes("count: 0, includeArchived: !!includeArchived, projects: [],\n        interpreted: { terms },\n        ...extras,"), "close matches ride beside an empty list");
  assert.ok(shipped.includes('return Object.defineProperty(p, "searchExtras", { value: projectSearchExtras(row), enumerable: false });'), "search text never leaves with a record");
  assert.ok(!/function scoreProjectMatch|const AGENCY_ALIASES/.test(shipped), "index.ts has no second copy of the rules");
});

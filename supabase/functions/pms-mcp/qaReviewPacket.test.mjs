// get_qa_review_packet: the pure assembly, run against stand-in data.
//
//   node --test supabase/functions/pms-mcp/qaReviewPacket.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildQaReviewPacket, phaseOfSet, backgroundDiscipline, possibleBackground, HANDOFF_PATTERN, DEFERRAL_PATTERN, QA_PACKET_LIMITS } from "./qaReviewPacket.ts";

const SET = {
  sourceSets: [{ name: "2026-08-22_100% CD" }, { name: "2026-10-01_Bid Set" }],
  disciplines: [
    { discipline: "M", name: "Mechanical", sheets: [{ sheetNo: "M-101", title: "First Floor Plan", revision: "2", issuedIn: "2026-10-01_Bid Set" }, { sheetNo: "M-601", title: "Schedules", revision: "1", issuedIn: "2026-08-22_100% CD" }] },
    { discipline: "E", name: "Electrical", sheets: [{ sheetNo: "E-201", title: "Power Plan", revision: "1", issuedIn: "2026-10-01_Bid Set" }] },
  ],
};
const deps = (over = {}) => ({
  currentSet: async () => SET,
  indexFiles: async () => [
    { file_name: "M.pdf", folder_path: "Outgoing/2026-10-01_Bid Set", status: "done", pages: 20, text_pages: 20 },
    { file_name: "E-scan.pdf", folder_path: "Outgoing/2026-10-01_Bid Set", status: "done", pages: 12, text_pages: 0 },
    { file_name: "P.pdf", folder_path: "Outgoing/2026-10-01_Bid Set", status: "pending", pages: null, text_pages: null },
  ],
  search: async (pattern) => pattern === HANDOFF_PATTERN
    ? [{ sheet_no: "M-101", sheet_title: "First Floor Plan", file_name: "M.pdf", page: 3, item_id: "d|1", matches: 1, snippet: "ACCESS PANELS   BY ARCHITECT" },
       { sheet_no: "M-501", sheet_title: "Details", file_name: "M.pdf", page: 9, item_id: "d|1", matches: 4, snippet: "RATED ENCLOSURE BY OTHERS" }]
    : [{ sheet_no: "E-001", sheet_title: "Notes", file_name: "E.pdf", page: 1, item_id: "d|2", matches: 2, snippet: "MC CABLE AS ALLOWED BY OWNER" }],
  schedules: async () => [{ sheet_no: "M-601", page: 12 }, { sheet_no: "M-601", page: 13 }, { sheet_no: "E-601", page: 4 }],
  backgroundFiles: async () => [
    { item_id: "a1", name: "A-101 Floor Plan.pdf", folder_path: "Incoming/2026-09-15 Arch", discipline: "A", modified_at: "2026-09-15T10:00:00Z" },
    { item_id: "a2", name: "RCP Level 2.pdf", folder_path: "Emails", discipline: null, modified_at: "2026-07-01T10:00:00Z", set_date: "2026-06-30" },
    { item_id: "m9", name: "M-101 markup.pdf", folder_path: "Incoming", discipline: "M", modified_at: "2026-09-20T10:00:00Z" },
    { item_id: "x1", name: "Meeting minutes 12.pdf", folder_path: "Emails", discipline: null, modified_at: "2026-09-21T10:00:00Z" },
  ],
  openFindings: async () => [
    { id: 7, source: "qa", severity: "rfi-bait", title: "No access panel at VAV-3", sheets: ["M-101"], discipline: "Mechanical", key_item: true, created_at: "2026-09-08T12:00:00Z" },
    { id: 8, source: "agency", severity: "agency", title: "Provide fault current", sheets: ["E-001"], created_at: "2026-09-10T12:00:00Z" },
  ],
  reviews: async () => [{ id: 3, set_name: "2026-08-22_100% CD", phase: "CD", kind: "review", run_at: "2026-09-08T12:00:00Z" }],
  rfiHistory: async () => ({ basis: { kindOfWork: "renovation" }, items: [{ qaItem: "qa-630", preventableRfis: 12 }] }),
  knowledge: async () => ({ lessonsOnThisProject: 4 }),
  ...over,
});
const ARGS = { projectNumber: "SAPX000000.00", projectName: "Test Hall", owner: "SUNY", prime: "Some Architects", status: "Design" };

test("the phase comes from the set name, and a construction document is called one", () => {
  assert.equal(phaseOfSet("2026-08-22_100% CD"), "CD");
  assert.equal(phaseOfSet("DD Progress Set"), "DD");
  assert.equal(phaseOfSet("2026-10-01_Bid Set"), "Bid");
  assert.equal(phaseOfSet("2026-03-26_Addendum 2 Revisions"), "Addendum");
  assert.equal(phaseOfSet("Permit Set"), "Permit");
  assert.equal(phaseOfSet("2026-06-12_Bulletin 3"), "Construction");
  assert.equal(phaseOfSet("Misc"), null);
});

test("a background is another discipline's drawing; ours and unclassified files are left out", () => {
  assert.equal(backgroundDiscipline({ discipline: "A" }), "A");
  assert.equal(backgroundDiscipline({ discipline: "M" }), null);
  assert.equal(backgroundDiscipline({ discipline: null, name: "RCP Level 2.pdf" }), "A");
  assert.equal(backgroundDiscipline({ discipline: null, name: "S-201 Framing.pdf" }), "S");
  assert.equal(backgroundDiscipline({ discipline: null, name: "Structural calcs.pdf" }), "S");
  assert.equal(backgroundDiscipline({ discipline: null, name: "Meeting minutes 12.pdf" }), null);
  assert.equal(backgroundDiscipline({ discipline: null, name: "Spec section 230900.pdf" }), null, "S-digits only as a sheet number");
});

test("the patterns match the notes they are for, and not ordinary drawing text", () => {
  const h = new RegExp(HANDOFF_PATTERN, "i"), d = new RegExp(DEFERRAL_PATTERN, "i");
  for (const s of ["ACCESS PANEL BY ARCHITECT", "LOUVER BY OTHERS", "CONCRETE PAD BY G.C.", "SEE STRUCTURAL DRAWINGS", "REFER TO ARCH PLANS", "N.I.C.", "COORDINATE WITH ARCHITECT", "FLOOR BOXES FURNISHED BY OWNER"]) assert.ok(h.test(s), s);
  for (const s of ["PROVIDE 3/4 IN. CONDUIT", "SEE DETAIL 4/M-701", "STANDBY GENERATOR"]) assert.ok(!h.test(s), s);
  for (const s of ["MC CABLE AS ALLOWED BY OWNER", "BMS INTERFACE IF APPLICABLE", "EXACT LOCATION TO BE COORDINATED IN FIELD", "WHERE PERMITTED BY CODE"]) assert.ok(d.test(s), s);
  assert.ok(!d.test("PROVIDE DISCONNECT AT EACH UNIT"));
});

test("the packet gathers the set, coverage, notes, backgrounds and carry-over", async () => {
  const p = await buildQaReviewPacket(deps(), ARGS);
  assert.equal(p.project.settyRole, "MEPFP consultant to Some Architects");
  assert.equal(p.set.phase, "Bid");
  assert.equal(p.set.phaseFrom, "2026-10-01_Bid Set");
  assert.equal(p.set.sheetCount, 3);
  assert.deepEqual(p.set.disciplines.map((d) => [d.discipline, d.sheets]), [["M", 2], ["E", 1]]);
  assert.equal(p.set.disciplines[0].list[0].sheet, "M-101");
  assert.deepEqual([p.index.files, p.index.indexed, p.index.notIndexedYet, p.index.pages], [3, 2, 1, 32]);
  assert.deepEqual(p.index.textlessFiles, ["E-scan.pdf"]);
  assert.ok(p.index.nextStep.includes("indexOnly"));
  assert.equal(p.handOffNotes.hits[0].sheet, "M-501", "the sheet with the most hand-offs first");
  assert.equal(p.handOffNotes.sheets, 2);
  assert.equal(p.deferredDecisions.hits[0].snippet, "MC CABLE AS ALLOWED BY OWNER");
  assert.deepEqual(p.schedules.sheets, ["M-601", "E-601"]);
  assert.equal(p.backgrounds.found.length, 1);
  assert.deepEqual([p.backgrounds.found[0].discipline, p.backgrounds.found[0].files, p.backgrounds.found[0].newest], ["A", 2, "2026-09-15"]);
  assert.deepEqual(p.backgrounds.notFound, ["Structural"], "absence is reported, not skipped");
  assert.deepEqual([p.carryOver.open, p.carryOver.keyItems, p.carryOver.bySource], [2, 1, { qa: 1, agency: 1 }]);
  assert.equal(p.carryOver.earlierReviews[0].on, "2026-09-08");
  assert.equal(p.rfiHistory.items[0].qaItem, "qa-630");
  assert.deepEqual(p.coverage.gaps, []);
});

test("a read that fails is a gap, and the rest of the packet still comes back", async () => {
  const p = await buildQaReviewPacket(deps({
    search: async () => { throw new Error("canceling statement due to statement timeout"); },
    backgroundFiles: async () => { throw new Error("404"); },
  }), ARGS);
  assert.equal(p.coverage.gaps.length, 3);
  assert.ok(p.coverage.gaps.some((g) => g.startsWith("hand-off notes: canceling statement")));
  assert.equal(p.set.sheetCount, 3);
  assert.equal(p.handOffNotes.sheets, 0);
  assert.deepEqual(p.backgrounds.notFound, ["Architectural", "Structural"]);
});

test("no logged set, a named set, and a very large set are each said plainly", async () => {
  const empty = await buildQaReviewPacket(deps({ currentSet: async () => ({ disciplines: [], sourceSets: [] }), indexFiles: async () => [] }), ARGS);
  assert.equal(empty.set.sheetCount, 0);
  assert.ok(empty.set.note.includes("not the end of the review"));
  assert.ok(empty.index.nextStep);
  const named = await buildQaReviewPacket(deps({ indexFiles: async () => [
    { file_name: "QA.pdf", folder_path: "09 QAQC/2026-11-20 CD Set", status: "done", pages: 5, text_pages: 5 },
    { file_name: "old.pdf", folder_path: "Outgoing/2026-08-22_100% CD", status: "done", pages: 9, text_pages: 9 },
  ] }), { ...ARGS, set: "09 QAQC/2026-11-20 CD Set" });
  assert.equal(named.set.named, "09 QAQC/2026-11-20 CD Set");
  assert.equal(named.set.phase, "CD");
  assert.equal(named.index.files, 1, "coverage is for the named set only");
  const big = { sourceSets: [], disciplines: [{ discipline: "M", name: "Mechanical", sheets: Array.from({ length: QA_PACKET_LIMITS.sheetsListed + 1 }, (_, i) => ({ sheetNo: "M-" + i })) }] };
  const large = await buildQaReviewPacket(deps({ currentSet: async () => big }), ARGS);
  assert.equal("list" in large.set.disciplines[0], false);
  assert.ok(large.set.sheetsNotListed);
});

test("the tool is registered, read-only, and the review skill starts with it", () => {
  const here = new URL(".", import.meta.url);
  const src = readFileSync(new URL("./index.ts", here), "utf8");
  assert.match(src, /mcp\.tool\("get_qa_review_packet"/);
  const tool = src.slice(src.indexOf('mcp.tool("get_qa_review_packet"'), src.indexOf('mcp.tool("get_qa_checklist"'));
  assert.ok(!/sbInsert|sbPatch|sbUpsert|sbDelete|updateProjectRecord|graphFetch/.test(tool), "it writes nothing and makes no SharePoint call");
  assert.ok(src.includes('"get_qa_review_packet"]);'), "classified as a one-record tool, so a full packet is not logged as empty");
  assert.match(readFileSync(new URL("../../../SettyAdmin.html", here), "utf8"), /get_qa_review_packet/);
  assert.match(readFileSync(new URL("./README.md", here), "utf8"), /get_qa_review_packet/);
  const skill = readFileSync(new URL("../../../.claude/skills/qa-coordination-review/SKILL.md", here), "utf8");
  assert.ok(skill.includes("**Start with `get_qa_review_packet`.**"));
});

test("a sheet indexed at several revisions is listed once, at its latest", async () => {
  const p = await buildQaReviewPacket(deps({ search: async () => [
    { sheet_no: "M-101", item_id: "d|1", page: 3, revision_date: "2026-08-22", matches: 1, snippet: "OLD: BY OTHERS" },
    { sheet_no: "m-101", item_id: "d|9", page: 3, revision_date: "2026-10-01", matches: 2, snippet: "NEW: BY ARCHITECT" },
    { sheet_no: null, item_id: "d|4", page: 1, matches: 1, snippet: "COVER: BY OWNER" },
  ] }), ARGS);
  assert.equal(p.handOffNotes.sheets, 2);
  assert.equal(p.handOffNotes.hits[0].snippet, "NEW: BY ARCHITECT");
  assert.equal("capped" in p.handOffNotes, false);
});

// SAPX256011.00, 2026-11-25: 84 PDFs received, none classified by name, though
// the architect's sets were among them, named by building.
const RECEIVED = [
  { item_id: "b1", name: "202237-01_Rosenthal Library.pdf", folder_path: "Emails/2026_07_13 Standing Meeting", discipline: null, modified_at: "2026-11-17T10:00:00Z", size_bytes: 48_000_000 },
  { item_id: "b1x", name: "202237-01_Rosenthal Library.pdf", folder_path: "Emails/2026_07_20 FW", discipline: null, modified_at: "2026-11-18T10:00:00Z", size_bytes: 48_000_000 },
  { item_id: "b2", name: "QC Kiely Hall-As Built - Rev5.pdf", folder_path: "Emails/2026_05_20 RE", discipline: null, modified_at: "2026-07-16T10:00:00Z", size_bytes: 90_000_000 },
  { item_id: "n1", name: "(2021-03-05) QC I Building-OM Manual R1.pdf", folder_path: "Emails/2026_05_20 RE", discipline: null, modified_at: "2026-07-16T10:00:00Z", size_bytes: 120_000_000 },
  { item_id: "n2", name: "5-4-26_PRECON_Queens College_Student Union_Final V1.pdf", folder_path: "Emails/2026_05_11 FW TAB Report", discipline: null, modified_at: "2026-05-11T10:00:00Z", size_bytes: 60_000_000 },
  { item_id: "n3", name: "PRE Plumbing.pdf", folder_path: "Emails/2026_05_20 RE", discipline: "P", modified_at: "2026-07-16T10:00:00Z", size_bytes: 30_000_000 },
  { item_id: "n4", name: "image scan.pdf", folder_path: "Emails/x", discipline: null, modified_at: "2026-07-16T10:00:00Z", size_bytes: 200_000 },
  { item_id: "n5", name: "261103_Mtg_36 Minutes.pdf", folder_path: "Emails/y", discipline: null, modified_at: "2026-11-03T10:00:00Z", size_bytes: 5_000_000 },
];

test("a large received PDF with no telling name is a possible background; ours and plain documents are not", () => {
  assert.deepEqual(RECEIVED.filter(possibleBackground).map((f) => f.item_id), ["b1", "b1x", "b2"]);
  assert.equal(possibleBackground({ name: "A-101 Plan.pdf", size_bytes: 9e7 }), false, "already classified as architectural by name");
  assert.equal(possibleBackground({ name: "Set.pdf", size_bytes: null }), false, "no size, no claim");
});

test("a re-sent set with the same name shows the newest copy, even when it is smaller", async () => {
  const rows = [
    { item_id: "old", name: "Library Set.PDF", folder_path: "Emails/2026_06_01 Set", discipline: null, set_date: "2026-06-01", modified_at: "2026-06-01T10:00:00Z", size_bytes: 80_000_000 },
    { item_id: "new", name: "library set.pdf", folder_path: "Emails/2026_10_01 Rev", discipline: null, set_date: "2026-10-01", modified_at: "2026-10-01T10:00:00Z", size_bytes: 60_000_000 },
    { item_id: "dupe", name: "Library Set.pdf", folder_path: "Emails/2026_10_02 FW", discipline: null, set_date: "2026-10-01", modified_at: "2026-10-02T10:00:00Z", size_bytes: 59_000_000 },
    { item_id: "other", name: "Hall.pdf", folder_path: "Emails/2026_09_01", discipline: null, modified_at: "2026-09-01T10:00:00Z", size_bytes: 70_000_000 },
  ];
  const p = await buildQaReviewPacket(deps({ backgroundFiles: async () => rows }), ARGS);
  // "new" and "dupe" share the newest date (set_date wins over modified_at); the larger one stays.
  assert.deepEqual(p.backgrounds.possible.map((f) => [f.itemId, f.date]), [["other", "2026-09-01"], ["new", "2026-10-01"]]);
});

test("backgrounds named by building are offered as possible, and 'not found' says by name only", async () => {
  const p = await buildQaReviewPacket(deps({ backgroundFiles: async () => RECEIVED }), ARGS);
  assert.deepEqual(p.backgrounds.found, []);
  assert.deepEqual(p.backgrounds.possible.map((f) => [f.itemId, f.megabytes]), [["b2", 90], ["b1x", 48]], "largest first, one line per file name, the newest copy");
  assert.equal(p.backgrounds.possible[1].date, "2026-11-18");
  assert.deepEqual(p.backgrounds.notFound, ["Architectural", "Structural"]);
  assert.ok(p.backgrounds.notFoundNote.startsWith("Not found BY NAME. That is not the same as missing"));
  assert.ok(p.backgrounds.possibleNote.includes("open the first page of each"));
  // With nothing large received, the old wording stands.
  const none = await buildQaReviewPacket(deps({ backgroundFiles: async () => RECEIVED.slice(3) }), ARGS);
  assert.equal("possible" in none.backgrounds, false);
  assert.ok(none.backgrounds.notFoundNote.startsWith("Nothing on file by name or folder, and no large unclassified PDF"));
});

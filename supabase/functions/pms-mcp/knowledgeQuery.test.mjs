// Tests for knowledgeQuery.ts: word-by-word matching for the knowledge tools.
// The queries are ones that came back empty in production (2026-11) while the
// tables held rows carrying every word.
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { queryTerms, termInText, matchQuery, rankByQuery, closeByQuery, CLOSE_QUERY_MAX } from "./knowledgeQuery.ts";

const ROWS = [
  { id: 1, text: "Electric resistance heat is not permitted with A2L refrigerants unless the unit is listed for it.", system: "DOAS" },
  { id: 2, text: "Size the disconnect from the MOCP on the nameplate; the feeder from the MCA.", system: "Power" },
  { id: 3, text: "Duct insulation: R-6 minimum on supply ductwork in unconditioned space.", system: "Ductwork" },
  { id: 4, text: "Insulate outdoor ducts; verify product data shows the vapor barrier.", system: "Ductwork" },
  { id: 5, text: "Provide a reduced pressure zone backflow preventer; a double check assembly is not accepted.", system: "Domestic water" },
];
const fields = (r) => [r.text, r.system];
const ids = (rows) => rows.map((r) => r.id);

test("the words may be anywhere in the row, in any order", () => {
  assert.deepEqual(ids(rankByQuery(ROWS, fields, "A2L electric resistance heat")), [1]);
  assert.deepEqual(ids(rankByQuery(ROWS, fields, "MCA MOCP")), [2]);
  assert.deepEqual(ids(rankByQuery(ROWS, fields, "backflow double check")), [5]);
});

test("the old rule found none of these: the query is not one phrase in any field", () => {
  for (const q of ["a2l electric resistance heat", "mca mocp", "backflow double check"]) {
    assert.ok(!ROWS.some((r) => fields(r).some((v) => String(v).toLowerCase().includes(q))), q);
  }
});

test("a row carrying the query as a phrase comes first", () => {
  assert.deepEqual(ids(rankByQuery(ROWS, fields, "duct insulation")), [3]);
  assert.deepEqual(ids(rankByQuery([ROWS[3], ROWS[2]], fields, "ducts")), [4, 3], "same rank keeps the order given");
  const both = [{ id: "b", text: "insulation for the duct" }, { id: "a", text: "duct insulation thickness" }];
  assert.deepEqual(rankByQuery(both, (r) => [r.text], "duct insulation").map((r) => r.id), ["a", "b"]);
});

test("a word matches at the start of a word, and a plural finds the singular", () => {
  assert.ok(termInText("supply ductwork", "duct"));
  assert.ok(!termInText("product data", "duct"), "not inside another word");
  assert.ok(termInText("one disconnect", "disconnects"));
  assert.ok(termInText("section 23 21 13 piping", "21"));
  assert.deepEqual(ids(rankByQuery(ROWS, fields, "duct")), [3, 4]);
});

test("every word must match for a result", () => {
  assert.equal(rankByQuery(ROWS, fields, "duct insulation humidification").length, 0);
  assert.equal(rankByQuery(ROWS, fields, "luminaire").length, 0);
});

test("small words carry no weight; a query of only small words still means something", () => {
  assert.deepEqual(queryTerms("What is our standard for the duct insulation?"), ["standard", "duct", "insulation"]);
  assert.deepEqual(queryTerms("of the"), ["of", "the"]);
  assert.deepEqual(queryTerms("VA/SF 3 phase"), ["va", "sf", "3", "phase"]);
  assert.deepEqual(queryTerms(null), []);
});

test("no query returns the rows unchanged", () => {
  assert.equal(rankByQuery(ROWS, fields, undefined), ROWS);
  assert.equal(rankByQuery(ROWS, fields, "   "), ROWS);
});

test("close matches: at least half the words, most words first, with what is missing", () => {
  const close = closeByQuery(ROWS, fields, "duct insulation humidification");
  assert.deepEqual(close.map((c) => c.row.id), [3], "row 4 says 'insulate' and 'ducts': one word of three is not close");
  assert.deepEqual(close[0].matchedTerms, ["duct", "insulation"]);
  assert.deepEqual(close[0].missingTerms, ["humidification"]);
  assert.equal(closeByQuery(ROWS, fields, "luminaire").length, 0, "a single word has no close matches");
  assert.equal(closeByQuery(ROWS, fields, "wireless smoke detector").length, 0, "no shared word, nothing close");
  assert.ok(!closeByQuery(ROWS, fields, "duct insulation").some((c) => c.row.id === 3), "a full match is a result, not a close match");
  const many = Array.from({ length: 20 }, (_, i) => ({ id: i, text: "duct note " + i }));
  assert.equal(closeByQuery(many, (r) => [r.text], "duct humidifier").length, CLOSE_QUERY_MAX);
});

test("matchQuery reports the phrase and the words", () => {
  assert.deepEqual(matchQuery(["Duct insulation", null, "Ductwork"], "duct insulation"), { phrase: true, matched: ["duct", "insulation"], missing: [] });
  assert.equal(matchQuery(["a", "b"], "").phrase, false);
});

test("the four knowledge filters use this rule, and close matches stay out of the results", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  for (const line of [
    "out = rankByQuery(out, agencyPrefFields, query);",
    "return rankByQuery(out, standardFields, f.query);",
    "return rankByQuery(out, lessonFields, f.query);",
    "return rankByQuery(out, practiceFields, f.query);",
  ]) assert.ok(src.includes(line), "index.ts lost: " + line);
  // search_field_photos is the one other place that phrase rule lives; it is not a knowledge tool.
  const knowledge = src.slice(src.indexOf('mcp.tool("search_agency_preferences"'), src.indexOf('mcp.tool("save_knowledge"'));
  assert.ok(!/has\(\w+, q\)/.test(knowledge), "no knowledge filter still matches the whole query as one phrase");
  assert.ok(src.includes("const close = out.length ? [] : closeByQuery(beforeQuery, agencyPrefFields, query);"), "agency preferences: close matches only when nothing matched");
  assert.ok(src.includes("const closeLessons = out.length || practices.length ? []"), "knowledge: close matches only when nothing matched");
  assert.equal(src.split("closeMatchesNote: CLOSE_QUERY_NOTE,").length - 1, 3, "each tool says what close matches are");
});

// Tests for deferredDecisions.js (check_deferred_decisions, qa-637). The
// sample sentences are from the Tabler set and the RFI log.
//
//   node --test supabase/functions/pms-mcp/deferredDecisions.test.mjs

import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PHRASES, pgPattern, categoryOf, scanText, groupHits } from "./deferredDecisions.js";

const key = (s) => { const h = scanText(s); return h.length ? categoryOf(h[0].phrase).key : null; };

test("the phrases that defer a decision are found, each under its kind", () => {
  assert.equal(key("MC CABLE MAY BE USED AS ALLOWED BY OWNER FOR BRANCH CIRCUITS."), "owner-decides");
  assert.equal(key("Install as directed by the Engineer."), "owner-decides");
  assert.equal(key("as approved by the authority having jurisdiction"), "owner-decides");
  assert.equal(key("FINISH AT OWNER'S OPTION."), "owner-decides");
  assert.equal(key("CONFIRM ALL BMS PANEL LOCATIONS WITH CLIENT PRIOR TO ROUGH-IN"), "confirm-with-owner");
  assert.equal(key("COORDINATE SLEEVE AND FIRE STOPPING REQUIREMENTS WITH THE UNIVERSITY."), "confirm-with-owner");
  assert.equal(key("FIRE ALARM EXTENDER PANEL, IF REQUIRED"), "conditional");
  assert.equal(key("CENTERED ABOVE DOOR (WHERE APPLICABLE)"), "conditional");
  assert.equal(key("POLE MANUFACTURER: TBD"), "undecided");
  assert.equal(key("BONDING CONDUCTOR TO BE DETERMINED AT JOB SITE."), "undecided");
  assert.equal(key("SMACNA DUCT CONSTRUCTION STANDARDS: LATEST EDITIONS"), "code-edition");
  assert.equal(key("COMPLY WITH THE CODE IN EFFECT."), "code-edition");
});

test("ordinary sentences are not hits", () => {
  for (const s of [
    "PROVIDE ALL REQUIRED INSTALLATION ACCESSORIES AND SUPPORTS AS REQUIRED.",
    "COORDINATE WITH MECHANICAL CONTRACTOR FOR EXACT LOCATION.",
    "BUILDING CODE OF NEW YORK STATE, 2020 EDITION.",
    "VERIFY IN FIELD PRIOR TO FABRICATION.",
    "FURNISHED BY OWNER, INSTALLED BY CONTRACTOR.",
    "SIGNIFICANT OWNERSHIP OF THE EQUIPMENT TRANSFERS AT ACCEPTANCE.",
    "THE STBD SIDE SHALL BE CLEAR.",
  ]) assert.deepEqual(scanText(s), [], s);
});

test("a hit comes back in its sentence, with the text either side", () => {
  const long = "A".repeat(300) + " MC CABLE AS ALLOWED BY THE OWNER FOR BRANCH WIRING " + "B".repeat(300);
  const [h] = scanText(long);
  assert.equal(h.phrase, "AS ALLOWED BY THE OWNER");
  assert.ok(h.text.startsWith("…") && h.text.endsWith("…") && h.text.includes("MC CABLE AS ALLOWED BY THE OWNER FOR BRANCH WIRING"));
  assert.ok(h.text.length < 270);
  assert.equal(scanText("IF APPLICABLE and, later, TBD.").length, 2);
});

test("the same note on many sheets is one place; kinds are grouped and counted", () => {
  const note = "…ALL DEVICES SHALL BE MOUNTED AS DIRECTED BY THE ARCHITECT UNLESS NOTED…";
  const g = groupHits([
    { where: "E-201", phrase: "AS DIRECTED BY THE ARCHITECT", text: note },
    { where: "E-202", phrase: "as directed by the architect", text: note.toLowerCase() },
    { where: "E-202", phrase: "AS DIRECTED BY THE ARCHITECT", text: note },
    { where: "E-601", phrase: "TBD", text: "MANUFACTURER: TBD" },
    { where: "Spec 260519 p.4", phrase: "as allowed by owner", text: "MC cable as allowed by owner." },
    { where: "X", phrase: "not a phrase", text: "nothing" },
  ]);
  assert.deepEqual([g.hits, g.places], [5, 3]);
  assert.deepEqual(g.categories.map((c) => [c.category, c.count]), [["owner-decides", 2], ["undecided", 1]]);
  assert.deepEqual(g.categories[0].places[0].where, ["E-201", "E-202"], "most sheets first, each sheet once");
  assert.equal(g.categories[0].label, "Left to the owner or the authority");
  assert.deepEqual(groupHits([]).categories, []);
});

test("the pattern Postgres gets is the same alternation, with its word boundary", () => {
  const pg = pgPattern();
  assert.ok(!pg.includes("\\b") && pg.includes("\\y"));
  assert.ok(!/\((?!\?:)/.test(pg), "non-capturing groups only, so both engines number nothing");
  for (const p of PHRASES) assert.ok(!/\\[dDSWB]|\(\?[=!<]|\*\?|\+\?/.test(p.re), "only constructs both engines read the same way: " + p.key);
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.ok(src.includes('mcp.tool("check_deferred_decisions"') && src.includes('sbRpc("pms_sheet_phrase_hits"') && src.includes("deferredPgPattern()"));
  const sql = readFileSync(new URL("../../migrations/20261124280000_qa_deferred_decisions.sql", import.meta.url), "utf8");
  assert.ok(sql.includes("regexp_count(l.text, p_pattern, 1, 'i')") && sql.includes("regexp_instr(l.text, p_pattern, 1, n, 0, 'i')"), "each occurrence by position, so neighbours are not swallowed");
  assert.ok(sql.includes("to service_role") && sql.includes("from anon"));
  assert.ok(sql.includes("where item_id = 'qa-637'") && sql.includes("automation = 'auto'"));
});

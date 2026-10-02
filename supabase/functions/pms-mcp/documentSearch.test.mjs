// Tests for documentSearch.ts: how find_document narrows candidates in SQL and
// shapes rows back into files for the existing scorer. The ranking itself is
// covered by findDocument.test.mjs and is unchanged.
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  safeTokens, buildDocumentsQuery, tableIsFresh, rowToFile, fullFolderPath,
  DOCS_TABLE_MAX_AGE_MS, DOCS_TABLE_MAX_ROWS,
} from "./documentSearch.ts";
import { norm, normaliseDocType, normaliseDiscipline, DOC_TYPES } from "./documentMeta.ts";

const NOW = Date.parse("2026-10-02T12:00:00Z");

test("the table is trusted only after a recent completed sync", () => {
  assert.equal(tableIsFresh(null, NOW), false);
  assert.equal(tableIsFresh({ last_completed_at: null }, NOW), false);
  assert.equal(tableIsFresh({ last_completed_at: "garbage" }, NOW), false);
  assert.equal(tableIsFresh({ last_completed_at: "2026-10-01T03:00:00Z" }, NOW), true);
  assert.equal(tableIsFresh({ last_completed_at: new Date(NOW - DOCS_TABLE_MAX_AGE_MS - 1000).toISOString() }, NOW), false);
});

test("hard filters become eq filters on the view; no filters means none", () => {
  const withBoth = buildDocumentsQuery({ projectPrefix: "SAPX196006.00", tokens: [], docType: "Comment Log", discipline: "FP" });
  assert.match(withBoth, /^pms_documents_v\?select=/);
  assert.ok(withBoth.includes("project_prefix=eq.sapx196006.00"));
  assert.ok(withBoth.includes("doc_type=eq.Comment%20Log"));
  assert.ok(withBoth.includes("discipline=eq.FP"));
  assert.ok(!withBoth.includes("or=("), "no tokens, no prefilter");
  const bare = buildDocumentsQuery({ projectPrefix: "p1", tokens: ["narrative"] });
  assert.ok(!bare.includes("doc_type=eq") && !bare.includes("discipline=eq"));
  assert.ok(bare.includes("order=item_id"), "paging must be deterministic");
});

test("tokens are made safe for PostgREST and cannot act as wildcards", () => {
  assert.deepEqual(safeTokens(["100%", "a_b", "(x),y", "", "CD"]), ["100", "ab", "xy", "cd"]);
  const q = buildDocumentsQuery({ projectPrefix: "p1", tokens: ["100%", "bod,x", "(a)"] });
  const patterns = [...q.matchAll(/\.ilike\.\*([^*]*)\*/g)].map((m) => m[1]);
  assert.ok(patterns.length >= 9, "three tokens, three columns");
  for (const pat of patterns) assert.match(pat, /^[a-z0-9]+$/, "no ilike wildcards or filter syntax smuggled in");
  assert.ok(q.includes("name.ilike.*bodx*"));
});

test("scope only matches for library rows, so naming the project number does not pull in the project", () => {
  const q = buildDocumentsQuery({ projectPrefix: "p1", tokens: ["sapx196006"] });
  assert.ok(q.includes("and(scope.like.lib:*,scope.ilike.*sapx196006*)"));
  assert.ok(!/,scope\.ilike/.test(q.replace("and(scope.like.lib:*,scope.ilike.", "")));
});

test("the prefilter is a superset of what the scorer's includes() can match", () => {
  // The scorer tests norm(name).includes(token) / norm(path).includes(token).
  // The SQL prefilter tests lower(raw).includes(safeToken). Every scorer hit
  // must also be a prefilter hit, or a real match is dropped before ranking.
  const names = [
    "E211 - GROUND FLOOR PLAN - EAST WING - ELECTRICAL POWER.pdf", "STTQ-01-E_Bulletin #13.pdf",
    "FP Basis of Design.docx", "2026-05-19 BOYLAN HALL.pdf", "M501_MECHANICAL_DETAILS.pdf",
    "Fee proposal (CD) rev.2.pdf", "100% CD Narrative.docx",
  ];
  const queries = ["electrical power", "bulletin 13", "basis of design", "boylan", "mechanical details", "fee proposal cd", "100% cd narrative", "13", "rev 2"];
  for (const n of names) for (const query of queries) {
    for (const tok of norm(query).split(" ").filter(Boolean)) {
      const scorerHit = norm(n).includes(tok);
      const sqlHit = safeTokens([tok]).some((t) => n.toLowerCase().includes(t));
      if (scorerHit) assert.ok(sqlHit, `prefilter lost "${tok}" in "${n}"`);
    }
  }
});

test("library rows regain their top folder so the scorer sees the client name", () => {
  assert.equal(fullFolderPath({ scope: "lib:Proposals/Dutchess County", folder_path: "Round 2" }), "Dutchess County/Round 2");
  assert.equal(fullFolderPath({ scope: "lib:Proposals/Dutchess County", folder_path: "/" }), "Dutchess County");
  assert.equal(fullFolderPath({ scope: "sapx196006.00", folder_path: "Outgoing/2026-04-17_Bulletin #13" }), "Outgoing/2026-04-17_Bulletin #13");
  assert.equal(fullFolderPath({ scope: "sapx196006.00", folder_path: "" }), "/");
});

test("a row becomes the file shape the scorer and read_document already use", () => {
  const f = rowToFile({
    item_id: "d|1", scope: "sapx196006.00", library: "Project Document Library", folder_path: "Outgoing/2026-04-17_Bulletin #13",
    name: "E211.PDF", ext: "PDF", web_url: "https://x", modified_at: "2026-09-09T16:44:42Z",
  });
  assert.deepEqual(f, {
    itemId: "d|1", name: "E211.PDF", library: "Project Document Library", folderPath: "Outgoing/2026-04-17_Bulletin #13",
    webUrl: "https://x", modified: "2026-09-09T16:44:42Z", size: 0, ext: "pdf",
  });
});

test("filter words: any spelling of a known type or discipline, nothing else", () => {
  assert.equal(normaliseDocType("narratives"), "Narrative");
  assert.equal(normaliseDocType("COMMENT LOG"), "Comment Log");
  assert.equal(normaliseDocType("Drawings"), "Drawing");
  assert.equal(normaliseDocType("email attachment"), "Email Attachment");
  assert.equal(normaliseDocType("lunch menu"), null);
  for (const t of DOC_TYPES) assert.equal(normaliseDocType(t), t);
  assert.equal(normaliseDiscipline("mechanical"), "M");
  assert.equal(normaliseDiscipline("Fire Protection"), "FP");
  assert.equal(normaliseDiscipline("plumbng"), null);
});

test("the cap is explicit, not a silent sample", () => {
  assert.equal(DOCS_TABLE_MAX_ROWS % 1000, 0, "rows are pulled in whole 1000-row PostgREST pages");
});

// ── wiring: the handler really reads the table, and nothing else changed ────
const shipped = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const handler = shipped.slice(shipped.indexOf('mcp.tool("find_document"'), shipped.indexOf("// ─── SHEET INDEX"));
test("find_document reads the table first and falls back to the live walk", () => {
  assert.ok(handler.includes("documentsFromTable("), "reads the table");
  assert.ok(handler.includes(": await projectTree(String(project).toLowerCase().trim())"), "keeps the live walk as fallback");
  assert.ok(handler.includes("FIND_DOCUMENT_USE_TABLE"), "has a kill switch");
  assert.ok(handler.includes("normaliseDiscipline(discipline)") && handler.includes("normaliseDocType(docType)"), "validates the hard filters");
});
test("prepare_transmittal still walks the live tree untouched", () => {
  const pt = shipped.slice(shipped.indexOf('mcp.tool("prepare_transmittal"'), shipped.indexOf('mcp.tool("prepare_transmittal"') + 12000);
  assert.ok(!pt.includes("documentsFromTable"), "only find_document switched");
});

// Matching QA ledger rows to a sheet or an equipment tag (list_qa_findings
// sheets/mentions, read_rfi_submittal's qaLedger).
//
//   node --test supabase/functions/pms-mcp/qaLedgerMatch.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sheetKey, mentionRegex, buildLedgerMatcher, normalizeTag, scheduleRowsForTag } from "./qaLedgerMatch.ts";

test("sheet references reduce to one key whatever the review wrote", () => {
  for (const s of ["M-601 Rev 3", "M601", "m 601", "M.601 (Bulletin #2)", " M-601"]) assert.equal(sheetKey(s), "m601", s);
  assert.equal(sheetKey("E101.00 Rev 4"), "e101");
  assert.equal(sheetKey("FP-101A"), "fp101a");
  assert.equal(sheetKey("General notes"), "");
  assert.equal(sheetKey(null), "");
  assert.notEqual(sheetKey("E-61"), sheetKey("E-610"));
});

test("a tag matches with hyphen, space or nothing, and never a longer number", () => {
  const re = mentionRegex("EF-7");
  for (const t of ["EF-7 upsized", "see EF 7.", "(EF7)", "ef-7"]) assert.ok(re.test(t), t);
  for (const t of ["EF-70", "REF-7", "EF-7A"]) assert.ok(!re.test(t), t);
  assert.equal(mentionRegex(" "), null);
  assert.ok(mentionRegex("a.b").test("a.b") && !mentionRegex("a.b").test("axb"));
});

const rows = [
  { id: 1, title: "EF-7 upsized to 2 HP; circuit not revised", sheets: ["M-601 Rev 3", "E-610 Rev 2"] },
  { id: 2, title: "Provide fault current letter", sheets: [], evidence: "Comment refers to one-line on E601.", response: "Complied on E-601 Rev 4." },
  { id: 3, title: "Legend missing symbol", sheets: ["E-001"] },
  { id: 4, title: "Verify EF-70 disconnect", sheets: ["E-6100"] },
];

test("rows match on cited sheets, on sheets named in prose, and on tags", () => {
  const m = buildLedgerMatcher({ sheets: ["E610", "E-601"], mentions: ["EF 7"] });
  assert.equal(m.active, true);
  assert.deepEqual(m.match(rows[0]), { sheets: ["E610"], mentions: ["EF 7"] });
  assert.deepEqual(m.match(rows[1]), { sheets: ["E601"], mentions: [] }); // no sheets[] on a comment row: found in its text
  assert.equal(m.match(rows[2]), null);
  assert.equal(m.match(rows[3]), null); // EF-70 and E-6100 are other things
});

test("no criteria means no filtering, not match-everything", () => {
  const m = buildLedgerMatcher({ sheets: ["not a sheet"], mentions: [""] });
  assert.equal(m.active, false);
  assert.equal(m.match(rows[0]), null);
});

test("the tools use the matcher and keep the pre-issue guard", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  for (const anchor of [
    'import { buildLedgerMatcher, sheetKey, normalizeTag, scheduleRowsForTag } from "./qaLedgerMatch.ts";',
    "async function qaLedgerFor(",
    "sheets: z.array(z.string()).max(40).optional()",
    "mentions: z.array(z.string()).max(20).optional()",
    // read_rfi_submittal returns the PM-confirmed sheet links and what the ledger holds on them.
    'x.status === "confirmed"',
    "qaLedger:",
    // Pre-issuance QA copies stay out of the default index readers.
    "const PRE_ISSUE_FOLDER_RE = /(^|\\/)[^/]*qaqc[^/]*(\\/|$)/i;",
    "if (isNotIssuedPath(r.folder_path)) continue;",
    "const issued = pool.filter((r) => !isNotIssuedPath(r.folder_path));",
    '"pms_equipment_tags_scoped"',
  ]) assert.ok(src.includes(anchor), `index.ts lost anchor: ${anchor}`);
  const re = new RegExp(src.match(/const PRE_ISSUE_FOLDER_RE = \/(.+)\/i;/)[1], "i");
  for (const p of ["09 ✅ QAQC/2026-11-10_100% CD QAQC", "QAQC", "x/qaqc sets/y"]) assert.ok(re.test(p), p);
  for (const p of ["Outgoing/2026-11-12_100% CD Submission", "Outgoing/2026-11-12_QAQC comments incorporated/x".replace("QAQC comments", "QA comments"), ""]) assert.ok(!re.test(p), p);
  const sql = readFileSync(new URL("../../migrations/20261116140000_equipment_tags_scoped.sql", import.meta.url), "utf8");
  assert.ok(sql.includes("p_exclude is null or coalesce(t.folder_path, '') !~* p_exclude"));
  assert.ok(sql.includes("grant execute on function public.pms_equipment_tags_scoped(text, int, text, text) to service_role;"));
  assert.ok(src.includes('const PRE_ISSUE_FOLDER_SQL_RE = "(^|/)[^/]*qaqc[^/]*(/|$)";'));
});

test("tags recorded on a row match without relying on its wording", () => {
  assert.equal(normalizeTag(" ef 7 "), "EF-7");
  assert.equal(normalizeTag("RTU--1"), "RTU-1");
  const m = buildLedgerMatcher({ mentions: ["EF-7"] });
  assert.deepEqual(m.match({ title: "Feeder undersized", tags: ["EF 7"] }), { sheets: [], mentions: ["EF-7"] });
  assert.equal(m.match({ title: "Feeder undersized", tags: ["EF-70"] }), null);
  // matchParts is what find_related uses on an RFI or submittal's text.
  assert.deepEqual(m.matchParts([], [], "Contractor asks about EF7 disconnect"), { sheets: [], mentions: ["EF-7"] });
  assert.equal(m.matchParts([], [], "Contractor asks about EF-17"), null);
});

test("saved schedules give back the rows naming a tag, with their headers", () => {
  const tables = [
    { title: "FAN SCHEDULE", columns: 4, rows: [
      ["TAG", "CFM", "HP", "V/PH"], ["", "", "", "VOLTS"],
      ["EF-7", "1200", "2", "208/3"], ["EF-70", "9000", "5", "480/3"], ["EF-8", "800", "1", "120/1"] ] },
    { title: "PUMP SCHEDULE", columns: 3, rows: [["TAG", "GPM", "HEAD"], ["P-1", "40", "60"]] },
    { title: "NOTES SCHEDULE", columns: 2, rows: [["NOTE", "TEXT"], ["1", "Interlock with EF-7."]] },
  ];
  const hit = scheduleRowsForTag(tables, "EF 7");
  assert.deepEqual(hit.map((h) => h.title), ["FAN SCHEDULE", "NOTES SCHEDULE"]);
  assert.deepEqual(hit[0].header, [["TAG", "CFM", "HP", "V/PH"], ["", "", "", "VOLTS"]]);
  assert.deepEqual(hit[0].rows, [["EF-7", "1200", "2", "208/3"]]); // EF-70 is another fan
  assert.deepEqual(scheduleRowsForTag(tables, "AHU-1"), []);
  assert.deepEqual(scheduleRowsForTag(null, "EF-7"), []);
});

test("the schedule cache, the saved links and find_related keep their guard rails", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  for (const anchor of [
    'mcp.tool("find_related"',
    // A cached parse is used only for the same extractor version and file size.
    'const SCHED_PARSER = "sched-v5";',
    '"&page=eq." + page + "&parser=eq." + SCHED_PARSER',
    "if (!meta.size || Number(row.size_bytes) !== Number(meta.size)) return null;",
    "const cached = refresh ? null : await schedCacheGet(fileId, pageInFile);",
    // The whole page is parsed and kept; match only filters titles.
    "allTables = extractSheetTables(items);",
    // Cache failures never break a read.
    "} catch { return null; }",
    // A full CA review replaces the item's earlier review links; merge only adds.
    "if (!merge) {",
    '"project,item_type,item_number,ref_kind,ref_key,origin"',
    // find_related never serves a pre-issuance QA copy's schedule as the scheduled value.
    "if (isNotIssuedPath(r.folder_path)) continue;",
    'linkedBy.push("confirmed sheet link")',
  ]) assert.ok(src.includes(anchor), `index.ts lost anchor: ${anchor}`);
  const sql = readFileSync(new URL("../../migrations/20261116160000_drawing_schedule_cache_and_refs.sql", import.meta.url), "utf8");
  for (const anchor of [
    "create table if not exists public.pms_drawing_schedules",
    "primary key (item_id, page)",
    "add column if not exists tags jsonb",
    "create table if not exists public.pms_ca_item_refs",
    "unique (project, item_type, item_number, ref_kind, ref_key, origin)",
    "alter table public.pms_drawing_schedules enable row level security;",
    "alter table public.pms_ca_item_refs enable row level security;",
  ]) assert.ok(sql.includes(anchor), `migration lost anchor: ${anchor}`);
});

// Matching QA ledger rows to a sheet or an equipment tag (list_qa_findings
// sheets/mentions, read_rfi_submittal's qaLedger).
//
//   node --test supabase/functions/pms-mcp/qaLedgerMatch.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sheetKey, mentionRegex, buildLedgerMatcher } from "./qaLedgerMatch.ts";

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
    'import { buildLedgerMatcher } from "./qaLedgerMatch.ts";',
    "async function qaLedgerFor(",
    "sheets: z.array(z.string()).max(40).optional()",
    "mentions: z.array(z.string()).max(20).optional()",
    // read_rfi_submittal returns the PM-confirmed sheet links and what the ledger holds on them.
    'x.status === "confirmed"',
    "qaLedger:",
    // Pre-issuance QA copies stay out of the default index readers.
    "const PRE_ISSUE_FOLDER_RE = /(^|\\/)[^/]*qaqc[^/]*(\\/|$)/i;",
    "if (isPreIssuePath(r.folder_path)) continue;",
    "const issued = pool.filter((r) => !isPreIssuePath(r.folder_path));",
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

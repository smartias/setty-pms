// Drift anchors for review comment responses (connector 1.21.0, PMS v160).
//
//   node supabase/functions/pms-mcp/commentResponses.test.mjs
//
// The disposition vocabulary and the "external sources only" rule live in four
// places that must agree: the SQL CHECK + RPC, the connector constants, the
// PMS QA Reviews tab, and the review-comment-responses skill. index.ts boots a
// server at import, so this reads the sources as text (same approach as the
// other pms-mcp drift tests).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const read = (...p) => readFileSync(join(root, ...p), "utf8");

let total = 0, failures = 0;
const check = (ok, label) => { total++; if (!ok) { failures++; console.error("✗ " + label); } };
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

const index = read("supabase", "functions", "pms-mcp", "index.ts");
const sql = read("supabase", "migrations", "20260916000000_qa_comment_responses.sql");
const app = read("SettyPMS.html");
const skill = read(".claude", "skills", "review-comment-responses", "SKILL.md");

const quoted = (s) => [...s.matchAll(/['"]([a-z-]+)['"]/g)].map((m) => m[1]);

// ── 1. Dispositions agree everywhere ────────────────────────────────────────
const connectorDisp = quoted(index.match(/const QA_RESPONSE_DISPOSITIONS = \[([^\]]*)\]/)[1]);
check(connectorDisp.length === 7, "connector lists seven dispositions");

const sqlCheck = quoted(sql.match(/response_disposition in\s*\(([^)]*)\)/)[1]);
check(sameSet(connectorDisp, sqlCheck), "SQL CHECK matches the connector dispositions");

const sqlRpc = quoted(sql.match(/p_disposition not in\s*\(([^)]*)\)/)[1]);
check(sameSet(connectorDisp, sqlRpc), "RPC validation matches the connector dispositions");

const appLabels = app.match(/const QA_DISPOSITION_LABEL = \{([^}]*)\}/);
check(!!appLabels, "app defines QA_DISPOSITION_LABEL");
if (appLabels) {
  const appDisp = [...appLabels[1].matchAll(/"([a-z-]+)"\s*:/g)].map((m) => m[1]);
  check(sameSet(connectorDisp, appDisp), "app labels cover exactly the connector dispositions");
}
for (const d of connectorDisp) {
  check(skill.includes(d), "skill documents disposition: " + d);
}

// ── 2. External sources only ────────────────────────────────────────────────
const connectorExt = quoted(index.match(/const QA_RESPONSE_EXTERNAL_SOURCES = new Set\(\[([^\]]*)\]/)[1]);
const sqlExt = quoted(sql.match(/source not in\s*\(([^)]*)\)/)[1]);
check(connectorExt.length === 5, "connector lists five external sources");
check(sameSet(connectorExt, sqlExt), "RPC external sources match the connector");
check(!connectorExt.includes("qa") && !connectorExt.includes("ripple"), "internal sources are never answerable");

// ── 3. The connector tool only ever writes the draft block ──────────────────
const tool = index.slice(index.indexOf('mcp.tool("save_comment_responses"'));
const toolBody = tool.slice(0, tool.indexOf("// ─── SUBMITTAL / RFI REVIEW"));
check(/sbPatch\("pms_qa_findings\?id=eq\." \+ id, \{ ai_response: block \}\)/.test(toolBody),
  "save_comment_responses patches ai_response and nothing else");
check(!/sbPatch\([^)]*\{[^}]*status/.test(toolBody), "save_comment_responses never patches status");
check(!/response_by|response_at|response_disposition/.test(toolBody.replace(/\/\/.*$/gm, "").replace(/"[^"]*"/g, '""')),
  "save_comment_responses never writes the human response columns");
check(/\^https:\\\/\\\//.test(toolBody), "only https links are stored");

// ── 4. The human response goes through the RPC, signed in ───────────────────
check(/revoke all on function public\.pms_qa_finding_set_response\(bigint, text, text\) from anon/.test(sql),
  "RPC is not callable by anon");
check(/grant execute on function public\.pms_qa_finding_set_response\(bigint, text, text\) to authenticated/.test(sql),
  "RPC is callable by signed-in users");
check(/sheetRefRpc\("pms_qa_finding_set_response"/.test(app), "the QA tab writes responses through the RPC");

console.log(`${total - failures}/${total} passed`);
if (failures) process.exit(1);

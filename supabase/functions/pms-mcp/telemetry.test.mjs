// P3.12 telemetry: result classification, the project-argument recorder that
// makes the `identifier` alias retirable on evidence, and the posture the
// wrapper must hold (hidden is its own outcome; the insert never sits on the
// response path; the service lane is a label everything downstream excludes).
//
//   node supabase/functions/pms-mcp/telemetry.test.mjs
//
// The functions are COPIES (index.ts boots a server at import); drift checks
// at the bottom compare them against the shipped bodies.

let total = 0, failures = 0;
const check = (ok, label) => { total++; if (!ok) { failures++; console.error("✗ " + label); } };

// ── copies from index.ts ────────────────────────────────────────────────────
const firstString = (...vals) => {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 120);
  }
  return null;
};
function projectArgName(args) {
  if (firstString(args?.projectNumber)) return "projectNumber";
  if (firstString(args?.identifier)) return "identifier";
  if (firstString(args?.project)) return "project";
  return null;
}
const RESULT_ARRAY_KEYS = [
  "results", "items", "emails", "notes", "projects", "documents", "files", "sheets",
  "findings", "entries", "matches", "milestones", "contacts", "companies", "photos",
];
function classifyResult(payload) {
  if (!payload || typeof payload !== "object") return { outcome: "hit", resultCount: null, detail: null };
  if (payload.error) {
    return { outcome: "error", resultCount: null, detail: String(payload.error).slice(0, 300) };
  }
  let count = typeof payload.count === "number" ? payload.count : null;
  if (count === null) {
    for (const k of RESULT_ARRAY_KEYS) {
      if (Array.isArray(payload[k])) { count = payload[k].length; break; }
    }
  }
  if (count === 0) {
    return { outcome: "empty", resultCount: 0, detail: payload.reason ? String(payload.reason).slice(0, 300) : null };
  }
  return { outcome: "hit", resultCount: count, detail: null };
}

// ── 1. classifyResult ───────────────────────────────────────────────────────
check(classifyResult({ count: 3, sheets: [] }).outcome === "hit", "count wins over an array key");
check(classifyResult({ count: 0, sheets: [{}] }).outcome === "empty", "count 0 is empty even with a non-empty array elsewhere");
check(classifyResult({ project: "X", sheets: [] }).outcome === "empty", "an empty sheets array with no count is empty");
check(classifyResult({ files: [], folder: "Outgoing" }).outcome === "empty", "an empty files array with no count is empty");
check(classifyResult({ findings: [{ title: "a" }] }).resultCount === 1, "findings array counted");
check(classifyResult({ documents: [1, 2] }).resultCount === 2, "documents array counted");
check(classifyResult({ error: "boom", nextStep: "x" }).outcome === "error", "payload.error is an error");
check(classifyResult({ error: "boom" }).detail === "boom", "error detail carried");
check(classifyResult({ count: 0, reason: "no folder" }).detail === "no folder", "empty reason carried");
check(classifyResult({ project: {} }).outcome === "hit" && classifyResult({ project: {} }).resultCount === null,
  "a payload with no count and no known array is a hit with unknown count");
check(classifyResult("plain text").outcome === "hit" && classifyResult(null).outcome === "hit",
  "non-object payloads are hits");
check(classifyResult({ count: 2, results: [] }).resultCount === 2, "resultCount is the count, not the array length");

// ── 2. projectArgName ───────────────────────────────────────────────────────
check(projectArgName({ projectNumber: "SAPX196006.00" }) === "projectNumber", "projectNumber recorded");
check(projectArgName({ identifier: "SAPX196006.00" }) === "identifier", "identifier (deprecated alias) recorded");
check(projectArgName({ project: "Tabler Quad" }) === "project", "project recorded");
check(projectArgName({ projectNumber: "A", identifier: "B" }) === "projectNumber", "projectNumber wins when both sent (matches projectRef precedence)");
check(projectArgName({ projectNumber: "   ", identifier: "B" }) === "identifier", "blank projectNumber does not count as used");
check(projectArgName({ query: "x" }) === null && projectArgName(undefined) === null, "no project parameter is null");

// ── 3. Drift checks against the shipped source ─────────────────────────────
import { readFileSync } from "node:fs";
const shipped = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const here = readFileSync(new URL(import.meta.url), "utf8");
function extractBody(src, fn) {
  const i = src.indexOf(`function ${fn}(`);
  if (i < 0) return null;
  // The body's brace is the first one that ends a line; the TS return type
  // annotation on classifyResult carries inline braces before it.
  const open = src.indexOf("{\n", i);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(open, j + 1);
  }
  return null;
}
const normalise = (body) => body
  .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n")
  .replace(/: number \| null/g, "").replace(/: any/g, "").replace(/: string/g, "")
  .replace(/\s+/g, " ").trim();
for (const fn of ["classifyResult", "projectArgName"]) {
  const a = extractBody(shipped, fn);
  const b = extractBody(here, fn);
  check(a !== null, `could not find ${fn} in index.ts — extractor needs updating`);
  check(b !== null, `could not find ${fn} in this test file — extractor needs updating`);
  check(a !== null && b !== null && normalise(a) === normalise(b),
    `${fn} has DRIFTED from index.ts. Sync the copy in this test and re-run.`);
}
const has = (needle, label) => check(shipped.includes(needle), `${label} has DRIFTED from this test's anchor`);
has('"findings", "entries", "matches", "milestones", "contacts", "companies", "photos",', "result array key list");
has('type TelemetryOutcome = "hit" | "empty" | "error" | "hidden";', "hidden is its own outcome");
has('cls = { outcome: "hidden", resultCount: null, detail: `caps: projects.view denied for "${ref}"`.slice(0, 300) };',
  "the caps hide path logs hidden, not error");
has("function logTelemetry(row: Record<string, unknown>): void {", "logTelemetry is synchronous fire-and-forget");
has("if (rt && typeof rt.waitUntil === \"function\") rt.waitUntil(settled);", "the background insert is handed to EdgeRuntime.waitUntil");
check(!/finally \{[\s\S]{0,400}await logTelemetry\(/.test(shipped), "the wrapper's finally does not await the telemetry insert");
has("project_arg: projectArgName(args),", "project_arg is written on every row");
has('const TELEMETRY_SERVICE_LABEL = "(shared-secret)";', "service-lane label is one constant");
has('currentCaller().kind === "service" ? TELEMETRY_SERVICE_LABEL : currentCaller().email', "telemetry labels the shared-secret lane");
has("if (!email || email === TELEMETRY_SERVICE_LABEL || email === self || !ref || !refSet.has(ref)) continue;",
  "team activity excludes the service lane");

// The Admin card must treat the label as the service lane, not a person.
const admin = readFileSync(new URL("../../../SettyAdmin.html", import.meta.url), "utf8");
check(admin.includes('const SERVICE_LABEL = "(shared-secret)";') &&
      admin.includes("const isService = (r) => !r.caller_email || r.caller_email === SERVICE_LABEL;"),
  "Admin Usage & audit card recognises the service-lane label");
check(admin.includes('const callers = by(r => isService(r) ? "—" : r.caller_email);'),
  "Admin card's signed-in caller count excludes the service lane");

console.log(failures
  ? `\n${failures} of ${total} assertions FAILED`
  : `\nall ${total} assertions pass (telemetry)`);
process.exit(failures ? 1 : 0);

// Tests for knowledgebase.ts — the firm Knowledgebase share (team KB).
//
//   node supabase/functions/pms-mcp/knowledgebase.test.mjs
//
// The walker takes an injected listing function, so the real code runs
// against an in-memory tree: no share, no secret, no network.

import { readFileSync } from "node:fs";
import { isKbTeam, parseKbExclude, kbExcluded, walkKb, kbScore, kbSearch, KB_TEAM } from "./knowledgebase.ts";

let total = 0, failures = 0;
const check = (ok, label) => { total++; if (!ok) { failures++; console.error("✗ " + label); } };
const eq = (a, b, label) => check(JSON.stringify(a) === JSON.stringify(b), `${label}\n    got  ${JSON.stringify(a)}\n    want ${JSON.stringify(b)}`);

// ── 1. Team and exclusions ───────────────────────────────────────────────────
check(KB_TEAM === "KB" && isKbTeam("kb") && isKbTeam(" KB ") && !isKbTeam("NY") && !isKbTeam(null), "KB team is recognised case-insensitively, nothing else is");
eq(parseKbExclude(" HR, Finance_Private ,,"), ["hr", "finance private"], "exclude list is trimmed, lower-cased, underscores folded");
eq(parseKbExclude(undefined), [], "no env var means no exclusions");
const ex = parseKbExclude("HR,Finance Private");
check(kbExcluded("HR/Policies/leave.pdf", ex), "a file under an excluded folder is excluded");
check(kbExcluded("Standards/hr", ex), "an excluded name matches at any depth, any case");
check(kbExcluded("a/Finance_Private/x.xlsx", ex), "underscores and spaces are equivalent");
check(!kbExcluded("Standards/Mechanical/vav.pdf", ex), "other folders pass");
check(!kbExcluded("Chronicles/hr-notes.pdf", ex), "a name merely containing an excluded word is not excluded (whole segments only)");
check(!kbExcluded("anything", []), "empty exclusion list excludes nothing");

// ── 2. Walk ──────────────────────────────────────────────────────────────────
const F = (name, size = 10, modified = "2026-01-01T00:00:00.000Z") => ({ name, type: "file", size, modified });
const D = (name) => ({ name, type: "folder" });
const TREE = {
  "": [D("HR"), D("Standards"), F("README.txt")],
  "HR": [F("vacation policy.pdf"), D("Benefits")],
  "HR/Benefits": [F("health.pdf")],
  "Standards": [D("Mechanical"), F("index.docx")],
  "Standards/Mechanical": [F("VAV schedule template.xlsx", 5, "2026-08-01T00:00:00.000Z"), F("Chiller notes.pdf")],
};
let calls = [];
const list = async (rel) => { calls.push(rel); if (!(rel in TREE)) throw new Error("404"); return { entries: TREE[rel], truncated: false }; };

let w = await walkKb(list, "");
eq(w.files.map((f) => f.path).sort(), [
  "HR/Benefits/health.pdf", "HR/vacation policy.pdf", "README.txt", "Standards/Mechanical/Chiller notes.pdf",
  "Standards/Mechanical/VAV schedule template.xlsx", "Standards/index.docx",
], "walk finds every file with its full path");
check(!w.truncated && w.failedListings === 0, "a complete walk is not marked partial");
eq(w.files.find((f) => f.name === "README.txt").folder, "", "root files carry an empty folder");

calls = [];
w = await walkKb(list, "", { exclude: ["hr"] });
check(!calls.includes("HR") && !calls.includes("HR/Benefits"), "an excluded folder is never even listed");
check(!w.files.some((f) => f.path.startsWith("HR")), "nothing from an excluded folder is returned");

w = await walkKb(list, "Standards");
eq(w.files.length, 3, "starting inside a folder walks only that subtree");

w = await walkKb(list, "", { maxListings: 2 });
check(w.truncated, "hitting the listing cap marks the walk partial");

w = await walkKb(list, "", { maxFiles: 2 });
check(w.truncated && w.files.length === 2, "hitting the file cap marks the walk partial and stops at the cap");

const flaky = async (rel) => { if (rel === "Standards") throw new Error("503"); return list(rel); };
w = await walkKb(flaky, "");
check(w.failedListings === 1 && w.truncated, "a folder that will not list is counted and reported, not fatal");
check(w.files.some((f) => f.name === "vacation policy.pdf"), "the rest of the tree is still walked after one failure");

// ── 3. Search ────────────────────────────────────────────────────────────────
const all = (await walkKb(list, "")).files;
eq(kbSearch(all, "vacation policy").map((f) => f.name), ["vacation policy.pdf"], "every word must match; name hit found");
eq(kbSearch(all, "VAV template").map((f) => f.name), ["VAV schedule template.xlsx"], "words may be non-adjacent and any case");
eq(kbSearch(all, "mechanical").map((f) => f.name).sort(), ["Chiller notes.pdf", "VAV schedule template.xlsx"], "a folder-path hit finds the files inside it");
eq(kbSearch(all, "nonexistent thing"), [], "no match is an empty list, not an error");
eq(kbSearch(all, ""), [], "an empty query matches nothing");
check(kbScore({ name: "leave policy.pdf", folder: "x" }, ["policy"]) > kbScore({ name: "leave.pdf", folder: "policy" }, ["policy"]), "a name hit outranks a folder hit");
check(kbScore({ name: "vav.pdf", folder: "" }, ["vav"]) > kbScore({ name: "vavs.pdf", folder: "" }, ["vav"]), "a whole-word hit outranks a substring hit");
eq(kbSearch(all, "pdf", 2).length, 2, "limit caps the hits");
const tie = kbSearch([{ name: "a.pdf", path: "a.pdf", folder: "", ext: "pdf", modified: "2025-01-01" }, { name: "b.pdf", path: "b.pdf", folder: "", ext: "pdf", modified: "2026-01-01" }], "pdf");
eq(tie.map((f) => f.name), ["b.pdf", "a.pdf"], "equal scores sort newest first");

// ── 4. Drift anchors: the gate in index.ts must keep these properties ────────
const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
check(/if \(isKbTeam\(team\)\) \{[\s\S]{0,400}kbExcluded\(relPath, KB_EXCLUDE\)[\s\S]{0,300}projectNumber: ""/.test(src),
  "azurePathProject has a KB branch that applies KB_EXCLUDE and skips the project gate");
const gateAt = src.indexOf("async function azurePathProject");
const kbAt = src.indexOf("if (isKbTeam(team))", gateAt);
const projAt = src.indexOf("projectForFolderName(first", gateAt);
check(kbAt > gateAt && kbAt < projAt, "the KB branch sits ahead of the project lookup, and only the KB team takes it");
check(!/!dec \|\| !dec\.relPath\.includes\("\/"\)/.test(src), "no drive-id check still demands a slash without the KB root-file exception");
check(/mcp\.tool\("browse_knowledgebase"/.test(src), "browse_knowledgebase is registered");
check(/walkKb\(\(d\) => azureDirEntries\(ctx, d\), rel, \{[^}]*exclude: KB_EXCLUDE/.test(src), "the search walk passes KB_EXCLUDE");

if (failures) { console.error(`\n${failures} of ${total} checks failed`); process.exit(1); }
console.log(`knowledgebase: ${total} checks passed`);

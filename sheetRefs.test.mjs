// Stage 1 sheet-reference chips: the browser matcher mirror (sheetRefs.js)
// against real-shaped RFI fixtures, plus drift anchors pinning it to the
// shipped trace_references matcher in supabase/functions/pms-mcp/index.ts.
//
//   node sheetRefs.test.mjs
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  PROSE_SHEET_RE, sheetTokensInText, refSnippet, REF_CONFIDENCE_RANK,
  computeSuggestions, unknownCandidates, registerKeysFromRows, normalizeKeys,
  TEXT_FALLBACK_CAP, stripHtml,
} from "./sheetRefs.js";

// The real CSI Elevator RFI-029 shape (SAPX226009.00) — the Stage 0 acceptance case.
const rfi029 = {
  id: "x1", number: "RFI-029",
  title: "RFI29 - 363250 - BLDG 2A - Power Source in Wrong Panel",
  description: "<p>The power source shown is in the wrong panel.</p>",
  response: "<p>• Refer to Electrical Demolition Notes on Sheet E-001, Note 2. The Electrical Contractor is responsible for field verification.</p>",
};

test("E-001 in a response is found, tiered by what validates", () => {
  const none = computeSuggestions(rfi029, "rfi", { registerKeys: new Set(), indexKeys: new Set(), textKeys: new Set() });
  assert.equal(none.length, 1);
  assert.equal(none[0].sheet, "E001");
  assert.equal(none[0].confidence, "unvalidated");
  assert.equal(none[0].field, "response");
  assert.ok(none[0].snippet.includes("E-001"));

  const text = computeSuggestions(rfi029, "rfi", { registerKeys: new Set(), indexKeys: new Set(), textKeys: new Set(["E001"]) });
  assert.equal(text[0].confidence, "drawing-text", "text occurrence upgrades unvalidated");

  const reg = computeSuggestions(rfi029, "rfi", { registerKeys: new Set(["E001"]), indexKeys: new Set(), textKeys: new Set(["E001"]) });
  assert.equal(reg[0].confidence, "register", "register outranks every other tier");
});

test("equipment tags and prose never become suggestions", () => {
  const item = { id: "x2", title: "FCU-11 and CHWP-2 balancing", description: "See option E 2021 and AHU-101 for the unit." };
  const out = computeSuggestions(item, "rfi", { registerKeys: new Set(), indexKeys: new Set(), textKeys: new Set() });
  // FCU-11/CHWP-2: 2-digit numbers never tokenize. "E 2021": space-separated
  // unvalidated is dropped. AHU-101: AHU is not a discipline code.
  assert.equal(out.length, 0, JSON.stringify(out));
});

test("register keys fold DOB-NOW suffixes and hyphen variants to identity", () => {
  const keys = registerKeysFromRows([
    { files: { sheets: [{ sheetNo: "P101.00" }, { sheetNo: "E-211" }, { sheetNo: "STTQ-01" }] } },
  ]);
  assert.ok(keys.has("P101") && keys.has("E211"), [...keys].join(","));
  assert.ok(!keys.has("STTQ-01") && !keys.has("STTQ01"), "a series key never validates a reference");
  const idx = normalizeKeys(["FA100.00", "P - 001", "not a sheet"]);
  assert.ok(idx.has("FA100") && idx.has("P001") && idx.size === 2);
});

test("unknownCandidates: only known-discipline, non-space tokens, capped", () => {
  const item = { id: "x3", title: "", description: "E-101 M-201 ZZZ-301 T 401", response: "" };
  const u = unknownCandidates(item, "rfi", new Set(["E101"]), new Set());
  assert.deepEqual(u, ["M201"], "register-known, unknown-prefix and space-separated all excluded");
  const many = { id: "x4", description: Array.from({ length: 30 }, (_, i) => "E-" + (100 + i)).join(" ") };
  assert.equal(unknownCandidates(many, "rfi", new Set(), new Set()).length, TEXT_FALLBACK_CAP);
});

test("stripHtml flattens the email-shaped HTML these fields carry", () => {
  assert.equal(stripHtml("<p>Sheet&nbsp;E-001 &amp; E-002</p>"), 'Sheet E-001 & E-002');
});

// ── drift anchors against the shipped trace_references matcher ──────────────
test("DRIFT: mirror matches index.ts", () => {
  const shipped = readFileSync(new URL("./supabase/functions/pms-mcp/index.ts", import.meta.url), "utf8");
  assert.ok(shipped.includes("const PROSE_SHEET_RE = " + PROSE_SHEET_RE.toString() + ";"),
    "PROSE_SHEET_RE literal drifted");
  assert.ok(shipped.includes('{ register: 4, "drawing-index": 3, "drawing-text": 2, unvalidated: 1 }'),
    "confidence rank drifted");
  assert.equal(JSON.stringify(REF_CONFIDENCE_RANK), '{"register":4,"drawing-index":3,"drawing-text":2,"unvalidated":1}');
  for (const anchor of [
    'if (registerKeys.has(t.sheet)) confidence = "register";',
    'else if (indexKeys.has(t.sheet)) confidence = "drawing-index";',
    'else if (textKeys.has(t.sheet)) confidence = "drawing-text";',
    'else if (!t.spaceSeparated && DISCIPLINE_NAME[t.discipline]) confidence = "unvalidated";',
    "if (t.spaceSeparated || !DISCIPLINE_NAME[t.discipline]) continue;",
    "const TEXT_FALLBACK_CAP = 15;",
    '["subject", String(item.title || "")]',
    '["response", htmlToText(item.response || "")]',
  ]) {
    assert.ok(shipped.includes(anchor), "tier/field rule drifted from the mirror: " + anchor);
  }
  // refSnippet body, TS annotations stripped, must match the mirror's.
  const body = (src, name) => {
    const i = src.indexOf("function " + name);
    const open = src.indexOf("{", i);
    let d = 0;
    for (let j = open; j < src.length; j++) {
      if (src[j] === "{") d++;
      else if (src[j] === "}" && --d === 0) return src.slice(open + 1, j).replace(/\s+/g, " ").trim();
    }
  };
  assert.equal(body(shipped, "refSnippet"), body(readFileSync(new URL("./sheetRefs.js", import.meta.url), "utf8"), "refSnippet"),
    "refSnippet drifted");
});

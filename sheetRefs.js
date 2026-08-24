// sheetRefs.js — browser-side mirror of the trace_references MATCHER, for the
// Stage 1 sheet-reference chips on RFI/Submittal cards in SettyPMS.html.
//
// Loaded as a plain <script type="module"> alongside SettyPMS.html and hung on
// window.SheetRefs (the app's own code is Babel-compiled and cannot import).
//
// DRIFT: the matcher and tiering duplicate trace_references in
// supabase/functions/pms-mcp/index.ts, which a browser cannot import.
// sheetRefs.test.mjs pins the regex literal and the tier rules against the
// shipped source, so a divergence fails that test (run it by hand; no CI).
// Validation UNIVERSES come from the database, not from here: the transmittal
// register (pms_filing_log, folded with canonicalSheet like the connector) and
// the two authenticated lookups pms_drawing_sheet_keys / pms_drawing_text_occurs
// (SECURITY DEFINER — pms_drawing_text itself is admin-only).

import { canonicalSheet, DISCIPLINE_NAME } from "./currentSetFold.js";

// Precision strategy (mirrors index.ts): equipment tags share the
// letters+digits shape (AHU-101), so an unvalidated token counts only when its
// prefix is a known discipline code, and a space-separated unvalidated token
// ("option E 2021") never counts. Two-digit tags (FCU-11) never tokenize:
// real sheet numbers are 3-4 digits.
export const PROSE_SHEET_RE = /\b([A-Za-z]{1,3})([-\s]?)(\d{3,4}[A-Za-z]?)\b/g;

export function sheetTokensInText(text) {
  const out = [];
  if (!text) return out;
  PROSE_SHEET_RE.lastIndex = 0;
  let m;
  while ((m = PROSE_SHEET_RE.exec(text))) {
    out.push({
      sheet: (m[1] + m[3]).toUpperCase(),
      discipline: m[1].toUpperCase(),
      spaceSeparated: m[2] === " ",
      at: m.index,
      token: m[0],
    });
  }
  return out;
}

export function refSnippet(text, at, len) {
  const start = Math.max(0, at - 60);
  const end = Math.min(text.length, at + len + 60);
  const clip = text.slice(start, end).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + clip + (end < text.length ? "…" : "");
}

export const REF_CONFIDENCE_RANK = { register: 4, "drawing-index": 3, "drawing-text": 2, unvalidated: 1 };

// RFI text fields arrive as HTML from the email parsers; a light strip is
// enough here — the matcher only needs the words, not the layout.
export const stripHtml = (html) => String(html || "")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
  .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#39;/gi, "'").replace(/&quot;/gi, '"')
  .replace(/\s+/g, " ").trim();

// The fields trace_references scans, in the same order (field names surface in
// the chip tooltip, so they must match what the connector reports).
export function itemFields(item, kind) {
  return [
    ["subject", String(item?.title || "")],
    [kind === "rfi" ? "question" : "description", stripHtml(item?.description || "")],
    ["response", stripHtml(item?.response || "")],
    ["comments", stripHtml(item?.comments || "")],
    ["notes", String(item?.notes || "")],
  ];
}

// Candidate sheets an item mentions that validate against NOTHING yet — the
// list worth probing against drawing text (same cap as the connector).
export const TEXT_FALLBACK_CAP = 15;
export function unknownCandidates(item, kind, registerKeys, indexKeys) {
  const out = new Set();
  for (const [, text] of itemFields(item, kind)) {
    for (const t of sheetTokensInText(text)) {
      if (registerKeys.has(t.sheet) || indexKeys.has(t.sheet)) continue;
      if (t.spaceSeparated || !DISCIPLINE_NAME[t.discipline]) continue;
      out.add(t.sheet);
    }
  }
  return [...out].slice(0, TEXT_FALLBACK_CAP);
}

// One entry per referenced sheet at its BEST confidence — the same dedupe and
// tier rules as the connector's trace_references items[].sheets.
export function computeSuggestions(item, kind, { registerKeys, indexKeys, textKeys }) {
  const best = new Map();
  for (const [field, text] of itemFields(item, kind)) {
    for (const t of sheetTokensInText(text)) {
      let confidence = null;
      if (registerKeys.has(t.sheet)) confidence = "register";
      else if (indexKeys.has(t.sheet)) confidence = "drawing-index";
      else if (textKeys.has(t.sheet)) confidence = "drawing-text";
      else if (!t.spaceSeparated && DISCIPLINE_NAME[t.discipline]) confidence = "unvalidated";
      if (!confidence) continue;
      const prev = best.get(t.sheet);
      if (prev && REF_CONFIDENCE_RANK[prev.confidence] >= REF_CONFIDENCE_RANK[confidence]) continue;
      best.set(t.sheet, {
        sheet: t.sheet,
        discipline: DISCIPLINE_NAME[t.discipline] ?? t.discipline,
        confidence, field,
        snippet: refSnippet(text, t.at, t.token.length),
      });
    }
  }
  return [...best.values()].sort((a, b) =>
    REF_CONFIDENCE_RANK[b.confidence] - REF_CONFIDENCE_RANK[a.confidence] ||
    String(a.sheet).localeCompare(String(b.sheet)));
}

// Raw sheet_no values (e.g. from pms_drawing_sheet_keys: "P-001", "FA100.00")
// normalized to identity keys, the same way the connector normalizes its
// drawing-index universe. Unparseable values drop out.
export function normalizeKeys(list) {
  const keys = new Set();
  for (const v of (Array.isArray(list) ? list : [])) {
    const c = canonicalSheet({ sheetNo: v });
    if (c) keys.add(c.key);
  }
  return keys;
}

// Register keys from raw pms_filing_log rows — identity keys (DOB-NOW suffix
// stripped), the same canonicalSheet the fold uses. ALL rows on purpose: an old
// RFI legitimately cites a sheet a later set superseded.
export function registerKeysFromRows(rows) {
  const keys = new Set();
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const sheets = Array.isArray(row?.files?.sheets) ? row.files.sheets : [];
    for (const s of sheets) {
      const c = canonicalSheet(s);
      if (c) keys.add(c.key);
    }
  }
  return keys;
}

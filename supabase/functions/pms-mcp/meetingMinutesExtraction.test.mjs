// Tests for the meeting-minutes extraction pipeline's pure logic in index.ts
// (issue #291): carry-forward matching and the extraction-output parser.
//
//   node supabase/functions/pms-mcp/meetingMinutesExtraction.test.mjs
//
// The functions are COPIED below rather than imported: index.ts is a
// single-file edge function whose top level constructs the MCP server and
// calls Deno.serve, so importing it would boot a server (see
// saveKnowledge.test.mjs for the same pattern). Drift checks at the bottom
// keep this copy honest against the shipped source.

let total = 0, failures = 0;
const check = (ok, label) => { total++; if (!ok) { failures++; console.error("✗ " + label); } };

// ── copies from index.ts ────────────────────────────────────────────────────
const MEETING_ITEM_NUMBER_MATCH_THRESHOLD = 0.35;
const MEETING_ITEM_TEXT_MATCH_THRESHOLD = 0.6;
function meetingItemWords(s) {
  return new Set(
    String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2),
  );
}
function meetingItemOverlap(a, b) {
  const A = meetingItemWords(a), B = meetingItemWords(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}
function carryForwardMatch(extracted, open) {
  let best = null;
  for (const row of open) {
    if (row.itemType !== extracted.itemType) continue;
    const numberMatch = !!extracted.itemNumber && !!row.itemNumber && extracted.itemNumber === row.itemNumber;
    const score = meetingItemOverlap(extracted.text, row.text);
    const threshold = numberMatch ? MEETING_ITEM_NUMBER_MATCH_THRESHOLD : MEETING_ITEM_TEXT_MATCH_THRESHOLD;
    if (score < threshold) continue;
    const better = !best || (numberMatch && !best.numberMatch) || (numberMatch === best.numberMatch && score > best.score);
    if (better) best = { row, score, numberMatch };
  }
  return best ? best.row : null;
}
function parseMeetingExtraction(raw) {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no JSON object in extraction output");
  const d = JSON.parse(stripped.slice(start, end + 1));
  if (d?.kind !== "meeting-minutes-extraction" || d?.schemaVersion !== 1) {
    throw new Error("extraction output is not meeting-minutes-extraction schemaVersion 1");
  }
  const items = (Array.isArray(d.items) ? d.items : []).filter((it) =>
    it && ["decision", "action_item", "open_question"].includes(it.type) &&
    typeof it.text === "string" && it.text.trim());
  return {
    meetingDate: typeof d.meetingDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.meetingDate) ? d.meetingDate : null,
    attendees: (Array.isArray(d.attendees) ? d.attendees : []).filter((a) => typeof a === "string" && a.trim()),
    items,
  };
}

// ── 1. carryForwardMatch: renumbered items still match on text ─────────────
{
  const open = [
    { id: "old-1", itemNumber: "2.1", text: "SCA to confirm the mezzanine fire rating requirement with the code consultant.", itemType: "action_item", firstSeenMeetingId: "m0", carryCount: 2 },
  ];
  const extracted = { itemNumber: "3.4", text: "SCA still needs to confirm the mezzanine fire rating requirement with the code consultant.", itemType: "action_item" };
  const m = carryForwardMatch(extracted, open);
  check(m && m.id === "old-1", "a renumbered item (2.1 -> 3.4) still carries forward on text overlap alone");
}

// ── 2. A matching printed number lowers the bar, but text must still be related ─
{
  const open = [{ id: "old-2", itemNumber: "5", text: "Confirm generator fuel tank sizing with the mechanical engineer.", itemType: "action_item", firstSeenMeetingId: "m0", carryCount: 1 }];
  // Same number, unrelated topic (a renumbering COLLISION) — must NOT match.
  const collision = { itemNumber: "5", text: "Owner requested an updated project schedule by Friday.", itemType: "action_item" };
  check(carryForwardMatch(collision, open) === null, "same item number but unrelated text does not false-match (renumbering collision)");
  // Same number, same topic reworded — should match at the lower (numbered) threshold.
  const reworded = { itemNumber: "5", text: "Generator fuel tank sizing needs confirmation from mechanical.", itemType: "action_item" };
  check(carryForwardMatch(reworded, open)?.id === "old-2", "same number + related text matches at the lower numbered threshold");
}

// ── 3. Different item_type never matches, even with identical text ─────────
{
  const open = [{ id: "old-3", itemNumber: "1", text: "Owner will confirm the finish schedule by next meeting.", itemType: "open_question", firstSeenMeetingId: "m0", carryCount: 1 }];
  const asDecision = { itemNumber: "1", text: "Owner will confirm the finish schedule by next meeting.", itemType: "decision" };
  check(carryForwardMatch(asDecision, open) === null, "an open_question never carries forward into a decision, even with identical text");
}

// ── 4. Distinct, unrelated open items in the same project do not match ─────
{
  const open = [
    { id: "a", itemNumber: null, text: "Setty to issue the updated riser diagram.", itemType: "action_item", firstSeenMeetingId: "m0", carryCount: 1 },
    { id: "b", itemNumber: null, text: "Architect to confirm ceiling height in the lobby.", itemType: "action_item", firstSeenMeetingId: "m0", carryCount: 1 },
  ];
  const extracted = { itemNumber: null, text: "Contractor to submit the updated project schedule.", itemType: "action_item" };
  check(carryForwardMatch(extracted, open) === null, "an unrelated new item does not spuriously match an existing open item");
}

// ── 5. Best match wins when several candidates score above threshold ───────
{
  const open = [
    { id: "weak", itemNumber: null, text: "Setty riser diagram update pending.", itemType: "action_item", firstSeenMeetingId: "m0", carryCount: 1 },
    { id: "strong", itemNumber: null, text: "Setty to issue the updated riser diagram showing the relocated main.", itemType: "action_item", firstSeenMeetingId: "m0", carryCount: 3 },
  ];
  const extracted = { itemNumber: null, text: "Setty to issue the updated riser diagram showing the relocated main to the electrical room.", itemType: "action_item" };
  const m = carryForwardMatch(extracted, open);
  check(m && m.id === "strong", "the higher-overlap candidate wins over a weaker partial match");
}

// ── 6. parseMeetingExtraction: fenced JSON, schema validation, item filtering ─
check(JSON.stringify(parseMeetingExtraction('```json\n{"schemaVersion":1,"kind":"meeting-minutes-extraction","meetingDate":"2026-07-29","attendees":["A"],"items":[{"type":"decision","itemNumber":"1","text":"x"}]}\n```'))
  === JSON.stringify({ meetingDate: "2026-07-29", attendees: ["A"], items: [{ type: "decision", itemNumber: "1", text: "x" }] }),
  "a fenced code block is stripped before parsing");
check((() => { try { parseMeetingExtraction('{"schemaVersion":2,"kind":"meeting-minutes-extraction","items":[]}'); return false; } catch { return true; } })(),
  "wrong schemaVersion is rejected");
check((() => { try { parseMeetingExtraction('{"schemaVersion":1,"kind":"something-else","items":[]}'); return false; } catch { return true; } })(),
  "wrong kind is rejected");
check(parseMeetingExtraction('{"schemaVersion":1,"kind":"meeting-minutes-extraction","meetingDate":"not-a-date","items":[]}').meetingDate === null,
  "a malformed meetingDate is dropped to null rather than passed through");
check(parseMeetingExtraction('{"schemaVersion":1,"kind":"meeting-minutes-extraction","items":[{"type":"agenda","text":"x"},{"type":"decision","text":""},{"type":"decision","text":"real one"}]}').items.length === 1,
  "items with an unrecognized type or empty text are dropped");

// ── 7. Drift checks against the shipped source ──────────────────────────────
import { readFileSync } from "node:fs";
const shipped = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const has = (needle, label) => check(shipped.includes(needle), `${label} has DRIFTED from this test's copy`);
has("const MEETING_ITEM_NUMBER_MATCH_THRESHOLD = 0.35;", "number-match threshold");
has("const MEETING_ITEM_TEXT_MATCH_THRESHOLD = 0.6;", "text-match threshold");
has("return inter / Math.min(A.size, B.size);", "overlap containment denominator");
has("if (row.itemType !== extracted.itemType) continue;", "carry-forward type guard");
has('if (d?.kind !== "meeting-minutes-extraction" || d?.schemaVersion !== 1) {', "extraction schema guard");
has('["decision", "action_item", "open_question"].includes(it.type)', "item type allowlist");

console.log(failures
  ? `\n${failures} of ${total} assertions FAILED`
  : `\nall ${total} assertions pass`);
process.exit(failures ? 1 : 0);

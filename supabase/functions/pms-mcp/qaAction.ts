// Is a finding's action something a person can do and another can check?
// (record_qa_findings flags the ones that are not; revise_qa_finding_action
// refuses to store one.) Pure; see qaAction.test.mjs.
//
// The standard, from the qa-coordination-review skill: the discipline first,
// an imperative verb, the sheet and item to change, and the value or wording
// it should read when done. This is a floor under that standard, not the
// standard: it catches "Coordinate." and "Verify and revise as required", and
// lets through anything that names where the work is. It is deliberately
// lenient, because a wrongly rejected action costs a person more than a
// loose one that got through.

// Verbs that say nothing on their own.
const VAGUE = "coordinate|verify|review|check|confirm|reconcile|clarify|address|resolve|revise|update|correct|fix|investigate|evaluate|see|refer";
const VAGUE_ONLY = new RegExp(
  "^(?:please\\s+)?(?:" + VAGUE + ")(?:\\s*(?:,|and|&|/|or)\\s*(?:" + VAGUE + "))*" +
  "(?:\\s+(?:as\\s+(?:required|needed|necessary|appropriate)|accordingly|the\\s+(?:drawings?|documents?|sheets?|set|schedules?|design)|" +
  "with\\s+(?:the\\s+)?(?:architect|structural|owner|team|engineer|all\\s+(?:trades|disciplines))))*\\s*\\.?$", "i");
// Somewhere to look: a sheet number, a spec section, or a named part of the set.
const WHERE = new RegExp(
  "\\b[A-Z]{1,3}-?\\d{2,4}(?:\\.\\d+)?[A-Z]?\\b" +                     // M-601, E501, FA-101, A-552
  "|\\b\\d{2}\\s?\\d{2}\\s?\\d{2}(?:\\.\\d+)?\\b" +                     // 213113, 08 35 13.23
  "|\\b(?:sheets?|specs?|specification|section|division|detail|schedule|panel|riser|legend|keynote|note|title\\s*block|" +
  "plans?|one-line|sequence|diagram|narrative|register|letter|calc(?:ulation)?s?|report|response|filing|form)\\b", "i");
const SHEET_NO = /\b[A-Z]{1,3}-?\d{2,4}(?:\.\d+)?[A-Z]?\b/;
const DISCIPLINE_PREFIX = /^\s*[A-Za-z][A-Za-z /,&-]{1,60}:\s*/;

export function actionProblem(action: unknown): string | null {
  const raw = String(action ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "no action given";
  const body = raw.replace(DISCIPLINE_PREFIX, "").trim();
  const words = body.split(" ").filter(Boolean).length;
  if (VAGUE_ONLY.test(body)) return "says only to " + body.replace(/\.$/, "").toLowerCase() + ": name the sheet, the item and what it should read when done";
  // A short action that names a sheet number ("Correct to 208/1/60 on M-601.") is fine.
  if (words < 6 && !SHEET_NO.test(raw)) return "too short to act on (" + words + " words): name the sheet, the item and what it should read when done";
  if (!WHERE.test(raw) && words < 14) return "names no sheet, schedule, detail or spec section to change";
  return null;
}

export const ACTION_STANDARD =
  "An action is one or two sentences: the discipline first, an imperative verb, the sheet (and schedule row, keynote, " +
  "detail or spec section) to change, and the value or wording it should read when done, e.g. 'Mechanical: on M-601, " +
  "change FCU-1-1 from 220/1/60 to 208/1/60 to match E-601.' Name every sheet that has to change. Where the right " +
  "answer is not known, say who decides and give both outcomes with their sheets.";

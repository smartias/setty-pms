// The item-by-item result of a QA review, as stored on its review row
// (pms_qa_reviews.checklist_results) and shown in the QA Reviews tab.
// Pure; see qaChecklistResults.test.mjs.
//
// One entry per checklist item the review was asked to work: what happened
// to it, and what was examined or why it was not. This is the record that
// says whether an item was looked at. It is NOT a sign-off: "clean" means
// the review found nothing in what it examined, and a person still signs.

export const QA_DISPOSITIONS = ["clean", "finding", "flag", "partial", "not attempted", "n/a"] as const;
export type QaDisposition = typeof QA_DISPOSITIONS[number];
export const QA_CHECKLIST_RESULTS_MAX = 400;
export const QA_RESULT_NOTE_MAX = 600;
export const QA_NARRATIVE_MAX = 12000;

const ALIASES: Record<string, QaDisposition> = {
  "clean": "clean", "ok": "clean", "no exception": "clean", "pass": "clean", "passed": "clean",
  "finding": "finding", "findings": "finding",
  "flag": "flag", "confirm": "flag",
  "partial": "partial", "partly": "partial",
  "not attempted": "not attempted", "not-attempted": "not attempted", "not_attempted": "not attempted",
  "not verified": "not attempted", "not checked": "not attempted", "skipped": "not attempted",
  "n/a": "n/a", "na": "n/a", "not applicable": "n/a",
};

export function normalizeDisposition(d: unknown): QaDisposition | null {
  const k = String(d ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return ALIASES[k] ?? null;
}

export interface QaChecklistResult { itemId: string; disposition: QaDisposition; note?: string }

// Clean what the review sent: known dispositions only, one entry per item
// (the last one wins, so a corrected entry replaces the first), notes trimmed
// to a length the tab can show. Returns what was dropped so the caller hears
// about it instead of finding a shorter table later.
export function cleanChecklistResults(input: unknown): {
  results: QaChecklistResult[]; dropped: Array<{ itemId: string; reason: string }>; counts: Record<string, number>;
} {
  const byId = new Map<string, QaChecklistResult>();
  const dropped: Array<{ itemId: string; reason: string }> = [];
  for (const r of Array.isArray(input) ? input : []) {
    const itemId = String((r as any)?.itemId ?? "").trim().slice(0, 40);
    if (!itemId) { dropped.push({ itemId: "", reason: "no itemId" }); continue; }
    const disposition = normalizeDisposition((r as any)?.disposition);
    if (!disposition) { dropped.push({ itemId, reason: `unknown disposition "${String((r as any)?.disposition ?? "").slice(0, 40)}"` }); continue; }
    const note = String((r as any)?.note ?? "").replace(/\s+/g, " ").trim().slice(0, QA_RESULT_NOTE_MAX);
    byId.set(itemId, note ? { itemId, disposition, note } : { itemId, disposition });
  }
  const results = [...byId.values()].slice(0, QA_CHECKLIST_RESULTS_MAX);
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.disposition] = (counts[r.disposition] ?? 0) + 1;
  return { results, dropped, counts };
}

// "12 clean, 9 finding/flag, 3 partial, 105 not attempted, 4 n/a (of 133)"
export function checklistCountsLine(counts: Record<string, number>): string {
  const n = (k: string) => counts[k] ?? 0;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total) return "";
  return `${n("clean")} clean, ${n("finding") + n("flag")} finding/flag, ${n("partial")} partial, ` +
    `${n("not attempted")} not attempted, ${n("n/a")} n/a (of ${total})`;
}

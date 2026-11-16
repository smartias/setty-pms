// Why an RFI was asked, and which QA check would have caught it
// (save_ca_review rootCause, tag_rfi_root_causes, rfi_root_cause_summary).
// Pure; see rfiRootCause.test.mjs.
//
// QA is proactive and RFIs are reactive: the RFI log is the record of what the
// documents got wrong, so it is the best evidence of what the next project's
// QA review should look for. One tag per RFI, written when the RFI is
// reviewed, turns each project's log into counts that say which checks earn
// their place and which problems no check covers yet.

export const RFI_ROOT_CAUSES = [
  "doc-conflict",     // the documents disagree with themselves (two sheets, drawing vs spec, plan vs schedule)
  "doc-missing",      // something needed to build or price it is not in the documents
  "coordination",     // MEPFP against another discipline's documents, or trade against trade in space
  "scope-gap",        // who furnishes, installs or wires it is unclear or unassigned
  "contractor",       // answered by the documents as issued, means and methods, or a substitution request
  "field-condition",  // an existing or site condition nobody could have drawn
  "owner-change",     // the owner or a user changed what they want
  "other",
] as const;
export type RfiRootCause = typeof RFI_ROOT_CAUSES[number];

// Causes a review of the documents before issue could have caught.
const PREVENTABLE = new Set<string>(["doc-conflict", "doc-missing", "coordination", "scope-gap"]);
export const defaultPreventable = (cause: string): boolean => PREVENTABLE.has(cause);

const ALIASES: Record<string, RfiRootCause> = {
  conflict: "doc-conflict", "document-conflict": "doc-conflict", discrepancy: "doc-conflict",
  missing: "doc-missing", "document-missing": "doc-missing", omission: "doc-missing", incomplete: "doc-missing",
  "coord-other-discipline": "coordination", coord: "coordination", clash: "coordination", "cross-discipline": "coordination",
  scope: "scope-gap", "division-of-work": "scope-gap", "by-others": "scope-gap",
  "means-and-methods": "contractor", substitution: "contractor", "contractor-error": "contractor",
  field: "field-condition", "existing-condition": "field-condition", site: "field-condition",
  owner: "owner-change", "client-change": "owner-change",
  unclear: "other", unknown: "other",
};
export function normalizeRootCause(v: unknown): RfiRootCause | null {
  const t = String(v ?? "").toLowerCase().trim().replace(/[\s_/]+/g, "-");
  if (!t) return null;
  if ((RFI_ROOT_CAUSES as readonly string[]).includes(t)) return t as RfiRootCause;
  return ALIASES[t] ?? null;
}

// A checklist item id ("qa-614") or null. "none", "n/a" and blanks mean no
// check covers it, which is the signal that one may be missing.
export function normalizeQaItem(v: unknown): string | null {
  const t = String(v ?? "").toLowerCase().trim();
  const m = /^qa-?(\d{3})$/.exec(t);
  return m ? "qa-" + m[1] : null;
}

// Bid RFIs are numbered apart on every log seen so far (BID-011, BID-RFI-298).
export function rfiPhase(number: unknown, given?: unknown): "bid" | "construction" {
  const g = String(given ?? "").toLowerCase().trim();
  if (g === "bid" || g === "construction") return g;
  return /^\s*bid\b/i.test(String(number ?? "")) ? "bid" : "construction";
}

export type RootCauseRow = {
  project: string; item_number: string; cause: string; preventable: boolean;
  qa_item?: string | null; phase?: string | null; note?: string | null; subject?: string | null;
};

// The picture a QA review reads before it starts, and the PM reads after a
// job: how many RFIs a document review could have prevented, which checks
// they map to, and the preventable ones no check covers (candidates for a
// new checklist item).
export function summarizeRootCauses(rows: RootCauseRow[], opts: { uncoveredLimit?: number } = {}) {
  const total = rows.length;
  const byCause: Record<string, number> = {};
  const byPhase: Record<string, number> = {};
  const byItem = new Map<string, { count: number; projects: Set<string>; examples: string[] }>();
  const uncovered: Array<{ project: string; number: string; cause: string; subject: string | null; note: string | null }> = [];
  let preventable = 0;
  for (const r of rows) {
    byCause[r.cause] = (byCause[r.cause] || 0) + 1;
    const ph = r.phase || "construction";
    byPhase[ph] = (byPhase[ph] || 0) + 1;
    if (!r.preventable) continue;
    preventable++;
    if (r.qa_item) {
      const e = byItem.get(r.qa_item) ?? { count: 0, projects: new Set<string>(), examples: [] };
      e.count++; e.projects.add(r.project);
      if (e.examples.length < 3) e.examples.push(r.project + " " + r.item_number + (r.subject ? ": " + String(r.subject).slice(0, 80) : ""));
      byItem.set(r.qa_item, e);
    } else {
      uncovered.push({ project: r.project, number: r.item_number, cause: r.cause, subject: r.subject ?? null, note: r.note ?? null });
    }
  }
  const byQaItem = [...byItem.entries()]
    .map(([qaItem, e]) => ({ qaItem, rfis: e.count, projects: e.projects.size, examples: e.examples }))
    .sort((a, b) => b.rfis - a.rfis || a.qaItem.localeCompare(b.qaItem));
  const lim = opts.uncoveredLimit ?? 40;
  return {
    tagged: total,
    preventable, preventableShare: total ? Math.round((preventable / total) * 100) : 0,
    byCause, byPhase, byQaItem,
    preventableWithNoCheck: uncovered.length,
    noCheckExamples: uncovered.slice(0, lim),
    projects: [...new Set(rows.map((r) => r.project))].length,
  };
}

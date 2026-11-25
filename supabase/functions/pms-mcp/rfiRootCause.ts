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

// ── Preventable RFIs that no lesson records yet ──────────────────────────────
// The tags say which RFIs a document review could have prevented; a lesson is
// what carries that to the next project. On 2026-11-24, 483 RFIs were tagged
// preventable and 64 lessons came from RFIs. lessonCandidates() lists the
// preventable RFIs no lesson links to, grouped by the checklist item (or, with
// none, by cause) so ONE lesson is drafted per recurring pattern, not one per
// RFI: 200 single-RFI lessons would bury the reviewer and the reader alike.

// "RFI-019", "rfi 19", "019" and "19" are the same RFI, and so are "BID-338"
// and "BID-RFI-338" (lessons mined from the bid log write it the second way);
// "BID-032" and "032" stay apart.
export function rfiKey(project: unknown, number: unknown): string {
  const n = String(number ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/RFI/g, "").replace(/^([A-Z]*)0+(?=\d)/, "$1");
  return String(project ?? "").trim().toUpperCase() + "#" + n;
}

export type LessonRow = { project_id?: string | null; status?: string | null; linked_records?: unknown; source_reference?: string | null };

// The RFIs a lesson already covers. linked_records is the reliable record
// ([{type:"rfi", project, rfi_id}]); a lesson on the same project whose source
// text names the number counts too, because hand-saved lessons carry no links.
// Rejected and archived lessons cover nothing.
export function coveredRfiKeys(lessons: LessonRow[]): { linked: Set<string>; sourceText: Map<string, string> } {
  const linked = new Set<string>();
  const sourceText = new Map<string, string>();
  for (const l of lessons ?? []) {
    if (l.status === "rejected" || l.status === "archived") continue;
    const links = Array.isArray(l.linked_records) ? l.linked_records : [];
    for (const x of links as any[]) {
      if (!x || String(x.type ?? "").toLowerCase() !== "rfi") continue;
      const num = x.rfi_id ?? x.number ?? x.id;
      const proj = x.project ?? l.project_id;
      if (num && proj) linked.add(rfiKey(proj, num));
    }
    const p = String(l.project_id ?? "").trim().toUpperCase();
    if (p && l.source_reference) sourceText.set(p, (sourceText.get(p) ?? "") + "\n" + String(l.source_reference).toUpperCase());
  }
  return { linked, sourceText };
}

function namedInSource(text: string | undefined, number: string): boolean {
  if (!text) return false;
  const n = String(number).toUpperCase().trim();
  if (!n) return false;
  const digits = n.replace(/^RFI[\s#-]*/, "").replace(/^0+(?=.)/, "");
  // "RFI 19", "RFI-019", "RFI #19" or the whole stored number as a token.
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("\\bRFI[\\s#-]*0*" + esc(digits) + "\\b").test(text)
    || (/[A-Z]/.test(n.replace(/^RFI/, "")) && new RegExp("(^|[^A-Z0-9])" + esc(n) + "([^A-Z0-9]|$)").test(text));
}

export const LESSON_GROUP_ITEMS = 12;

export function lessonCandidates(tags: RootCauseRow[], lessons: LessonRow[], opts: { groupLimit?: number; itemsPerGroup?: number } = {}) {
  const { linked, sourceText } = coveredRfiKeys(lessons);
  const groups = new Map<string, { qaItem: string | null; cause: string | null; rfis: RootCauseRow[]; projects: Set<string> }>();
  let preventable = 0, covered = 0;
  for (const t of tags ?? []) {
    if (!t.preventable) continue;
    preventable++;
    if (linked.has(rfiKey(t.project, t.item_number)) || namedInSource(sourceText.get(String(t.project).trim().toUpperCase()), t.item_number)) { covered++; continue; }
    const key = t.qa_item ? "item:" + t.qa_item : "cause:" + t.cause;
    const g = groups.get(key) ?? { qaItem: t.qa_item || null, cause: t.qa_item ? null : t.cause, rfis: [], projects: new Set<string>() };
    g.rfis.push(t); g.projects.add(t.project);
    groups.set(key, g);
  }
  const perGroup = Math.max(1, opts.itemsPerGroup ?? LESSON_GROUP_ITEMS);
  const all = [...groups.values()]
    // A pattern seen on several projects first: that is what a firm lesson is for.
    .sort((a, b) => b.projects.size - a.projects.size || b.rfis.length - a.rfis.length
      || String(a.qaItem ?? a.cause).localeCompare(String(b.qaItem ?? b.cause)))
    .map((g) => ({
      ...(g.qaItem ? { qaItem: g.qaItem } : { noChecklistItem: true, cause: g.cause }),
      rfis: g.rfis.length, projects: g.projects.size,
      items: g.rfis.slice(0, perGroup).map((r) => ({
        project: r.project, number: r.item_number, cause: r.cause,
        ...(r.subject ? { subject: String(r.subject).slice(0, 120) } : {}),
        ...(r.note ? { note: r.note } : {}),
      })),
      ...(g.rfis.length > perGroup ? { moreNotShown: g.rfis.length - perGroup } : {}),
    }));
  const lim = Math.max(1, opts.groupLimit ?? 10);
  return {
    preventable, alreadyInALesson: covered, withoutALesson: preventable - covered,
    groups: all.slice(0, lim), groupsTotal: all.length,
  };
}

// ── What to get right in design: the RFI log, read forward ───────────────────
// A QA review reads the root-cause tags at the end of design. The cheaper time
// to use them is the start: a project briefing on a job still in design carries
// the checks that cost the firm the most RFIs on jobs like it. "Like it" means
// the same owner and the same kind of work (renovation or new construction);
// both are weighted above the firm-wide count, and the answer says which
// applied, because a list that looks tailored and is not would mislead.

export type WorkKind = "renovation" | "new";
// projectType reads like "Type IV Renovation" or "Type II New Construction".
export function workKindOf(projectType: unknown): WorkKind | null {
  const t = String(projectType ?? "").toLowerCase();
  if (/renovat|alterat|fit[- ]?out|upgrade|retrofit/.test(t)) return "renovation";
  if (/new\s+construction|new\s+build|addition/.test(t)) return "new";
  return null;
}

export type ProjectMeta = { projectNumber: string; owner?: string | null; projectType?: string | null };
const ownerKey = (v: unknown) => String(v ?? "").trim().toLowerCase();

export const WATCHLIST_MAX = 8;

export function designWatchlist(
  tags: RootCauseRow[], projects: ProjectMeta[], self: ProjectMeta, opts: { max?: number } = {},
) {
  const meta = new Map(projects.map((p) => [String(p.projectNumber), p]));
  const kind = workKindOf(self.projectType);
  const owner = ownerKey(self.owner);
  type Row = { qaItem: string; rfis: number; projects: Set<string>; sameKind: number; sameOwner: number; example: string | null; exampleScore: number };
  const by = new Map<string, Row>();
  let considered = 0;
  for (const t of tags ?? []) {
    if (!t.preventable || !t.qa_item) continue;
    if (String(t.project) === String(self.projectNumber)) continue;   // its own log is not a forecast
    considered++;
    const m = meta.get(String(t.project));
    const isKind = !!kind && workKindOf(m?.projectType) === kind;
    const isOwner = !!owner && ownerKey(m?.owner) === owner;
    const r = by.get(t.qa_item) ?? { qaItem: t.qa_item, rfis: 0, projects: new Set<string>(), sameKind: 0, sameOwner: 0, example: null, exampleScore: -1 };
    r.rfis++; r.projects.add(String(t.project));
    if (isKind) r.sameKind++;
    if (isOwner) r.sameOwner++;
    // The example a designer reads should come from the most similar job that
    // has a real description, not a subject line.
    const note = String(t.note ?? "").trim();
    if (note && !/subject only/i.test(note)) {
      const sc = (isOwner ? 2 : 0) + (isKind ? 1 : 0);
      if (sc > r.exampleScore) { r.example = note.slice(0, 220); r.exampleScore = sc; }
    }
    by.set(t.qa_item, r);
  }
  const rows = [...by.values()];
  const anyOwner = rows.some((r) => r.sameOwner > 0);
  const anyKind = rows.some((r) => r.sameKind > 0);
  const score = (r: Row) => r.sameOwner * 3 + r.sameKind * 2 + r.rfis;
  const items = rows
    .sort((a, b) => score(b) - score(a) || b.projects.size - a.projects.size || a.qaItem.localeCompare(b.qaItem))
    .slice(0, Math.max(1, opts.max ?? WATCHLIST_MAX))
    .map((r) => ({
      qaItem: r.qaItem, preventableRfis: r.rfis, projects: r.projects.size,
      ...(anyKind ? { onSameKindOfWork: r.sameKind } : {}),
      ...(anyOwner ? { forSameOwner: r.sameOwner } : {}),
      ...(r.example ? { example: r.example } : {}),
    }));
  return {
    basis: {
      kindOfWork: kind,                          // null: projectType does not say
      ...(kind ? { rfisOnSameKindOfWork: rows.reduce((n, r) => n + r.sameKind, 0) } : {}),
      owner: self.owner || null,
      ...(owner ? { rfisForSameOwner: rows.reduce((n, r) => n + r.sameOwner, 0) } : {}),
      preventableRfisConsidered: considered,
    },
    items,
  };
}

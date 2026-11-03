// The closeout checklist as the connector reports it. The record is
// project.closeout.items, written by the PMS "Closeout" tab on jobs where
// Setty is prime; the rules (statuses, who holds each item, progress) come
// from closeout.js, a byte-identical copy of the repo-root module the PMS
// loads (closeoutDrift.test.mjs keeps them in step).
//
// Pure: a project blob in, plain objects out. Read-only: the connector never
// changes closeout items (a person receives and accepts them in the PMS).
import {
  CATEGORIES as CATEGORIES_JS, progress as progressJs, ballInCourt as ballInCourtJs,
  isOverdue as isOverdueJs, isDone as isDoneJs, outstandingForContractor as outstandingJs,
} from "./closeout.js";

const CATEGORIES = CATEGORIES_JS as string[];
const progress = progressJs as (items: any[], today: string) => any;
const ballInCourt = ballInCourtJs as (i: any, subs?: any[]) => { who: string; label: string };
const isOverdue = isOverdueJs as (i: any, today: string) => boolean;
const isDone = isDoneJs as (i: any) => boolean;
const outstandingForContractor = outstandingJs as (items: any[]) => any[];

export function closeoutItemsOf(p: any): any[] {
  const items = p?.closeout?.items;
  return Array.isArray(items) ? items.filter((i: any) => i && typeof i === "object") : [];
}
const catOrder = (c: string) => { const k = CATEGORIES.indexOf(c); return k < 0 ? 99 : k; };
const sortItems = (a: any, b: any) => catOrder(a.category) - catOrder(b.category)
  || String(a.discipline || "").localeCompare(String(b.discipline || "")) || String(a.title || "").localeCompare(String(b.title || ""));
const label = (i: any) => `${i.title || "Untitled"} (${i.status})`;

function progressOut(items: any[], today: string) {
  const pr = progress(items, today);
  return {
    requiredItems: pr.required, accepted: pr.accepted, pctAccepted: pr.pct, outstanding: pr.outstanding,
    withContractor: pr.withContractor, withSettyOrSub: pr.inReview, overdue: pr.overdue,
    byStatus: pr.byStatus, readyForFinalCompletion: pr.readyForFinal,
  };
}

// The compact block for get_project / project_briefing. null when the
// checklist has not been started (absence is not a finding).
export function closeoutSummary(p: any, today: string) {
  const items = closeoutItemsOf(p);
  if (!items.length) return null;
  const subs = p?.subconsultants ?? [];
  return {
    startedAt: p?.closeout?.startedAt || null,
    progress: progressOut(items, today),
    owedByContractor: outstandingForContractor(items).slice(0, 15).map(label),
    withSetty: items.filter((i) => ballInCourt(i, subs).who === "setty").sort(sortItems).slice(0, 10).map(label),
    overdue: items.filter((i) => isOverdue(i, today)).sort(sortItems).slice(0, 10)
      .map((i) => ({ item: label(i), dueDate: i.dueDate, ballInCourt: ballInCourt(i, subs).label || null })),
    note: "Summarized — use list_closeout_items for every item with its dates, comments and history.",
  };
}

export type CloseoutFilters = { category?: string; status?: string; openOnly?: boolean; query?: string; includeHistory?: boolean };
// The whole checklist, filtered, with progress on top.
export function listCloseout(p: any, f: CloseoutFilters, today: string) {
  const all = closeoutItemsOf(p);
  const subs = p?.subconsultants ?? [];
  const q = String(f.query ?? "").trim().toLowerCase();
  const cat = String(f.category ?? "").trim().toLowerCase();
  const items = all
    .filter((i) => !cat || String(i.category || "").toLowerCase() === cat || String(i.category || "").toLowerCase().startsWith(cat))
    .filter((i) => !f.status || String(i.status).toLowerCase() === String(f.status).toLowerCase())
    .filter((i) => !f.openOnly || !isDone(i))
    .filter((i) => !q || [i.title, i.category, i.specSection, i.discipline, i.responsible, i.comments, i.notes].join(" ").toLowerCase().includes(q))
    .sort(sortItems);
  return {
    count: items.length, progress: progressOut(all, today),
    items: items.map((i) => {
      const ball = ballInCourt(i, subs);
      const sub = subs.find((s: any) => s.id === i.reviewerSubId);
      return {
        category: i.category || "Other", item: i.title || null, status: i.status,
        required: i.required !== false, ballInCourt: ball.who === "none" ? null : ball.label,
        ...(i.specSection ? { specSection: i.specSection } : {}),
        ...(i.discipline ? { discipline: i.discipline } : {}),
        ...(i.responsible ? { responsible: i.responsible } : {}),
        dueDate: i.dueDate || null, ...(isOverdue(i, today) ? { overdue: true } : {}),
        received: i.dateReceived || null, accepted: i.dateAccepted || null,
        ...(sub ? { reviewedBySub: sub.firm || sub.name || null } : {}),
        ...(i.comments ? { reviewComments: i.comments } : {}),
        ...(i.notes ? { internalNotes: i.notes } : {}),
        ...(i.spFolderUrl ? { documentsFolder: i.spFolderUrl } : {}),
        ...(f.includeHistory ? { history: (i.history || []).map((h: any) => ({ at: h.at || null, status: h.status, from: h.from || null, by: h.by || null, note: h.note || null })) } : {}),
      };
    }),
  };
}

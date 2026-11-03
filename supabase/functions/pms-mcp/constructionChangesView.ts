// Construction changes (ASI / PR / CCD / COR / CO) as the connector reports
// them. The record is project.constructionChanges, written by the PMS
// "Construction Changes" tab on jobs where Setty is prime; the rules (status
// sets, ball in court, running totals) come from constructionChanges.js, a
// byte-identical copy of the repo-root module the PMS loads
// (constructionChangesDrift.test.mjs keeps them in step).
//
// Pure: a project blob in, plain objects out. Read-only: the connector never
// writes construction changes (they are the official record and a person
// issues them).
import {
  KINDS as KINDS_JS, KIND_LABEL as KIND_LABEL_JS, changeTotals as changeTotalsJs, ballInCourt as ballInCourtJs,
  isDone as isDoneJs, money as moneyJs, days as daysJs,
} from "./constructionChanges.js";

const KINDS = KINDS_JS as string[];
const KIND_LABEL = KIND_LABEL_JS as Record<string, string>;
const changeTotals = changeTotalsJs as (p: any) => any;
const ballInCourt = ballInCourtJs as (c: any) => { who: string; label: string };
const isDone = isDoneJs as (c: any) => boolean;
const money = moneyJs as (v: any) => number | null;
const days = daysJs as (v: any) => number | null;

const strip = (h: unknown) => String(h ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
const numberValue = (n: unknown) => { const m = String(n ?? "").match(/(\d+)(?:\.\d+)?\s*$/); return m ? parseInt(m[1], 10) : 0; };
const sortChanges = (a: any, b: any) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || numberValue(a.number) - numberValue(b.number);

export function changesOf(p: any): any[] {
  return Array.isArray(p?.constructionChanges) ? p.constructionChanges.filter((c: any) => c && KINDS.includes(c.kind)) : [];
}
export function isSettyPrime(p: any): boolean {
  return /setty/i.test(String(p?.prime ?? ""));
}
// Overdue = has a due date before `today`, not done, and the ball is not
// with nobody. A CO out for signature past its date counts (the owner owes it).
function overdue(c: any, today: string): boolean {
  return !!c.dueDate && String(c.dueDate).slice(0, 10) < today && !isDone(c);
}

function totalsOut(p: any) {
  const t = changeTotals(p);
  return {
    contractor: p?.constructionContract?.contractor || null,
    originalContract: t.original, approvedChanges: t.approved, approvedChangeOrders: t.approvedCount, revisedContract: t.revised,
    pending: t.pending, pendingBreakdown: { changeOrdersOutForSignature: t.pendingCo, openCCDs: t.ccdOpen, openCORs: t.corOpen, openCORCount: t.corOpenCount },
    projectedContract: t.projected, pctApproved: t.pctApproved, pctProjected: t.pctProjected,
    contractDays: { original: t.originalDays, approved: t.approvedDays, revised: t.revisedDays },
    ...(t.original ? {} : { note: "No original contract sum is set on the project, so percentages are unavailable." }),
  };
}

// The compact block for get_project / project_briefing. null when the project
// has no change documents (absence is not a finding).
export function changeSummary(p: any, today: string) {
  const all = changesOf(p);
  if (!all.length) return null;
  const byKind: Record<string, { total: number; open: number }> = {};
  for (const k of KINDS) {
    const of = all.filter((c) => c.kind === k);
    if (of.length) byKind[k] = { total: of.length, open: of.filter((c) => !isDone(c)).length };
  }
  const ref = (c: any) => `${c.number}${c.title ? " — " + c.title : ""} (${c.status})`;
  return {
    count: all.length, open: all.filter((c) => !isDone(c)).length, byKind,
    totals: totalsOut(p),
    withSetty: all.filter((c) => ballInCourt(c).who === "setty").sort(sortChanges).slice(0, 10).map(ref),
    overdue: all.filter((c) => overdue(c, today)).sort(sortChanges).slice(0, 10)
      .map((c) => ({ item: ref(c), dueDate: c.dueDate, ballInCourt: ballInCourt(c).label || null })),
    note: "Summarized — use list_construction_changes / read_construction_change for detail.",
  };
}

function row(c: any, byId: Map<string, any>, today: string) {
  const ball = ballInCourt(c);
  const co = c.coId ? byId.get(c.coId) : null;
  return {
    number: c.number, type: c.kind, typeLabel: KIND_LABEL[c.kind], title: c.title || null, status: c.status,
    ballInCourt: ball.who === "none" ? null : ball.label, date: c.date || null, dueDate: c.dueDate || null,
    ...(overdue(c, today) ? { overdue: true } : {}),
    ...(c.contractorRef ? { contractorRef: c.contractorRef } : {}),
    ...(c.discipline ? { discipline: c.discipline } : {}),
    ...(c.kind === "COR" ? { requested: money(c.amountRequested), requestedDays: days(c.daysRequested), recommended: money(c.amountRecommended), recommendedDays: days(c.daysRecommended) } : {}),
    ...(["PR", "CCD"].includes(c.kind) && money(c.amountEstimate) != null ? { estimate: money(c.amountEstimate) } : {}),
    ...(["CO", "CCD"].includes(c.kind) && money(c.amountApproved) != null ? { approved: money(c.amountApproved), approvedDays: days(c.daysApproved) } : {}),
    ...(co ? { inChangeOrder: co.number } : {}),
    ...((c.sourceIds || []).length ? { linked: (c.sourceIds || []).map((id: string) => byId.get(id)?.number).filter(Boolean) } : {}),
  };
}

export type ChangeFilters = { type?: string; status?: string; openOnly?: boolean; query?: string };
// The log, filtered, with the running totals on top.
export function listChanges(p: any, f: ChangeFilters, today: string) {
  const all = changesOf(p);
  const byId = new Map(all.map((c) => [c.id, c]));
  const q = String(f.query ?? "").trim().toLowerCase();
  const items = all
    .filter((c) => !f.type || c.kind === String(f.type).toUpperCase())
    .filter((c) => !f.status || String(c.status).toLowerCase() === String(f.status).toLowerCase())
    .filter((c) => !f.openOnly || !isDone(c))
    .filter((c) => !q || [c.number, c.title, c.contractorRef, c.discipline, c.sheets, strip(c.description), c.notes].join(" ").toLowerCase().includes(q))
    .sort(sortChanges);
  return { count: items.length, totals: totalsOut(p), items: items.map((c) => row(c, byId, today)) };
}

// One document in full: description, links both ways, related RFIs, history.
export function readChange(p: any, number: string, today: string) {
  const all = changesOf(p);
  const want = String(number ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const c = all.find((x) => String(x.number).toUpperCase() === want)
    ?? all.find((x) => String(x.id) === String(number))
    // "COR 4" / "cor-4" / "COR-0004" → COR-004
    ?? (() => { const m = want.match(/^([A-Z]+)-?0*(\d+)$/); return m ? all.find((x) => x.kind === m[1] && numberValue(x.number) === +m[2]) : undefined; })();
  if (!c) return null;
  const byId = new Map(all.map((x) => [x.id, x]));
  const brief = (x: any) => ({ number: x.number, type: x.kind, title: x.title || null, status: x.status });
  const rfis = new Map(((p?.rfis ?? []) as any[]).map((r) => [r.id, r]));
  const sub = (p?.subconsultants ?? []).find((s: any) => s.id === c.subAssigned);
  return {
    ...row(c, byId, today),
    description: strip(c.description) || null,
    affectedSheets: c.sheets || null,
    internalNotes: c.notes ? strip(c.notes) : null,
    ...(sub ? { subconsultantReviewingPricing: sub.firm || sub.name || null } : {}),
    linkedDocuments: (c.sourceIds || []).map((id: string) => byId.get(id)).filter(Boolean).map(brief),
    referencedBy: all.filter((x) => (x.sourceIds || []).includes(c.id) || x.coId === c.id).map(brief),
    ...(c.kind === "CO" ? { includes: all.filter((x) => x.coId === c.id).map((x) => ({ ...brief(x), amount: x.kind === "COR" ? (money(x.amountRecommended) ?? money(x.amountRequested)) : (money(x.amountApproved) ?? money(x.amountEstimate)) })) } : {}),
    relatedRFIs: (c.relatedRfiIds || []).map((id: string) => rfis.get(id)).filter(Boolean)
      .map((r: any) => ({ number: r.number, title: r.title || null, status: r.status || null })),
    documentsFolder: c.spFolderUrl || null,
    history: (c.history || []).map((h: any) => ({ at: h.at || null, status: h.status, from: h.from || null, by: h.by || null, note: h.note || null })),
  };
}

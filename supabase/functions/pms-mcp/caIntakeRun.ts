// One pass of the scheduled portal-email intake (admin/ca-items-intake).
// Step 2 of PROPOSAL-portal-email-intake.md. I/O is injected so the loop can
// be tested without Supabase (caIntakeRun.test.mjs); the route in index.ts
// wires it to PostgREST and updateProjectRecord.
//
// Per run:
//   1. find the projects with a portal email on or after `since`;
//   2. for each, read ALL its portal emails (an item's full history builds its
//      status, question and received date) and, inside the version-guarded
//      write, plan the append against the project as it is NOW (planIntake);
//   3. append only NEW items, marked intakeReviewed:false. Nothing existing is
//      edited, so a PM with the project open merges the additions silently
//      (the PMS 3-way merge takes cloud-added array items without a prompt).
// A version race fails that project for this run; the next run retries it
// (the plan is idempotent by record id).
import { planIntake as planIntakeJs, applyStatusUpdates as applyStatusUpdatesJs } from "./caIntake.js";

// caIntake.js is plain JS shared with the browser; give its result a shape here.
type IntakeRecord = { id: string; number: string; title?: string; description?: string; status: string; [k: string]: unknown };
type IntakeUpdate = { kind: "rfi" | "submittal"; id: string; number: string; from: string; to: string; patch: Record<string, unknown>; intakeStatus: Record<string, unknown> };
type IntakePlan = { rfis: IntakeRecord[]; submittals: IntakeRecord[]; updates: IntakeUpdate[]; skipped: { matched: number; update: number; old: number } };
const planIntake = planIntakeJs as (emails: any[], project: any, pid: string, opts: { vendors: string[]; since: string; at: string; updates?: boolean }) => IntakePlan;
const applyStatusUpdates = applyStatusUpdatesJs as (project: any, updates: IntakeUpdate[]) => { rfis: any[]; submittals: any[]; applied: number };

export const CA_STATUS = "In Construction Administration";

export type IntakeDeps = {
  since: string;                                   // YYYY-MM-DD
  at: string;                                      // ISO timestamp stamped on new records
  vendors: string[];                               // caIntake VENDORS names, e.g. ["Procore"]
  dryRun: boolean;
  statusUpdates?: boolean;                         // default true: move logged items forward on closing events
  budgetMs: number;
  maxProjects: number;
  now: () => number;
  recentProjectIds: (sinceIso: string) => Promise<string[]>;
  emailsFor: (pid: string) => Promise<any[]>;
  // Version-guarded read-modify-write; mutate returns the SAME object for "no change".
  writeProject: (pid: string, mutate: (proj: any) => any) => Promise<unknown>;
  log?: (msg: string) => void;
};

export type IntakeItem = { project: string; kind: "rfi" | "submittal"; number: string; title: string; status: string };
export type IntakeStatusChange = { project: string; kind: "rfi" | "submittal"; number: string; from: string; to: string };
export type IntakeSummary = {
  since: string; dryRun: boolean; projectsWithMail: number; projectsChecked: number;
  notInCA: number; created: { rfi: number; submittal: number }; items: IntakeItem[];
  updated: { rfi: number; submittal: number }; statusChanges: IntakeStatusChange[];
  skipped: { matched: number; update: number; old: number }; failed: { project: string; error: string }[];
  stoppedEarly?: boolean; ms: number;
};

export async function runIntakePass(d: IntakeDeps): Promise<IntakeSummary> {
  const t0 = d.now();
  const s: IntakeSummary = {
    since: d.since, dryRun: d.dryRun, projectsWithMail: 0, projectsChecked: 0, notInCA: 0,
    created: { rfi: 0, submittal: 0 }, items: [], updated: { rfi: 0, submittal: 0 }, statusChanges: [],
    skipped: { matched: 0, update: 0, old: 0 }, failed: [], ms: 0,
  };
  const pids = [...new Set(await d.recentProjectIds(d.since + "T00:00:00Z"))].sort();
  s.projectsWithMail = pids.length;
  for (const pid of pids.slice(0, d.maxProjects)) {
    if (d.now() - t0 > d.budgetMs) { s.stoppedEarly = true; break; }
    s.projectsChecked++;
    try {
      const emails = await d.emailsFor(pid);
      let plan: IntakePlan | null = null;
      let label = pid;
      await d.writeProject(pid, (proj: any) => {
        label = proj?.projectNumber || proj?.name || pid;
        // Same scope as the tracker's picker: CA jobs only, never archived ones.
        if ((proj?.status || "") !== CA_STATUS || proj?.archived === true || proj?.archived === "true") { s.notInCA++; return proj; }
        plan = planIntake(emails, proj, pid, { vendors: d.vendors, since: d.since, at: d.at, updates: d.statusUpdates !== false });
        if (d.dryRun || (!plan.rfis.length && !plan.submittals.length && !plan.updates.length)) return proj;
        const upd = applyStatusUpdates(proj, plan.updates);
        return { ...proj, rfis: [...upd.rfis, ...plan.rfis], submittals: [...upd.submittals, ...plan.submittals] };
      });
      const p = plan as IntakePlan | null;
      if (!p) continue;
      for (const k of ["matched", "update", "old"] as const) s.skipped[k] += p.skipped[k];
      for (const [kind, recs] of [["rfi", p.rfis], ["submittal", p.submittals]] as const) {
        s.created[kind] += recs.length;
        for (const r of recs) s.items.push({ project: label, kind, number: r.number, title: r.title || r.description || "", status: r.status });
      }
      for (const u of p.updates) {
        s.updated[u.kind]++;
        s.statusChanges.push({ project: label, kind: u.kind, number: u.number, from: u.from, to: u.to });
      }
    } catch (e) {
      const error = String((e as any)?.message ?? e);
      s.failed.push({ project: pid, error });
      d.log?.(`${pid}: ${error}`);
    }
  }
  if (!s.stoppedEarly && pids.length > d.maxProjects) s.stoppedEarly = true;
  s.ms = Math.round(d.now() - t0);
  return s;
}

// YYYY-MM-DD `days` before `nowMs` (UTC).
export function intakeSince(nowMs: number, days: number): string {
  return new Date(nowMs - days * 86400000).toISOString().slice(0, 10);
}

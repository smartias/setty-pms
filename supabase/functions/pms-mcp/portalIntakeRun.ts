// One pass of the scheduled client-portal intake (admin/portal-ca-intake).
// Step 2 of PROPOSAL-portal-ca-exchange.md: on jobs where Setty is prime the
// contractor drops a filled form workbook (portalFormSpec.js) into the
// portal's RFIs/ or Submittals/ folder; this reads those folders and logs
// each new form as an RFI or submittal marked intakeReviewed:false, so the
// PMS shows it as Unreviewed until a person confirms discipline and assignee.
//
// I/O is injected so the loop can be tested without Graph or Supabase
// (portalIntakeRun.test.mjs); the route in index.ts wires it to Graph and
// updateProjectRecord.
//
// Per project (opted in by project.portalIntake, which the PMS writes when
// the folders are planted):
//   1. read the project once (a no-op mutate) for what is already logged;
//   2. list each folder; a candidate is an .xlsx that is not the blank
//      template, not an Excel lock file, modified within `recentDays`, not
//      already logged (by file id) and not already recorded as skipped for
//      this same modification;
//   3. download and read each candidate by its defined names;
//   4. inside the version-guarded write, append the complete ones with the
//      next RFI / SUB number (the prime's own numbering, high-water mark
//      bumped) and record the incomplete ones under portalIntake.skipped so
//      they are not downloaded again until the contractor saves the file.
// Append-only: nothing already logged is edited. A version race fails that
// project for this run; the next run retries (the plan is idempotent by id).
import { readFormParts as readFormPartsJs, PORTAL_INTAKE_KINDS as KINDS_JS, PORTAL_FORM_FIELDS as FIELDS_JS } from "./portalFormSpec.js";
import { nextCaNumber as nextCaNumberJs, bumpHighWater as bumpHighWaterJs, addWorkdays as addWorkdaysJs } from "./primeCa.js";
import { inferDiscipline as inferDisciplineJs } from "./caIntake.js";

type Kind = "rfi" | "submittal";
type FormRead = { kind: Kind | null; fields: Record<string, string>; missing: string[] };
const readFormParts = readFormPartsJs as (parts: unknown) => FormRead;
const KINDS = KINDS_JS as Record<Kind, { folder: string; formFile: string; readmeFile: string; title: string; noun: string }>;
const FIELDS = FIELDS_JS as Record<Kind, { name: string; label: string; required?: boolean; type: string }[]>;
const nextCaNumber = nextCaNumberJs as (items: any[], type: Kind, highWater: unknown) => { number: string; value: number };
const bumpHighWater = bumpHighWaterJs as (project: any, type: Kind, value: number) => Record<string, number>;
const addWorkdays = addWorkdaysJs as (day: string, n: number) => string;
const inferDiscipline = inferDisciplineJs as (it: { specSection?: string; title?: string; question?: string }, kind: Kind) => string;

export const PORTAL_INTAKE_BY = "portal-ca-intake";
export const PORTAL_VENDOR = "Client portal";

export type PortalFile = { id: string; name: string; webUrl: string; lastModified: string; size?: number; driveId?: string };
export type PortalProject = { pid: string; rfisUrl: string; submittalsUrl: string };
export type PortalIntakeDeps = {
  at: string;                       // ISO timestamp stamped on new records
  dryRun: boolean;
  budgetMs: number;
  maxProjects: number;
  recentDays: number;               // only forms modified within this many days
  now: () => number;
  projects: () => Promise<PortalProject[]>;
  listForms: (folderUrl: string) => Promise<{ folderWebUrl: string; files: PortalFile[] }>;
  readForm: (file: PortalFile) => Promise<unknown>;   // unzipped parts: Map or {path: bytes}
  // Version-guarded read-modify-write; mutate returns the SAME object for "no change".
  writeProject: (pid: string, mutate: (proj: any) => any) => Promise<unknown>;
  log?: (msg: string) => void;
};

export type PortalIntakeItem = { project: string; kind: Kind; number: string; title: string; file: string };
export type PortalIntakeSummary = {
  at: string; dryRun: boolean; projects: number; projectsChecked: number; archived: number;
  created: { rfi: number; submittal: number }; items: PortalIntakeItem[];
  skipped: { seen: number; old: number; notForm: number; incomplete: number; template: number };
  incomplete: { project: string; kind: Kind; file: string; missing: string[] }[];
  failed: { project: string; error: string }[];
  stoppedEarly?: boolean; ms: number;
};

const isXlsx = (name: string) => /\.xlsx$/i.test(name) && !/^~\$/.test(name);
const dayOf = (iso: string) => String(iso || "").slice(0, 10);

// Which file ids are already items on the project (by intake.driveItemId).
export function loggedFileIds(proj: any): Set<string> {
  const ids = new Set<string>();
  for (const arr of [proj?.rfis, proj?.submittals]) {
    for (const it of Array.isArray(arr) ? arr : []) {
      const id = it?.intake?.driveItemId;
      if (id) ids.add(String(id));
    }
  }
  return ids;
}

// The record a complete form becomes. `number` is assigned by the caller
// inside the write (it depends on the project as it is then).
export function portalRecordFor(kind: Kind, read: FormRead, file: PortalFile, folderWebUrl: string, proj: any, pid: string, number: string, at: string) {
  const f = read.fields;
  const received = dayOf(file.lastModified) || dayOf(at);
  const contractor = [f.SubmittedBy, f.Email].filter(Boolean).join(" · ");
  const noteBits = [`Submitted through the client portal · form "${file.name}"`];
  if (f.ContractorNumber) noteBits.push(`contractor's number ${f.ContractorNumber}`);
  if (f.Email) noteBits.push(`reply to ${f.Email}`);
  const intake = {
    at, by: PORTAL_INTAKE_BY, vendor: PORTAL_VENDOR,
    driveItemId: file.id, formName: file.name, formUrl: file.webUrl, formModified: file.lastModified || "",
  };
  const base = {
    id: `portal-${kind}-${pid}-${file.id}`, number, from: contractor, assignedTo: [], subAssigned: "",
    dateReceived: received, spFolderUrl: folderWebUrl || "", links: [],
    source: "portal", extNumber: f.ContractorNumber || "", contractorEmail: f.Email || "",
    intakeReviewed: false, intake,
  };
  if (kind === "rfi") {
    if (f.CostImpact === "Yes") noteBits.push("cost impact: yes");
    if (f.ScheduleImpact === "Yes") noteBits.push("schedule impact: yes");
    if (f.Attachments) noteBits.push(`attachments: ${f.Attachments}`);
    return {
      ...base, title: f.Subject || "", description: (f.Question || "").slice(0, 4000),
      discipline: inferDiscipline({ specSection: f.SpecSection, title: f.Subject, question: f.Question }, "rfi"),
      dueDate: f.DateNeeded || addWorkdays(received, +proj?.rfiDueDays || 5),
      dateResponded: "", response: "", status: "Open", notes: noteBits.join(" · "),
      specSection: f.SpecSection || "",
    };
  }
  if (f.Attachments) noteBits.push(`attachments: ${f.Attachments}`);
  const rev = parseInt(String(f.Revision || "0"), 10);
  return {
    ...base, specSection: f.SpecSection || "",
    description: [f.Subject, f.Manufacturer].filter(Boolean).join(" — ").slice(0, 400),
    discipline: inferDiscipline({ specSection: f.SpecSection, title: f.Subject }, "submittal"),
    dueDate: f.DateNeeded || addWorkdays(received, +proj?.submittalDueDays || 10),
    dateReturned: "", comments: "", status: "Received", stamp: "—", resubNumber: Number.isFinite(rev) ? rev : 0,
    notes: noteBits.join(" · "), registerItemId: "",
  };
}

export async function runPortalIntakePass(d: PortalIntakeDeps): Promise<PortalIntakeSummary> {
  const t0 = d.now();
  const s: PortalIntakeSummary = {
    at: d.at, dryRun: d.dryRun, projects: 0, projectsChecked: 0, archived: 0,
    created: { rfi: 0, submittal: 0 }, items: [],
    skipped: { seen: 0, old: 0, notForm: 0, incomplete: 0, template: 0 },
    incomplete: [], failed: [], ms: 0,
  };
  const cutoff = new Date(Date.parse(d.at) - d.recentDays * 86400000).toISOString();
  const projects = await d.projects();
  s.projects = projects.length;
  for (const p of projects.slice(0, d.maxProjects)) {
    if (d.now() - t0 > d.budgetMs) { s.stoppedEarly = true; break; }
    s.projectsChecked++;
    try {
      // 1. what the project holds now (no-op mutate: the same object back).
      let snapshot: any = null;
      await d.writeProject(p.pid, (proj: any) => { snapshot = proj; return proj; });
      const label = snapshot?.projectNumber || snapshot?.name || p.pid;
      if (snapshot?.archived === true || snapshot?.archived === "true") { s.archived++; continue; }
      const logged = loggedFileIds(snapshot);
      const skippedBefore: Record<string, { lastModified?: string }> = (snapshot?.portalIntake?.skipped) || {};

      // 2. candidates per folder.
      type Cand = { kind: Kind; file: PortalFile; folderWebUrl: string };
      const cands: Cand[] = [];
      for (const kind of ["rfi", "submittal"] as Kind[]) {
        const url = kind === "rfi" ? p.rfisUrl : p.submittalsUrl;
        if (!url) continue;
        const { folderWebUrl, files } = await d.listForms(url);
        for (const f of files) {
          if (!isXlsx(f.name)) continue;
          if (f.name.toLowerCase() === KINDS[kind].formFile.toLowerCase()) { s.skipped.template++; continue; }
          if (logged.has(String(f.id))) { s.skipped.seen++; continue; }
          if ((f.lastModified || "") < cutoff) { s.skipped.old++; continue; }
          const prev = skippedBefore[String(f.id)];
          if (prev && (prev.lastModified || "") === (f.lastModified || "")) { s.skipped.incomplete++; continue; }
          cands.push({ kind, file: f, folderWebUrl });
        }
      }
      if (!cands.length) continue;

      // 3. read each candidate.
      type Read = Cand & { read: FormRead };
      const complete: Read[] = [];
      const skippedNow: Record<string, { name: string; reason: string; lastModified: string; at: string }> = {};
      for (const c of cands) {
        if (d.now() - t0 > d.budgetMs) { s.stoppedEarly = true; break; }
        const read = readFormParts(await d.readForm(c.file));
        if (!read.kind) { s.skipped.notForm++; skippedNow[c.file.id] = { name: c.file.name, reason: "not a portal form", lastModified: c.file.lastModified || "", at: d.at }; continue; }
        if (read.kind !== c.kind) {
          s.skipped.notForm++;
          skippedNow[c.file.id] = { name: c.file.name, reason: `a ${KINDS[read.kind].noun} form in the ${KINDS[c.kind].folder} folder`, lastModified: c.file.lastModified || "", at: d.at };
          continue;
        }
        if (read.missing.length) {
          s.skipped.incomplete++;
          s.incomplete.push({ project: label, kind: c.kind, file: c.file.name, missing: read.missing });
          skippedNow[c.file.id] = { name: c.file.name, reason: "missing: " + read.missing.join(", "), lastModified: c.file.lastModified || "", at: d.at };
          continue;
        }
        complete.push({ ...c, read });
      }
      if (!complete.length && !Object.keys(skippedNow).length) continue;

      // 4. the write, against the project as it is now.
      const added: PortalIntakeItem[] = [];
      await d.writeProject(p.pid, (proj: any) => {
        if (d.dryRun) {
          for (const c of complete) added.push({ project: label, kind: c.kind, number: "(dry run)", title: c.read.fields.Subject || "", file: c.file.name });
          return proj;
        }
        const have = loggedFileIds(proj);
        let next = { ...proj, rfis: [...(proj.rfis || [])], submittals: [...(proj.submittals || [])] };
        let changed = false;
        for (const c of complete) {
          if (have.has(String(c.file.id))) { s.skipped.seen++; continue; }
          const arrKey = c.kind === "rfi" ? "rfis" : "submittals";
          const num = nextCaNumber(next[arrKey], c.kind, (next.caNumberHighWater || {})[c.kind]);
          const rec = portalRecordFor(c.kind, c.read, c.file, c.folderWebUrl, proj, p.pid, num.number, d.at);
          next = { ...next, [arrKey]: [...next[arrKey], rec], caNumberHighWater: bumpHighWater(next, c.kind, num.value) };
          have.add(String(c.file.id));
          added.push({ project: label, kind: c.kind, number: num.number, title: c.kind === "rfi" ? rec.title : rec.description, file: c.file.name });
          changed = true;
        }
        const prevSkipped = (proj.portalIntake && proj.portalIntake.skipped) || {};
        const mergedSkipped: Record<string, unknown> = { ...prevSkipped };
        for (const [id, v] of Object.entries(skippedNow)) {
          if (JSON.stringify(prevSkipped[id]) !== JSON.stringify(v)) { mergedSkipped[id] = v; changed = true; }
        }
        // Forget skips for files that are now logged or gone from the folder listing.
        for (const id of Object.keys(mergedSkipped)) {
          if (have.has(id)) { delete mergedSkipped[id]; changed = true; }
        }
        if (!changed) return proj;
        return { ...next, portalIntake: { ...(proj.portalIntake || {}), skipped: mergedSkipped } };
      });
      for (const a of added) { s.created[a.kind]++; s.items.push(a); }
    } catch (e) {
      const error = String((e as any)?.message ?? e);
      s.failed.push({ project: p.pid, error });
      d.log?.(`${p.pid}: ${error}`);
    }
  }
  if (!s.stoppedEarly && projects.length > d.maxProjects) s.stoppedEarly = true;
  s.ms = Math.round(d.now() - t0);
  return s;
}

export const REQUIRED_FIELDS: Record<Kind, string[]> = {
  rfi: FIELDS.rfi.filter((f) => f.required).map((f) => f.name),
  submittal: FIELDS.submittal.filter((f) => f.required).map((f) => f.name),
};

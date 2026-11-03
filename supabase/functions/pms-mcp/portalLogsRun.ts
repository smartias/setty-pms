// One pass of the client-portal log refresh (rides admin/portal-ca-intake).
// Step 5 of PROPOSAL-portal-ca-exchange.md: "RFI Log.xlsx" and "Submittal
// Log.xlsx" in each portal project's Deliverables folder, regenerated from
// the project record whenever the record changed after the file was last
// written. The contractor's list view, for a contractor who only has a
// folder.
//
// Stateless on purpose: staleness is "the file's lastModifiedDateTime is
// older than pms_projects.updated_at" (the PMS stamps updated_at on every
// save; so does updateProjectRecord). Nothing is written back to the project,
// so a refresh never bumps the version under a PM who has the project open.
//
// I/O is injected so the loop can be tested without Graph or Supabase
// (portalLogsRun.test.mjs); the route in index.ts wires it up.
import { buildPortalLogParts as buildPartsJs, PORTAL_LOG_FILE as FILES_JS } from "./portalLogSpec.js";

type Kind = "rfi" | "submittal";
const buildPortalLogParts = buildPartsJs as (input: { project: any; type: Kind; generatedAt: string }) => [string, Uint8Array][];
const PORTAL_LOG_FILE = FILES_JS as Record<Kind, string>;

export type LogProject = { pid: string; deliverablesUrl: string; updatedAt: string };
export type PortalLogsDeps = {
  at: string;
  dryRun: boolean;
  budgetMs: number;
  now: () => number;
  projects: () => Promise<LogProject[]>;
  readProject: (pid: string) => Promise<any>;                       // the project jsonb
  logMeta: (folderUrl: string, fileName: string) => Promise<{ lastModified: string } | null>;
  writeLog: (folderUrl: string, fileName: string, parts: [string, Uint8Array][]) => Promise<void>;
  log?: (msg: string) => void;
};
export type PortalLogsSummary = {
  projects: number; checked: number; written: { project: string; file: string }[]; current: number;
  failed: { project: string; error: string }[]; stoppedEarly?: boolean; ms: number; dryRun: boolean;
};

const ms = (iso: string) => { const t = Date.parse(String(iso || "")); return Number.isFinite(t) ? t : 0; };

// Stale when the file is missing or older than the project's last save.
export function logIsStale(meta: { lastModified: string } | null, updatedAt: string): boolean {
  if (!meta) return true;
  return ms(meta.lastModified) < ms(updatedAt);
}

export async function runPortalLogsPass(d: PortalLogsDeps): Promise<PortalLogsSummary> {
  const t0 = d.now();
  const s: PortalLogsSummary = { projects: 0, checked: 0, written: [], current: 0, failed: [], ms: 0, dryRun: d.dryRun };
  const projects = (await d.projects()).filter((p) => p.deliverablesUrl);
  s.projects = projects.length;
  for (const p of projects) {
    if (d.now() - t0 > d.budgetMs) { s.stoppedEarly = true; break; }
    s.checked++;
    try {
      let proj: any = null;
      for (const type of ["rfi", "submittal"] as Kind[]) {
        const file = PORTAL_LOG_FILE[type];
        const meta = await d.logMeta(p.deliverablesUrl, file);
        if (!logIsStale(meta, p.updatedAt)) { s.current++; continue; }
        if (!proj) proj = await d.readProject(p.pid);
        if (proj?.archived === true || proj?.archived === "true") { s.current++; continue; }
        const label = proj?.projectNumber || proj?.name || p.pid;
        if (!d.dryRun) await d.writeLog(p.deliverablesUrl, file, buildPortalLogParts({ project: proj, type, generatedAt: d.at }));
        s.written.push({ project: label, file });
      }
    } catch (e) {
      const error = String((e as any)?.message ?? e);
      s.failed.push({ project: p.pid, error });
      d.log?.(`${p.pid}: ${error}`);
    }
  }
  s.ms = Math.round(d.now() - t0);
  return s;
}

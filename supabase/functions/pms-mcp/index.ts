// PMS MCP Server — read-only access to Setty PMS data for the team's
// enterprise Claude accounts. Runs as a Supabase Edge Function. Read-only.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { McpServer, StreamableHttpTransport } from "mcp-lite";
import { Hono } from "hono";
import { z } from "zod";
import pako from "pako";
import { jwtVerify, createRemoteJWKSet } from "jose";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function sbGet(path: string): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}
async function sbRpc(fn: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase rpc ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// PostgREST caps responses at 1000 rows; page past it.
const SB_PAGE = 1000;
async function sbGetAll(path: string): Promise<any[]> {
  const out: any[] = [];
  for (let offset = 0; ; offset += SB_PAGE) {
    const page = await sbGet(`${path}&limit=${SB_PAGE}&offset=${offset}`);
    if (!Array.isArray(page) || page.length === 0) break;
    out.push(...page);
    if (page.length < SB_PAGE) break;
  }
  return out;
}

let _projCache: { at: number; data: any[] } | null = null;
async function getProjects(): Promise<any[]> {
  const now = Date.now();
  if (_projCache && (now - _projCache.at) < 300000) return _projCache.data;
  // Reads EVERYTHING (active + archived). Archived state is the `archived` boolean
  // already inside each project blob (set by the PMS web app's Archive button), so
  // closed-out jobs stay fully searchable; individual tools decide whether to show them.
  // Pull ONLY the sub-fields the portfolio-wide tools use — EXCLUDING the fat emails[]
  // array (~53% of the blob; email tools query pms_project_emails directly). This halves
  // the cold-cache load (~18MB -> ~9MB). Single-project tools use getProjectById (full blob).
  // The identifying scalars below are pulled so a project can be found by how
  // someone DESCRIBES it ("the feasibility study with SCA for Morphosis")
  // rather than only by its own name. They are short strings, so they cost
  // almost nothing next to the arrays; emails[] is the field this projection
  // exists to keep out, and it stays out.
  const SLIM = "pid:project->>id,name:project->>name,projectNumber:project->>projectNumber," +
    "status:project->>status,owner:project->>owner,archived:project->archived," +
    "prime:project->>prime,clientName:project->>clientName,projectType:project->>projectType," +
    "projectCity:project->>projectCity,projectState:project->>projectState," +
    "buildingCategory:project->>buildingCategory,contractNumber:project->>contractNumber," +
    "primeProjectNumber:project->>primeProjectNumber," +
    "milestones:project->milestones,rfis:project->rfis,submittals:project->submittals,notes:project->notes";
  const rows = await sbGetAll("pms_projects?select=" + SLIM + "&order=id.asc");
  const data = rows.map((r: any) => ({
    id: r.pid, name: r.name, projectNumber: r.projectNumber, status: r.status,
    owner: r.owner, archived: r.archived === true,
    prime: r.prime, clientName: r.clientName, projectType: r.projectType,
    projectCity: r.projectCity, projectState: r.projectState,
    buildingCategory: r.buildingCategory, contractNumber: r.contractNumber,
    primeProjectNumber: r.primeProjectNumber,
    milestones: r.milestones ?? [], rfis: r.rfis ?? [], submittals: r.submittals ?? [], notes: r.notes ?? [],
  })).filter((p: any) => p.id || p.projectNumber || p.name);
  _projCache = { at: now, data };
  return data;
}

async function getProjectById(pid: string): Promise<any | null> {
  const rows = await sbGet("pms_projects?select=project&project->>id=eq." + encodeURIComponent(pid));
  return rows?.[0]?.project ?? null;
}

async function resolveProjectId(identifier: string): Promise<string | null> {
  const id = identifier.toLowerCase().trim();
  const rows = await sbGetAll("pms_projects?select=pid:project->>id,pn:project->>projectNumber,nm:project->>name&order=id.asc");
  const hit = (rows || []).find((r: any) =>
    [r.pid, r.pn, r.nm].filter(Boolean).some((f: string) => String(f).toLowerCase() === id));
  return hit?.pid ?? null;
}

const MAX_BODY_CHARS = 5000;
function decompressBody(b64: string): string {
  if (!b64) return "";
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return pako.inflate(bytes, { to: "string" });
  } catch { return ""; }
}
function htmlToText(html: string): string {
  return html
    .replace(new RegExp("<script[^>]*>[^]*?</script>", "gi"), " ")
    .replace(new RegExp("<style[^>]*>[^]*?</style>", "gi"), " ")
    .replace(new RegExp("<br[^>]*>", "gi"), "\n")
    .replace(new RegExp("</(p|div|tr|li|h[1-6])>", "gi"), "\n")
    .replace(new RegExp("<[^>]+>", "g"), " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'").replace(/&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/ +/g, " ").replace(/\n +/g, "\n")
    .trim();
}
function emailBody(r: any): string {
  let body = r.body_text || "";
  if (!body && r.body_html_compressed) body = htmlToText(decompressBody(r.body_html_compressed));
  return body.length > MAX_BODY_CHARS ? body.slice(0, MAX_BODY_CHARS) + "\n…[truncated]" : body;
}

const GRAPH_TENANT = Deno.env.get("GRAPH_TENANT_ID");
const GRAPH_CLIENT = Deno.env.get("GRAPH_CLIENT_ID");
const GRAPH_SECRET = Deno.env.get("GRAPH_CLIENT_SECRET");
const SP_SITE_ID = Deno.env.get("GRAPH_SITE_ID") ??
  "setty.sharepoint.com,aa580464-13e9-4eb4-8ad4-ca6ff5b9e001,c97a67e8-fb1b-4a23-a29a-753a5d57d410";
const DOC_LIBRARY = Deno.env.get("GRAPH_DOC_LIBRARY") ?? "Project Document Library";
const MAX_DOC_CHARS = 50000;
const MAX_DOC_BYTES = 20 * 1024 * 1024;
// Sheet extraction is a different bargain from read_document: it walks pages and
// returns a few structured fields per sheet, never the file body, so the 20MB
// bound above (which is about response size) is the wrong limit for it. Combined
// discipline books routinely run past it — Tabler's electrical book is 42MB.
const SHEET_MAX_BYTES = 64 * 1024 * 1024;
const SHEET_OVERSIZE_BUDGET = 96 * 1024 * 1024;

let _graphTok: { token: string; exp: number } | null = null;
async function graphToken(): Promise<string> {
  if (!GRAPH_TENANT || !GRAPH_CLIENT || !GRAPH_SECRET) {
    throw new Error("SharePoint not configured yet — set GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET.");
  }
  const now = Date.now() / 1000;
  if (_graphTok && _graphTok.exp > now + 60) return _graphTok.token;
  const res = await fetch(`https://login.microsoftonline.com/${GRAPH_TENANT}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GRAPH_CLIENT, client_secret: GRAPH_SECRET,
      scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Graph token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  _graphTok = { token: j.access_token, exp: now + (j.expires_in ?? 3600) };
  return _graphTok.token;
}
async function graphGet(path: string): Promise<any> {
  const res = await fetch("https://graph.microsoft.com/v1.0" + path, {
    headers: { Authorization: "Bearer " + (await graphToken()) },
  });
  if (!res.ok) throw new Error(`Graph ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}
let _docDriveId: string | null = null;
async function docDriveId(): Promise<string> {
  if (_docDriveId) return _docDriveId;
  const drives = await graphGet(`/sites/${SP_SITE_ID}/drives?$select=id,name`);
  const list = drives.value || [];
  const match = list.find((d: any) => d.name === DOC_LIBRARY) || list[0];
  if (!match) throw new Error("No document library found on the configured site.");
  // Return the local, not the field: TS cannot narrow a mutable module-level
  // `string | null` after assignment, and `deno check --strict` is only worth
  // having as a pre-deploy gate if it runs clean.
  const id: string = match.id;
  _docDriveId = id;
  return id;
}
async function projectFolder(projectNumber: string): Promise<any | null> {
  const drive = await docDriveId();
  const num = projectNumber.toLowerCase().trim();
  let url: string = `/drives/${drive}/root/children?$select=id,name,folder&$top=200`;
  while (url) {
    const page = await graphGet(url);
    for (const it of (page.value || [])) {
      if (it.folder && String(it.name).toLowerCase().startsWith(num)) return it;
    }
    const next = page["@odata.nextLink"];
    url = next ? next.replace("https://graph.microsoft.com/v1.0", "") : "";
  }
  return null;
}

// All document libraries (drives) on the site, cached. Proposals/Contracts live in
// their own libraries alongside the main Project Document Library.
let _drives: Array<{ id: string; name: string }> | null = null;
async function siteDrives(): Promise<Array<{ id: string; name: string }>> {
  if (_drives) return _drives;
  const d = await graphGet(`/sites/${SP_SITE_ID}/drives?$select=id,name`);
  const list: Array<{ id: string; name: string }> = (d.value || []).map((x: any) => ({ id: x.id, name: x.name }));
  _drives = list;
  return list;
}
// Find a project's root folder (named by NUMBER, e.g. "<number> - ...") within a drive.
//
// This is a LINEAR SCAN of the drive root, which holds roughly one folder per
// project, paged at 200. At 148 projects that is one Graph call; the firm adds
// ~27 projects a year, so it becomes two calls in about two years and keeps
// climbing. Every briefing and every list_project_documents pays it, and
// list_project_documents pays it once per drive across ~37 libraries.
//
// So memoize. Folder ids are stable, so a HIT is a permanent fact and is cached
// without expiry. A MISS is not: a project folder created after the scan would
// otherwise stay invisible for the life of the instance, so misses expire on the
// same 300s clock getProjects() uses.
const _projFolder = new Map<string, { item: any; at: number }>();
const PROJ_FOLDER_MISS_TTL = 300000;
async function findProjectFolderInDrive(driveId: string, numPrefix: string): Promise<any | null> {
  const key = driveId + "|" + numPrefix;
  const hit = _projFolder.get(key);
  if (hit && (hit.item || (Date.now() - hit.at) < PROJ_FOLDER_MISS_TTL)) return hit.item;

  let url: string = `/drives/${driveId}/root/children?$select=id,name,folder&$top=200`;
  while (url) {
    const page = await graphGet(url);
    for (const it of (page.value || [])) {
      if (it.folder && String(it.name).toLowerCase().startsWith(numPrefix)) {
        _projFolder.set(key, { item: it, at: Date.now() });
        return it;
      }
    }
    const next = page["@odata.nextLink"];
    url = next ? next.replace("https://graph.microsoft.com/v1.0", "") : "";
  }
  _projFolder.set(key, { item: null, at: Date.now() });
  return null;
}
// Graph caps a children listing at 200 entries and hands back a nextLink. Reading
// only the first page passes a truncated slice off as the whole folder, which is
// worse than an error because it looks like it worked — Tabler's Emails folder
// holds 3,226 items. Follow the link, bounded, and REPORT stopping early.
async function listChildren(path: string): Promise<{ value: any[]; truncated: boolean }> {
  const out: any[] = [];
  let url: string = path;
  let pages = 0;
  while (url) {
    if (pages >= MAX_FOLDER_PAGES) return { value: out, truncated: true };
    const page = await graphGet(url);
    for (const it of (page.value || [])) out.push(it);
    pages++;
    const next = page["@odata.nextLink"];
    url = next ? next.replace("https://graph.microsoft.com/v1.0", "") : "";
  }
  return { value: out, truncated: false };
}

// Find root folders whose NAME CONTAINS a needle (case-insensitive). For name-based
// libraries (Proposals/Contracts). Empty needle returns the first folders (browse).
// Bounded to 15 pages (~3000 folders) per drive.
async function findFoldersByName(driveId: string, needleLower: string, cap: number): Promise<any[]> {
  const out: any[] = [];
  let url: string = `/drives/${driveId}/root/children?$select=id,name,folder&$top=200`;
  let pages = 0;
  while (url && pages < 15) {
    const page = await graphGet(url);
    for (const it of (page.value || [])) {
      if (it.folder && (!needleLower || String(it.name).toLowerCase().includes(needleLower))) {
        out.push(it);
        if (out.length >= cap) return out;
      }
    }
    const next = page["@odata.nextLink"];
    url = next ? next.replace("https://graph.microsoft.com/v1.0", "") : "";
    pages++;
  }
  return out;
}

const RFI_OPEN = new Set(["Open", "Pending Sub Response"]);
const SUBMITTAL_OPEN = new Set(["Received", "Under Review", "Pending Sub Review", "Resubmittal Required"]);
const openActionItems = (p: any) =>
  (p.notes ?? []).filter((n: any) => n.actionItem && (n.actionStatus ?? "open") !== "done");

// A milestone is DONE when pctComplete hits 100, full stop. `status` is a
// legacy field the app no longer writes on auto-built milestones — it is null
// on most rows and goes stale at "Not Started" on the rest, so testing it alone
// reports finished work as overdue. Mirrors milestoneStatus() in SettyPMS.html.
const milestoneDone = (m: any) =>
  (m.status ?? "") === "Completed" || Number(m.pctComplete ?? 0) >= 100;

function summarizeProject(p: any): Record<string, unknown> {
  const today = new Date().toISOString().slice(0, 10);
  const plausible = (d: string) => d >= "2015-01-01" && d <= "2100-12-31";
  const live = (p.milestones ?? []).filter((m: any) =>
    m.dueDate && plausible(m.dueDate) && !m.cancelled && !milestoneDone(m));
  const overdue = live.filter((m: any) => m.dueDate < today);
  const next = live.filter((m: any) => m.dueDate >= today)
    .sort((a: any, b: any) => String(a.dueDate).localeCompare(String(b.dueDate)))[0];
  return {
    name: p.name, projectNumber: p.projectNumber, status: p.status,
    ownerAgency: p.owner || null,
    // Returned so a caller can see WHY a description matched, and because a
    // pipeline job is often known by its prime rather than by its own name.
    prime: p.prime || null,
    nextMilestone: next ? { name: next.name, due: next.dueDate } : null,
    overdueCount: overdue.length, openActionItems: openActionItems(p).length,
    archived: !!p.archived,
  };
}

// Bump on every deploy. `version` is what an MCP client shows; BUILD is echoed by
// /health so "is my change live?" is answerable without diffing the source.
const BUILD = "2026-08-05-describe-a-project-2";
const mcp = new McpServer({
  name: "setty-pms", version: "1.1.0",
  schemaAdapter: (schema) => z.toJSONSchema(schema as z.ZodType),
});
const asText = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });

// ─── P3.12: TELEMETRY ────────────────────────────────────────────────────────
// The roadmap rates empty results a P0-grade concern even though the dashboard
// is P3: one "the connector didn't find it" moment sends someone back to the N:
// drive for a month, and they do not file a ticket about it. Today nothing
// records that it happened, so the only gaps we find are the ones someone
// happens to mention.
//
// Instrumented once here rather than in 24 handlers. mcp.tool is wrapped so
// every tool, including any added later, is covered by construction: a tool
// that has to be remembered to be instrumented eventually is not.
//
// Two rules this must never break:
//   1. Telemetry cannot fail a tool call. Every path swallows its own errors.
//   2. Telemetry cannot slow a tool call noticeably. The insert is raced against
//      a short timeout, so a struggling database costs the caller nothing.
const TELEMETRY_TIMEOUT_MS = 1500;
const TELEMETRY_QUERY_MAX = 200;

const firstString = (...vals: unknown[]): string | null => {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 120);
  }
  return null;
};

// ── Project parameter naming ─────────────────────────────────────────────────
// 15 tools take `projectNumber`; get_project and project_briefing took
// `identifier`. That inconsistency already cost us once (telemetry read only
// projectNumber, so those two logged a null project and dropped out of the
// per-project report silently).
//
// The two are aligned on `projectNumber`, but `identifier` is still ACCEPTED,
// and removing it would be an outage rather than a cleanup. MCP clients cache
// tool schemas at CONNECT: every session opened before this deploy will keep
// sending `identifier`, and a hard rename gives all of them
// "expected string, received undefined" until each user reconnects. Everyone at
// the firm connected yesterday.
//
// So both are optional in the schema and one is required at runtime. Delete the
// alias only once the connected clients have all cycled, which telemetry can
// confirm rather than guess: no rows with identifier in use means it is safe.
const projectRef = (projectNumber?: string, identifier?: string): string | null =>
  firstString(projectNumber, identifier);

// The parameter is called projectNumber because 15 tools already call it that,
// but it accepts a NAME just as well, and for a large part of the portfolio the
// name is the only thing there is: 46 of 151 projects carry no number, and all
// of them are pipeline (Proposal Submitted, Proposal Due, Lost, Not Started).
// A number is assigned when the job is won. Any message that says "pass the
// project number" is therefore wrong for roughly a third of the firm's work,
// which is why this one leads with both.
const MISSING_PROJECT_REF = {
  error: "No project given.",
  nextStep: "Pass projectNumber with either the number (e.g. 'SAPX256018.00') or the project NAME. " +
    "Pipeline projects (proposals and pursuits) have no number until the job is won, so use the name for those. " +
    "search_projects finds either.",
};

async function logTelemetry(row: Record<string, unknown>): Promise<void> {
  try {
    const insert = fetch(`${SUPABASE_URL}/rest/v1/pms_mcp_telemetry`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(row),
    });
    await Promise.race([
      insert.then((r) => { if (!r.ok) return r.text().then((t) => console.warn("[telemetry]", r.status, t.slice(0, 200))); }),
      new Promise((resolve) => setTimeout(resolve, TELEMETRY_TIMEOUT_MS)),
    ]);
  } catch (e) {
    console.warn("[telemetry] insert failed:", String((e as any)?.message ?? e));
  }
}

// Classify what the caller actually got. Handlers all return asText(payload),
// so the payload is the honest signal: a tool that answers "no folder for this
// project" has NOT served the user, however successful the HTTP call was.
function classifyResult(payload: any): { outcome: "hit" | "empty" | "error"; resultCount: number | null; detail: string | null } {
  if (!payload || typeof payload !== "object") return { outcome: "hit", resultCount: null, detail: null };
  if (payload.error) {
    return { outcome: "error", resultCount: null, detail: String(payload.error).slice(0, 300) };
  }
  const count =
    typeof payload.count === "number" ? payload.count :
    Array.isArray(payload.results) ? payload.results.length :
    Array.isArray(payload.items) ? payload.items.length :
    Array.isArray(payload.emails) ? payload.emails.length :
    Array.isArray(payload.notes) ? payload.notes.length :
    Array.isArray(payload.projects) ? payload.projects.length :
    null;
  if (count === 0) {
    return { outcome: "empty", resultCount: 0, detail: payload.reason ? String(payload.reason).slice(0, 300) : null };
  }
  return { outcome: "hit", resultCount: count, detail: null };
}

const _rawTool = mcp.tool.bind(mcp);
(mcp as any).tool = (name: string, def: any) => {
  const inner = def.handler;
  return _rawTool(name, {
    ...def,
    handler: async (args: any) => {
      const t0 = Date.now();
      let cls: ReturnType<typeof classifyResult> = { outcome: "hit", resultCount: null, detail: null };
      try {
        const res = await inner(args);
        try {
          cls = classifyResult(JSON.parse(res?.content?.[0]?.text ?? "null"));
        } catch { /* not JSON: treat as a hit, the tool answered something */ }
        return res;
      } catch (e) {
        cls = { outcome: "error", resultCount: null, detail: String((e as any)?.message ?? e).slice(0, 300) };
        throw e;
      } finally {
        await logTelemetry({
          tool: name,
          // Tools disagree on the parameter name: most take projectNumber,
          // get_project and project_briefing take identifier. Reading only one
          // left the project blank on those, which silently breaks the
          // "empty results by project" report for exactly the tools a PM uses
          // most. Take whichever is present.
          project_number: firstString(args?.projectNumber, args?.identifier, args?.project),
          outcome: cls.outcome,
          result_count: cls.resultCount,
          latency_ms: Date.now() - t0,
          build: BUILD,
          query: args?.query ? String(args.query).slice(0, TELEMETRY_QUERY_MAX) : null,
          detail: cls.detail,
        });
      }
    },
  });
};

// ── Project search ───────────────────────────────────────────────────────────
// People do not name a project the way the record does. They describe it:
// "the feasibility study with SCA for Morphosis" names the TYPE, the AGENCY by
// acronym, and the PRIME, and not one of those is the project's name (which is
// "St. Therese of Lisieux Feasibility Study"). The old search failed that
// completely: it looked only at name / number / status / owner, and it required
// the WHOLE query to appear contiguously in one of them, so any phrase a person
// would actually say returned nothing.
//
// Now every term is scored against every identifying field. A project has to
// match every meaningful term to be returned, so precision holds, but the terms
// may land in DIFFERENT fields, which is what makes a description work.

// Words that carry no signal in a project description. Without this, "with" and
// "for" are terms that nothing matches, and a require-all-terms rule then
// returns nothing for every naturally phrased query.
const SEARCH_STOPWORDS = new Set([
  "a", "an", "the", "with", "for", "of", "on", "at", "in", "and", "to", "by",
  "project", "job", "study", "our",
]);

// Agencies are written in full on the record but spoken as acronyms. Mapping is
// one-way on purpose: typing "SCA" should find "School Construction Authority",
// and the full name still matches itself by ordinary term overlap.
const AGENCY_ALIASES: Record<string, string> = {
  sca: "school construction authority",
  ddc: "department of design and construction",
  dasny: "dormitory authority",
  cuny: "city university",
  suny: "state university",
  sucf: "state university construction fund",
  ogs: "office of general services",
  edc: "economic development corporation",
  dep: "department of environmental protection",
  dot: "department of transportation",
  nycha: "housing authority",
  hpd: "housing preservation development",
};

function projectHaystack(p: any): string {
  return [
    p.name, p.projectNumber, p.status, p.owner, p.prime, p.clientName,
    p.projectType, p.projectCity, p.projectState, p.buildingCategory,
    p.contractNumber, p.primeProjectNumber,
  ].filter(Boolean).join(" ").toLowerCase();
}

function scoreProjectMatch(p: any, terms: string[]): number {
  if (!terms.length) return 1;
  const hay = projectHaystack(p);
  let hits = 0;
  for (const t of terms) {
    const alias = AGENCY_ALIASES[t];
    if (hay.includes(t) || (alias && hay.includes(alias))) hits++;
  }
  // Every meaningful term must land somewhere. Partial matching would make
  // "SCA Morphosis" return every SCA job, which is worse than nothing when the
  // caller is about to act on the answer.
  return hits === terms.length ? hits : 0;
}

mcp.tool("search_projects", {
  description:
    "Find PMS projects by anything that identifies them: name, project number, status, owner " +
    "agency (DASNY, SCA, CUNY, NYC DDC, SUNY...), the PRIME or client firm, project type, or " +
    "city. Terms may span several of those, so a plain description works: 'feasibility study " +
    "with SCA for Morphosis' finds the right job even though none of those words is its name. " +
    "Agency acronyms are understood. Returns compact summaries including ownerAgency and prime. " +
    "Leave query empty to list everything. Excludes archived (closed-out) projects by default; " +
    "pass includeArchived: true to search the archive too.",
  inputSchema: z.object({
    query: z.string().optional().describe("Free text: name, number, status, agency, prime/client firm, project type or city. A description spanning several of these works."),
    includeArchived: z.boolean().optional().describe("Include archived/closed-out projects (default false)"),
  }),
  handler: async ({ query, includeArchived }) => {
    const projects = await getProjects();
    const pool = includeArchived ? projects : projects.filter((p) => !p.archived);
    const raw = (query ?? "").toLowerCase().trim();
    const terms = raw
      ? raw.split(/[^a-z0-9.#&-]+/).filter((t) => t && t.length > 1 && !SEARCH_STOPWORDS.has(t))
      : [];

    const matched = terms.length
      ? pool.map((p) => ({ p, s: scoreProjectMatch(p, terms) }))
          .filter((r) => r.s > 0)
          .sort((a, b) => b.s - a.s || String(a.p.name).localeCompare(String(b.p.name)))
          .map((r) => r.p)
      : pool;

    if (raw && !matched.length) {
      return asText({
        count: 0, includeArchived: !!includeArchived, projects: [],
        interpreted: { terms },
        reason: `No project matches every term in "${query}".`,
        nextStep: "Drop the least certain term and try again: every term has to match something. " +
          "The prime firm, owner agency, project type and city are all searchable, so a partial " +
          "description usually works better than a full sentence.",
      });
    }

    return asText({
      count: matched.length,
      includeArchived: !!includeArchived,
      ...(terms.length ? { interpreted: { terms } } : {}),
      projects: matched.map(summarizeProject),
    });
  },
});

function rfiSubStatusCounts(arr: any[]) {
  const byStatus: Record<string, number> = {};
  for (const x of (arr || [])) { const s = x?.status || "—"; byStatus[s] = (byStatus[s] || 0) + 1; }
  return byStatus;
}
function slimProjectForDetail(p: any) {
  const out: any = { ...p };
  out.ownerAgency = p.owner ?? null; // surface the owner agency under a clear name (alias of `owner`)
  if (Array.isArray(p.rfis) && p.rfis.length) {
    out.rfis = { count: p.rfis.length, open: p.rfis.filter((r: any) => RFI_OPEN.has(r.status)).length,
      byStatus: rfiSubStatusCounts(p.rfis), note: "Summarized — use search_rfis_submittals / read_rfi_submittal for detail." };
  }
  if (Array.isArray(p.submittals) && p.submittals.length) {
    out.submittals = { count: p.submittals.length, open: p.submittals.filter((s: any) => SUBMITTAL_OPEN.has(s.status)).length,
      byStatus: rfiSubStatusCounts(p.submittals), note: "Summarized — use search_rfis_submittals / read_rfi_submittal for detail." };
  }
  if (Array.isArray(p.notes) && p.notes.length) {
    out.notes = { count: p.notes.length, actionItems: p.notes.filter((n: any) => n.actionItem || n.category === "Action Item").length,
      note: "Summarized — use search_notes / read_note for content, list_action_items for action items." };
  }
  if (Array.isArray(p.emails) && p.emails.length) {
    out.emails = { count: p.emails.length, note: "Summarized — use search_emails / summarize_project_emails." };
  }
  return out;
}

mcp.tool("get_project", {
  description:
    "Structured PMS record for one project, looked up by exact project number, id, or name. " +
    "Milestones, phases, team, and contacts come in full; RFIs, submittals, notes, and " +
    "emails are summarized (counts + status) — use search_rfis_submittals, list_milestones, " +
    "search_notes, or search_emails to read those in detail. " +
    "NOT A STATUS ANSWER ON ITS OWN. These are the same fields anyone can read off the PMS web app " +
    "in seconds, so reciting them back is not useful. If the question is 'what is going on with " +
    "<project>' or anything like it, call project_briefing instead — it returns this record PLUS " +
    "the meeting minutes and review comments that actually say what is happening. " +
    "AUTHORITATIVE HERE — do NOT infer these from documents: `scopeContent` is the project's SCOPE as " +
    "maintained in PMS, and `directory` / `projectContacts` / `clientContact` / `teamMembers` are the " +
    "PROJECT DIRECTORY. Prefer these over anything found in a contract, proposal, or other document.",
  inputSchema: z.object({
    projectNumber: z.string().optional().describe("Project number OR project name. Pipeline projects (proposals and pursuits) have no number until the job is won, so use the name for those."),
    identifier: z.string().optional().describe("Deprecated alias for projectNumber. Accepted so clients that cached this tool's schema before 2026-08-05 keep working."),
  }),
  handler: async ({ projectNumber, identifier }) => {
    const ref = projectRef(projectNumber, identifier);
    if (!ref) return asText(MISSING_PROJECT_REF);
    const pid = await resolveProjectId(ref);
    if (!pid) return asText({ error: `No project matching \"${ref}\"` });
    const p = await getProjectById(pid);
    if (!p) return asText({ error: `No project matching \"${ref}\"` });
    const out = slimProjectForDetail(p);
    out._note = "Structured record only. For a 'what is going on' question this is background, not " +
      "the answer — call project_briefing to get the recent meeting minutes and review comments with it.";
    return asText(out);
  },
});

// ---------------------------------------------------------------------------
// project_briefing — the "what's going on with <project>" entry point.
//
// The structured PMS record is not an answer to that question. It is the same
// set of fields anyone at the firm can read off the PMS web app in seconds, so
// reciting it back costs a round trip and adds nothing. What people actually
// want is the narrative record: the most recent meeting minutes, and the
// agency/contractor review comments. This tool puts both in front of the model
// in ONE call, so the minutes-led answer happens on the first pass, not the
// second.
//
// Minutes live in TWO places and the split is per-project, not per-firm:
//   * the numbered Project Management folder, on projects that file them there;
//   * the Emails folder, as the attachment they arrived as, which is the ONLY
//     copy on plenty of projects. 280 Broadway (SAPX256018.00) has an empty PM
//     folder and every set of minutes sitting in Emails.
// Searching only the PM folder finds nothing on those projects, so search both.
// ---------------------------------------------------------------------------

// Folders under a project root worth scanning. Names carry numeric and emoji
// prefixes ("01 📋 Project Management"), so match on substring, never equality.
// Bare "PM" is deliberately not matched: too many folders start with those
// letters. "Emails" is plural on some projects and singular on others.
const PM_FOLDER_RE = /project\s*management/i;
const EMAIL_FOLDER_RE = /^\s*emails?\s*$/i;

// Extensions read_document can extract text from. Anything else comes back as a
// webUrl pointer, so flagging it up front saves a wasted read.
const READABLE_EXT = new Set(["pdf", "docx", "xlsx", "xls", "xlsm", "txt", "csv", "htm", "html"]);

// Only projects in construction generate RFIs and submittals. Reporting "no open
// RFIs" on a design-phase job reads as a finding when it is really just a phase
// that has not started yet.
//
// Matched loosely rather than by equality against the exact PMS status string
// "In Construction Administration". An exact match is a silent coupling to the
// app's status vocabulary: rename or recase it there and the gate stops firing
// with nothing to show for it. A substring test survives that.
const CA_STATUS_RE = /construction\s*admin/i;
const inConstructionAdmin = (status: unknown) => CA_STATUS_RE.test(String(status ?? ""));

// Page cap when walking a project folder. 10 pages of 200 is 2,000 entries,
// comfortably above the largest Emails folder in the firm while still bounding
// the worst case to ten sequential Graph calls for a single folder.
const MAX_FOLDER_PAGES = 10;

// How strongly a name says "this is the record of a meeting that happened".
// Scored against real filenames rather than assumed ones, because the assumed
// ones were wrong: on 280 Broadway the minutes are "2026.07.29_Design Meeting
// #16.pdf", carrying neither "minutes" nor "notes", while the agenda beside it
// abbreviates to "Mtg". So MEETING and MTG have to score on their own, and
// AGENDA has to be a penalty rather than a bonus — otherwise "Progress Meeting
// Agenda #16" outranks the actual minutes, which is exactly backwards. The
// penalty is small enough that agendas still surface when no minutes exist.
// Also runs against FOLDER names: the Emails folder files each message under
// "YYYY_MM_DD <subject>", so "2026_07_17 Meeting minutes" is itself the signal.
function scoreMeetingDoc(name: string): number {
  // Fold separators to spaces BEFORE matching. Underscore is a word character,
  // so \bagenda\b does not match "_Agenda_2026-07-29.pdf" — which silently let
  // that agenda outscore the minutes it was filed next to.
  const n = name.toLowerCase().replace(/[_.\-]+/g, " ");
  let s = 0;
  // MINUTES, MEETING and AGENDA match unanchored because the firm concatenates
  // them ("OAMeeting2", "PreconstructionAgenda"). They are distinctive enough
  // that a substring hit is a true hit. NOTES and MTG keep their boundaries:
  // "notes" would otherwise fire on "keynotes"/"denotes", and three letters of
  // "mtg" inside a longer word means nothing.
  if (/minutes?/.test(n)) s += 10;
  if (/\bnotes?\b/.test(n)) s += 8;
  if (/meeting|\bmtg\b/.test(n)) s += 6;
  if (/\b(design|progress|coordination|oac|kick\s*-?\s*off|kickoff|workshop|site\s*visit|bi.?weekly)\b/.test(n)) s += 3;
  if (/agendas?/.test(n)) s -= 4;
  if (/\b(sign[\s_-]*in|attendance|roster|invite|calendar)\b/.test(n)) s -= 8;
  return s;
}

// The meeting date out of a file or folder name, or null. Needed because
// lastModifiedDateTime lies: Tabler's 41 meeting folders were bulk-migrated and
// every one of them reports the same June-2026 timestamp, so ordering by Graph
// metadata puts its 2019 and 2024 meetings in arbitrary order. The name is the
// honest date. Handles 2024-10-25, 2026.07.29, 2026_07_17, 20260729 and the
// six-digit 260602 form, all of which are in live use.
function nameDate(name: string): string | null {
  const n = name.replace(/[_.]+/g, "-");
  // Scan every candidate, not just the first: "2020.40-01_..." leads with a
  // project number that looks like a date and would otherwise mask the real one.
  for (const m of n.matchAll(/(20\d{2})-?(\d{2})-?(\d{2})/g)) {
    if (+m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  for (const m of n.matchAll(/\b(\d{2})(\d{2})(\d{2})\b/g)) {
    if (+m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) return `20${m[1]}-${m[2]}-${m[3]}`;
  }
  return null;
}

// Attachment names worth reading: design-review feedback from an agency or a
// contractor. "Dr Checks" / DrChecks is the agencies' review system, i.e. the
// same thing under another name.
const REVIEW_ATTACHMENT_RE = /comments?|dr\.?\s*checks|drchecks|minutes|review|markup|backcheck/i;

// Rank a project's meeting records across BOTH the Project Management folder and
// the Emails folder. Bounded on purpose: every level here is a Graph round trip,
// so this walks two folders and at most a handful of subfolders under each.
async function meetingRecords(
  projectNumber: string,
  cap: number,
): Promise<{ items: any[]; truncated: boolean; note: string }> {
  const num = String(projectNumber || "").toLowerCase().trim();
  if (!num) {
    return { items: [], truncated: false, note: "This project has no project number, so its SharePoint folder cannot be located." };
  }
  const drive = await docDriveId();
  const root = await findProjectFolderInDrive(drive, num);
  if (!root) return { items: [], truncated: false, note: `No folder starting with "${projectNumber}" in ${DOC_LIBRARY}.` };

  const SELECT = "?$select=id,name,folder,file,size,lastModifiedDateTime&$top=200";
  // Follow @odata.nextLink. Graph caps a page at 200 entries and the longest-
  // running projects blow past that: Tabler has 3,226 filed emails, 771 of them
  // with attachments. Reading only the first page would treat a truncated slice
  // as the whole folder and then pick the "newest" meetings out of it, which is
  // worse than finding nothing because it looks like it worked. Bounded at
  // MAX_FOLDER_PAGES so one pathological folder cannot stall the briefing, and
  // the caller is TOLD when that bound is hit rather than guessing.
  let listTruncated = false;
  const children = async (id: string): Promise<any[]> => {
    const out: any[] = [];
    let url: string = `/drives/${drive}/items/${id}/children${SELECT}`;
    for (let page = 0; url; page++) {
      if (page >= MAX_FOLDER_PAGES) { listTruncated = true; break; }
      const res = await graphGet(url);
      out.push(...(res.value || []));
      const next = res["@odata.nextLink"];
      url = next ? String(next).replace("https://graph.microsoft.com/v1.0", "") : "";
    }
    return out;
  };

  const kids = await children(root.id);
  const pm = kids.find((k: any) => k.folder && PM_FOLDER_RE.test(String(k.name)));
  const mail = kids.find((k: any) => k.folder && EMAIL_FOLDER_RE.test(String(k.name)));
  if (!pm && !mail) {
    return {
      items: [], truncated: false,
      note: "This project has neither a Project Management folder nor an Emails folder, so nothing " +
        "is filed to read. Fall back to search_emails and search_notes for the narrative.",
    };
  }

  // `date` is the meeting date: from the name where there is one, otherwise the
  // folder it sits in (dated subfolders name the meeting, their files often do
  // not), otherwise Graph's timestamp as a last resort.
  const tag = (it: any, folder: string) => ({
    itemId: drive + "|" + it.id,
    name: it.name,
    folder,
    date: nameDate(String(it.name)) ?? nameDate(folder) ?? String(it.lastModifiedDateTime ?? "").slice(0, 10),
    modified: it.lastModifiedDateTime ?? null,
    ext: (String(it.name).split(".").pop() || "").toLowerCase(),
    score: scoreMeetingDoc(String(it.name)),
  });

  const files: any[] = [];
  let scanned = 0;

  // Both folders are shaped the same way: loose files at the top, plus dated
  // subfolders holding the rest. Under Emails each subfolder is one message
  // ("2026_07_29 ... Bi-Weekly Meeting"), so its NAME already says whether the
  // attachments inside are worth opening. Pick subfolders by that name score
  // first and recency second, which is what keeps this to a few round trips
  // instead of one per message.
  const harvest = async (parent: any, subCap: number) => {
    const inside = await children(parent.id);
    scanned += inside.length;
    for (const it of inside) if (it.file) files.push(tag(it, parent.name));
    const subs = inside.filter((it: any) => it.folder)
      .map((it: any) => ({
        it,
        score: scoreMeetingDoc(String(it.name)),
        date: nameDate(String(it.name)) ?? String(it.lastModifiedDateTime ?? "").slice(0, 10),
      }))
      .filter((x: any) => x.score > 0)
      // Newest meeting first. Score only breaks ties, because on a project with
      // 40-odd identically-named "Meeting Notes" folders the score is constant
      // and the date is the only thing that distinguishes them.
      .sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)) || (b.score - a.score))
      .slice(0, subCap);
    for (const { it: sf } of subs) {
      try {
        for (const f of await children(sf.id)) {
          if (f.file) files.push(tag(f, parent.name + "/" + sf.name));
        }
      } catch { /* one unreadable subfolder must not sink the whole briefing */ }
    }
  };

  for (const [folder, subCap] of [[pm, 3], [mail, 4]] as Array<[any, number]>) {
    if (!folder) continue;
    try { await harvest(folder, subCap); } catch { /* keep whatever the other folder gave us */ }
  }

  // Recency dominates, score only breaks ties within the same day. Sorting by
  // score first would rank an older set of minutes above the newest meeting,
  // which is the opposite of what "what's going on" is asking for. Comparing by
  // DAY still lets minutes outrank the agenda filed beside them the same day.
  files.sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.score - a.score));
  const items = files.filter((f) => f.score > 0).slice(0, cap)
    .map((f) => ({ ...f, readable: READABLE_EXT.has(f.ext) }));

  const searched = [pm && pm.name, mail && mail.name].filter(Boolean).join(" and ");
  const truncatedWarning = listTruncated
    ? ` NOTE: this project has more filed history than one pass reads (stopped at ${MAX_FOLDER_PAGES * 200} ` +
      "entries), so older material may be missing. Recent meetings are unaffected; for anything historical, " +
      "search_emails covers the full log."
    : "";
  return {
    items,
    truncated: listTruncated,
    note: (items.length
      ? `Newest first, with minutes ranked above agendas filed the same day. Searched ${searched}. ` +
        "Read the top one or two."
      : `Searched ${searched} (${scanned} entries); nothing is named like a meeting record. ` +
        "Try search_emails, or browse with list_project_documents.") + truncatedWarning,
  };
}

// The project's recent filed correspondence, with each message's review-comment
// attachments called out. Deliberately NOT filtered to has_attachments: the
// briefing reports these as "recent emails", and silently dropping every message
// without a file would make that label a lie. Reads the email log rather than
// walking the SharePoint Emails folder, because attachment names are already
// indexed in Postgres and one query beats a Graph call per message.
async function recentMail(pid: string, cap: number): Promise<any[]> {
  const rows = await sbGet(
    "pms_project_emails?project_id=eq." + pid +
    "&select=record_id,subject,from_name,from_address,direction,email_date,attachment_names" +
    "&order=email_date.desc.nullslast&limit=" + cap,
  );
  return (rows || []).map((r: any) => {
    const names: string[] = Array.isArray(r.attachment_names) ? r.attachment_names
      : (typeof r.attachment_names === "string" && r.attachment_names ? [r.attachment_names] : []);
    return {
      recordId: r.record_id, date: r.email_date, direction: r.direction,
      from: r.from_name || r.from_address, subject: r.subject,
      attachments: names,
      reviewComments: names.filter((n) => REVIEW_ATTACHMENT_RE.test(String(n))),
    };
  });
}

mcp.tool("project_briefing", {
  description:
    "THE entry point for 'what's going on with <project>', 'catch me up on <project>', 'status " +
    "of <project>' and anything like it. One call returns: a compact orientation block from the " +
    "PMS record; the project's most recent MEETING MINUTES, ranked and ready for read_document, " +
    "found across BOTH its SharePoint Project Management folder and its Emails folder (many " +
    "projects only ever have the emailed copy); recent email attachments that look like agency " +
    "or contractor REVIEW COMMENTS; and the newest filed emails and OneNote notes. " +
    "The structured PMS fields are NOT the answer to a status question — the whole firm can " +
    "already read those off the PMS web app, so repeating them is not useful. The substance is in " +
    "the minutes. Work the `readNext` list with read_document BEFORE answering, and lead with " +
    "what those documents say is outstanding. Use get_project only when someone wants the record " +
    "itself (fee, directory, scope, full milestone list).",
  inputSchema: z.object({
    projectNumber: z.string().optional().describe("Project number OR project name. Pipeline projects (proposals and pursuits) have no number until the job is won, so use the name for those."),
    identifier: z.string().optional().describe("Deprecated alias for projectNumber. Accepted so clients that cached this tool's schema before 2026-08-05 keep working."),
    documents: z.number().optional().describe("How many meeting records to rank and return (default 6, max 20)"),
    emails: z.number().optional().describe("How many recent filed emails to scan (default 25, max 60)"),
  }),
  handler: async ({ projectNumber, identifier, documents, emails }) => {
    const ref = projectRef(projectNumber, identifier);
    if (!ref) return asText(MISSING_PROJECT_REF);
    const pid = await resolveProjectId(ref);
    if (!pid) return asText({ error: `No project matching "${ref}"` });
    const p = await getProjectById(pid);
    if (!p) return asText({ error: `No project matching "${ref}"` });
    const docCap = Math.min(Math.max(documents ?? 6, 1), 20);
    const mailCap = Math.min(Math.max(emails ?? 25, 1), 60);

    // Graph and Postgres are independent; neither should wait on the other.
    // Either can fail without costing the caller the rest of the briefing.
    const [docs, mail] = await Promise.all([
      meetingRecords(p.projectNumber, docCap)
        .catch((e) => ({
          items: [] as any[], truncated: false,
          note: "SharePoint lookup failed: " + String((e as any)?.message ?? e),
        })),
      recentMail(pid, mailCap).catch(() => [] as any[]),
    ]);

    const notes = (p.notes ?? [])
      .filter((n: any) => n.body)
      .sort((a: any, b: any) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))
      .slice(0, 8)
      .map((n: any) => ({
        noteId: n.id, date: n.createdAt ?? n.updatedAt ?? null, author: n.author ?? null,
        category: n.category ?? null, actionItem: !!n.actionItem,
        preview: htmlToText(n.body || "").slice(0, 300),
      }));

    // RFIs and submittals belong to construction. On a project that has not
    // reached CA they are not "zero open" — they do not exist yet, and saying
    // so out loud reads as a finding when it is really just an unstarted phase.
    const rfis = p.rfis ?? [], subs = p.submittals ?? [];
    const inCA = inConstructionAdmin(p.status);
    const construction = (inCA || rfis.length || subs.length)
      ? {
        openRFIs: rfis.filter((r: any) => RFI_OPEN.has(r.status)).length, totalRFIs: rfis.length,
        openSubmittals: subs.filter((s: any) => SUBMITTAL_OPEN.has(s.status)).length, totalSubmittals: subs.length,
        note: "Use search_rfis_submittals / read_rfi_submittal for detail.",
      }
      : null;

    const readNext = docs.items.filter((d: any) => d.readable).slice(0, 3)
      .map((d: any) => ({ itemId: d.itemId, name: d.name, why: "Meeting record — read_document this before answering." }));

    const guidance = [
      "The orientation block is BACKGROUND, not the answer. Anyone can read those fields off the " +
      "PMS web app in seconds, so do not lead with them and do not pad an answer with them.",
      readNext.length
        ? "Call read_document on `readNext` now, then lead your answer with what the minutes say is " +
          "outstanding: the open items, who owes each one, and when it is due."
        : "No meeting records were found, so build the answer from `recentEmails` (summarize_project_emails " +
          "for bodies), `reviewComments` and `recentNotes` instead.",
      "Where the documents CONTRADICT the structured record — a milestone reading overdue that the " +
      "minutes show as closed out, a phase at 0% that the meetings have clearly moved past — say so. " +
      "That reconciliation is worth reporting. The raw fields on their own are not.",
      construction
        ? "This project is in construction, so RFI and submittal traffic is real; check it."
        : `This project is not in Construction Administration (status: ${p.status || "unknown"}). RFIs and ` +
          "submittals do not exist yet, so they are omitted here. Do not report their absence as a finding.",
    ];

    return asText({
      project: summarizeProject(p),
      projectManager: p.projectManager ?? null,
      deputyProjectManager: p.deputyProjectManager ?? null,
      client: p.clientName ?? null,
      clientContact: p.clientContact ?? null,
      construction,
      meetingRecords: { count: docs.items.length, truncated: docs.truncated, note: docs.note, documents: docs.items },
      reviewComments: mail.filter((m: any) => m.reviewComments.length),
      recentEmails: mail.slice(0, 10).map((m: any) =>
        ({ recordId: m.recordId, date: m.date, direction: m.direction, from: m.from, subject: m.subject, attachments: m.attachments })),
      recentNotes: notes,
      readNext,
      guidance,
    });
  },
});

mcp.tool("list_action_items", {
  description:
    "Action items across all projects (or one). Action items are notes flagged actionItem. " +
    "Defaults to OPEN; pass status 'done' or 'all' to include closed ones.",
  inputSchema: z.object({
    owner: z.string().optional().describe("Filter by action owner name"),
    projectNumber: z.string().optional(),
    status: z.enum(["open", "done", "all"]).optional().describe("open (default), done/closed, or all"),
  }),
  handler: async ({ owner, projectNumber, status }) => {
    const want = status || "open";
    const projects = await getProjects();
    const out: any[] = [];
    for (const p of projects) {
      if (projectNumber && p.projectNumber !== projectNumber) continue;
      for (const n of (p.notes ?? [])) {
        if (!(n.actionItem || n.category === "Action Item")) continue;
        const done = (n.actionStatus ?? "open") === "done";
        if (want === "open" && done) continue;
        if (want === "done" && !done) continue;
        if (owner && (n.actionOwner ?? "").toLowerCase() !== owner.toLowerCase()) continue;
        out.push({ project: p.projectNumber, owner: n.actionOwner, due: n.actionDueDate, status: done ? "done" : "open", item: n.body });
      }
    }
    return asText({ count: out.length, items: out });
  },
});

mcp.tool("firm_overview", {
  description:
    "Portfolio-wide rollup over ACTIVE projects: project count by status, total open RFIs, " +
    "submittals, and action items. Good for a 'how are we doing' question. Archived/closed-out " +
    "projects are excluded from the rollup but reported as a count.",
  inputSchema: z.object({}),
  handler: async () => {
    const all = await getProjects();
    const projects = all.filter((p) => !p.archived);
    const archivedProjects = all.length - projects.length;
    const byStatus: Record<string, number> = {};
    let rfis = 0, subs = 0, actions = 0;
    for (const p of projects) {
      byStatus[p.status ?? "Unknown"] = (byStatus[p.status ?? "Unknown"] ?? 0) + 1;
      rfis += (p.rfis ?? []).filter((r: any) => RFI_OPEN.has(r.status)).length;
      subs += (p.submittals ?? []).filter((s: any) => SUBMITTAL_OPEN.has(s.status)).length;
      actions += openActionItems(p).length;
    }
    return asText({ totalProjects: projects.length, archivedProjects, byStatus, openRFIs: rfis, openSubmittals: subs, openActionItems: actions });
  },
});

mcp.tool("search_emails", {
  description:
    "Full-text search the filed project email log across subject, sender, body, AND " +
    "attachment file names. With a query, ranked by relevance. Without a query, lists " +
    "newest first. Returns metadata + preview; call read_email for a full body.",
  inputSchema: z.object({
    query: z.string().optional().describe("Topic/keywords — searches subject, sender, body, and attachment names"),
    projectNumber: z.string().optional().describe("Scope to one project (number, id, or name)"),
    sender: z.string().optional().describe("Filter by sender email address (contains)"),
    direction: z.enum(["outgoing", "incoming"]).optional().describe("'outgoing' = sent by Setty, 'incoming' = received from outside"),
    limit: z.number().optional().describe("Max results (default 25, max 100)"),
  }),
  handler: async ({ query, projectNumber, sender, direction, limit }) => {
    const lim = Math.min(Math.max(limit ?? 25, 1), 100);
    let pid: string | null = null;
    if (projectNumber) {
      pid = await resolveProjectId(projectNumber);
      if (!pid) return asText({ error: `No project matching \"${projectNumber}\"` });
    }
    const q = (query ?? "").trim();
    let rows: any[];
    if (q) {
      rows = await sbRpc("search_project_emails", { q, proj: pid, lim });
      if (sender && sender.trim()) {
        const s = sender.trim().toLowerCase();
        rows = rows.filter((r: any) => (r.from_address ?? "").toLowerCase().includes(s));
      }
      if (direction) rows = rows.filter((r: any) => r.direction === direction);
    } else {
      const params = new URLSearchParams({
        select: "record_id,project_id,subject,from_name,from_address,to_addresses,direction,email_date,preview,has_attachments",
        order: "email_date.desc.nullslast", limit: String(lim),
      });
      if (pid) params.append("project_id", "eq." + pid);
      if (sender && sender.trim()) params.append("from_address", "ilike.*" + sender.trim().replace(/[*(),]/g, " ") + "*");
      if (direction) params.append("direction", "eq." + direction);
      rows = await sbGet("pms_project_emails?" + params.toString());
    }
    return asText({
      count: rows.length,
      emails: rows.map((r: any) => ({
        recordId: r.record_id, project: r.project_id, date: r.email_date, direction: r.direction,
        from: r.from_name || r.from_address, to: r.to_addresses, subject: r.subject, preview: r.preview,
        ...(typeof r.rank === "number" ? { rank: Math.round(r.rank * 1000) / 1000 } : {}),
        hasAttachments: r.has_attachments,
      })),
    });
  },
});

mcp.tool("read_email", {
  description: "Read one filed email in full by its recordId (from search_emails).",
  inputSchema: z.object({ recordId: z.string().describe("record_id from search_emails") }),
  handler: async ({ recordId }) => {
    const rows = await sbGet(
      "pms_project_emails?record_id=eq." + encodeURIComponent(recordId) +
      "&select=record_id,project_id,subject,from_name,from_address,to_addresses,cc_addresses,direction,email_date,attachment_names,body_text,body_html_compressed&limit=1",
    );
    const r = rows?.[0];
    if (!r) return asText({ error: `No email with recordId \"${recordId}\"` });
    return asText({
      recordId: r.record_id, project: r.project_id, date: r.email_date, direction: r.direction,
      from: r.from_name, fromAddress: r.from_address, to: r.to_addresses, cc: r.cc_addresses,
      subject: r.subject, attachments: r.attachment_names, body: emailBody(r),
    });
  },
});

mcp.tool("summarize_project_emails", {
  description:
    "Pull the most recent filed emails for a project WITH full bodies, to summarize the " +
    "correspondence. Defaults to the 12 newest.",
  inputSchema: z.object({
    projectNumber: z.string().describe("Project number OR project name. Pipeline projects (proposals and pursuits) have no number until the job is won, so use the name for those."),
    limit: z.number().optional().describe("How many recent emails to pull (default 12, max 30)"),
  }),
  handler: async ({ projectNumber, limit }) => {
    const pid = await resolveProjectId(projectNumber);
    if (!pid) return asText({ error: `No project matching \"${projectNumber}\"` });
    const lim = Math.min(Math.max(limit ?? 12, 1), 30);
    const rows = await sbGet(
      "pms_project_emails?project_id=eq." + pid +
      "&select=record_id,subject,from_name,from_address,to_addresses,direction,email_date,has_attachments,attachment_names,body_text,body_html_compressed" +
      "&order=email_date.desc.nullslast&limit=" + lim,
    );
    return asText({
      project: projectNumber, returned: rows.length,
      emails: rows.map((r: any) => ({
        date: r.email_date, direction: r.direction, from: r.from_name || r.from_address, to: r.to_addresses,
        subject: r.subject, hasAttachments: r.has_attachments, attachments: r.attachment_names, body: emailBody(r),
      })),
    });
  },
});

mcp.tool("search_notes", {
  description:
    "Search project / meeting notes captured to OneNote (site visits, client meetings, calls) " +
    "plus logged action items. Returns text, author, date, OneNote link. Long notes truncated — " +
    "use read_note for the full text.",
  inputSchema: z.object({
    query: z.string().optional().describe("Keywords in the note text (also matches category and author). Omit to list recent notes."),
    projectNumber: z.string().optional().describe("Scope to one project (number, id, or name)"),
    limit: z.number().optional().describe("Max results (default 25, max 100)"),
  }),
  handler: async ({ query, projectNumber, limit }) => {
    const lim = Math.min(Math.max(limit ?? 25, 1), 100);
    let pid: string | null = null;
    if (projectNumber) {
      pid = await resolveProjectId(projectNumber);
      if (!pid) return asText({ error: `No project matching \"${projectNumber}\"` });
    }
    const projects = pid ? [await getProjectById(pid)].filter(Boolean) : await getProjects();
    const q = (query ?? "").toLowerCase().trim();
    const out: any[] = [];
    for (const p of projects) {
      for (const n of (p.notes ?? [])) {
        const text = htmlToText(n.body || "");
        if (!text && !n.oneNoteUrl) continue;
        if (q) {
          const hay = (text + " " + (n.category ?? "") + " " + (n.author ?? "")).toLowerCase();
          if (!hay.includes(q)) continue;
        }
        out.push({
          noteId: n.id, project: p.projectNumber || p.id, date: n.createdAt || n.updatedAt || null,
          author: n.author || null, category: n.category || null, actionItem: !!n.actionItem,
          text: text.length > MAX_BODY_CHARS ? text.slice(0, MAX_BODY_CHARS) + "\n…[truncated — use read_note for the full text]" : text,
          oneNoteUrl: n.oneNoteUrl || null,
        });
      }
    }
    out.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
    return asText({ count: out.length, returned: Math.min(out.length, lim), notes: out.slice(0, lim) });
  },
});

mcp.tool("read_note", {
  description: "Read one project note / OneNote page in full (the complete captured text), by noteId from search_notes.",
  inputSchema: z.object({ noteId: z.string().describe("The noteId from search_notes") }),
  handler: async ({ noteId }) => {
    const projects = await getProjects();
    for (const p of projects) {
      const n = (p.notes ?? []).find((x: any) => x.id === noteId);
      if (n) return asText({
        noteId, project: p.projectNumber || p.id, date: n.createdAt || n.updatedAt || null,
        author: n.author || null, category: n.category || null, actionItem: !!n.actionItem,
        oneNoteUrl: n.oneNoteUrl || null, text: htmlToText(n.body || ""),
      });
    }
    return asText({ error: `No note with id \"${noteId}\"` });
  },
});

mcp.tool("list_milestones", {
  description:
    "List a project's milestones — both billable (phase deliverables, with fee and % complete) " +
    "and non-billable. Shows phase, start/due dates, status, % complete, and whether a due date " +
    "is pinned (hand-set). Use for schedule and deadline questions.",
  inputSchema: z.object({
    projectNumber: z.string().describe("Project number OR project name. Pipeline projects (proposals and pursuits) have no number until the job is won, so use the name for those."),
    type: z.enum(["billable", "non-billable"]).optional().describe("Filter by milestone type"),
    includeCompleted: z.boolean().optional().describe("Include 100%-complete milestones (default true)"),
  }),
  handler: async ({ projectNumber, type, includeCompleted }) => {
    const pid = await resolveProjectId(projectNumber);
    if (!pid) return asText({ error: `No project matching \"${projectNumber}\"` });
    const p = await getProjectById(pid);
    let ms = (p?.milestones ?? []).filter((m: any) => !m.cancelled);
    if (type) ms = ms.filter((m: any) => m.type === type);
    if (includeCompleted === false) ms = ms.filter((m: any) => (m.pctComplete || 0) < 100);
    return asText({
      project: p?.projectNumber || projectNumber, count: ms.length,
      milestones: ms.map((m: any) => ({
        name: m.name, type: m.type, phase: m.phase || null, startDate: m.startDate || null, dueDate: m.dueDate || null,
        pctComplete: m.pctComplete || 0,
        // Derive from pctComplete FIRST. A stored status of "Not Started" on a
        // 100%-complete milestone is stale data, not a fact — reporting it made
        // finished concept-phase work read as open.
        status: (m.pctComplete || 0) >= 100 ? "Completed"
              : (m.pctComplete || 0) > 0 ? "In Progress"
              : (m.status || "Not Started"),
        ...(m.type === "billable" ? { fee: m.fee } : {}), datePinned: !!m.dueDateManual,
      })),
    });
  },
});

mcp.tool("search_rfis_submittals", {
  description:
    "Search Construction Administration RFIs and submittals (including historical / Newforma- " +
    "imported records). Filter by project, type (rfi/submittal), status, discipline, or keyword " +
    "(matches number, subject, discipline, spec section, and the full question/response/comments " +
    "text). Returns compact rows with a snippet — call read_rfi_submittal for the full text. With " +
    "no project, searches firm-wide.",
  inputSchema: z.object({
    projectNumber: z.string().optional().describe("Scope to one project (number, id, or name)"),
    type: z.enum(["rfi", "submittal"]).optional().describe("Limit to RFIs or submittals"),
    query: z.string().optional().describe("Keyword across number, subject, discipline, spec section, question/response"),
    status: z.string().optional().describe("Exact status filter, e.g. Open, Closed, Returned"),
    discipline: z.string().optional().describe("Discipline filter, e.g. Electrical, Mechanical"),
    openOnly: z.boolean().optional().describe("Only items still needing attention (open RFIs / in-review submittals)"),
    limit: z.number().optional().describe("Max results (default 30, max 100)"),
  }),
  handler: async ({ projectNumber, type, query, status, discipline, openOnly, limit }) => {
    const lim = Math.min(Math.max(limit ?? 30, 1), 100);
    let pid: string | null = null;
    if (projectNumber) {
      pid = await resolveProjectId(projectNumber);
      if (!pid) return asText({ error: `No project matching \"${projectNumber}\"` });
    }
    const projects = pid ? [await getProjectById(pid)].filter(Boolean) : await getProjects();
    const q = (query ?? "").toLowerCase().trim();
    const disc = (discipline ?? "").toLowerCase().trim();
    const out: any[] = [];
    for (const p of projects) {
      const add = (item: any, kind: string) => {
        if (!item) return;
        if (status && (item.status || "") !== status) return;
        if (disc && (item.discipline || "").toLowerCase() !== disc) return;
        if (openOnly && !(kind === "rfi" ? RFI_OPEN.has(item.status) : SUBMITTAL_OPEN.has(item.status))) return;
        if (q) {
          const hay = [item.number, item.title, item.description, item.response, item.comments, item.discipline, item.specSection, item.status]
            .filter(Boolean).join(" ").toLowerCase();
          if (!hay.includes(q)) return;
        }
        out.push({
          project: p.projectNumber || p.id, type: kind, number: item.number,
          subject: item.title || (item.description ? String(item.description).slice(0, 80) : "—"),
          discipline: item.discipline || null, specSection: item.specSection || undefined,
          status: item.status || null, dueDate: item.dueDate || null, received: item.dateReceived || null,
          closed: item.dateResponded || item.dateReturned || null,
          snippet: htmlToText(item.response || item.comments || item.description || "").slice(0, 200),
        });
      };
      if (type !== "submittal") for (const r of (p.rfis ?? [])) add(r, "rfi");
      if (type !== "rfi") for (const s of (p.submittals ?? [])) add(s, "submittal");
    }
    out.sort((a, b) => String(b.received ?? b.dueDate ?? "").localeCompare(String(a.received ?? a.dueDate ?? "")));
    return asText({ count: out.length, returned: Math.min(out.length, lim), items: out.slice(0, lim) });
  },
});

mcp.tool("read_rfi_submittal", {
  description:
    "Read one RFI or submittal in full — the complete question and response (RFI) or description " +
    "and review comments (submittal), plus metadata. Identify it by project + number.",
  inputSchema: z.object({
    projectNumber: z.string().describe("Project number OR project name. Pipeline projects (proposals and pursuits) have no number until the job is won, so use the name for those."),
    type: z.enum(["rfi", "submittal"]).describe("Whether it's an RFI or a submittal"),
    number: z.string().describe("The RFI/submittal number (e.g. '004' or '260513-001-0')"),
  }),
  handler: async ({ projectNumber, type, number }) => {
    const pid = await resolveProjectId(projectNumber);
    if (!pid) return asText({ error: `No project matching \"${projectNumber}\"` });
    const p = await getProjectById(pid);
    const arr = type === "rfi" ? (p?.rfis ?? []) : (p?.submittals ?? []);
    const item = arr.find((x: any) => String(x.number) === String(number)) || arr.find((x: any) => String(x.id) === String(number));
    if (!item) return asText({ error: `No ${type} \"${number}\" on project ${projectNumber}` });
    const cap = (t: string) => t.length > MAX_DOC_CHARS ? t.slice(0, MAX_DOC_CHARS) + "\n…[truncated]" : t;
    return asText({
      project: p?.projectNumber || projectNumber, type, number: item.number,
      subject: item.title || item.description || null, discipline: item.discipline || null,
      specSection: item.specSection || null, status: item.status || null, reviewAction: item.stamp || null,
      from: item.from || null, dueDate: item.dueDate || null, received: item.dateReceived || null,
      closed: item.dateResponded || item.dateReturned || null,
      question: cap(htmlToText(item.description || "")), response: cap(htmlToText(item.response || item.comments || "")),
      notes: item.notes || null,
    });
  },
});

// ─── TRANSMITTAL REGISTER / CURRENT SET ─────────────────────────────────────
// The register is pms_filing_log rows tagged operation = 'transmittal-generated',
// written by transmittal.html at the moment a set is issued. That is what makes
// it authoritative: it records the ISSUING EVENT rather than a label somebody has
// to remember to set on every upload, so it cannot silently go blank the way a
// SharePoint status column does.
async function transmittalRows(pid: string): Promise<any[]> {
  const rows = await sbGetAll(
    "pms_filing_log?select=created_at,sp_folder_url,files,email_subject" +
    "&project_id=eq." + encodeURIComponent(pid) +
    "&operation=eq.transmittal-generated&order=created_at.desc",
    // Ordered by created_at here only so the fetch is deterministic. The real
    // ordering happens in JS on registerIssueDate() below, because created_at
    // is a FILING timestamp and is not always the issue date.
  );
  return (Array.isArray(rows) ? rows : [])
    // A corrected set leaves its old record behind, marked rather than deleted,
    // so the register keeps a trail of what was filed and when. Those rows must
    // not reach the reader: a superseded filename-derived row sitting beside its
    // re-read replacement would put two conflicting answers in the same set.
    .filter((r: any) => r?.files?.superseded !== true)
    .sort((a, b) => registerIssueDate(b).localeCompare(registerIssueDate(a)));
}

// When was this set ISSUED, as opposed to when the record was filed?
//
// created_at is a filing timestamp. It equals the issue date only when the set
// was logged the day it went out. Saving an OLD folder through the transmittal
// tool stamps today, and that is exactly how Tabler ended up reporting a
// year-superseded Bulletin #1 as current: its record was filed 2026-07-30 for a
// set issued 2025-04-10, which outranked Bulletin #13.
//
// Precedence, most to least trustworthy:
//   1. files.issuedAt   — someone stated the issue date explicitly.
//   2. the set folder's leading date — what the set is called.
//   3. created_at       — last resort, may be a filing timestamp.
//
// issuedAt outranks the folder name on purpose. CUNY's folder is
// "2026-02-02 CUNY Brooklyn BMS 100% CD SET dated 1-27-26": the folder date is
// when it was filed and the NAME says the set is dated 1-27-26, which is what
// the person entered. Trusting the folder there would be wrong.
function registerIssueDate(row: any): string {
  const explicit = row?.files?.issuedAt;
  if (explicit) return String(explicit).slice(0, 10);
  const named = /^\s*(\d{4})[-_](\d{2})[-_](\d{2})/.exec(String(row?.files?.milestoneName || ""));
  if (named) return `${named[1]}-${named[2]}-${named[3]}`;
  return String(row?.created_at || "").slice(0, 10);
}
// Which of the three it used, so a caller can judge the answer.
function registerIssueDateSource(row: any): string {
  if (row?.files?.issuedAt) return "stated issue date";
  if (/^\s*\d{4}[-_]\d{2}[-_]\d{2}/.test(String(row?.files?.milestoneName || ""))) return "set folder name";
  return "filing timestamp (may not be the issue date)";
}

// Set folders are named "<ISO date>_<set name>", e.g. "2025-01-21_Addendum #1".
// Rank the inference fallback on the date in the NAME, never on Graph's
// lastModifiedDateTime — a bulk migration flattened those firm-wide, so the
// modified stamp says when the file moved, not when the set was issued.
function setFolderDate(name: string): string | null {
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})/.exec(String(name || ""));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

const sheetsOf = (row: any): any[] => Array.isArray(row?.files?.sheets) ? row.files.sheets : [];

// The register's `discipline` field cannot be trusted on its own. parseFilename()
// in transmittal.html assumes the filename LEADS with the discipline ("M-501",
// "FP-301"), but sheets named with a building series first — "STTQ-01-E_Bulletin
// #13.pdf" — record discipline "STTQ" (the series) and sheetNo "STTQ-01" for BOTH
// the E and the M sheet. So match the stored field OR a discipline token embedded
// in the filename, which is where the letter actually survives.
function sheetDisciplines(sheet: any): string[] {
  const out = new Set<string>();
  const stored = String(sheet?.discipline || "").toLowerCase().trim();
  if (stored) out.add(stored);
  const base = String(sheet?.filename || "").replace(/\.[a-z0-9]+$/i, "");
  for (const m of base.matchAll(/[-_]([A-Z]{1,3})(?=[-_.\s]|$)/g)) out.add(m[1].toLowerCase());
  const lead = /^([A-Z]{1,3})[-_]?\d/.exec(base);
  if (lead) out.add(lead[1].toLowerCase());
  return [...out];
}
const sheetHasDiscipline = (sheet: any, disc: string) => sheetDisciplines(sheet).includes(disc);
const hasDiscipline = (row: any, disc: string) => sheetsOf(row).some((s: any) => sheetHasDiscipline(s, disc));

// ── Composing the CURRENT FULL SET from the register ─────────────────────────
// Reading title blocks at request time cannot answer "what is the whole set
// now". A 68-sheet discipline book is minutes of PDF parsing, and the answer is
// never in one folder anyway: it is a baseline plus every partial issued since.
// The register already stores each set's sheets, written when the set was
// issued, so the current set is a FOLD over those rows rather than a re-read of
// the drawings.
//
// transmittalRows() returns rows newest-first, so the FIRST sighting of a sheet
// number is its current issuance and every later sighting is superseded. That
// ordering is the entire mechanism. Do NOT re-sort these rows by revision LABEL:
// the scheme changes mid-project (letters A/B/C for early addenda, then 2, 3, 6,
// 13), so a label sort returns the superseded sheet.

// A real sheet number is a discipline prefix and a number: "E221", "M-507",
// "FP301A". The register also holds filename-parsed backfill rows that recorded
// a building SERIES instead ("STTQ-01"), which names no single sheet: both the
// E and the M sheet of a bulletin land on that one key. Folding those in would
// collapse two disciplines onto one row and overstate coverage, so they are
// counted out separately where the caller can see them.
const SHEET_NO_RE = /^([A-Z]{1,3})[-_ ]?(\d{2,4}[A-Z]?)$/;

function canonicalSheet(sheet: any): { sheetNo: string; discipline: string } | null {
  const raw = String(sheet?.sheetNo || "").toUpperCase().replace(/\s+/g, "");
  const m = SHEET_NO_RE.exec(raw);
  if (!m) return null;
  // The prefix is the only reliable statement of discipline. The register's own
  // `discipline` field is free text that has held "Electrical", "STTQ" and
  // "General" on the same project, depending on which era wrote the row.
  return { sheetNo: m[1] + m[2], discipline: m[1] };
}

// Conventional AEC set order, not alphabetical: a PM scanning a set expects
// mechanical before electrical. Anything unrecognised sorts last, alphabetically.
// Codes are kept in step with DISCIPLINE_WORDS below, which is the vocabulary
// the search tools already use. Two disagreeing lists of discipline codes in one
// file is a bug waiting to happen.
const DISCIPLINE_ORDER = ["G", "M", "MS", "P", "FP", "FA", "E", "ES", "T", "TS", "EN"];
const DISCIPLINE_NAME: Record<string, string> = {
  G: "General", M: "Mechanical", MS: "Mechanical Site", P: "Plumbing",
  FP: "Fire Protection", FA: "Fire Alarm", E: "Electrical", ES: "Electrical Site",
  T: "Technology", TS: "Technology Security", EN: "Energy",
};
const disciplineRank = (d: string) => {
  const i = DISCIPLINE_ORDER.indexOf(d);
  return i === -1 ? DISCIPLINE_ORDER.length : i;
};
// Sheets sort NUMERICALLY within a discipline. A plain string sort puts E1000
// before E221, which reads as a renumbered set to anyone scanning the list.
const sheetRank = (no: string) => {
  const m = SHEET_NO_RE.exec(no);
  return m ? Number(String(m[2]).replace(/[A-Z]$/, "")) : 0;
};

function composeCurrentSet(rows: any[]) {
  const current = new Map<string, any>();
  const unusable: any[] = [];
  const sourceSets = new Map<string, any>();
  let supersededCount = 0;

  for (const row of rows) {
    const issueDate = registerIssueDate(row);
    const setName = row?.files?.milestoneName || null;
    const transmittalNumber = row?.files?.transmittalNumber || null;
    for (const s of sheetsOf(row)) {
      const c = canonicalSheet(s);
      if (!c) {
        unusable.push({
          recordedAs: s?.sheetNo ?? null,
          filename: s?.filename ?? null,
          fromSet: setName,
          transmittalNumber,
        });
        continue;
      }
      if (current.has(c.sheetNo)) { supersededCount++; continue; }
      current.set(c.sheetNo, {
        sheetNo: c.sheetNo,
        discipline: c.discipline,
        title: String(s?.title || "").replace(/\s+/g, " ").trim() || null,
        revision: s?.revision ?? null,
        revisionDate: s?.revisionDate ?? null,
        issuedIn: setName,
        transmittalNumber,
        issueDate,
        // A backfilled row is a set reconstructed after the fact, not a live
        // send. It is still authoritative, but the difference matters to anyone
        // auditing where a sheet's current revision came from.
        backfilled: row?.files?.backfilled === true,
        folderUrl: row?.sp_folder_url || null,
      });
      const key = `${issueDate}|${setName ?? ""}`;
      let ss = sourceSets.get(key);
      if (!ss) {
        ss = { setName, issueDate, transmittalNumbers: new Set<string>(), currentSheets: 0 };
        sourceSets.set(key, ss);
      }
      ss.currentSheets++;
      if (transmittalNumber) ss.transmittalNumbers.add(transmittalNumber);
    }
  }

  const all = [...current.values()].sort((a, b) =>
    disciplineRank(a.discipline) - disciplineRank(b.discipline) ||
    a.discipline.localeCompare(b.discipline) ||
    sheetRank(a.sheetNo) - sheetRank(b.sheetNo) ||
    a.sheetNo.localeCompare(b.sheetNo));

  const disciplines: any[] = [];
  for (const s of all) {
    let d = disciplines[disciplines.length - 1];
    if (!d || d.discipline !== s.discipline) {
      d = {
        discipline: s.discipline,
        name: DISCIPLINE_NAME[s.discipline] || s.discipline,
        sheetCount: 0,
        sheets: [],
      };
      disciplines.push(d);
    }
    d.sheetCount++;
    // The grouping already states the discipline, so it is left off each sheet:
    // repeating it 190 times is pure response weight.
    const sheet = { ...s };
    delete sheet.discipline;
    d.sheets.push(sheet);
  }

  return {
    disciplines,
    sheetCount: all.length,
    supersededCount,
    sourceSets: [...sourceSets.values()]
      .sort((a, b) => String(b.issueDate).localeCompare(String(a.issueDate)))
      .map((s) => ({ ...s, transmittalNumbers: [...s.transmittalNumbers].sort() })),
    unusable,
  };
}

// ── P0.2: per-FILE supersession status ───────────────────────────────────────
// composeCurrentSet answers "what is the whole set now". This answers the
// narrower question find_document needs: for THIS file, is it the current
// issuance or has a later set replaced it?
//
// The fold is the same one composeCurrentSet uses and for the same reason:
// rows arrive newest-issue-first, so the first sighting of a sheet number is
// current and every later sighting is superseded. What differs is the lookup
// key. A caller here holds a FILENAME, not a sheet number, and the two are not
// reliably related: FP601.pdf carries the Revit model name STTQ-01-P inside,
// and a booked addendum holds many sheets in one PDF. So two routes are tried,
// strongest first, and anything that does not resolve cleanly stays "unknown".
// Guessing here would manufacture the exact wrong-revision risk P0.2 exists to
// remove, so every branch below fails toward "unknown" rather than a verdict.
type SheetStatus = {
  status: "current" | "superseded";
  sheetNo: string;
  discipline: string;
  revision: string | null;
  issuedIn: string | null;
  transmittalNumber: string | null;
  issueDate: string;
  backfilled: boolean;
};

type Registration = {
  sheetNo: string;
  setName: string | null;
  issueDate: string;
  transmittalNumber: string | null;
  revision: string | null;
};

function buildSupersessionIndex(rows: any[]) {
  // sheetNo -> the sheet's CURRENT issuance (first sighting wins: rows arrive
  // newest-issue-first).
  const bySheet = new Map<string, SheetStatus>();
  // filename (lowercased) -> EVERY set that filename was registered in.
  //
  // Every registration is kept, not just the newest, because the same filename
  // is issued repeatedly and a physical copy exists in each set folder:
  // "E211 - GROUND FLOOR PLAN - EAST WING - ELECTRICAL POWER.pdf" sits in
  // Addendum #1, Addendum #2 AND Bulletin #1 on Tabler. Collapsing those to the
  // newest would label the Addendum #1 copy "current", which is precisely the
  // wrong-revision claim this feature exists to prevent.
  const byFilename = new Map<string, Registration[]>();
  let registeredFiles = 0;

  for (const row of rows) {
    const issueDate = registerIssueDate(row);
    const setName = row?.files?.milestoneName || null;
    const transmittalNumber = row?.files?.transmittalNumber || null;
    for (const s of sheetsOf(row)) {
      const fn = String(s?.filename || "").trim().toLowerCase();
      const c = canonicalSheet(s);
      if (c && !bySheet.has(c.sheetNo)) {
        bySheet.set(c.sheetNo, {
          status: "current",
          sheetNo: c.sheetNo,
          discipline: c.discipline,
          revision: s?.revision ?? null,
          issuedIn: setName,
          transmittalNumber,
          issueDate,
          backfilled: row?.files?.backfilled === true,
        });
      }
      if (fn) {
        registeredFiles++;
        let list = byFilename.get(fn);
        if (!list) { list = []; byFilename.set(fn, list); }
        // A registration with no canonical sheet number is still recorded, so
        // "registered but unkeyable" stays distinguishable from "never seen".
        list.push({
          sheetNo: c ? c.sheetNo : "",
          setName, issueDate, transmittalNumber,
          revision: s?.revision ?? null,
        });
      }
    }
  }
  return { bySheet, byFilename, registeredFiles, sets: rows.length };
}

// Resolve ONE PHYSICAL FILE against the index.
//
// folderPath is what makes this answer about the file rather than the sheet.
// The same filename lives in several set folders; which copy you are holding is
// decided by the folder it sits in, so the set name is matched against the path
// before anything is claimed. Returns null when nothing can be said.
function fileSupersessionStatus(
  fileName: string,
  folderPath: string,
  idx: ReturnType<typeof buildSupersessionIndex>,
):
  | (SheetStatus & { basis: string; supersededBy?: SheetStatus })
  | { status: "ambiguous"; basis: string; sheetNumbers: string[] }
  | null {
  const nameLower = String(fileName || "").trim().toLowerCase();
  if (!nameLower) return null;
  const pathLower = String(folderPath || "").toLowerCase();

  const regs = idx.byFilename.get(nameLower);
  let sheetNo = "";
  let mine: Registration | null = null;

  if (regs && regs.length) {
    const keys = new Set(regs.map((r) => r.sheetNo).filter(Boolean));
    if (keys.size > 1) {
      // One filename, two different sheet numbers: the STTQ-01 series collision.
      return {
        status: "ambiguous",
        basis: "this filename is registered against more than one sheet number, so no single revision status applies",
        sheetNumbers: [...keys].sort(),
      };
    }
    if (keys.size === 0) return null; // registered, but never with a usable sheet number
    sheetNo = [...keys][0];
    // Which copy is this? The set folder name appears in the path
    // ("Outgoing/2025-01-21_Addendum #1/Drawings"), so match on it.
    mine = regs.find((r) => r.setName && pathLower.includes(String(r.setName).toLowerCase())) ?? null;
    if (!mine) {
      if (regs.length === 1) {
        mine = regs[0]; // issued once, so there is only one copy it can be
      } else {
        // Registered in several sets and the path names none of them. Which
        // issuance this file is cannot be established, and picking the newest
        // would be a guess in the one direction that causes harm.
        return null;
      }
    }
  } else {
    // Route 2 — the filename itself parses to a sheet number. Only accepted
    // when the stem IS the sheet number, so "P111.pdf" resolves and
    // "2026-05-19 BOYLAN HALL.pdf" does not. Guards the FP601/STTQ-01-P trap.
    const stem = nameLower.replace(/\.[a-z0-9]+$/i, "").toUpperCase().replace(/\s+/g, "");
    const c = canonicalSheet({ sheetNo: stem });
    if (!c || !idx.bySheet.has(c.sheetNo)) return null;
    sheetNo = c.sheetNo;
  }

  const currentRec = idx.bySheet.get(sheetNo);
  if (!currentRec) return null;

  // No registration of its own (route 2): all that can be said is what the
  // sheet's current issuance is, and only if this file could BE that issuance.
  if (!mine) {
    return { ...currentRec, basis: "matched by sheet number parsed from the filename" };
  }

  const isCurrent = mine.issueDate === currentRec.issueDate &&
    (mine.setName ?? null) === (currentRec.issuedIn ?? null);
  if (isCurrent) {
    return { ...currentRec, basis: "matched by filename in the transmittal register" };
  }
  return {
    status: "superseded",
    sheetNo,
    discipline: currentRec.discipline,
    revision: mine.revision,
    issuedIn: mine.setName,
    transmittalNumber: mine.transmittalNumber,
    issueDate: mine.issueDate,
    backfilled: currentRec.backfilled,
    basis: "this copy is from an earlier set; a later set reissued the same sheet",
    supersededBy: currentRec,
  };
}

// ── P2.9 (derived slice): design phase, without a SharePoint column ──────────
// The roadmap wanted Phase as a provisioned column. A column has to be set by
// hand on every upload and is blank the moment someone forgets, which the
// roadmap itself calls out as the reason search returns stale or nothing. The
// phase is already written down in the set name on real projects, so derive it
// the way P0.2 derives status: from something that cannot be left blank.
//
//   2019-11-22_Final CD Submission      2024-01-17_100 DD
//   2026-03-26_SD Interim 2 Progress    2026_02_18 Bid Phase
//   2025-11-18_Updated 100% CD          2026-05-26_SD-2 Updated Option Drawings
//
// WORD BOUNDARIES ARE WRONG HERE. Set names separate with underscores, and \b
// does not fire between "_" and a letter because "_" is a word character, so
// \bSD\b misses "_SD-2" entirely. The separator class below treats anything
// that is not A-Z0-9 as a boundary, which is what makes "_SD" match.
const PHASE_PATTERNS: Array<{ phase: string; re: RegExp }> = [
  // Most specific first. A percentage prefix ("100% CD", "50 DD") is a
  // milestone WITHIN a phase, not a different phase, so it is skipped over.
  { phase: "CD", re: /(?:^|[^A-Z0-9])(?:\d{1,3}\s*%?\s*)?CD\d?(?:[^A-Z0-9]|$)/ },
  { phase: "DD", re: /(?:^|[^A-Z0-9])(?:\d{1,3}\s*%?\s*)?DD\d?(?:[^A-Z0-9]|$)/ },
  { phase: "SD", re: /(?:^|[^A-Z0-9])(?:\d{1,3}\s*%?\s*)?SD\d?(?:[^A-Z0-9]|$)/ },
  { phase: "Bid", re: /(?:^|[^A-Z0-9])BID(?:[^A-Z0-9]|$)/ },
  { phase: "CA", re: /(?:^|[^A-Z0-9])CA(?:[^A-Z0-9]|$)/ },
  { phase: "Programming", re: /(?:^|[^A-Z0-9])PROGRAMMING(?:[^A-Z0-9]|$)/ },
  { phase: "Validation", re: /(?:^|[^A-Z0-9])VALIDATION(?:[^A-Z0-9]|$)/ },
];
// What a set is FOR, when it does not name a phase. An addendum answers bidder
// questions before award; a bulletin, ASI or RFI response is issued against a
// construction contract. These are weaker evidence than a stated phase, so they
// are only consulted second and the basis says which was used.
const PHASE_BY_ACTIVITY: Array<{ phase: string; re: RegExp; what: string }> = [
  { phase: "Bid", re: /(?:^|[^A-Z0-9])ADDEND/, what: "addendum" },
  { phase: "CA", re: /(?:^|[^A-Z0-9])(?:BULLETIN|ASI|RFI)(?:[^A-Z0-9]|$)/, what: "bulletin/ASI/RFI" },
];

function derivePhase(text: string): { phase: string; basis: string } | null {
  const t = String(text || "").toUpperCase();
  if (!t) return null;
  for (const { phase, re } of PHASE_PATTERNS) {
    if (re.test(t)) return { phase, basis: "named in the set folder" };
  }
  for (const { phase, re, what } of PHASE_BY_ACTIVITY) {
    if (re.test(t)) return { phase, basis: `inferred from ${what}` };
  }
  return null;
}
// Accept what people type: "cd", "100% CD", "Construction Documents".
const PHASE_ALIASES: Record<string, string> = {
  SD: "SD", SCHEMATIC: "SD", "SCHEMATIC DESIGN": "SD",
  DD: "DD", "DESIGN DEVELOPMENT": "DD",
  CD: "CD", "CONSTRUCTION DOCUMENTS": "CD", "CONSTRUCTION DOCUMENT": "CD",
  BID: "Bid", BIDDING: "Bid",
  CA: "CA", "CONSTRUCTION ADMINISTRATION": "CA",
  PROGRAMMING: "Programming", VALIDATION: "Validation",
};
function normalisePhase(input: string): string | null {
  const raw = String(input || "").toUpperCase().replace(/\d{1,3}\s*%?\s*/g, "").trim();
  return PHASE_ALIASES[raw] ?? null;
}

mcp.tool("get_current_set", {
  description:
    "Authoritative answer to \"what is the current issued set?\" for a project — the drawing/spec set " +
    "most recently transmitted, with its transmittal number, issue date, sheet register (sheet number, " +
    "title, revision, discipline) and a clickable folder link. Reads the transmittal register, which " +
    "records every set issued through the Setty transmittal tool. If the project has no transmittal " +
    "record, falls back to the newest dated folder under Outgoing and flags the answer inferred:true. " +
    "AN INFERRED ANSWER IS A STRONG LEAD, NOT A GUARANTEE — when repeating one, say it was inferred " +
    "from the folder structure and that no transmittal was logged. Never present a superseded set as " +
    "current.",
  inputSchema: z.object({
    projectNumber: z.string().describe("Project number OR project name. Pipeline projects (proposals and pursuits) have no number until the job is won, so use the name for those."),
    discipline: z.string().optional().describe("Return the newest set containing this discipline, e.g. 'M', 'E', 'FP'. Omit for the newest set overall."),
  }),
  handler: async ({ projectNumber, discipline }) => {
    const pid = await resolveProjectId(projectNumber);
    if (!pid) {
      return asText({
        error: `No project matching "${projectNumber}".`,
        nextStep: "Confirm the number with search_projects, then call again.",
      });
    }
    const p = await getProjectById(pid);
    const project = p?.projectNumber || projectNumber;
    const disc = (discipline ?? "").toLowerCase().trim();

    let rows: any[] = [];
    try {
      rows = await transmittalRows(pid);
    } catch (e) {
      return asText({
        project,
        error: `Could not read the transmittal register: ${String((e as any)?.message ?? e)}`,
        nextStep: "This is a lookup failure, not an empty result — do not conclude the project has no issued set.",
      });
    }

    // ── Authoritative path. Rows come back newest-first. A discipline filter asks
    // for the newest set CONTAINING that discipline, which is not always the newest
    // set overall: a Bulletin covering only mechanical leaves the current electrical
    // set several transmittals back.
    const candidates = disc ? rows.filter((r) => hasDiscipline(r, disc)) : rows;
    if (candidates.length) {
      const latest = candidates[0];
      const f = latest.files || {};
      // ONE SET IS SEVERAL REGISTER ROWS. The transmittal tool writes a row per
      // discipline, so Addendum #1 is four rows (T-014..T-017) that share a set
      // name and issue date. Reading only candidates[0] reported a single
      // discipline's slice as "the current set" and silently dropped the rest.
      const setKey = (r: any) => `${registerIssueDate(r)}|${r?.files?.milestoneName ?? ""}`;
      const key = setKey(latest);
      const setRows = candidates.filter((r) => setKey(r) === key);
      const seenSheet = new Set<string>();
      const all = setRows.flatMap((r) => sheetsOf(r)).filter((s: any) => {
        // The same sheet can appear in two rows of one set when a discipline was
        // transmitted twice. Collapse on sheet number so the count is honest.
        const k = String(s?.sheetNo || "").toUpperCase().replace(/\s+/g, "") + "|" + String(s?.filename || "");
        if (seenSheet.has(k)) return false;
        seenSheet.add(k);
        return true;
      });
      const sheets = disc ? all.filter((s: any) => sheetHasDiscipline(s, disc)) : all;
      // Prior sets are listed once each, not once per discipline row, or the
      // list is five rows of the same addendum.
      const priorSeen = new Set<string>();
      const priorSets: any[] = [];
      for (const r of candidates) {
        const k = setKey(r);
        if (k === key || priorSeen.has(k)) continue;
        priorSeen.add(k);
        if (priorSets.length >= 5) break;
        priorSets.push({
          setName: r.files?.milestoneName || null,
          transmittalNumber: r.files?.transmittalNumber || null,
          issueDate: registerIssueDate(r),
          superseded: true,
        });
      }
      return asText({
        project,
        inferred: false,
        basis: "Transmittal register (pms_filing_log), the record written when the set was issued.",
        current: {
          setName: f.milestoneName || null,
          transmittalNumber: f.transmittalNumber || null,
          // Every transmittal that makes up this one set. A set issued per
          // discipline carries several, and naming only the first understates
          // what was sent.
          transmittalNumbers: [...new Set(setRows.map((r: any) => r.files?.transmittalNumber).filter(Boolean))].sort(),
          issueDate: registerIssueDate(latest),
          issueDateFrom: registerIssueDateSource(latest),
          filedAt: latest.created_at,
          issuedTo: f.recipientEmail || null,
          deliveryKind: f.distributionKind || null,
          webUrl: latest.sp_folder_url || null,
          // A backfilled row is a set reconstructed after the fact. Authoritative,
          // but not a live send, and the difference matters if anyone audits it.
          backfilled: f.backfilled === true,
          sheetCount: sheets.length,
          sheets,
        },
        ...(disc ? { disciplineFilter: discipline } : {}),
        // The commonest misreading of this tool: a bulletin covering 8 sheets is
        // the current SET, but it is not the current sheet list for the job.
        fullSetHint: "This is the most recently ISSUED SET, not the whole job. For every sheet on the project " +
          "at its most recent issuance, grouped by discipline, call extract_sheet_index with no subfolder.",
        ...(sheets.length ? {} : {
          sheetRegisterNote:
            "This transmittal has no sheet register. Sets issued before the register was added to the " +
            "transmittal tool recorded only the set itself, so the set is authoritative but its sheet " +
            "list is not available here — open the folder link to see the contents.",
        }),
        ...(priorSets.length ? { priorSets } : {}),
        ...(latest.sp_folder_url ? {} : {
          linkNote: "No folder link was recorded on this transmittal. Use list_project_documents with subfolder:'Outgoing' to locate it.",
        }),
      });
    }

    // ── Inference fallback. Per the register's real coverage this is the common
    // case today, not the exception, so the basis has to be specific enough that
    // the reader can judge it rather than a bare "inferred".
    const discNote = disc && rows.length
      ? `The register has ${rows.length} transmittal(s) for this project but none recording discipline "${discipline}". Falling back to folder inference for the set overall.`
      : null;
    try {
      const driveId = await docDriveId();
      const folder = await findProjectFolderInDrive(driveId, String(project).toLowerCase().trim());
      if (!folder) {
        return asText({
          project, inferred: true, current: null,
          reason: `No folder for ${project} in the ${DOC_LIBRARY}, and no transmittal record.`,
          nextStep: "The project is most likely not provisioned in SharePoint yet. Confirm with list_project_documents.",
        });
      }
      // Folder names carry numbering and emoji prefixes ("99 📤 Outgoing"), so match
      // on CONTAINS. An exact-path lookup returns nothing on most projects.
      const top = await graphGet(`/drives/${driveId}/items/${folder.id}/children?$select=id,name,folder,webUrl&$top=200`);
      const outgoing = (top.value || []).find((it: any) => it.folder && String(it.name).toLowerCase().includes("outgoing"));
      if (!outgoing) {
        return asText({
          project, inferred: true, current: null,
          reason: "No transmittal record, and no Outgoing folder in this project's SharePoint folder.",
          nextStep: "Nothing has been issued through the transmittal tool and there is no Outgoing folder to infer from. Ask the PM directly.",
          ...(discNote ? { disciplineNote: discNote } : {}),
        });
      }
      const kids = await graphGet(`/drives/${driveId}/items/${outgoing.id}/children?$select=id,name,folder,webUrl,lastModifiedDateTime&$top=200`);
      const sets = (kids.value || [])
        .filter((it: any) => it.folder)
        .map((it: any) => ({ name: it.name, webUrl: it.webUrl, dateInName: setFolderDate(it.name), modified: it.lastModifiedDateTime }))
        .sort((a: any, b: any) => String(b.dateInName || "").localeCompare(String(a.dateInName || "")));
      if (!sets.length) {
        return asText({
          project, inferred: true, current: null,
          reason: "No transmittal record, and the Outgoing folder has no set subfolders.",
          outgoingUrl: outgoing.webUrl || null,
          nextStep: "Nothing appears to have been issued yet. Confirm with the PM before relying on this.",
        });
      }
      const newest = sets[0];
      const dated = sets.filter((s: any) => s.dateInName);
      return asText({
        project,
        inferred: true,
        basis: newest.dateInName
          ? `No transmittal was logged for this project. Inferred from the newest dated folder under Outgoing: "${newest.name}" (date read from the folder name, ${newest.dateInName}), out of ${sets.length} set folder(s).`
          : `No transmittal was logged for this project, and no folder under Outgoing carries a date in its name, so ordering is not reliable. Showing "${newest.name}" out of ${sets.length} set folder(s).`,
        confidence: newest.dateInName ? "dated folder name" : "low — undated folder names",
        current: {
          setName: newest.name,
          transmittalNumber: null,
          issueDate: newest.dateInName,
          webUrl: newest.webUrl || null,
          sheets: [],
        },
        sheetRegisterNote: "Inferred sets have no sheet register. Open the folder link, or use list_project_documents with subfolder:'Outgoing/<set name>'.",
        priorSets: dated.slice(1, 6).map((s: any) => ({ setName: s.name, issueDate: s.dateInName, webUrl: s.webUrl })),
        nextStep: "Issuing this set through the transmittal tool would make it authoritative here instead of inferred.",
        ...(discNote ? { disciplineNote: discNote } : {}),
      });
    } catch (e) {
      return asText({
        project, inferred: true, current: null,
        error: `No transmittal record, and the SharePoint fallback failed: ${String((e as any)?.message ?? e)}`,
        nextStep: "This is a lookup failure, not proof that nothing was issued.",
      });
    }
  },
});

mcp.tool("list_project_documents", {
  description:
    "List a project's SharePoint files/folders across ALL document libraries on the site. THREE modes: " +
    "(1) projectNumber (default) — finds the project's folder by NUMBER in each library (works for the main " +
    "Project Document Library + Documents: drawings and specs; the EMAIL folder holds attachments received " +
    "FROM others (agency/contractor review comments, markups, transmittals sent to us) and files there whose " +
    "names contain 'COMMENTS' are HIGH-VALUE design-review feedback, usually named by phase or party such as " +
    "'Owner Comments', 'DD Comments', 'CD Comments'; the OUTGOING folder holds document sets WE issued " +
    "(submissions, addenda, bulletins); the PROJECT MANAGEMENT folder holds meeting minutes and agendas; " +
    "DESIGN folders hold Setty's own internal calculations and working analysis and are INTERNAL ONLY, never " +
    "client-facing) and lists its files, " +
    "each tagged with `library`. (2) folderMatch + library — the Proposals, Contract, and Contract Library " +
    "libraries are Dynamics-based and name folders by PROJECT/CLIENT NAME, not number (e.g. '2026 — NYS " +
    "Museum Plan', 'Buro Happold Engineering_HPCM Refrigeration Upgrade'), so pass folderMatch with a " +
    "distinctive word from the project name (e.g. 'Tabler') + library:'Proposals' to find the folder(s). " +
    "(3) folderId — list the contents of a specific folder returned by a prior call (folders carry a " +
    "composite itemId you can pass straight back here). Then call read_document on a file's itemId. Treat " +
    "MEETING MINUTES and DRAWING REVIEW COMMENTS/RESPONSES as HIGH-VALUE ('Dr. Checks' / DrChecks = the agencies' design-review comment system, so 'Dr. Checks comments' means AGENCY review comments). The default (projectNumber) result " +
    "also lists availableLibraries + librariesWithProject + a hint for reaching proposals/contracts.",
  inputSchema: z.object({
    projectNumber: z.string().optional().describe("Project number, e.g. SAPX256015.00 — matches folders named by NUMBER (Project Document Library, Documents)."),
    subfolder: z.string().optional().describe("Relative path inside the matched folder, e.g. 'Outgoing' or 'Outgoing/2025-01-21_Addendum #1/Specifications'. Works with projectNumber or folderId."),
    library: z.string().optional().describe("Scope to one library by name (e.g. 'Proposals', 'Contract Library'). Recommended with folderMatch."),
    folderMatch: z.string().optional().describe("Find folders whose NAME contains this text (case-insensitive) — for Proposals/Contract libraries (named by project/client name). Pass a distinctive word from the project name. Returns matching folders; then call with folderId to open one. Empty string with a library = browse that library's folders."),
    folderId: z.string().optional().describe("Composite 'driveId|itemId' of a folder (from a prior result) to list its contents directly."),
  }),
  handler: async ({ projectNumber, subfolder, library, folderMatch, folderId }) => {
    try {
      const drives = await siteDrives();
      const rel = subfolder && subfolder.trim() ? subfolder.trim().replace(/^\/+|\/+$/g, "").split("/").map(encodeURIComponent).join("/") : "";
      // Mode 3: open a specific folder by composite id.
      if (folderId && String(folderId).trim()) {
        const bar = folderId.indexOf("|");
        const dId = bar > 0 ? folderId.slice(0, bar) : await docDriveId();
        const fId = bar > 0 ? folderId.slice(bar + 1) : folderId;
        const libName = (drives.find((d) => d.id === dId) || { name: "" }).name;
        const listPath = (rel
          ? `/drives/${dId}/items/${fId}:/${rel}:/children`
          : `/drives/${dId}/items/${fId}/children`) + "?$select=id,name,size,folder,file,lastModifiedDateTime&$top=200";
        const page = await listChildren(listPath);
        const items = (page.value || []).map((it: any) => ({
          itemId: dId + "|" + it.id, name: it.name, type: it.folder ? "folder" : "file",
          library: libName, size: it.size, modified: it.lastModifiedDateTime,
          ext: it.file ? (String(it.name).split(".").pop() || "").toLowerCase() : undefined,
        }));
        return asText({
          folderId, library: libName, path: subfolder || "/", count: items.length, items,
          ...(page.truncated ? { truncated: true, coverageWarning: `This folder holds more than ${MAX_FOLDER_PAGES * 200} entries and the listing stopped there. Treat it as a PARTIAL listing — open a subfolder to narrow it.` } : {}),
        });
      }
      const wanted = library ? drives.filter((d) => d.name.toLowerCase() === library.toLowerCase()) : drives;
      // Mode 2: find folders by NAME (Proposals/Contracts). Triggered by folderMatch, or by
      // a library with no projectNumber (browse).
      if (folderMatch !== undefined || (library && !projectNumber)) {
        const needle = String(folderMatch ?? "").trim().toLowerCase();
        const per = await Promise.all(wanted.map(async (dr) => {
          try {
            const folders = await findFoldersByName(dr.id, needle, 25);
            return folders.map((f: any) => ({ itemId: dr.id + "|" + f.id, name: f.name, type: "folder", library: dr.name }));
          } catch { return [] as any[]; }
        }));
        const folders = per.flat();
        return asText({
          folderMatch: folderMatch ?? "", library: library || "(all libraries)", count: folders.length, folders,
          note: folders.length ? "Pick a folder and call again with its itemId as folderId to list its contents." : `No folder containing \"${folderMatch ?? ""}\" found in ${library || "any library"}.`,
        });
      }
      // Mode 1: default — find the project folder by NUMBER across libraries, list its children.
      const num = (projectNumber || "").toLowerCase().trim();
      if (!num) return asText({ error: "Provide projectNumber, OR folderMatch (+ library) to find a folder by name, OR folderId to open a folder." });
      const per = await Promise.all(wanted.map(async (dr) => {
        let folder: any = null;
        try { folder = await findProjectFolderInDrive(dr.id, num); } catch { return null; }
        if (!folder) return null;
        const listPath = (rel
          ? `/drives/${dr.id}/items/${folder.id}:/${rel}:/children`
          : `/drives/${dr.id}/items/${folder.id}/children`) + "?$select=id,name,size,folder,file,lastModifiedDateTime&$top=200";
        try {
          const page = await listChildren(listPath);
          return { name: dr.name, truncated: page.truncated, items: (page.value || []).map((it: any) => ({
            itemId: dr.id + "|" + it.id, name: it.name, type: it.folder ? "folder" : "file",
            library: dr.name, size: it.size, modified: it.lastModifiedDateTime,
            ext: it.file ? (String(it.name).split(".").pop() || "").toLowerCase() : undefined,
          })) };
        } catch { return { name: dr.name, truncated: false, items: [] as any[] }; }
      }));
      const found = per.filter(Boolean) as Array<{ name: string; truncated: boolean; items: any[] }>;
      const items = found.flatMap((f) => f.items);
      const partialLibs = found.filter((f) => f.truncated).map((f) => f.name);
      return asText({
        project: projectNumber, path: subfolder || "/",
        availableLibraries: drives.map((d) => d.name), librariesWithProject: found.map((f) => f.name),
        count: items.length, items,
        ...(partialLibs.length ? { truncated: true, coverageWarning: `Listing stopped at ${MAX_FOLDER_PAGES * 200} entries in ${partialLibs.join(", ")}. Treat it as a PARTIAL listing — open a subfolder to narrow it.` } : {}),
        hint: "Proposals/Contract libraries are named by project/client NAME, not number. To reach this project's proposal or contract folder, call again with folderMatch:'<distinctive word from the project name>' + library:'Proposals' (or 'Contract Library'), then folderId to open it.",
      });
    } catch (e) {
      return asText({ error: String((e as any)?.message ?? e) });
    }
  },
});

mcp.tool("read_document", {
  description:
    "Extract the text of one SharePoint document by its itemId (from list_project_documents). " +
    "Handles PDF, Word (.docx), Excel (.xlsx/.xls — each sheet rendered as rows), and " +
    "plain-text/HTML/CSV. For LARGE PDFs (spec books / project manuals) extraction is " +
    "page-bounded from page 1 — pass find:'keyword' (e.g. a spec section '15230') to jump to " +
    "the page(s) containing it, or pages:'120-140' for a range (the result reports totalPages). " +
    "MEETING MINUTES and DRAWING REVIEW COMMENTS/RESPONSES are HIGH-VALUE. Any file whose NAME contains " +
    "'COMMENTS' is agency or contractor design-review feedback: they are named by phase or party such as " +
    "'Owner Comments', 'DD Comments', 'CD Comments', and they arrive in the project's EMAIL folder. " +
    "'Dr. Checks' / DrChecks is the same thing under the agencies' review-system name, so 'Dr. Checks " +
    "comments' means AGENCY review comments. These are often Excel comment logs / registers or DrChecks " +
    "exports — read them in full and note the specific comments and their responses. Large files and other " +
    "binaries (drawings, images, .doc/.ppt) return metadata + a webUrl.",
  inputSchema: z.object({
    itemId: z.string().describe("driveItem id from list_project_documents (may be a 'driveId|itemId' composite spanning libraries)"),
    find: z.string().optional().describe("PDF only: jump to the page(s) whose text contains this keyword/phrase (case-insensitive), e.g. a spec section number '15230' or a term like 'DIRECT-BURIED'. The best way to reach a specific section of a large manual."),
    pages: z.string().optional().describe("PDF only: extract an explicit page range, e.g. '120-140' or '75'. Use after seeing totalPages, or to read around a find hit."),
  }),
  handler: async ({ itemId, find, pages }) => {
    try {
      const bar = itemId.indexOf("|");
      const drive = bar > 0 ? itemId.slice(0, bar) : await docDriveId();
      const realId = bar > 0 ? itemId.slice(bar + 1) : itemId;
      const meta = await graphGet(`/drives/${drive}/items/${encodeURIComponent(realId)}?$select=id,name,size,file,webUrl`);
      const name = meta.name || "";
      const ext = (name.split(".").pop() || "").toLowerCase();
      const size = meta.size ?? 0;
      const base = { itemId, name, size, webUrl: meta.webUrl };
      if (size > MAX_DOC_BYTES) return asText({ ...base, note: "File too large to extract inline — open via webUrl." });
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/drives/${drive}/items/${encodeURIComponent(realId)}/content`,
        { headers: { Authorization: "Bearer " + (await graphToken()) } },
      );
      if (!res.ok) return asText({ ...base, error: `Graph content ${res.status}` });
      let text = "";
      if (ext === "pdf") {
        try {
          const { getDocumentProxy } = await import("unpdf");
          const pdf: any = await getDocumentProxy(new Uint8Array(await res.arrayBuffer()));
          const total: number = pdf.numPages;
          const MAX_PAGES = 50;
          const pageText = async (i: number): Promise<string> => {
            const pg = await pdf.getPage(i);
            const tc = await pg.getTextContent();
            return (tc.items as any[]).map((it) => (it && it.str) || "").join(" ").replace(/ +/g, " ").trim();
          };
          const capPdf = (t: string) => t.length > MAX_DOC_CHARS ? t.slice(0, MAX_DOC_CHARS) + "\n…[truncated]" : t;
          if (find && String(find).trim()) {
            const term = String(find).trim().toLowerCase();
            const scanCap = Math.min(total, 800);
            const hits: number[] = [];
            for (let i = 1; i <= scanCap && hits.length < MAX_PAGES; i++) {
              if ((await pageText(i)).toLowerCase().includes(term)) hits.push(i);
            }
            if (!hits.length) {
              return asText({ ...base, ext, totalPages: total,
                note: `\"${find}\" not found in the extractable text of the first ${scanCap} of ${total} page(s). It may be a scanned/image-only section — open via webUrl, or try pages:\"X-Y\".` });
            }
            const parts: string[] = [];
            for (const i of hits) parts.push(`[p.${i}]\n` + (await pageText(i)));
            const body = parts.join("\n\n");
            return asText({ ...base, ext, totalPages: total, matchedPages: hits,
              note: `Found \"${find}\" on page(s) ${hits.join(", ")}${total > scanCap ? ` (scanned first ${scanCap})` : ""}. Use pages:\"X-Y\" to read around them.`,
              chars: body.length, truncated: body.length > MAX_DOC_CHARS, text: capPdf(body) });
          }
          let startP = 1, endP = total;
          if (pages && String(pages).trim()) {
            const m = String(pages).match(/(\d+)\s*(?:[-–]\s*(\d+))?/);
            if (m) { startP = Math.max(1, parseInt(m[1], 10)); endP = m[2] ? Math.min(total, parseInt(m[2], 10)) : startP; }
          }
          if (endP < startP) endP = startP;
          if (endP - startP + 1 > MAX_PAGES) endP = startP + MAX_PAGES - 1;
          endP = Math.min(endP, total);
          const parts: string[] = [];
          for (let i = startP; i <= endP; i++) parts.push(`[p.${i}]\n` + (await pageText(i)));
          const body = parts.join("\n\n");
          const partial = startP > 1 || endP < total;
          return asText({ ...base, ext, totalPages: total, pagesShown: `${startP}-${endP}`,
            note: partial ? `Showing pages ${startP}-${endP} of ${total}. Use find:\"keyword\" to jump to a section, or pages:\"X-Y\" for another range.` : `${total} page(s).`,
            chars: body.length, truncated: body.length > MAX_DOC_CHARS, text: capPdf(body) });
        } catch (e) {
          return asText({ ...base, error: "PDF text extraction failed: " + String((e as any)?.message ?? e) });
        }
      } else if (["txt", "csv", "md", "json", "xml"].includes(ext)) {
        text = await res.text();
      } else if (ext === "html" || ext === "htm") {
        text = htmlToText(await res.text());
      } else if (ext === "docx") {
        try {
          const { unzipSync, strFromU8 } = await import("npm:fflate@0.8.2");
          const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));
          const docXml = zip["word/document.xml"];
          if (!docXml) return asText({ ...base, note: "DOCX had no readable document.xml — open via webUrl." });
          text = strFromU8(docXml)
            .replace(/<w:tab[^>]*\/?>/g, "\t").replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
            .replace(/\n{3,}/g, "\n\n").trim();
        } catch (e) {
          return asText({ ...base, error: "DOCX text extraction failed: " + String((e as any)?.message ?? e) });
        }
      } else if (ext === "xlsx" || ext === "xls" || ext === "xlsm") {
        try {
          const mod: any = await import("npm:xlsx@0.18.5");
          const XLSX: any = mod.read ? mod : mod.default;
          const wb = XLSX.read(new Uint8Array(await res.arrayBuffer()), { type: "array" });
          const parts: string[] = [];
          for (const sheetName of (wb.SheetNames || [])) {
            const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName], { blankrows: false });
            if (csv && csv.trim()) parts.push("# Sheet: " + sheetName + "\n" + csv.trim());
          }
          text = parts.join("\n\n");
        } catch (e) {
          return asText({ ...base, error: "Excel extraction failed: " + String((e as any)?.message ?? e) });
        }
      } else {
        return asText({ ...base, note: `No text extractor for .${ext} yet (likely a drawing/image or .doc/.ppt binary) — open via webUrl.` });
      }
      const truncated = text.length > MAX_DOC_CHARS;
      return asText({ ...base, ext, chars: text.length, truncated, text: truncated ? text.slice(0, MAX_DOC_CHARS) + "\n…[truncated]" : text });
    } catch (e) {
      return asText({ error: String((e as any)?.message ?? e) });
    }
  },
});

// ─── PROJECT FILE INDEX + RANKED RETRIEVAL (roadmap P0.3) ───────────────────
// The pitch this serves is "here is a faster door", not "change where you save".
// Someone asks for the current fire protection narrative and gets a link before
// they could have navigated the folder tree. That means the whole project tree
// has to be in hand at scoring time, so the walk is cached per project rather
// than re-run per call.
const TREE_TTL = 300000;
const TREE_MAX_FILES = 4000;
const TREE_MAX_REQUESTS = 150;
// How many sibling folders to read at once. Graph throttles per app, so this is
// a balance rather than "as high as possible": 8 turns a ~150-request walk from
// ~150 serial round trips into ~19 waves without pushing hard enough to earn a
// 429, which would cost far more than it saved.
const TREE_CONCURRENCY = 8;
// One shape for the walk and the cached copy alike, so callers infer the same
// types whichever layer answered.
type TreeFile = {
  itemId: string; name: string; library: string; folderPath: string;
  webUrl: string; modified: string | null; size: number; ext: string;
};
type ProjectTree = { at: number; files: TreeFile[]; libraries: string[]; truncated: boolean };
const _treeCache = new Map<string, ProjectTree>();

// One file row, shaped the same whether it came from the whole-project walk or
// from a path-scoped one. `folderPath` is relative to the PROJECT ROOT in both,
// which is what lets a caller filter either result set the same way.
function treeFileRow(driveId: string, driveName: string, it: any, nodePath: string): TreeFile {
  return {
    itemId: driveId + "|" + it.id,
    name: it.name,
    library: driveName,
    folderPath: nodePath || "/",
    webUrl: it.webUrl || null,
    modified: it.lastModifiedDateTime || null,
    size: it.size,
    ext: (String(it.name).split(".").pop() || "").toLowerCase(),
  };
}

// The in-memory Map only helps within one isolate, and edge isolates are short
// lived, so it was missing on nearly every call. The shared copy in Postgres is
// what actually makes a repeat question fast: one SELECT instead of ~150 Graph
// round trips. Both layers use the same TTL, and a failure in either falls
// through to the walk, so the cache can never be the reason an answer is wrong
// or missing.
async function treeFromDb(numPrefix: string): Promise<ProjectTree | null> {
  try {
    const rows = await sbGet(
      "pms_mcp_tree_cache?select=cached_at,file_count,truncated,libraries,files" +
      "&project_prefix=eq." + encodeURIComponent(numPrefix) + "&limit=1");
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return null;
    const at = Date.parse(row.cached_at);
    if (!Number.isFinite(at) || Date.now() - at >= TREE_TTL) return null;
    return {
      at,
      files: Array.isArray(row.files) ? row.files : [],
      libraries: Array.isArray(row.libraries) ? row.libraries : [],
      truncated: !!row.truncated,
    };
  } catch (e) {
    console.warn("[tree-cache] read failed:", String((e as any)?.message ?? e));
    return null;
  }
}

async function treeToDb(numPrefix: string, out: { files: any[]; libraries: string[]; truncated: boolean }) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/pms_mcp_tree_cache?on_conflict=project_prefix`, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        project_prefix: numPrefix,
        cached_at: new Date().toISOString(),
        file_count: out.files.length,
        truncated: out.truncated,
        libraries: out.libraries,
        files: out.files,
      }),
    });
    if (!res.ok) console.warn("[tree-cache] write", res.status, (await res.text()).slice(0, 200));
  } catch (e) {
    console.warn("[tree-cache] write failed:", String((e as any)?.message ?? e));
  }
}

async function projectTree(numPrefix: string): Promise<ProjectTree> {
  const hit = _treeCache.get(numPrefix);
  if (hit && Date.now() - hit.at < TREE_TTL) return hit;

  const shared = await treeFromDb(numPrefix);
  if (shared) { _treeCache.set(numPrefix, shared); return shared; }

  const drives = await siteDrives();
  const files: any[] = [];
  const libraries: string[] = [];
  let requests = 0;
  let truncated = false;

  for (const dr of drives) {
    let root: any = null;
    try { root = await findProjectFolderInDrive(dr.id, numPrefix); } catch { continue; }
    if (!root) continue;
    libraries.push(dr.name);

    // Breadth-first, one LEVEL at a time, with the folders in each level read
    // concurrently. Depth-first would spend the whole request budget inside one
    // set folder and never reach its siblings, so the shallow high-signal
    // folders would be exactly the ones missed. Level-at-a-time preserves that
    // ordering while letting the slow part overlap.
    //
    // The walk was sequential until 2026-08-05 and cost 16-30 SECONDS per call,
    // measured by the telemetry added the same day: ~150 Graph round trips at
    // roughly 150ms each, run one after another. Nothing about the work needed
    // to be serial. Sibling folders are independent, so the only ordering that
    // matters is between levels, not within one.
    let level: Array<{ id: string; path: string }> = [{ id: root.id, path: "" }];
    while (level.length && requests < TREE_MAX_REQUESTS && files.length < TREE_MAX_FILES) {
      const nextLevel: Array<{ id: string; path: string }> = [];
      for (let i = 0; i < level.length; i += TREE_CONCURRENCY) {
        if (requests >= TREE_MAX_REQUESTS || files.length >= TREE_MAX_FILES) { truncated = true; break; }
        const batch = level.slice(i, i + TREE_CONCURRENCY);
        // Budget is claimed BEFORE dispatch so a batch cannot overshoot the cap
        // by its own width. Each folder needs at least one request; extra pages
        // are counted as they happen.
        requests += batch.length;
        const pages = await Promise.all(batch.map(async (node) => {
          const out: any[] = [];
          let url = `/drives/${dr.id}/items/${node.id}/children` +
            "?$select=id,name,folder,file,webUrl,lastModifiedDateTime,size&$top=200";
          let extra = 0;
          while (url) {
            let page: any;
            try { page = await graphGet(url); } catch { break; }
            out.push(...(page.value || []));
            const next = page["@odata.nextLink"];
            url = next ? next.replace("https://graph.microsoft.com/v1.0", "") : "";
            if (url) extra++;
          }
          return { node, items: out, extra };
        }));
        for (const { node, items, extra } of pages) {
          requests += extra;
          for (const it of items) {
            const path = node.path ? node.path + "/" + it.name : it.name;
            if (it.folder) {
              nextLevel.push({ id: it.id, path });
            } else if (files.length < TREE_MAX_FILES) {
              files.push(treeFileRow(dr.id, dr.name, it, node.path));
            } else { truncated = true; }
          }
        }
      }
      level = nextLevel;
    }
    if (level.length && (requests >= TREE_MAX_REQUESTS || files.length >= TREE_MAX_FILES)) truncated = true;
  }
  const out = { at: Date.now(), files, libraries, truncated };
  _treeCache.set(numPrefix, out);
  // Publish for the next isolate. Awaited rather than fired and forgotten: an
  // edge function can be torn down as soon as it responds, and a write that
  // loses that race would leave every call paying for the walk, which is the
  // bug this exists to fix.
  await treeToDb(numPrefix, out);
  return out;
}

// ── Path-scoped crawl. The whole-project walk is the WRONG tool once the caller
// has already named the folder they mean.
//
// TREE_MAX_REQUESTS bounds projectTree across the ENTIRE project, breadth-first
// across every library. On a large job the budget runs out before the walk
// reaches deep set subfolders, so those files are simply absent from
// `tree.files` — and a caller filtering that array by path concludes "no files
// found under X", which reads as a bad path when the path is fine.
//
// Confirmed on SAPX196006.00 (Tabler) on 2026-08-01: the 68 sheet PDFs under
// `Outgoing/2024-10-24_Revised 100% CD Submission/INDIVIDUAL PDF's/<DISCIPLINE>`
// were invisible, while under `Outgoing/2025-01-21_Addendum #1` the sibling
// `Specifications` folder WAS present and `Drawing` was not. So it is ORDER
// dependent, not a depth rule anyone could predict or work around.
//
// Resolving the named path directly costs one Graph call and spends the whole
// budget beneath it, which is why this exists rather than a bigger cap.
const SUBTREE_MAX_REQUESTS = 120;

async function subtreeFiles(numPrefix: string, rel: string): Promise<{
  files: any[];
  truncated: boolean;
  resolvedIn: string[];
  scanned: number;
}> {
  const relClean = String(rel || "").replace(/^\/+|\/+$/g, "");
  const encoded = relClean.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const drives = await siteDrives();
  const files: any[] = [];
  const resolvedIn: string[] = [];
  let requests = 0;
  let truncated = false;

  for (const dr of drives) {
    let root: any = null;
    try { root = await findProjectFolderInDrive(dr.id, numPrefix); } catch { continue; }
    if (!root) continue;

    // The path API 404s when the folder is absent from THIS library, which is
    // the normal case for most of the ~37 libraries. Not an error, just a miss.
    let start: any = root;
    if (encoded) {
      try {
        start = await graphGet(
          `/drives/${dr.id}/items/${root.id}:/${encoded}:?$select=id,name,folder`,
        );
        requests++;
      } catch { continue; }
    }
    if (!start || !start.folder) continue;
    resolvedIn.push(dr.name);

    const queue: Array<{ id: string; path: string }> = [{ id: start.id, path: relClean }];
    while (queue.length) {
      if (requests >= SUBTREE_MAX_REQUESTS || files.length >= TREE_MAX_FILES) { truncated = true; break; }
      const node = queue.shift()!;
      let url = `/drives/${dr.id}/items/${node.id}/children` +
        "?$select=id,name,folder,file,webUrl,lastModifiedDateTime,size&$top=200";
      while (url) {
        if (requests >= SUBTREE_MAX_REQUESTS) { truncated = true; break; }
        let page: any;
        try { page = await graphGet(url); } catch { break; }
        requests++;
        for (const it of (page.value || [])) {
          const path = node.path ? node.path + "/" + it.name : it.name;
          if (it.folder) {
            queue.push({ id: it.id, path });
          } else if (files.length < TREE_MAX_FILES) {
            files.push(treeFileRow(dr.id, dr.name, it, node.path));
          } else { truncated = true; }
        }
        const next = page["@odata.nextLink"];
        url = next ? next.replace("https://graph.microsoft.com/v1.0", "") : "";
      }
    }
  }
  return { files, truncated, resolvedIn, scanned: requests };
}

// ── Pure scoring. Kept free of Graph and DB calls so it can be tested directly;
// see findDocument.test.mjs.
const norm = (s: string) => String(s || "").toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
const STOPWORDS = new Set(["the", "a", "an", "of", "for", "and", "to", "in", "on", "current", "latest", "newest", "me", "get", "find", "show", "please"]);

// The firm's own vocabulary. "Design criteria" is almost never what the file is
// called: the same document ships as an OPR, a Basis of Design, or a Narrative.
const DOC_TYPE_WORDS: Record<string, string[]> = {
  Narrative: ["narrative", "basis of design", "bod", "opr", "owners project requirements", "design report", "criteria"],
  Calc: ["calc", "calculation", "calculations", "load", "sizing", "takeoff"],
  Spec: ["spec", "specs", "specification", "specifications", "division"],
  "Comment Log": ["comment", "comments", "drchecks", "dr checks", "response", "responses", "backcheck"],
  Transmittal: ["transmittal", "cover sheet"],
  Minutes: ["minutes", "meeting notes", "mtg", "notes"],
  Report: ["report", "survey", "study", "assessment", "scorecard"],
};
// Phrases only. The bare codes used to live in here too ("fp", "fa"), and they
// were matched as SUBSTRINGS, so "fan coil schedule" set the discipline to FA
// and "surface mounted" did the same. Codes are matched separately below, as
// whole words. EN is a real code in use: SCA issues "..._EN.pdf" and DASNY's
// CSI set is "..._EN (DOB SET).pdf" — and it is exactly the one that must never
// be a substring, or "generator" and "engineering" both become Energy.
// A discipline code only counts when it stands alone as a word.
const wholeWord = (code: string) => new RegExp("(^| )" + code.toLowerCase() + "( |$)");

const DISCIPLINE_WORDS: Record<string, string[]> = {
  M: ["mechanical", "hvac", "ductwork", "hthw"],
  E: ["electrical", "power", "lighting", "normal power"],
  P: ["plumbing", "domestic water", "sanitary"],
  FP: ["fire protection", "sprinkler", "standpipe"],
  FA: ["fire alarm"],
  T: ["technology", "telecom", "security", "av"],
  EN: ["energy", "energy analysis", "energy model"],
};

// Folder semantics are already domain knowledge encoded in list_project_documents;
// reuse the same reading rather than inventing a second one.
function folderArea(folderPath: string): string {
  const p = norm(folderPath);
  if (p.includes("outgoing")) return "Outgoing";
  if (p.includes("email")) return "Emails";
  if (p.includes("project management")) return "Project Management";
  if (p.includes("design")) return "Design";
  return "Other";
}

function parseQuery(query: string, discipline?: string, docType?: string) {
  const n = norm(query);
  const tokens = n.split(" ").filter((t) => t && !STOPWORDS.has(t));
  let wantType = docType || null;
  if (!wantType) {
    for (const [type, words] of Object.entries(DOC_TYPE_WORDS)) {
      if (words.some((w) => n.includes(w))) { wantType = type; break; }
    }
  }
  let wantDisc = discipline || null;
  if (!wantDisc) {
    for (const [code, words] of Object.entries(DISCIPLINE_WORDS)) {
      // Phrases may appear anywhere; a bare CODE must stand alone. Substring
      // matching a two-letter code turns "fan coil" into fire alarm and
      // "generator" into energy.
      if (words.some((w) => n.includes(w)) || wholeWord(code).test(n)) { wantDisc = code; break; }
    }
  }
  // "latest"/"current" is an intent, not a search term: it asks for a recency
  // tiebreak rather than a file with that word in its name.
  const wantsCurrent = /\b(current|latest|newest|most recent)\b/.test(n);
  return { tokens, wantType, wantDisc, wantsCurrent };
}

function scoreDocument(file: any, q: ReturnType<typeof parseQuery>, nowMs: number): number {
  const name = norm(file.name);
  const path = norm(file.folderPath);
  let s = 0;

  // Filename match dominates. A term in the name is a far stronger signal than
  // the same term in an ancestor folder, which every sibling file also inherits.
  for (const t of q.tokens) {
    if (name.includes(t)) s += 10;
    else if (path.includes(t)) s += 3;
  }
  // Nothing matched at all: not a candidate. Returning it anyway is how a
  // ranked list turns into "here is the whole folder, good luck".
  if (s === 0) return 0;

  if (q.wantType) {
    const words = DOC_TYPE_WORDS[q.wantType] || [];
    if (words.some((w) => name.includes(w))) s += 8;
    else if (words.some((w) => path.includes(w))) s += 3;
  }
  if (q.wantDisc) {
    const words = DISCIPLINE_WORDS[q.wantDisc] || [];
    const code = q.wantDisc.toLowerCase();
    if (words.some((w) => name.includes(w))) s += 8;
    // A bare discipline letter is only meaningful as a sheet-name segment
    // ("STTQ-01-E"), never as a loose substring, or every name with an E hits.
    else if (new RegExp("(^| )" + code + "( |$)").test(name)) s += 6;
    else if (words.some((w) => path.includes(w))) s += 3;
  }

  const area = folderArea(file.folderPath);
  if (area === "Outgoing") s += 6;            // what we issued: the usual answer
  else if (area === "Project Management") s += 3;
  else if (area === "Design") s -= 2;         // internal calcs, rarely the ask
  if (/\bsuperseded|\bold\b|\barchive/.test(path)) s -= 12;

  if (file.ext === "pdf") s += 2;
  else if (["docx", "doc", "xlsx", "xls"].includes(file.ext)) s += 1;
  else if (["url", "lnk", "ini", "tmp"].includes(file.ext)) s -= 10;

  // Recency as a tiebreak, not a ranking axis. Bulk migrations flattened
  // lastModifiedDateTime firm-wide, so it is weak evidence: worth a nudge
  // between otherwise-equal files, never worth outranking a name match.
  const dateInPath = /(\d{4})-(\d{2})-(\d{2})/.exec(file.folderPath || "");
  const stamp = dateInPath ? Date.parse(dateInPath[0]) : Date.parse(file.modified || "");
  if (!isNaN(stamp)) {
    const years = (nowMs - stamp) / (365.25 * 24 * 3600 * 1000);
    s += Math.max(-3, 3 - years);
    if (q.wantsCurrent) s += Math.max(-4, 4 - years * 1.5);
  }
  return s;
}

mcp.tool("find_document", {
  description:
    "Find a project document by describing it in plain language, e.g. 'current phase 3 fire protection " +
    "narrative' or 'Bulletin 13 electrical drawings'. Returns ranked matches, each with its library, " +
    "folder path, and a clickable webUrl. THIS IS THE FASTEST WAY to get to a specific document when you " +
    "know roughly what it is but not where it lives; use list_project_documents instead when you want to " +
    "browse a known folder, and read_document to open a result (pass the itemId returned here). " +
    "Ranking favours filename matches, the Outgoing folder (sets we issued), and recency. Each result " +
    "carries a supersession status derived from the transmittal register: 'current' (no later set has " +
    "reissued that sheet), 'superseded' (one has, with the set that replaced it), 'ambiguous' (the " +
    "filename maps to more than one sheet) or 'unknown' (the register has never seen this file, so " +
    "the hit means 'this document exists here' and nothing more). Results are NOT filtered by status; " +
    "call get_current_set for the authoritative full issued set.",
  inputSchema: z.object({
    projectNumber: z.string().describe("Project number OR project name. Pipeline projects (proposals and pursuits) have no number until the job is won, so use the name for those."),
    query: z.string().describe("Plain-language description of the document, e.g. 'fire protection narrative'"),
    discipline: z.string().optional().describe("Restrict to a discipline: M, E, P, FP, FA or T"),
    docType: z.string().optional().describe("Restrict to a type: Narrative, Calc, Spec, Comment Log, Transmittal, Minutes or Report"),
    phase: z.string().optional().describe("Restrict to a design phase: SD, DD, CD, Bid, CA, Programming or Validation. Accepts '100% CD' or 'Construction Documents' too. Derived from the set folder, so files in folders that name no phase are excluded when this is used."),
    limit: z.number().optional().describe("Max results (default 10, max 30)"),
  }),
  handler: async ({ projectNumber, query, discipline, docType, phase, limit }) => {
    const lim = Math.min(Math.max(limit ?? 10, 1), 30);
    const pid = await resolveProjectId(projectNumber);
    if (!pid) {
      return asText({ error: `No project matching "${projectNumber}".`, nextStep: "Confirm the number with search_projects." });
    }
    const p = await getProjectById(pid);
    const project = p?.projectNumber || projectNumber;

    let tree;
    try {
      tree = await projectTree(String(project).toLowerCase().trim());
    } catch (e) {
      return asText({
        project, query,
        error: `Could not read this project's SharePoint folders: ${String((e as any)?.message ?? e)}`,
        nextStep: "This is a lookup failure, not an empty project. Retry, or browse with list_project_documents.",
      });
    }
    if (!tree.files.length) {
      return asText({
        project, query, count: 0, results: [],
        reason: tree.libraries.length
          ? `Found this project's folder in ${tree.libraries.join(", ")} but it contains no files.`
          : "No folder for this project in any SharePoint library — it is most likely not provisioned yet.",
        nextStep: "Confirm with list_project_documents. If the project is new, the folders may not exist yet.",
      });
    }

    const q = parseQuery(query, discipline, docType);
    const now = Date.now();
    const scored = tree.files
      .map((f: any) => ({ f, s: scoreDocument(f, q, now) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s || String(b.f.modified || "").localeCompare(String(a.f.modified || "")));

    if (!scored.length) {
      return asText({
        project, query, count: 0, results: [],
        searched: { files: tree.files.length, libraries: tree.libraries },
        reason: `Nothing in this project's ${tree.files.length} files matches "${query}".`,
        nextStep: "Try fewer or different words. The firm names design-criteria documents 'OPR', 'Basis of Design' " +
          "or 'Narrative' rather than 'design criteria'. list_project_documents will show what is actually there.",
        ...(tree.truncated ? { coverageWarning: "The folder walk hit its cap, so some files were not indexed." } : {}),
      });
    }

    // Supersession (P0.2). A register read failure must not take the search
    // down: the results are still useful, they just cannot carry a status.
    let idx: ReturnType<typeof buildSupersessionIndex> | null = null;
    let registerError: string | null = null;
    try {
      idx = buildSupersessionIndex(await transmittalRows(pid));
    } catch (e) {
      registerError = String((e as any)?.message ?? e);
    }

    // Phase (P2.9, derived). Applied BEFORE the limit is taken, or asking for
    // 10 CD documents would return however many of the top 10 happened to be CD.
    const wantPhase = phase ? normalisePhase(phase) : null;
    if (phase && !wantPhase) {
      return asText({
        project, query,
        error: `"${phase}" is not a phase I recognise.`,
        nextStep: "Use SD, DD, CD, Bid, CA, Programming or Validation. '100% CD' and 'Construction Documents' also work.",
      });
    }
    let phaseFiltered = scored;
    let droppedNoPhase = 0;
    if (wantPhase) {
      phaseFiltered = scored.filter((r) => {
        const d = derivePhase(r.f.folderPath);
        if (!d) { droppedNoPhase++; return false; }
        return d.phase === wantPhase;
      });
      if (!phaseFiltered.length) {
        return asText({
          project, query, phase: wantPhase, count: 0, results: [],
          reason: `Nothing in this project matches "${query}" in the ${wantPhase} phase.`,
          nextStep: droppedNoPhase
            ? `${droppedNoPhase} matching file(s) sit in folders that name no phase, so they were excluded. ` +
              "Re-run without the phase filter to see them."
            : "Try the search without the phase filter, or a different phase.",
        });
      }
    }

    const counts = { current: 0, superseded: 0, ambiguous: 0, unknown: 0 };
    const results = phaseFiltered.slice(0, lim).map((r) => {
      const verdict = idx ? fileSupersessionStatus(r.f.name, r.f.folderPath, idx) : null;
      const ph = derivePhase(r.f.folderPath);
      const base = {
        name: r.f.name,
        library: r.f.library,
        folderPath: r.f.folderPath,
        area: folderArea(r.f.folderPath),
        ...(ph ? { phase: ph.phase, phaseBasis: ph.basis } : {}),
        webUrl: r.f.webUrl,
        itemId: r.f.itemId,
        modified: r.f.modified,
        score: Math.round(r.s * 10) / 10,
      };
      if (!verdict) { counts.unknown++; return { ...base, status: "unknown" }; }
      if (verdict.status === "ambiguous") {
        counts.ambiguous++;
        return { ...base, status: "ambiguous", statusBasis: verdict.basis, sheetNumbers: verdict.sheetNumbers };
      }
      counts[verdict.status]++;
      return {
        ...base,
        status: verdict.status,
        sheetNo: verdict.sheetNo,
        revision: verdict.revision,
        issuedIn: verdict.issuedIn,
        transmittalNumber: verdict.transmittalNumber,
        issueDate: verdict.issueDate,
        statusBasis: verdict.basis,
        ...(verdict.supersededBy ? {
          supersededBy: {
            issuedIn: verdict.supersededBy.issuedIn,
            transmittalNumber: verdict.supersededBy.transmittalNumber,
            issueDate: verdict.supersededBy.issueDate,
            revision: verdict.supersededBy.revision,
          },
        } : {}),
        ...(verdict.backfilled ? { backfilled: true } : {}),
      };
    });

    // The note is written for the mix actually returned, because a blanket
    // caveat trains the reader to ignore it. When nothing resolved, say why.
    const statusNote = registerError
      ? `status is 'unknown' for every result: the transmittal register could not be read (${registerError}).`
      : !idx || idx.sets === 0
      ? "status is 'unknown' for every result: this project has no transmittal records, so there is nothing " +
        "to establish which revision is current. Treat every hit as 'this document exists here'."
      : counts.current + counts.superseded + counts.ambiguous === 0
      ? "status is 'unknown' for every result: none of these filenames appear in this project's " +
        `${idx.sets} transmittal record(s). A hit means 'this document exists here', not 'this is current'.`
      : "status is derived from the transmittal register: 'current' means no later set has reissued that " +
        "sheet, 'superseded' means one has, 'ambiguous' means the filename maps to more than one sheet, and " +
        "'unknown' means the register has never seen the file. Only current/superseded are claims; " +
        "call get_current_set for the authoritative full set.";

    return asText({
      project, query,
      interpreted: {
        terms: q.tokens,
        docType: q.wantType, discipline: q.wantDisc,
        recencyPreferred: q.wantsCurrent,
      },
      searched: { files: tree.files.length, libraries: tree.libraries },
      count: phaseFiltered.length,
      returned: Math.min(phaseFiltered.length, lim),
      ...(wantPhase ? {
        phaseFilter: {
          phase: wantPhase,
          matchedBeforeFilter: scored.length,
          excludedForNoPhase: droppedNoPhase,
          ...(droppedNoPhase ? {
            note: `${droppedNoPhase} matching file(s) sit in folders that name no phase and were excluded. ` +
              "Phase is read from the set folder, so loose files carry none.",
          } : {}),
        },
      } : {}),
      results,
      statusCounts: counts,
      statusNote,
      ...(tree.truncated ? { coverageWarning: `The folder walk hit its cap after ${tree.files.length} files, so results may be incomplete.` } : {}),
    });
  },
});

// ─── SHEET INDEX: TITLE-BLOCK EXTRACTION ────────────────────────────────────
// Filenames cannot describe a drawing set. A booked addendum holds many sheets
// in one PDF, and the name that IS on the file is usually the Revit model
// ("STTQ-01-E"), not a sheet number — on one 2019 sheet the model name is even
// the wrong discipline (FP601.pdf records STTQ-01-P.rvt). The title block is
// Revit-generated and carries the truth: sheet number, title, date, who drew
// and checked it, project number, phase, and page N of M.
//
// Observed on real sheets, 2019 and 2026, which differ in ways a naive parser
// would trip on (2019 labels it "EYP Project No" after the architect changed,
// and dates are 11/01/19 vs 10/29/2024):
//
//   ... 500 Circle Road  E221 GROUND FLOOR PLAN - COMMONS - ELECTRICAL POWER
//       10/29/2024 SMA SM 1018037.01 TABLER QUAD NEW RESIDENCE HALL
//       CONSTRUCTION DOCUMENTS PD 22 68 ...
//
// so the anchor is the SHAPE — sheet number, ALL-CAPS title, date, two sets of
// initials, project number — not any label text.
// Title blocks vary by ARCHITECT, not by us. Each firm's Revit template lays the
// fields out in its own order, so one regex only ever reads one practice's
// drawings. This is a list, tried in order, and it will grow.
//
// A pattern must FAIL rather than half-match: a wrong sheet number is worse than
// no sheet number, because the filename fallback is honest about knowing nothing.
// That is why each pattern anchors on a long, specific run of fields rather than
// the sheet number alone.
//
// 1. SHEET NUMBER FIRST. Tabler Quad, Page/EYP template:
//      E221 GROUND FLOOR PLAN - COMMONS 10/29/2024 SMA SM 1018037.01
// 2. SHEET NUMBER LAST. CHCR Grove, think! architecture template:
//      GENERAL NOTES, SYMBOLS & ABBREVIATIONS 02/01/21 Author Checker 21104 P - 001 P 01 10
//    Note the sheet number carries spaces around its hyphen, the initials are
//    the unfilled Revit placeholders "Author" and "Checker" rather than real
//    ones, and the trailing "P 01 10" is discipline, page, and set total. That
//    tail is what makes the match safe on a page otherwise dense with capitals.
const TITLE_BLOCK_SHEET_FIRST =
  /\b([A-Z]{1,3}\d{2,4}[A-Z]?)\s+([A-Z][A-Z0-9 \-,&/'".()]{3,80}?)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+([A-Z]{2,4})\s+([A-Z]{2,4})\s+(\d[\d.]*)\b/;
const TITLE_BLOCK_SHEET_LAST =
  /([A-Z][A-Z0-9 \-,&/'".()]{3,80}?)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+([A-Za-z][\w.]{1,14})\s+([A-Za-z][\w.]{1,14})\s+(\d[\d.]*)\s+([A-Z]{1,3})\s*-\s*(\d{2,4}[A-Z]?)\s+[A-Z]{1,3}\s+(\d{1,3})\s+(\d{1,3})\b/;

const TITLE_BLOCK_PATTERNS: Array<{ layout: string; re: RegExp; map: (m: RegExpExecArray) => any }> = [
  {
    layout: "sheet-number-first",
    re: TITLE_BLOCK_SHEET_FIRST,
    map: (m) => ({
      sheetNo: m[1], sheetTitle: m[2], sheetDate: m[3],
      drawnBy: m[4], checkedBy: m[5], projectNo: m[6],
    }),
  },
  {
    layout: "sheet-number-last",
    re: TITLE_BLOCK_SHEET_LAST,
    map: (m) => ({
      // Normalise "P - 001" to "P-001" so it matches how the sheet is written
      // everywhere else, including the drawing list on the cover sheet.
      sheetNo: m[6] + "-" + m[7], sheetTitle: m[1], sheetDate: m[2],
      drawnBy: m[3], checkedBy: m[4], projectNo: m[5],
      pageOfSet: Number(m[8]), setTotal: Number(m[9]),
    }),
  },
];

// Revit leaves these in when nobody fills the fields. Reporting them as people
// would put "Author" in a drawn-by column and make it look like real data.
const REVIT_PLACEHOLDER = /^(author|checker|designer|approver)$/i;
const realName = (v: string) => (v && !REVIT_PLACEHOLDER.test(v) ? v : null);

const PHASE_RE =
  /\b(CONSTRUCTION DOCUMENTS|CONTRACT DOCUMENTS|DESIGN DEVELOPMENT|SCHEMATIC DESIGN|BID DOCUMENTS|BID SET|PERMIT SET|PROGRAMMING|VALIDATION)\s+\S+\s+(\d{1,3})\s+(\d{1,3})\b/;

// The revision block is the sheet's own history, and its LAST row is the
// revision the sheet is currently at. Parsing it row-by-row is fragile because
// some rows carry no description ("RFI-59 01/14/2026"), so instead anchor on the
// LAST DATE in the block and read the tokens between the previous date and it.
// An empty block is not a failure: it means base issue, revision 0.
// Revision-block headers also vary by template, and so do the date formats
// inside them: Tabler writes 04/17/2026, CHCR writes 2023.08.11.
const REVISION_HEADERS = ["Revisions Rev Description Date", "NO. REVISIONS DATE"];
const REVISION_DATE_RE = /\d{1,2}\/\d{1,2}\/\d{4}|\d{4}\.\d{2}\.\d{2}/g;

function parseRevisionBlock(pageText: string): { revision: string; description: string; date: string | null } {
  // Take whichever known header appears LAST: some templates print a submissions
  // table above the revisions table, and the revisions one is what governs.
  let i = -1, header = "";
  for (const h of REVISION_HEADERS) {
    const at = pageText.lastIndexOf(h);
    if (at > i) { i = at; header = h; }
  }
  if (i < 0) return { revision: "0", description: "", date: null };
  const tail = pageText.slice(i + header.length);
  const dates = [...tail.matchAll(REVISION_DATE_RE)];
  if (!dates.length) return { revision: "0", description: "", date: null };
  const last = dates[dates.length - 1];
  const prevEnd = dates.length > 1
    ? dates[dates.length - 2].index! + dates[dates.length - 2][0].length
    : 0;
  const between = tail.slice(prevEnd, last.index!).trim().split(/\s+/).filter(Boolean);
  return {
    revision: between.length ? between[0] : "0",
    description: between.slice(1).join(" "),
    date: last[0],
  };
}

function parseTitleBlock(pageText: string): any | null {
  for (const pat of TITLE_BLOCK_PATTERNS) {
    const m = pat.re.exec(pageText);
    if (!m) continue;
    const f = pat.map(m);
    const ph = PHASE_RE.exec(pageText);
    const rev = parseRevisionBlock(pageText);
    return {
      sheetNo: f.sheetNo,
      // Discipline comes from the sheet number's own prefix, which is the only
      // place it is reliably stated. See the parseFilename fix in transmittal.html.
      discipline: (/^([A-Z]{1,3})/.exec(f.sheetNo) || [, ""])[1],
      sheetTitle: String(f.sheetTitle).replace(/\s+/g, " ").trim(),
      sheetDate: f.sheetDate,
      drawnBy: realName(f.drawnBy),
      checkedBy: realName(f.checkedBy),
      projectNo: f.projectNo,
      phase: ph ? ph[1] : null,
      // Page and total come from the phase line on templates that print one, and
      // from the title block itself on those that do not.
      pageOfSet: ph ? Number(ph[2]) : (f.pageOfSet ?? null),
      setTotal: ph ? Number(ph[3]) : (f.setTotal ?? null),
      revision: rev.revision,
      revisionDescription: rev.description || null,
      revisionDate: rev.date,
      // Which template matched. Worth returning: when a project's sheets stop
      // parsing, the first question is whether the architect changed.
      titleBlockLayout: pat.layout,
    };
  }
  return null;
}

// ─── DRAWING LIST ───────────────────────────────────────────────────────────
// Title blocks do not generalise. A survey of six projects across six owners on
// 2026-08-02 found only two parsed: every firm lays its title block out
// differently, and each new architect needs a bespoke pattern.
//
// The drawing list does generalise. Every cover sheet seen so far carries one,
// and the anchor text is character-identical across unrelated practices:
//
//   CHCR: PLUMBING DRAWING LIST   SHEET DRAWING TITLE  1 P-001 GENERAL NOTES...
//   SCA:  FIRE ALARM DRAWING LIST SHEET DRAWING TITLE  1 FA001.00 FIRE ALARM...
//
// One page then yields the WHOLE set, architect-independent, instead of N title
// blocks each needing its own regex.
//
// Rows are found by locating the sheet-number tokens and slicing the text
// BETWEEN them for the title. Matching a title directly does not work: titles
// legitimately contain digits ("LEVEL 1 FLOOR PLAN"), so any "digits end the
// title" rule truncates real names.
const DRAWING_LIST_ANCHOR = /DRAWING LIST\s+SHEET\s+DRAWING TITLE/;
const DRAWING_LIST_ROW = /(\d{1,3})\s+([A-Z]{1,4}-?\d{2,4}(?:\.\d{2})?[A-Z]?)(?=\s)/g;
// The final row has no following row to bound it, so it runs on into whatever
// page section comes next. Cut at the headings that actually follow these lists.
// Includes the revision-table headings, because on SCA's sheets the revision
// table follows the drawing list directly and the final title swallowed it:
// "FIRE PROTECTION DETAILS No. Date Revision 1 11/21/2025 Issued for Bid".
const DRAWING_LIST_TAIL =
  /\b((?:NYC|NEW YORK CITY)\s+BUILDING\s+DEPARTMENT|SPECIAL\s+INSPECTIONS?|ABBREVIATIONS\s+SYMBOLS|No\.\s+Date\s+Revision|Revisions\s+Rev\s+Description|NO\.\s+REVISIONS\s+DATE)\b/;
const DRAWING_LIST_MAX_TITLE = 80;

function parseDrawingList(pageText: string): Array<{ sheetNo: string; sheetTitle: string }> {
  const at = pageText.search(DRAWING_LIST_ANCHOR);
  if (at < 0) return [];
  const tail = pageText.slice(at);
  const rows = [...tail.matchAll(DRAWING_LIST_ROW)];
  if (rows.length < 2) return []; // one row is far more likely to be noise than a list
  return rows.map((m, i) => {
    const from = m.index! + m[0].length;
    const to = i + 1 < rows.length ? rows[i + 1].index! : tail.length;
    let title = tail.slice(from, to).trim();
    const cut = DRAWING_LIST_TAIL.exec(title);
    if (cut) title = title.slice(0, cut.index).trim();
    if (title.length > DRAWING_LIST_MAX_TITLE) title = title.slice(0, DRAWING_LIST_MAX_TITLE).trim();
    return { sheetNo: m[2], sheetTitle: title.replace(/\s+/g, " ") };
  }).filter((r) => r.sheetTitle.length > 0);
}

// Folders inside a set that are not the issued sheets.
const NON_SHEET_FOLDER = /\b(cad files?|revit models?|specs?|specifications?|native|dwg|working)\b/i;

// Is this issue the whole set, or a partial?
//
// The sheets state their own set size, so the answer is on the drawings — but
// that size is PER DISCIPLINE. Tabler's title blocks say "of 68" on E, "of 54"
// on M and "of 22" on T. The first cut of this tested for exactly ONE distinct
// total across the entire result and so evaluated FALSE on every package
// spanning more than one discipline: Bulletin #13's 8 sheets across E and M were
// reported as a complete set, which is the opposite of the truth and the kind of
// wrong answer someone would act on. Group by discipline, then compare.
//
// Pure — see sheetIndex.test.mjs.
function summarizeDisciplines(sheets: any[]) {
  const byDiscipline: Record<string, any> = {};
  for (const s of sheets) {
    const d = s.discipline || "?";
    const e = byDiscipline[d] || (byDiscipline[d] = { sheets: 0, setTotal: null, totalsSeen: [] as number[] });
    e.sheets++;
    if (s.setTotal && !e.totalsSeen.includes(s.setTotal)) e.totalsSeen.push(s.setTotal);
  }
  for (const d of Object.keys(byDiscipline)) {
    const e = byDiscipline[d];
    // Sheets within one discipline should agree on the total. When they do not —
    // a folder holding two issues, or a renumbered set — the LARGEST is the safe
    // floor for "how many there should be", so a partial is never called whole.
    if (e.totalsSeen.length > 1) e.conflictingTotals = [...e.totalsSeen].sort((a: number, b: number) => a - b);
    e.setTotal = e.totalsSeen.length ? Math.max(...e.totalsSeen) : null;
    e.isPartial = e.setTotal ? e.sheets < e.setTotal : null;
    delete e.totalsSeen;
  }
  const partialDisciplines = Object.keys(byDiscipline).filter((d) => byDiscipline[d].isPartial === true);
  const rated = Object.values(byDiscipline).filter((e: any) => e.setTotal !== null);
  return {
    byDiscipline,
    partialDisciplines,
    // Partial when ANY discipline is short of its own stated total. NULL, not
    // false, when no title block stated a total — unknown is not "complete".
    isPartialIssue: rated.length ? partialDisciplines.length > 0 : null,
  };
}

// ── P1.6 (prepare-only): stage a transmittal without issuing it ──────────────
// The register is what makes get_current_set authoritative, so it is worth
// keeping clean. This tool does everything a person would otherwise do by hand
// before issuing — pick the next number, work out what the set replaces, and
// spot the filenames that will corrupt the register — and then STOPS.
//
// It deliberately does not write. The connector runs on the service-role key
// and Entra sign-in is a boolean gate rather than an identity, so a write tool
// here would let anyone signed in issue a transmittal with no permission check
// and no record of who did it. Issuing stays in transmittal.html, where a
// person is present and the audit trail names them.
//
// The pre-flight matters more than the convenience. Roughly one register row in
// twelve carries a filename that yields no sheet number, and those rows are
// exactly why some documents can never be given a revision status. Catching
// them BEFORE the set is issued is the only cheap moment.
const TRANSMITTAL_APP = "https://smartias.github.io/setty-pms/transmittal.html";

// The sheet number at the START of a filename, which is the firm's actual
// convention: "E211 - GROUND FLOOR PLAN - EAST WING - ELECTRICAL POWER.pdf".
//
// This is deliberately looser than canonicalSheet(), which demands the whole
// stem BE the sheet number. That strictness is right in find_document, where a
// false positive invents a revision status, but wrong here: staging a set is
// about telling a badly-named file from a well-named one, and requiring the
// whole stem would flag every properly-named drawing in the firm. The trailing
// boundary is what keeps it honest: "STTQ-01-E_Bulletin #13.pdf" still fails,
// because STTQ is four letters, and "2026-05-19 BOYLAN HALL.pdf" fails because
// it leads with a date.
function leadingSheetNo(filename: string): { sheetNo: string; discipline: string } | null {
  const stem = String(filename || "").replace(/\.[a-z0-9]+$/i, "").toUpperCase().trim();
  const m = /^([A-Z]{1,3})[-_ ]?(\d{2,4}[A-Z]?)(?=[-_ .]|$)/.exec(stem);
  return m ? { sheetNo: m[1] + m[2], discipline: m[1] } : null;
}

mcp.tool("prepare_transmittal", {
  description:
    "Stage a transmittal for a set that is ready to go out, WITHOUT issuing it. Give it a project and " +
    "the Outgoing set folder, and it returns: the next transmittal number (derived from the register, " +
    "not guessed), which sheets in the set would SUPERSEDE a currently-issued sheet and which are NEW " +
    "to the project, any filenames that cannot be parsed into a sheet number (these produce register " +
    "rows that can never be given a revision status, so fix them before issuing), and a ready-to-open " +
    "link into the Setty transmittal tool with the project and folder pre-loaded. " +
    "THIS WRITES NOTHING: a person still issues the set in the transmittal tool, which is what records " +
    "it in the register. Use it to check a set before it goes out, or to answer 'what would this " +
    "replace?'.",
  inputSchema: z.object({
    projectNumber: z.string().describe("Project number OR project name. Pipeline projects (proposals and pursuits) have no number until the job is won, so use the name for those."),
    subfolder: z.string().describe("The set folder to stage, exactly as list_project_documents reports it, e.g. 'Outgoing/2026-04-17_Bulletin #13'"),
  }),
  handler: async ({ projectNumber, subfolder }) => {
    const pid = await resolveProjectId(projectNumber);
    if (!pid) return asText({ error: `No project matching "${projectNumber}".`, nextStep: "Confirm with search_projects." });
    const p = await getProjectById(pid);
    const project = p?.projectNumber || projectNumber;

    let rows: any[] = [];
    try {
      rows = await transmittalRows(pid);
    } catch (e) {
      return asText({
        project,
        error: `Could not read the transmittal register: ${String((e as any)?.message ?? e)}`,
        nextStep: "This is a lookup failure. Do not conclude the project has no prior sets.",
      });
    }
    const idx = buildSupersessionIndex(rows);

    // Next number. Transmittal numbers are NOT chronological (T-002 can predate
    // T-001 on the same project), so the next one is max+1 by NUMBER, never by
    // date order or row position.
    let maxNum = 0;
    for (const r of rows) {
      const m = /(\d+)\s*$/.exec(String(r?.files?.transmittalNumber || ""));
      if (m) maxNum = Math.max(maxNum, Number(m[1]));
    }
    const nextTransmittalNumber = `T-${String(maxNum + 1).padStart(3, "0")}`;

    let tree;
    try {
      tree = await projectTree(String(project).toLowerCase().trim());
    } catch (e) {
      return asText({ project, error: `Could not read this project's SharePoint folders: ${String((e as any)?.message ?? e)}` });
    }
    const wanted = String(subfolder).replace(/^\/+|\/+$/g, "").toLowerCase();
    const inFolder = tree.files.filter((f: any) =>
      String(f.folderPath || "").replace(/^\/+|\/+$/g, "").toLowerCase() === wanted);

    if (!inFolder.length) {
      const candidates = [...new Set(tree.files
        .map((f: any) => String(f.folderPath || ""))
        .filter((fp: string) => /outgoing/i.test(fp)))].slice(0, 15);
      return asText({
        project, subfolder,
        error: `No files found in "${subfolder}".`,
        nextStep: "Pass the folder EXACTLY as list_project_documents prints it. Outgoing folders on this project:",
        outgoingFolders: candidates,
      });
    }

    const supersedes: any[] = [], newSheets: any[] = [], unkeyable: any[] = [];
    for (const f of inFolder) {
      if (!/\.pdf$/i.test(f.name)) continue;
      const c = leadingSheetNo(f.name);
      if (!c) { unkeyable.push({ filename: f.name }); continue; }
      const cur = idx.bySheet.get(c.sheetNo);
      if (cur) {
        supersedes.push({
          sheetNo: c.sheetNo, filename: f.name,
          currentlyIssuedIn: cur.issuedIn, currentTransmittal: cur.transmittalNumber,
          currentIssueDate: cur.issueDate, currentRevision: cur.revision,
        });
      } else {
        newSheets.push({ sheetNo: c.sheetNo, discipline: c.discipline, filename: f.name });
      }
    }

    // The folder URL is derived by chopping the filename off a file's webUrl,
    // which only works when that webUrl is a real library path. SharePoint also
    // hands back _layouts/15/Doc.aspx?... style links for some items, and
    // chopping one of those yields ".../_layouts/15", a link to nowhere. So
    // require the result to still contain the set folder's own name, and omit
    // the parameter entirely rather than hand over a broken link: transmittal.html
    // treats folder as optional and the person can pick it in two clicks.
    const lastSeg = wanted.split("/").filter(Boolean).pop() || "";
    const lastSegEnc = encodeURIComponent(lastSeg).toLowerCase();
    let folderUrl: string | null = null;
    for (const f of inFolder) {
      const u = String(f?.webUrl || "");
      if (!u) continue;
      const parent = u.replace(/\/[^/]*$/, "");
      const pl = parent.toLowerCase();
      if (lastSeg && (pl.includes(lastSegEnc) || pl.includes(lastSeg.toLowerCase()))) { folderUrl = parent; break; }
    }
    const handoff = TRANSMITTAL_APP +
      "?project=" + encodeURIComponent(p?.name || "") +
      "&number=" + encodeURIComponent(project) +
      (folderUrl ? "&folder=" + encodeURIComponent(folderUrl) : "");

    return asText({
      project,
      projectName: p?.name ?? null,
      subfolder,
      nextTransmittalNumber,
      priorSets: idx.sets,
      filesInFolder: inFolder.length,
      wouldSupersede: supersedes.sort((a, b) => a.sheetNo.localeCompare(b.sheetNo)),
      newToProject: newSheets.sort((a, b) => a.sheetNo.localeCompare(b.sheetNo)),
      ...(unkeyable.length ? {
        needsAttention: {
          count: unkeyable.length,
          files: unkeyable,
          why: "These filenames do not parse into a sheet number, so the register row they produce can " +
            "never be given a revision status and they will not appear in get_current_set. Renaming them " +
            "to lead with the sheet number (E211.pdf, M-507.pdf) before issuing is the only cheap fix.",
        },
      } : {}),
      issueHere: handoff,
      ...(folderUrl ? {} : {
        folderLinkNote: "The set folder could not be linked directly, so the transmittal tool opens with " +
          "the project loaded and the folder left for you to pick.",
      }),
      nextStep: "Nothing has been written. Open issueHere to review and issue the set in the transmittal " +
        "tool, which is what records it in the register.",
    });
  },
});

mcp.tool("extract_sheet_index", {
  description:
    "The project's drawing sheet index. CALLED WITH NO subfolder — the normal way — it returns the " +
    "CURRENT FULL SET: every sheet on the job at its most recent issuance, grouped by discipline in set " +
    "order (M, P, FP, E, T) and by sheet number within each. That answer is composed from the transmittal " +
    "register, the sheet list recorded when each set was issued, so it parses no drawings and returns in " +
    "one query. Ask it for 'the sheet index', 'the current drawing list', or 'what sheets are on this job' " +
    "and pass nothing but the project. " +
    "PASS subfolder ONLY to read ONE specific set straight from the drawings — a historical issue, or a " +
    "set never logged as a transmittal. That path reads the TITLE BLOCK of every sheet in the folder and " +
    "returns one row per sheet: sheet number, title, discipline, revision (from the sheet's own revision " +
    "block), phase, and page N of M. It handles BOOKED packages, splitting a single addendum or bulletin " +
    "PDF page by page. It is also SLOW and budget-bound: a single 22-page discipline book can exceed one " +
    "request, so prefer the default unless you specifically need one set. " +
    "IF YOU DO COMPOSE SETS BY HAND from repeated subfolder calls, GROUP BY sheetNo AND KEEP THE LATEST revisionDate — " +
    "NOT sheetDate, which is the BASE ISSUE date and never moves (it reads the same on every sheet of " +
    "a project, so grouping on it ties on every row), and NOT the revision label, which is unsortable " +
    "because the scheme changes mid-project (letters A/B/C for early addenda, then numbers 2, 3, 6, 9, " +
    "13; sheet E211 exists at both rev 'C' and rev '6', and a label sort returns the SUPERSEDED one). " +
    "A sheet with no revisionDate is a base issue at revision 0 and sorts earliest. The revision label " +
    "is also NOT the bulletin number (Bulletin #010 stamps revision 7), and revisionDate is not the " +
    "set's folder date. Completeness is judged PER " +
    "DISCIPLINE, because each discipline's title blocks state their own set size (E 'of 68', M 'of 54') " +
    "— see byDiscipline[<letter>].setTotal / .isPartial. " +
    "A FOLDER TOO BIG FOR ONE CALL IS PAGED, NOT TRUNCATED: the result carries paging.nextOffset, so call " +
    "again with offset:<nextOffset> and keep going until nextOffset is null. Skipping that leaves sheets " +
    "silently missing, and a big discipline folder needs several rounds. " +
    "Pass the subfolder EXACTLY as " +
    "list_project_documents reports it: an exact path is resolved directly, anything else falls back to " +
    "a capped whole-project folder walk that may not reach deep set folders. This is READ-ONLY: it " +
    "returns rows for review and writes nothing to the transmittal register.",
  inputSchema: z.object({
    projectNumber: z.string().describe("Project number OR project name. Pipeline projects (proposals and pursuits) have no number until the job is won, so use the name for those."),
    subfolder: z.string().optional().describe("ONE set folder under Outgoing to read from the drawings, e.g. 'Outgoing/2026-04-17_Bulletin #13'. OMIT THIS to get the current full set composed from the register, which is what you almost always want — pass it only to read a specific historical issue, or to read a set that was never logged as a transmittal."),
    offset: z.number().optional().describe("Skip this many PDFs before extracting. Use it to page through a folder too large for one call: start at 0, then pass the nextOffset from the previous result until it comes back null. File order is stable across calls."),
    maxFiles: z.number().optional().describe("Max PDFs to open (default 25)"),
    maxPages: z.number().optional().describe("Max pages to parse across all files (default 120)"),
  }),
  handler: async ({ projectNumber, subfolder, offset, maxFiles, maxPages }) => {
    const fileCap = Math.min(Math.max(maxFiles ?? 25, 1), 60);
    const pageCap = Math.min(Math.max(maxPages ?? 120, 1), 300);
    const pid = await resolveProjectId(projectNumber);
    if (!pid) return asText({ error: `No project matching "${projectNumber}".`, nextStep: "Confirm with search_projects." });
    const p = await getProjectById(pid);
    const project = p?.projectNumber || projectNumber;

    // ── DEFAULT: the current full set, composed from the register ────────────
    // No subfolder means "the whole set as it stands", which is the question
    // people actually ask. Answering it by parsing drawings is not merely slow,
    // it TIMES OUT: one 22-page discipline book exceeds the request budget, and
    // the full Tabler set is 192 sheets across five books. Folding the register
    // is one query and needs no PDF reading at all.
    if (!subfolder) {
      let rows: any[] = [];
      try {
        rows = await transmittalRows(pid);
      } catch (e) {
        return asText({
          project,
          error: `Could not read the transmittal register: ${String((e as any)?.message ?? e)}`,
          nextStep: "This is a lookup failure, not an empty result — do not conclude the project has no issued set.",
        });
      }
      if (!rows.length) {
        return asText({
          project, count: 0, disciplines: [],
          reason: "No set has been logged as a transmittal for this project, so there is no register to compose a current set from.",
          nextStep: "Read one set straight from the drawings instead: list_project_documents with subfolder:'Outgoing' to find the set folders, then call again passing that folder as subfolder.",
        });
      }
      const composed = composeCurrentSet(rows);
      const withoutRevision = composed.disciplines
        .flatMap((d: any) => d.sheets)
        .filter((s: any) => s.revision === null || s.revision === undefined).length;
      return asText({
        project,
        basis: "Composed from the transmittal register (pms_filing_log) — the sheet lists recorded when each set was issued. No drawings were parsed.",
        mode: "current-full-set",
        sheetCount: composed.sheetCount,
        disciplineCount: composed.disciplines.length,
        // Ordered set order (M, P, FP, E, T), each discipline's sheets in sheet
        // number order, one row per sheet at its most recent issuance.
        disciplines: composed.disciplines,
        supersededCount: composed.supersededCount,
        // Which sets the current sheets actually came from. A healthy job shows a
        // baseline carrying most sheets plus a short tail of recent partials.
        sourceSets: composed.sourceSets,
        ...(composed.unusable.length
          ? {
            unusableRows: composed.unusable,
            unusableWarning:
              `${composed.unusable.length} register row(s) recorded a building SERIES rather than a sheet number ` +
              `(e.g. "STTQ-01"), so the sheets they cover are NOT in this list. These are filename-parsed backfill ` +
              `rows. Re-run the set through the transmittal tool's "Read sheet data from drawings" step to replace them.`,
          }
          : {}),
        ...(withoutRevision
          ? { revisionNote: `${withoutRevision} sheet(s) carry no revision in the register, which means unknown rather than revision 0.` }
          : {}),
        note: "Each sheet is shown at its MOST RECENT issuance: the register was folded newest-first, so a sheet " +
          "reissued in a later bulletin appears only once, at that bulletin. To see what a single set contained " +
          "instead, pass that set folder as subfolder.",
      });
    }

    const numPrefix = String(project).toLowerCase().trim();
    const want = String(subfolder || "").replace(/^\/+|\/+$/g, "").toLowerCase();

    // Resolve the named folder directly and crawl only beneath it. Falling back
    // to the whole-project walk is what keeps a path that is CLOSE but not exact
    // working (set folders carry dates and emoji prefixes), but the direct
    // resolve has to be tried first or a big project silently returns nothing.
    let inSet: any[] = [];
    let scope: any = { mode: "direct" };
    let crawlTruncated = false;
    try {
      const sub = await subtreeFiles(numPrefix, subfolder);
      inSet = sub.files;
      crawlTruncated = sub.truncated;
      scope = { mode: "direct", resolvedIn: sub.resolvedIn, graphCalls: sub.scanned };
      if (!sub.resolvedIn.length) scope.pathResolved = false;
    } catch (e) {
      return asText({ project, error: `Could not read SharePoint folders: ${String((e as any)?.message ?? e)}` });
    }

    let treeTruncated = false;
    if (!inSet.length) {
      let tree;
      try {
        tree = await projectTree(numPrefix);
      } catch (e) {
        return asText({ project, error: `Could not read SharePoint folders: ${String((e as any)?.message ?? e)}` });
      }
      treeTruncated = tree.truncated;
      inSet = tree.files.filter((f: any) => {
        const path = String(f.folderPath || "").toLowerCase();
        return path === want || path.startsWith(want + "/");
      });
      if (inSet.length) { scope = { mode: "project-walk-fallback", pathResolved: false }; crawlTruncated = tree.truncated; }
    }

    if (!inSet.length) {
      // Say which of the two it is. "No files found" that really meant "the
      // crawl ran out of budget" is the exact failure this tool shipped with.
      const exhausted = scope.pathResolved === false && treeTruncated;
      return asText({
        project, subfolder, count: 0, sheets: [], scope,
        reason: exhausted
          ? `The folder "${subfolder}" could not be resolved directly, and the whole-project folder walk hit its request cap before covering the project — so this is an INCOMPLETE scan, not proof the path is wrong.`
          : scope.pathResolved === false
          ? `No folder "${subfolder}" exists under this project in any library.`
          : `The folder "${subfolder}" resolved but holds no files.`,
        crawlTruncated: exhausted,
        nextStep: exhausted
          ? "Confirm the exact path with list_project_documents and pass it verbatim — an exact path is resolved directly and does not depend on the walk."
          : "Check the path with list_project_documents — set folders carry dates and sometimes emoji prefixes.",
      });
    }
    const pdfs = inSet.filter((f: any) => f.ext === "pdf" && !NON_SHEET_FOLDER.test(f.folderPath));
    const excludedFolders = [...new Set(inSet.filter((f: any) => NON_SHEET_FOLDER.test(f.folderPath)).map((f: any) => f.folderPath))];
    if (!pdfs.length) {
      return asText({
        project, subfolder, scope, count: 0, sheets: [],
        reason: `Found ${inSet.length} file(s) under "${subfolder}" but no drawing PDFs outside CAD/Revit/Specs folders.`,
        excludedFolders,
        ...(crawlTruncated ? { crawlWarning: "The folder crawl also hit its request cap, so this listing is incomplete." } : {}),
        nextStep: "This set may hold only native files or specs. Check with list_project_documents.",
      });
    }

    const sheets: any[] = [];
    // Sheets named by a cover sheet's drawing list. Kept separate from parsed
    // title blocks because a listed sheet is EVIDENCE THE SET CONTAINS IT, not a
    // reading of the sheet itself: there is no revision, and the file it lives
    // in is unknown. Merged in at the end, and only where a title block did not
    // already produce a richer row.
    const listed = new Map<string, any>();
    const unparsed: any[] = [];
    const seen = new Map<string, any>();
    let duplicates = 0, pagesParsed = 0, filesOpened = 0, stoppedMidFile = false;

    // Baseline sets often ship ONE combined book per discipline beside (or
    // instead of) the individual sheets. Tabler's combined electrical PDF is
    // 42MB, over MAX_DOC_BYTES, so it used to be dropped as one quiet `unparsed`
    // row — on a set that ships combined-only that silently loses the whole
    // discipline.
    //
    // Sheet extraction reads text one page at a time and never returns the file
    // body, so it can afford a larger cap than the generic document reader,
    // whose 20MB bound is about response size. The real limit here is edge-worker
    // memory, so: a bigger per-file cap, a budget on TOTAL oversized bytes per
    // call, and oversized files taken LAST — a book that OOMs must not cost us
    // the individual sheets that were going to parse fine.
    const oversized: any[] = [];
    let oversizeBytes = 0;
    const isBig = (f: any) => Number(f.size) > MAX_DOC_BYTES;
    //
    // The order must also be TOTAL and STABLE, not just big-last. `offset` pages
    // through this list across calls, and paging an order that can vary between
    // calls silently skips some files and reads others twice — the caller would
    // get a plausible, wrong answer with no signal. Graph does not promise a
    // children order, so sort by path then name rather than trusting the crawl.
    const ordered = [...pdfs].sort((a, b) =>
      Number(isBig(a)) - Number(isBig(b)) ||
      String(a.folderPath).localeCompare(String(b.folderPath)) ||
      String(a.name).localeCompare(String(b.name)));

    // A folder larger than one call's budget can only ever be read from the top
    // unless the caller can say "resume from here". Without this, the tail of a
    // 68-file discipline is simply unreachable.
    const start = Math.min(Math.max(offset ?? 0, 0), ordered.length);
    const work = ordered.slice(start);
    // Advances for every entry VISITED, including ones skipped as oversized or
    // failed downloads. Counting only successes would park the next page on a
    // file that can never open, and the caller would loop on it forever.
    let filesConsumed = 0;
    const consumed = () => filesConsumed - (stoppedMidFile ? 1 : 0);

    for (const f of work) {
      if (filesOpened >= fileCap || pagesParsed >= pageCap) break;
      filesConsumed++;
      const bar = f.itemId.indexOf("|");
      const drive = f.itemId.slice(0, bar);
      const realId = f.itemId.slice(bar + 1);
      const big = isBig(f);
      const sizeMB = Math.round(Number(f.size) / 104857.6) / 10;
      if (big) {
        if (Number(f.size) > SHEET_MAX_BYTES || oversizeBytes + Number(f.size) > SHEET_OVERSIZE_BUDGET) {
          oversized.push({
            file: f.name, sizeMB, folderPath: f.folderPath, webUrl: f.webUrl, opened: false,
            reason: Number(f.size) > SHEET_MAX_BYTES
              ? `${sizeMB}MB is over the ${SHEET_MAX_BYTES / 1048576}MB single-file cap for inline parsing`
              : "would exceed this call's oversized-file memory budget",
          });
          continue;
        }
        oversizeBytes += Number(f.size);
      }
      let buf: ArrayBuffer;
      try {
        const res = await fetch(
          `https://graph.microsoft.com/v1.0/drives/${drive}/items/${encodeURIComponent(realId)}/content`,
          { headers: { Authorization: "Bearer " + (await graphToken()) } },
        );
        if (!res.ok) { unparsed.push({ file: f.name, reason: `Graph content ${res.status}` }); continue; }
        buf = await res.arrayBuffer();
      } catch (e) { unparsed.push({ file: f.name, reason: String((e as any)?.message ?? e) }); continue; }
      filesOpened++;
      const sheetsBefore = sheets.length;
      try {
        const { getDocumentProxy } = await import("unpdf");
        const pdf: any = await getDocumentProxy(new Uint8Array(buf));
        const total: number = pdf.numPages;
        for (let i = 1; i <= total; i++) {
          if (pagesParsed >= pageCap) {
            // Out of page budget PART WAY THROUGH this file. Do not let it count
            // as consumed: if the next page started after it, its unread pages
            // would be skipped forever and the sheets on them lost with no
            // signal. Point the next call back at this file instead. Re-reading
            // the pages already taken is cheap, and the caller groups by sheetNo
            // when building a composite, so the repeats collapse.
            stoppedMidFile = true;
            break;
          }
          pagesParsed++;
          const pg = await pdf.getPage(i);
          const tc = await pg.getTextContent();
          const text = (tc.items as any[]).map((it) => (it && it.str) || "").join(" ").replace(/ +/g, " ").trim();
          // A cover sheet names the whole set in one table, whatever the
          // architect. Harvest it even when this page's own title block parses.
          for (const row of parseDrawingList(text)) {
            if (!listed.has(row.sheetNo)) {
              listed.set(row.sheetNo, {
                ...row,
                discipline: (/^([A-Z]{1,3})/.exec(row.sheetNo) || [, ""])[1],
                listedIn: f.name, listedOnPage: i,
              });
            }
          }
          const tb = parseTitleBlock(text);
          if (!tb) {
            unparsed.push({ file: f.name, page: i, reason: text.length < 50 ? "no extractable text (scanned?)" : "no title block matched" });
            continue;
          }
          const row = { ...tb, sourceFile: f.name, sourcePage: i, folderPath: f.folderPath, webUrl: f.webUrl, itemId: f.itemId };
          // A set often ships the SAME sheets twice, once in a combined PDF and
          // once as individual files. Collapsing here is what stops every sheet
          // being counted, and later reported, twice.
          const key = tb.sheetNo + "|" + tb.revision;
          if (seen.has(key)) { duplicates++; continue; }
          seen.set(key, row);
          sheets.push(row);
        }
      } catch (e) {
        unparsed.push({ file: f.name, reason: `PDF parse failed: ${String((e as any)?.message ?? e)}` });
        if (big) {
          oversized.push({ file: f.name, sizeMB, folderPath: f.folderPath, webUrl: f.webUrl, opened: true,
            reason: `opened at ${sizeMB}MB but parsing failed: ${String((e as any)?.message ?? e)}` });
        }
      }
      if (big) {
        const got = sheets.length - sheetsBefore;
        if (got > 0) oversized.push({ file: f.name, sizeMB, folderPath: f.folderPath, webUrl: f.webUrl, opened: true, sheetsFound: got });
      }
    }

    // Merge the drawing list in. A parsed title block always wins: it carries a
    // revision and a real source page, where a listed sheet carries neither.
    // Listed-only rows are what make a set countable on projects whose title
    // block no pattern reads, which after the 2026-08-02 survey is most of them.
    const parsedNos = new Set(sheets.map((s) => s.sheetNo));
    let fromList = 0;
    for (const [no, row] of listed) {
      if (parsedNos.has(no)) continue;
      fromList++;
      sheets.push({
        sheetNo: no,
        discipline: row.discipline,
        sheetTitle: row.sheetTitle,
        sheetDate: null, drawnBy: null, checkedBy: null, projectNo: null,
        phase: null, pageOfSet: null, setTotal: null,
        // No revision is knowable from a list. Saying "0" here would assert a
        // base issue that nothing on the page supports.
        revision: null, revisionDescription: null, revisionDate: null,
        titleBlockLayout: null,
        source: "drawing-list",
        sourceFile: row.listedIn, sourcePage: row.listedOnPage,
        folderPath: subfolder, webUrl: null, itemId: null,
      });
    }
    for (const s of sheets) if (!s.source) s.source = "title-block";

    sheets.sort((a, b) => String(a.sheetNo).localeCompare(String(b.sheetNo)));
    const { byDiscipline, partialDisciplines, isPartialIssue } = summarizeDisciplines(sheets);

    return asText({
      project, subfolder, scope,
      count: sheets.length,
      byDiscipline,
      isPartialIssue,
      ...(partialDisciplines.length ? { partialDisciplines } : {}),
      scanned: {
        pdfs: pdfs.length, filesOpened, pagesParsed, duplicatesCollapsed: duplicates,
        // Where the rows came from. A set that is all drawing-list means no
        // title block parsed: the sheet numbers are trustworthy, the revisions
        // are simply unknown rather than zero.
        fromTitleBlocks: sheets.length - fromList, fromDrawingList: fromList,
      },
      // Paging state. nextOffset is null ONLY when the folder is exhausted, so
      // "keep calling until nextOffset is null" is a complete read and needs no
      // arithmetic from the caller.
      paging: {
        offset: start,
        totalFiles: ordered.length,
        filesRemaining: Math.max(0, ordered.length - (start + consumed())),
        nextOffset: start + consumed() < ordered.length ? start + consumed() : null,
        ...(stoppedMidFile ? { resumesMidFile: true } : {}),
      },
      ...(excludedFolders.length ? { excludedFolders } : {}),
      sheets,
      ...(unparsed.length ? { unparsed } : {}),
      ...(oversized.length
        ? {
          oversizedFiles: oversized,
          oversizedWarning: oversized.some((o) => !o.opened)
            ? `${oversized.filter((o) => !o.opened).length} combined PDF(s) were TOO LARGE to open, so any sheet that exists ONLY inside them is missing from this result. Open them via webUrl, or re-run against the individual-PDF subfolder.`
            : `${oversized.length} oversized PDF(s) were opened successfully — no sheets lost.`,
        }
        : {}),
      ...(crawlTruncated ? { crawlWarning: "The SharePoint folder crawl hit its request cap, so some files under this path were not seen. Results are incomplete." } : {}),
      ...(start + consumed() < ordered.length
        ? {
          coverageWarning: `Read files ${start + 1}-${start + filesConsumed} of ${ordered.length}. ` +
            `${ordered.length - (start + consumed())} file(s) in this folder have NOT been fully read, so any sheet ` +
            `that exists only in them is missing here. Call again with offset:${start + consumed()} to continue` +
            (stoppedMidFile ? ", which re-reads the file the page budget cut short." : "."),
        }
        : {}),
      note: "Revision comes from each sheet's own revision block; an empty block means base issue, revision 0. " +
        "Rows are NOT written anywhere — this is a read-only extraction for review.",
    });
  },
});

mcp.tool("search_field_photos", {
  description:
    "Search field-photo upload sessions from the Field Photos mobile app (and Site Report photo " +
    "captures). Each session is one dated batch of photos on SharePoint, with metadata: phase " +
    "(Existing Conditions, Demo/Abatement, Rough-In, Construction Progress, Commissioning, " +
    "Substantial Completion, Punch List, Final/Completed), system (Mechanical/HVAC, Electrical, " +
    "Plumbing, Fire Protection, ...), location/floor, site address, tags, notes, photographer, and " +
    "photo count. Every result carries the SharePoint folder URL so the photos can be opened " +
    "directly. Answers questions like 'do we have existing-conditions photos of the roof at X?'. " +
    "NOTE: the index starts 2026-07-15; older sessions get indexed automatically as people browse " +
    "the Field Photos gallery, so absence here does not prove no photos exist — offer the " +
    "project's SharePoint Photos folder (via list_project_documents) as a fallback.",
  inputSchema: z.object({
    project: z.string().optional().describe("Project number, id, or part of the project name"),
    query: z.string().optional().describe("Free text across phase, system, location, address, tags, notes, and photographer"),
    phase: z.string().optional().describe("Phase filter (substring match), e.g. 'Punch List' or 'Existing'"),
    dateFrom: z.string().optional().describe("Only sessions with photos taken on/after this date (YYYY-MM-DD)"),
    dateTo: z.string().optional().describe("Only sessions with photos taken on/before this date (YYYY-MM-DD)"),
  }),
  handler: async ({ project, query, phase, dateFrom, dateTo }) => {
    const rows = await sbGetAll(
      "pms_field_photo_sessions?select=project_number,project_name,photo_date,phase,system," +
      "location,address,photographer,notes,tags,photo_count,folder_url,source,created_by,uploaded_at" +
      "&order=photo_date.desc.nullslast",
    );
    const has = (v: unknown, needle: string) => String(v ?? "").toLowerCase().includes(needle);
    let out = rows;
    if (project) {
      const pq = project.toLowerCase().trim();
      out = out.filter((r: any) => has(r.project_number, pq) || has(r.project_name, pq));
    }
    if (phase) { const ph = phase.toLowerCase().trim(); out = out.filter((r: any) => has(r.phase, ph)); }
    if (dateFrom) out = out.filter((r: any) => r.photo_date && r.photo_date >= dateFrom);
    if (dateTo)   out = out.filter((r: any) => r.photo_date && r.photo_date <= dateTo);
    if (query) {
      const q = query.toLowerCase().trim();
      out = out.filter((r: any) =>
        [r.phase, r.system, r.location, r.address, r.notes, r.photographer, (r.tags || []).join(" ")]
          .some((f: unknown) => has(f, q)));
    }
    const CAP = 200;
    return asText({
      count: out.length,
      truncated: out.length > CAP,
      sessions: out.slice(0, CAP).map((r: any) => ({
        project: r.project_number ? `${r.project_number} — ${r.project_name}` : r.project_name,
        date: r.photo_date, phase: r.phase, system: r.system, location: r.location,
        address: r.address, photographer: r.photographer, notes: r.notes || undefined,
        tags: (r.tags || []).length ? r.tags : undefined, photos: r.photo_count,
        source: r.source, folderUrl: r.folder_url,
      })),
    });
  },
});

// Canonical Additional Services Agreement (add service) template. Source of truth:
// "Homeport II CA Extension Add Service.docx" (Sara Arias, 2026-07-15). The ACCEPTANCE
// paragraph and signature block are contract boilerplate — reproduce them VERBATIM.
const ADD_SERVICE_TEMPLATE = [
  "MECHANICAL AND ELECTRICAL DESIGN ENGINEERING SERVICES",
  "",
  "To: {{CONTACT_NAME}}                                Date: {{DATE}}",
  "    {{CONTACT_TITLE}}                               Project: {{PROJECT_NAME}} Add Service {{ADD_SERVICE_NO}}",
  "    {{CLIENT_FIRM}}                                 Location: {{LOCATION}}",
  "                                                    Project #: {{PROJECT_NUMBER}}",
  "",
  "Email: {{CONTACT_EMAIL}}",
  "",
  "ADDITIONAL SERVICES AGREEMENT",
  "",
  "Additional Services to the {{ORIGINAL_CONTRACT_DESCRIPTION}} contract dated {{ORIGINAL_CONTRACT_DATE}} for the above-mentioned project.",
  "",
  "SCOPE OF ENGINEERING SERVICES:  {{SCOPE_TITLE}}",
  "",
  "{{SCOPE_ITEMS}}",
  "",
  "FEES",
  "",
  "Basic Fee:",
  "",
  "{{FEE_LINES}}",
  "",
  "ACCEPTANCE",
  "",
  "This Agreement is in accordance with communication and design direction from your firm.  All provisions of the original contract remain in effect.",
  "",
  "Please sign below to authorize us to proceed with this additional scope of work.  Any form of notice to proceed with this work via written or email communication shall be deemed as acceptance of this proposal and its fees in its entirety.",
  "",
  "EXCLUSIONS",
  "",
  "{{EXCLUSION_ITEMS}}",
  "All other exclusions in the base-bid contract will remain applicable to this additional service.",
  "",
  "",
  "Presented By:                                       Accepted By:",
  "",
  "SETTY & ASSOCIATES, LTD. PC                         {{CLIENT_FIRM_CAPS}}",
  "",
  "____________________________________                ____________________________________",
  "(Signature)                    (Date)               (Signature)                    (Date)",
  "",
  "Boggarm S. Setty, P.E., ASHRAE Fellow, AEE Fellow   ____________________________________",
  "(Printed Name)                                      (Printed Name)",
  "",
  "CEO & Founder                                       ____________________________________",
  "(Title)                                             (Title)",
].join("\n");

// Filing rules for documents drafted from these templates. The PMS Word add-in
// ("Print to OneNote") auto-detects the project by scoring the FILENAME (+10 when it
// contains the project number) and the first-page text (+5); auto-select needs >= 5.
const FILING_GUIDANCE = {
  fileName:
    "Name the .docx starting with the Setty project number, then the document title — e.g. " +
    "'SAPX206004.00 - Homeport II CA Add Service 7.docx'. The project number in the filename " +
    "(and in the header's Project # field) is what tags the document: the PMS Word add-in " +
    "auto-detects the project from it. Never use \\ / : * ? \" < > | in the name.",
  defaultLocation:
    "Default save location is the project's 'Project Management' subfolder in SharePoint " +
    "(Project Document Library > <project folder> > Project Management). Use " +
    "list_project_documents with the projectNumber and subfolder:'Project Management' to get " +
    "the folder and link the user to it.",
  pdfWorkflow:
    "After saving, the user opens the .docx in Word and uses the Setty PMS Word add-in " +
    "('Print to OneNote' button, Home tab): it auto-detects the project (via the number in " +
    "the filename/header), exports the PDF into the project's OneNote Documents section, can " +
    "save the .docx to the project's SharePoint folder, and permanently tags the file with " +
    "the project for future sessions. Mention this next step when delivering the document.",
};

const ADD_SERVICE_INSTRUCTIONS = {
  usage:
    "Fill every {{PLACEHOLDER}}, keep the section order exactly, and reproduce the ACCEPTANCE " +
    "paragraphs, the exclusions closing line, and the Setty signature block VERBATIM — they are " +
    "contract boilerplate, do not reword them. Draft as a formal one-to-two-page letter agreement " +
    "(Word document if the user wants a file). Ask the user for anything you cannot derive from " +
    "PMS data or the conversation — typically the scope, fees, exclusions, add-service number, " +
    "and original contract date.",
  placeholders: {
    CONTACT_NAME: "Client contact with honorific, e.g. 'Ms. Virginia Westervelt' — the person who will sign.",
    CONTACT_TITLE: "Their title / division at the client firm, e.g. 'Project Manager / Marine Division'.",
    CLIENT_FIRM: "Client firm name with short alias in parens if one is used, e.g. 'McLaren Engineering Group (McLaren)'.",
    CLIENT_FIRM_CAPS: "Client firm in ALL CAPS for the signature block, e.g. 'MCLAREN ENGINEERING GROUP (MCLAREN)'.",
    CONTACT_EMAIL: "Contact's email address.",
    DATE: "Issue date in long form, e.g. 'October 20, 2025'.",
    PROJECT_NAME: "Project name as the client knows it.",
    ADD_SERVICE_NO: "Sequential add-service number for THIS project (check prior add services in the project's emails/documents; e.g. Homeport II was 'Add Service 7').",
    LOCATION: "Project location (city or city, state).",
    PROJECT_NUMBER: "Setty project number, e.g. SAPX206004.00.",
    ORIGINAL_CONTRACT_DESCRIPTION: "Service description from the base contract, e.g. 'Design Engineering Services'.",
    ORIGINAL_CONTRACT_DATE: "Base contract date, e.g. '3/26/2020'.",
    SCOPE_TITLE: "ALL-CAPS discipline/scope label, e.g. 'MEP/FP/FUELING CA'.",
    SCOPE_ITEMS: "Short declarative bullet lines of the added scope (durations, counts, deliverables), e.g. 'Extension of CA duration from 12 months to approximately 30 months for Homeport Site.' / 'Additional (11) site visits for Site CA.'",
    FEE_LINES: "One line per fee component: 'The fee for <component>: $96,280.00' — currency with thousands separators and two decimals. A single lump sum is one line: 'The fee for this additional service: $X,XXX.00'.",
    EXCLUSION_ITEMS: "Bullet lines of what is NOT included (design revisions, studies, estimating, etc.). Always followed by the fixed base-bid exclusions line already in the template.",
  },
  fixedBoilerplate: [
    "The two ACCEPTANCE paragraphs.",
    "The closing exclusions line ('All other exclusions in the base-bid contract...').",
    "Setty signature block: SETTY & ASSOCIATES, LTD. PC / Boggarm S. Setty, P.E., ASHRAE Fellow, AEE Fellow / CEO & Founder.",
    "The letterhead heading 'MECHANICAL AND ELECTRICAL DESIGN ENGINEERING SERVICES'.",
  ],
  filing: FILING_GUIDANCE,
};

// Shared: pull compact live project context to pre-fill a document header.
async function projectHeaderContext(projectNumber?: string): Promise<any | null> {
  if (!projectNumber || !projectNumber.trim()) return null;
  const pid = await resolveProjectId(projectNumber);
  const p = pid ? await getProjectById(pid) : null;
  if (!p) return { error: `No project matching \"${projectNumber}\" — fill the header placeholders manually.` };
  return {
    name: p.name ?? null, projectNumber: p.projectNumber ?? null,
    ownerAgency: p.owner ?? null, status: p.status ?? null,
    location: p.location || p.address || null,
    contacts: (Array.isArray(p.contacts) ? p.contacts : []).map((c: any) => ({
      name: c?.name ?? null, role: c?.role || c?.title || null,
      company: c?.company || c?.organization || null,
      email: c?.email ?? null, phone: c?.phone ?? null,
    })),
  };
}

// Setty's standard letterhead — the SAME style as the add-service template; per Sara
// (2026-07-15) it is the firm's general format for formal outbound documents.
const SETTY_LETTERHEAD_TEMPLATE = [
  "MECHANICAL AND ELECTRICAL DESIGN ENGINEERING SERVICES",
  "",
  "To: {{CONTACT_NAME}}                                Date: {{DATE}}",
  "    {{CONTACT_TITLE}}                               Project: {{PROJECT_TITLE}}",
  "    {{RECIPIENT_FIRM}}                              Location: {{LOCATION}}",
  "                                                    Project #: {{PROJECT_NUMBER}}",
  "",
  "Email: {{CONTACT_EMAIL}}",
  "",
  "{{DOCUMENT_TITLE}}",
  "",
  "{{BODY}}",
].join("\n");

const SETTY_SIGNATURE_BLOCK = [
  "Presented By:                                       Accepted By:",
  "",
  "SETTY & ASSOCIATES, LTD. PC                         {{RECIPIENT_FIRM_CAPS}}",
  "",
  "____________________________________                ____________________________________",
  "(Signature)                    (Date)               (Signature)                    (Date)",
  "",
  "Boggarm S. Setty, P.E., ASHRAE Fellow, AEE Fellow   ____________________________________",
  "(Printed Name)                                      (Printed Name)",
  "",
  "CEO & Founder                                       ____________________________________",
  "(Title)                                             (Title)",
].join("\n");

const LETTERHEAD_INSTRUCTIONS = {
  usage:
    "This is Setty & Associates' standard letterhead format for formal outbound documents " +
    "(letters, proposals, agreements, notices). Fill every {{PLACEHOLDER}}; keep the heading " +
    "'MECHANICAL AND ELECTRICAL DESIGN ENGINEERING SERVICES' and the header field order " +
    "(To/Date/Project/Location/Project #/Email) exactly. {{DOCUMENT_TITLE}} is an ALL-CAPS " +
    "document-type title (e.g. 'ADDITIONAL SERVICES AGREEMENT', 'PROPOSAL', 'TRANSMITTAL'); " +
    "{{BODY}} is the document content, typically organized under short ALL-CAPS section " +
    "headings. For agreements needing client acceptance, close with signatureBlock (two " +
    "columns: Setty presents, client accepts); for one-way letters a simple Setty signature " +
    "(Boggarm S. Setty, P.E., ASHRAE Fellow, AEE Fellow, CEO & Founder) suffices. Date in " +
    "long form, e.g. 'October 20, 2025'. NOTE: for add services specifically, use " +
    "get_add_service_template instead — it carries the full agreement structure and its " +
    "required boilerplate.",
  signatureBlock: SETTY_SIGNATURE_BLOCK,
  filing: FILING_GUIDANCE,
};

mcp.tool("search_agency_preferences", {
  description:
    "Setty's KNOWLEDGE LAYER on how each client agency actually works: mined, verified process rules and " +
    "preferences per agency (DASNY, CUNY, NYC DDC, SUNY, SCA, ...) covering submittal and RFI handling, " +
    "review/comment expectations, formatting and deliverable conventions, and billing or closeout quirks. " +
    "Use for 'what does <agency> expect / require / prefer for X?', when preparing a submission or proposal " +
    "for an agency, or to sanity-check an approach against how that agency has behaved before. This is firm " +
    "know-how rather than project data — pair it with get_project for the specific job. Defaults to active " +
    "entries; archived ones are superseded and returned only on request.",
  inputSchema: z.object({
    agency: z.string().optional().describe("Agency name or part of it, e.g. 'DASNY', 'CUNY', 'DDC'"),
    query: z.string().optional().describe("Free text across the requirement, type, discipline, applies-to, notes, and source"),
    discipline: z.string().optional().describe("Discipline filter (substring), e.g. 'Mechanical', 'Electrical'"),
    includeArchived: z.boolean().optional().describe("Include superseded/archived entries (default false)"),
  }),
  handler: async ({ agency, query, discipline, includeArchived }) => {
    const rows = await sbGetAll(
      "pms_agency_preferences?select=agency,preference_type,discipline,requirement_or_preference," +
      "source,date_verified,applies_to,notes,status,updated_at&order=agency.asc",
    );
    const has = (v: unknown, needle: string) => String(v ?? "").toLowerCase().includes(needle);
    let out = includeArchived ? rows : rows.filter((r: any) => r.status !== "archived");
    if (agency) { const a = agency.toLowerCase().trim(); out = out.filter((r: any) => has(r.agency, a)); }
    if (discipline) { const d = discipline.toLowerCase().trim(); out = out.filter((r: any) => has(r.discipline, d)); }
    if (query) {
      const q = query.toLowerCase().trim();
      out = out.filter((r: any) =>
        [r.requirement_or_preference, r.preference_type, r.discipline, r.applies_to, r.notes, r.source]
          .some((f: unknown) => has(f, q)));
    }
    const CAP = 200;
    return asText({
      count: out.length,
      truncated: out.length > CAP,
      preferences: out.slice(0, CAP).map((r: any) => ({
        agency: r.agency, type: r.preference_type, discipline: r.discipline || undefined,
        requirement: r.requirement_or_preference, appliesTo: r.applies_to || undefined,
        notes: r.notes || undefined, source: r.source || undefined,
        verified: r.date_verified || undefined, status: r.status,
      })),
    });
  },
});

mcp.tool("get_letterhead_template", {
  description:
    "Setty's standard letterhead / formal document format — use when drafting ANY formal " +
    "document or letter on Setty's behalf (proposals, letters, notices, agreements). Returns " +
    "the letterhead header block with {{PLACEHOLDERS}}, formatting conventions, and the " +
    "standard signature block, and — when projectNumber is given — that project's live PMS " +
    "context (name, number, owner agency, contacts) to pre-fill from. For add services " +
    "specifically, use get_add_service_template instead.",
  inputSchema: z.object({
    projectNumber: z.string().optional().describe("Project number, id, or name — pulls live project context to pre-fill the header"),
  }),
  handler: async ({ projectNumber }) => {
    const projectContext = await projectHeaderContext(projectNumber);
    return asText({ template: SETTY_LETTERHEAD_TEMPLATE, instructions: LETTERHEAD_INSTRUCTIONS, projectContext });
  },
});

mcp.tool("get_add_service_template", {
  description:
    "Setty's ADDITIONAL SERVICES AGREEMENT template — use whenever asked to draft or create an " +
    "'add service', additional services proposal/agreement, or added-scope fee letter on an " +
    "existing project. Returns the canonical template with {{PLACEHOLDERS}}, fill-in " +
    "instructions (which sections are fixed contract boilerplate vs project-specific), and — " +
    "when projectNumber is given — that project's live PMS context (name, number, owner agency, " +
    "contacts) to pre-fill from. Ask the user for scope, fees, exclusions, and the original " +
    "contract date if not provided; check the project's emails/documents for prior add services " +
    "to determine the next add-service number.",
  inputSchema: z.object({
    projectNumber: z.string().optional().describe("Project number, id, or name — pulls live project context to pre-fill the header"),
  }),
  handler: async ({ projectNumber }) => {
    const projectContext = await projectHeaderContext(projectNumber);
    return asText({ template: ADD_SERVICE_TEMPLATE, instructions: ADD_SERVICE_INSTRUCTIONS, projectContext });
  },
});

// Live firm-template folder on SharePoint — maintained by Sara: drop a file into
// "SAPX26XXX - NY 2026 Templates and Standards" > "01 📋 Project Management" >
// "Templates for MCP Connector" and it becomes available here, no redeploy.
// Folders are matched by name-contains so numbering/emoji prefixes don't matter.
let _tmplFolder: { driveId: string; itemId: string } | null = null;
async function templatesFolder(): Promise<{ driveId: string; itemId: string }> {
  if (_tmplFolder) return _tmplFolder;
  const driveId = await docDriveId();
  const proj = await findProjectFolderInDrive(driveId, "sapx26xxx");
  if (!proj) throw new Error("Templates project folder ('SAPX26XXX - NY 2026 Templates and Standards') not found in the Project Document Library.");
  const findChild = async (parentId: string, needle: string): Promise<any | null> => {
    let url: string = `/drives/${driveId}/items/${parentId}/children?$select=id,name,folder&$top=200`;
    while (url) {
      const page = await graphGet(url);
      for (const it of (page.value || [])) {
        if (it.folder && String(it.name).toLowerCase().includes(needle)) return it;
      }
      const next = page["@odata.nextLink"];
      url = next ? next.replace("https://graph.microsoft.com/v1.0", "") : "";
    }
    return null;
  };
  const pm = await findChild(proj.id, "project management");
  if (!pm) throw new Error("'Project Management' folder not found under the templates project.");
  const tpl = await findChild(pm.id, "templates for mcp");
  if (!tpl) throw new Error("'Templates for MCP Connector' folder not found under Project Management.");
  _tmplFolder = { driveId, itemId: tpl.id };
  return _tmplFolder;
}

const TEMPLATE_INSTRUCTIONS = {
  usage:
    "This is a canonical Setty template — follow its structure, section order, and boilerplate " +
    "language VERBATIM; only replace the [bracketed] fill-in fields and obvious placeholders " +
    "with the engagement's specifics. The extraction may include form-authoring hint text " +
    "(e.g. 'This form has fields. To begin, just click...') — that is NOT document content, " +
    "drop it. Formatting follows Setty's letterhead conventions (get_letterhead_template). " +
    "Ask the user for any value you cannot derive from PMS data or the conversation.",
  filing: FILING_GUIDANCE,
};

mcp.tool("get_template", {
  description:
    "Setty's canonical document templates, read LIVE from the firm's 'Templates for MCP " +
    "Connector' SharePoint folder — use when drafting a firm document from a standard form: " +
    "subconsultant/sub agreement (and sub agreement modification), CAD release form, " +
    "certificate of substantial completion, engineer's supplemental instructions (ESI), " +
    "building report cards, additional services agreement, and whatever else the team adds. " +
    "Call WITHOUT name to list the available templates; call with name (fuzzy, e.g. 'sub " +
    "agreement', 'CAD release') to get that template's full text plus fill-in and filing " +
    "instructions. Pass projectNumber to also get live project context to pre-fill from. " +
    "(For add services, get_add_service_template also works and carries curated guidance.)",
  inputSchema: z.object({
    name: z.string().optional().describe("Template to fetch, fuzzy-matched against the file names (e.g. 'sub agreement', 'CAD release'). Omit to list all available templates."),
    projectNumber: z.string().optional().describe("Project number, id, or name — pulls live project context to pre-fill the template"),
  }),
  handler: async ({ name, projectNumber }) => {
    try {
      const { driveId, itemId } = await templatesFolder();
      const page = await graphGet(`/drives/${driveId}/items/${itemId}/children?$select=id,name,size,file,webUrl,lastModifiedDateTime&$top=200`);
      const files = (page.value || []).filter((it: any) => it.file);
      const listing = files.map((f: any) => ({ name: f.name, size: f.size, modified: f.lastModifiedDateTime }));
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
      const q = norm(name ?? "");
      if (!q) {
        return asText({ count: listing.length, templates: listing, note: "Call again with name:'<one of these>' to get the template text." });
      }
      const matches = files.filter((f: any) => norm(f.name).includes(q));
      if (!matches.length) {
        return asText({ error: `No template matching \"${name}\".`, available: listing.map((l: any) => l.name) });
      }
      if (matches.length > 1) {
        return asText({ note: `\"${name}\" matches ${matches.length} templates — call again with a more specific name.`, matches: matches.map((f: any) => f.name) });
      }
      const f = matches[0];
      const ext = (String(f.name).split(".").pop() || "").toLowerCase();
      const res = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${f.id}/content`,
        { headers: { Authorization: "Bearer " + (await graphToken()) } });
      if (!res.ok) return asText({ error: `Could not download \"${f.name}\" (Graph ${res.status}) — open via webUrl.`, webUrl: f.webUrl });
      let text = "";
      if (["docx", "dotx", "docm"].includes(ext)) {
        const { unzipSync, strFromU8 } = await import("npm:fflate@0.8.2");
        const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));
        const docXml = zip["word/document.xml"];
        if (!docXml) return asText({ error: `\"${f.name}\" had no readable document.xml — open via webUrl.`, webUrl: f.webUrl });
        text = strFromU8(docXml)
          .replace(/<w:tab[^>]*\/?>/g, "\t").replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "")
          .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
          .replace(/\n{3,}/g, "\n\n").trim();
      } else if (["xlsx", "xltx", "xlsm", "xls"].includes(ext)) {
        const mod: any = await import("npm:xlsx@0.18.5");
        const XLSX: any = mod.read ? mod : mod.default;
        const wb = XLSX.read(new Uint8Array(await res.arrayBuffer()), { type: "array" });
        const parts: string[] = [];
        for (const sheetName of (wb.SheetNames || [])) {
          const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName], { blankrows: false });
          if (csv && csv.trim()) parts.push("# Sheet: " + sheetName + "\n" + csv.trim());
        }
        text = parts.join("\n\n");
      } else {
        return asText({ error: `No text extractor for .${ext} — open via webUrl.`, name: f.name, webUrl: f.webUrl });
      }
      const projectContext = await projectHeaderContext(projectNumber);
      return asText({ name: f.name, modified: f.lastModifiedDateTime, webUrl: f.webUrl, template: text, instructions: TEMPLATE_INSTRUCTIONS, projectContext });
    } catch (e) {
      return asText({ error: String((e as any)?.message ?? e) });
    }
  },
});

const transport = new StreamableHttpTransport();
const httpHandler = transport.bind(mcp);
const app = new Hono();

const SHARED_SECRET   = Deno.env.get("MCP_SHARED_SECRET");
const ENTRA_TENANT_ID = Deno.env.get("ENTRA_TENANT_ID") || "f374c024-71c2-48b6-8420-076fff97327c";
const ENTRA_CLIENT_ID = Deno.env.get("ENTRA_CLIENT_ID") || "b49e795c-2af3-4ab9-aa39-52539d4a7a99";
const RESOURCE_META_URL = `${SUPABASE_URL}/functions/v1/pms-mcp/.well-known/oauth-protected-resource`;
const ENTRA_JWKS = ENTRA_TENANT_ID
  ? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${ENTRA_TENANT_ID}/discovery/v2.0/keys`))
  : null;

async function verifyEntraToken(token: string): Promise<boolean> {
  if (!ENTRA_JWKS || !ENTRA_CLIENT_ID) return false;
  try {
    const { payload } = await jwtVerify(token, ENTRA_JWKS, {
      issuer: `https://login.microsoftonline.com/${ENTRA_TENANT_ID}/v2.0`,
      audience: [ENTRA_CLIENT_ID, `api://${ENTRA_CLIENT_ID}`],
    });
    if (payload.tid && payload.tid !== ENTRA_TENANT_ID) return false;
    return true;
  } catch { return false; }
}

app.get("/pms-mcp/.well-known/oauth-protected-resource", (c) =>
  c.json({
    // Entra rejects sign-ins when the OAuth resource parameter differs from the
    // audience of the requested scopes (error 9010010), so advertise the
    // Application ID URI here rather than the function URL.
    resource: `api://${ENTRA_CLIENT_ID}`,
    authorization_servers: [`https://login.microsoftonline.com/${ENTRA_TENANT_ID}/v2.0`],
    scopes_supported: [`api://${ENTRA_CLIENT_ID}/MCP.Access`],
    bearer_methods_supported: ["header"],
  }));

app.use("/pms-mcp/mcp", async (c, next) => {
  const auth = c.req.header("Authorization") || "";
  if (SHARED_SECRET && auth === `Bearer ${SHARED_SECRET}`) { await next(); return; }
  if (auth.startsWith("Bearer ") && await verifyEntraToken(auth.slice(7))) { await next(); return; }
  c.header("WWW-Authenticate", `Bearer resource_metadata=\"${RESOURCE_META_URL}\"`);
  return c.json({ error: "Unauthorized" }, 401);
});

app.all("/pms-mcp/mcp", (c) => httpHandler(c.req.raw));
app.get("/pms-mcp/health", (c) => c.json({ ok: true, build: BUILD }));

Deno.serve(app.fetch);

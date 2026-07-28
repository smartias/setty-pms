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
  const SLIM = "pid:project->>id,name:project->>name,projectNumber:project->>projectNumber," +
    "status:project->>status,owner:project->>owner,archived:project->archived," +
    "milestones:project->milestones,rfis:project->rfis,submittals:project->submittals,notes:project->notes";
  const rows = await sbGetAll("pms_projects?select=" + SLIM + "&order=id.asc");
  const data = rows.map((r: any) => ({
    id: r.pid, name: r.name, projectNumber: r.projectNumber, status: r.status,
    owner: r.owner, archived: r.archived === true,
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
  _docDriveId = match.id;
  return _docDriveId;
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
  _drives = (d.value || []).map((x: any) => ({ id: x.id, name: x.name }));
  return _drives;
}
// Find a project's root folder (named by NUMBER, e.g. "<number> - ...") within a drive.
async function findProjectFolderInDrive(driveId: string, numPrefix: string): Promise<any | null> {
  let url: string = `/drives/${driveId}/root/children?$select=id,name,folder&$top=200`;
  while (url) {
    const page = await graphGet(url);
    for (const it of (page.value || [])) {
      if (it.folder && String(it.name).toLowerCase().startsWith(numPrefix)) return it;
    }
    const next = page["@odata.nextLink"];
    url = next ? next.replace("https://graph.microsoft.com/v1.0", "") : "";
  }
  return null;
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

function summarizeProject(p: any): Record<string, unknown> {
  const today = new Date().toISOString().slice(0, 10);
  const plausible = (d: string) => d >= "2015-01-01" && d <= "2100-12-31";
  const live = (p.milestones ?? []).filter((m: any) =>
    m.dueDate && plausible(m.dueDate) && !m.cancelled && (m.status ?? "") !== "Completed");
  const overdue = live.filter((m: any) => m.dueDate < today);
  const next = live.filter((m: any) => m.dueDate >= today)
    .sort((a: any, b: any) => String(a.dueDate).localeCompare(String(b.dueDate)))[0];
  return {
    name: p.name, projectNumber: p.projectNumber, status: p.status,
    ownerAgency: p.owner || null,
    nextMilestone: next ? { name: next.name, due: next.dueDate } : null,
    overdueCount: overdue.length, openActionItems: openActionItems(p).length,
    archived: !!p.archived,
  };
}

const mcp = new McpServer({
  name: "setty-pms", version: "1.0.0",
  schemaAdapter: (schema) => z.toJSONSchema(schema as z.ZodType),
});
const asText = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });

mcp.tool("search_projects", {
  description:
    "Search PMS projects by name, project number, status, or owner agency (e.g. DASNY, " +
    "CUNY, NYC DDC, SUNY Upstate). Returns compact summaries (each includes ownerAgency). " +
    "Leave query empty to list everything. Excludes archived (closed-out) projects by " +
    "default — pass includeArchived: true to also search the archive.",
  inputSchema: z.object({
    query: z.string().optional().describe("Free text: part of a name, number, status, or owner agency"),
    includeArchived: z.boolean().optional().describe("Include archived/closed-out projects (default false)"),
  }),
  handler: async ({ query, includeArchived }) => {
    const projects = await getProjects();
    const pool = includeArchived ? projects : projects.filter((p) => !p.archived);
    const q = (query ?? "").toLowerCase().trim();
    const matched = q
      ? pool.filter((p) => [p.name, p.projectNumber, p.status, p.owner].filter(Boolean)
          .some((f: string) => String(f).toLowerCase().includes(q)))
      : pool;
    return asText({ count: matched.length, includeArchived: !!includeArchived, projects: matched.map(summarizeProject) });
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
    "Full detail for one project, looked up by exact project number, id, or name. " +
    "Milestones, phases, team, and contacts come in full; RFIs, submittals, notes, and " +
    "emails are summarized (counts + status) — use search_rfis_submittals, list_milestones, " +
    "search_notes, or search_emails to read those in detail. " +
    "AUTHORITATIVE HERE — do NOT infer these from documents: `scopeContent` is the project's SCOPE as " +
    "maintained in PMS, and `directory` / `projectContacts` / `clientContact` / `teamMembers` are the " +
    "PROJECT DIRECTORY. Prefer these over anything found in a contract, proposal, or other document.",
  inputSchema: z.object({ identifier: z.string().describe("Project number, id, or exact name") }),
  handler: async ({ identifier }) => {
    const pid = await resolveProjectId(identifier);
    if (!pid) return asText({ error: `No project matching \"${identifier}\"` });
    const p = await getProjectById(pid);
    if (!p) return asText({ error: `No project matching \"${identifier}\"` });
    return asText(slimProjectForDetail(p));
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
    projectNumber: z.string().describe("Project number, id, or name"),
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
    projectNumber: z.string().describe("Project number, id, or name"),
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
        status: m.status || ((m.pctComplete || 0) >= 100 ? "Completed" : (m.pctComplete || 0) > 0 ? "In Progress" : "Not Started"),
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
    projectNumber: z.string().describe("Project number, id, or name"),
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
        const page = await graphGet(listPath);
        const items = (page.value || []).map((it: any) => ({
          itemId: dId + "|" + it.id, name: it.name, type: it.folder ? "folder" : "file",
          library: libName, size: it.size, modified: it.lastModifiedDateTime,
          ext: it.file ? (String(it.name).split(".").pop() || "").toLowerCase() : undefined,
        }));
        return asText({ folderId, library: libName, path: subfolder || "/", count: items.length, items });
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
          const page = await graphGet(listPath);
          return { name: dr.name, items: (page.value || []).map((it: any) => ({
            itemId: dr.id + "|" + it.id, name: it.name, type: it.folder ? "folder" : "file",
            library: dr.name, size: it.size, modified: it.lastModifiedDateTime,
            ext: it.file ? (String(it.name).split(".").pop() || "").toLowerCase() : undefined,
          })) };
        } catch { return { name: dr.name, items: [] as any[] }; }
      }));
      const found = per.filter(Boolean) as Array<{ name: string; items: any[] }>;
      const items = found.flatMap((f) => f.items);
      return asText({
        project: projectNumber, path: subfolder || "/",
        availableLibraries: drives.map((d) => d.name), librariesWithProject: found.map((f) => f.name),
        count: items.length, items,
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
app.get("/pms-mcp/health", (c) => c.json({ ok: true }));

Deno.serve(app.fetch);

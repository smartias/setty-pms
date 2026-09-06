// Tests for the 2026-09-06 multi-region SharePoint routing in index.ts:
// pms_regions maps a project's team to its region's site; every team without
// an enabled row falls back to the NY env defaults, so the change ships inert.
//
//   node supabase/functions/pms-mcp/regionRouting.test.mjs
//
// The pure resolution logic is COPIED below, same reason as the other pms-mcp
// tests: index.ts boots a server at import. Drift checks at the bottom.

let total = 0, failures = 0;
const check = (ok, label) => { total++; if (!ok) { failures++; console.error("✗ " + label); } };

// ── copies from index.ts (DB fetch replaced with an injected row list) ──────
const DEFAULT_REGION = { siteId: "ny-site-id", docLibrary: "Project Document Library" };
function buildRegionMap(rows) {
  const map = new Map();
  for (const r of (Array.isArray(rows) ? rows : [])) {
    if (r?.team && r?.sharepoint_site_id) {
      map.set(String(r.team).toUpperCase().trim(), {
        siteId: String(r.sharepoint_site_id),
        docLibrary: String(r.doc_library || DEFAULT_REGION.docLibrary),
      });
    }
  }
  return map;
}
function siteForTeam(map, team) {
  if (!team) return DEFAULT_REGION;
  return map.get(String(team).toUpperCase().trim()) ?? DEFAULT_REGION;
}
function siteUrlToGraphPath(ref) {
  if (!/^https?:\/\//i.test(ref)) return null;
  try {
    const u = new URL(ref);
    const path = u.pathname.replace(/\/+$/, "");
    return `/sites/${u.hostname}:${path || "/"}`;
  } catch { return null; }
}
function teamForProject(projects, projectNumber) {
  const num = String(projectNumber || "").toLowerCase().trim();
  if (!num) return null;
  const p = projects.find((x) => String(x.projectNumber || "").toLowerCase() === num) ??
    projects.find((x) => String(x.projectNumber || "").toLowerCase().startsWith(num));
  return p?.team ?? null;
}

// ── 1. Region resolution ────────────────────────────────────────────────────
const ROWS = [
  { team: "DC", sharepoint_site_id: "dc-site-id", doc_library: "Project Document Library" },
  { team: "atl", sharepoint_site_id: "atl-site-id", doc_library: "Projects" },
  { team: "BAD", sharepoint_site_id: "" },            // no site id: skipped
  { team: "", sharepoint_site_id: "orphan-site" },     // no team: skipped
];
const M = buildRegionMap(ROWS);
check(siteForTeam(M, "DC").siteId === "dc-site-id", "a mapped team routes to its region's site");
check(siteForTeam(M, "dc").siteId === "dc-site-id", "team match is case-insensitive");
check(siteForTeam(M, "ATL").docLibrary === "Projects", "a region can name a different document library");
check(siteForTeam(M, "NY") === DEFAULT_REGION, "a team without a row falls back to the env defaults");
check(siteForTeam(M, null) === DEFAULT_REGION && siteForTeam(M, undefined) === DEFAULT_REGION,
  "no team at all falls back to the env defaults");
check(siteForTeam(M, "BAD") === DEFAULT_REGION, "a row missing its site id is ignored, not half-applied");
check(siteForTeam(buildRegionMap(null), "DC") === DEFAULT_REGION, "an unreadable table degrades to defaults");

// ── 2. Project → team lookup (exact first, then prefix) ─────────────────────
const PROJECTS = [
  { projectNumber: "SAPX256015.00", team: "NY" },
  { projectNumber: "SAPX256015.01", team: "DC" },
  { projectNumber: "SAPX206004.00", team: null },
];
check(teamForProject(PROJECTS, "SAPX256015.00") === "NY", "exact project number wins");
check(teamForProject(PROJECTS, "sapx256015.01") === "DC", "lookup is case-insensitive");
check(teamForProject(PROJECTS, "SAPX256015") === "NY", "a prefix resolves to the first matching project");
check(teamForProject(PROJECTS, "SAPX206004.00") === null, "a project without a team yields null (default region)");
check(teamForProject(PROJECTS, "") === null && teamForProject(PROJECTS, "NOPE") === null,
  "empty and unknown numbers yield null");

// ── 3. Site URL → Graph path (console-pasted URLs) ──────────────────────────
check(siteUrlToGraphPath("https://setty.sharepoint.com/sites/DCProjects") ===
  "/sites/setty.sharepoint.com:/sites/DCProjects", "a plain site URL becomes a hostname:path Graph lookup");
check(siteUrlToGraphPath("https://setty.sharepoint.com/sites/DCProjects/") ===
  "/sites/setty.sharepoint.com:/sites/DCProjects", "trailing slash is trimmed");
check(siteUrlToGraphPath("setty.sharepoint.com,aa58,c97a") === null,
  "a composite Graph id passes through untouched (null = not a URL)");
check(siteUrlToGraphPath("") === null, "empty ref is not a URL");

// ── 4. Drift checks against the shipped source ─────────────────────────────
import { readFileSync } from "node:fs";
const shipped = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const has = (needle, label) => check(shipped.includes(needle), `${label} has DRIFTED from this test's copy`);
has('"pms_regions?select=team,sharepoint_site_id,doc_library,storage_kind,azure_share_url,azure_sas_env&enabled=eq.true"',
  "region rows query (enabled only, storage seam columns)");
// Storage seam (slice A): 'azure_files' regions are gated to browse/read
// semantics, the gates sit AFTER project resolution (HIDE must win), and the
// refusal text is one shared constant so every tool says the same true thing.
has('kind: r.storage_kind === "azure_files" ? "azure_files" : "sharepoint",', "unknown storage kinds fail closed to sharepoint");
has("const AZURE_LIMITED_NOTE =", "single shared azure-limitation note");
check((shipped.match(/AZURE_LIMITED_NOTE/g) || []).length >= 7,
  "the azure gate guards the file tools (drawings, sheets, current set, transmittals, find_document, listing)");
has('if ((await storageFor(project)).kind !== "sharepoint") {', "gates run on the RESOLVED project (after HIDE)");
has("azureSasEnv: r.azure_sas_env ? String(r.azure_sas_env) : null,",
  "SAS config is an env-var NAME — the token itself never comes from the database");
has("return `/sites/${u.hostname}:${path || \"/\"}`;", "URL-form site refs resolve via hostname:path");
has("/sites/${await resolveSiteId(region.siteId)}/drives?$select=id,name", "drive lookups resolve URL-form site refs");
has("async function docDriveId(team?: string | null): Promise<string> {", "docDriveId is region-aware");
has("async function siteDrives(team?: string | null): Promise<Array<{ id: string; name: string }>> {",
  "siteDrives is region-aware");
has('siteId: SP_SITE_ID, docLibrary: DOC_LIBRARY, kind: "sharepoint",', "env-default fallback (sharepoint kind)");
has("const drive = await docDriveId(await teamForProject(projectNumber));", "projectFolder routes by project team");
has("const drives = await siteDrives(await teamForProject(numPrefix));", "tree/subtree walks route by project team");
has('const proj = await findProjectFolderInDrive(driveId, "sapx26xxx");', "templates stay default-region (NY) for now");
// The map refresh shares the projects cache's 300s clock; a stale-forever
// region map would make adding a region silently require a redeploy.
const seg = shipped.slice(shipped.indexOf("async function regionMap"), shipped.indexOf("async function siteForTeam"));
check(seg.includes("300000"), "region map refreshes on the 300s clock");

console.log(failures
  ? `\n${failures} of ${total} assertions FAILED`
  : `\nall ${total} assertions pass`);
process.exit(failures ? 1 : 0);

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
const has = (needle, label, times = 1) => check((shipped.split(needle).length - 1) >= times, `${label} has DRIFTED from this test's copy`);
has('"pms_regions?select=team,sharepoint_site_id,doc_library,storage_kind&enabled=eq.true"',
  "region rows query (enabled only; the legacy single-share columns are gone since 1.18.1)");
check(!/azure_share_url|azure_sas_env/.test(shipped), "nothing in the connector still names the dropped single-share columns");
// Storage seam (slice A): 'azure_files' regions are gated to browse/read
// semantics, the gates sit AFTER project resolution (HIDE must win), and the
// refusal text is one shared constant so every tool says the same true thing.
has('kind: r.storage_kind === "azure_files" ? "azure_files" : "sharepoint",', "unknown storage kinds fail closed to sharepoint");
has("const AZURE_LIMITED_NOTE =", "single shared azure-limitation note");
// 1.16.0: the drawing tools index and read drives, so the gate remains only
// on what genuinely needs SharePoint — find_document (search index),
// prepare_transmittal and file_qa_report (writes), and the listing notes.
check((shipped.match(/AZURE_LIMITED_NOTE/g) || []).length >= 4 && (shipped.match(/AZURE_LIMITED_NOTE/g) || []).length <= 7,
  "the azure gate guards transmittal staging and filing only (not the drawing tools, not find_document since 1.17.2)");
check(/Drive-based project \(1\.17\.2\): the tree is a breadth-first walk/.test(shipped),
  "projectTree walks the project folder on a drive, so find_document ranks drive files");
has("async function loadPdfBytes(itemId: string, maxBytes: number", "one PDF loader for both storages");
has("const gate = await azurePathProject(dec.team, dec.relPath);\n    if (!gate.ok) throw new Error(", "the PDF loader runs the visibility gate on az ids");
has("buf = await loadPdfBytes(f.itemId, DRAWING_INDEX_MAX_BYTES, { cache: false });", "the index builder reads through the shared loader");
has("buf = await loadPdfBytes(f.itemId, SHEET_MAX_BYTES, { cache: false });", "extract_sheet_index reads through the shared loader");
has("return azureDrawingScope(String(team).toUpperCase().trim(), numPrefix, subfolder);", "drive projects get their drawing scope from the shares");
has("const bytes = await fetchDrawingPdfById(String(chosen.item_id));", "view_drawing opens indexed sheets by id (az or Graph)");
has("const bytes = await fetchDrawingPdfById(fileId);", "read_drawing_schedule opens by id (az or Graph)");
has("async function indexDerivedSet(numPrefix: string)", "drive projects compose the current set from the drawing index");
has("const st = await storageFor(project);", "gates run on the RESOLVED project (after HIDE)", 5);
has("sasEnv: s.sas_env ? String(s.sas_env) : null }))",
  "SAS config is an env-var NAME — the token itself never comes from the database");
// Region shares (1.15.0): a region carries N drives from pms_region_shares;
// the legacy single-share columns only serve a team the table has no rows
// for, so an older row keeps working until it is migrated.
has('"pms_region_shares?select=team,label,share_url,sas_env,sort_order&enabled=eq.true&order=sort_order.asc,label.asc"', "region shares query (enabled, ordered)");
has('console.warn("[regions] share rows not read:"', "a failed share read is logged, not fatal to region routing");
has("async function azureCtxForTeam(team: string | null | undefined, label?: string | null): Promise<AzureResolve> {", "a share is resolved by team + label");
has("const az = await azureCtxForTeam(dec.team, dec.label);", "both az: entry points resolve the share the id names", 2);
has("const { hits, problems, labels } = await azureProjectHits(t, num);", "azure-only listing and the hybrid annex search EVERY share of the region", 2);
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
// Storage seam slice B (2026-09-14): the Azure Files provider is wired in.
// The SAS is read from the function's env by the NAME on the row, the two
// browse/read tools accept `az:` ids, and hybrid regions report the annex.
has('} from "./azureFiles.ts";', "the provider module is imported");
has("const sas = normalizeSas(secretName ? Deno.env.get(secretName) : null);", "the SAS comes from the env secret named on the row");
has("if (isAzId(folderId)) {", "list_project_documents opens az: folder ids");
has('if (region.kind !== "sharepoint") {\n        const num = String(projectNumber || "").toLowerCase().trim();', "azure_files regions are browsed by project number, not refused");
has("const annex = region.shares.length ? await azureAnnexFor(team, num) : null;", "sharepoint regions with shares report their drive annexes");
has("if (isAzId(itemId)) {", "read_document opens az: file ids");
has("if (!pdfBytes) res = await getFile(az.ctx.share, dec.relPath, az.ctx.sas);", "read_document reads share bytes through the provider (PDF cache honoured)");
check(!shipped.includes("Ask Sara Arias."), "the slice-A 'not enabled yet' refusal is gone");
// Codex P1 on #260: an az: id is a typed PATH, so both tools gate it on the
// project it names (folder → project → team → projectRefVisible) before any
// share call, and the share root is never listed for a caller.
has("async function azurePathProject(team: string, relPath: string)", "share paths earn their own visibility verdict");
check((shipped.match(/const gate = await azurePathProject\(dec\.team, dec\.relPath\);/g) || []).length === 4,
  "every az: entry point runs the gate: list_project_documents, read_document, the PDF loader, drawing item meta");
has("if (!(await projectRefVisible(String(p.projectNumber)))) return notFound;", "the gate is projectRefVisible, so overrides and team scoping apply");
has('if (String(p.team || "").toUpperCase().trim() !== team) return notFound;', "a project is only served from its own team's share");
has('error: "The share root is not browsable."', "the share root is never listed for a caller");
// DC layout (1.15.1): a year folder may precede the project folder (the gate
// skips at most two year segments), the project folder is found under the
// year read off the number, and subfolder names resolve against the drive.
has("while (i < segs.length && i < 2 && isGroupingSegment(segs[i])) i++;", "the gate skips at most two leading grouping folders (year / entity)");
has("for (const ent of entities) { if (guess) dirs.push(joinRel(ent, guess)); dirs.push(ent); }", "entity folders are searched with the guessed year");
has("const guess = yearOfProjectNumber(num);", "the project folder is looked for under the year the number encodes");
has("await azureResolveSubfolder(az.ctx, dec.relPath, relIn)", "az folderId listings resolve subfolder names on the drive");
has("await azureResolveSubfolder(first.ctx, first.folder, relIn)", "azure-only default listings resolve subfolder names on the drive");
const azSeg = shipped.slice(shipped.indexOf("async function azureCtxForTeam"), shipped.indexOf("async function azureProjectFolder"));
check(azSeg.includes("300000"), "the share-root folder index refreshes on the 300s clock");
// Region site access (1.19.1, 2026-09-17): the connector's Sites.Selected
// grant is per site, so a region row naming an ungranted site made every
// SharePoint tool fail with a bare "Graph 403: accessDenied" (Tivoly, the
// first BT project). Both drive lookups go through one wrapper that rethrows
// it as the configuration fact it is; list_project_documents still returns
// the drive annex; /health?probe=regions checks every region's site.
has('} from "./regionAccess.ts";', "the region-access module is imported");
has("async function regionDrives(team: string | null | undefined, region: RegionSite)", "one wrapper resolves a region's drives");
has("throw regionAccessError(team, region.siteId, e) ?? e;", "a site-access failure is rethrown with the fix; anything else passes through");
check((shipped.match(/const list = await regionDrives\(team, region\);/g) || []).length === 2, "docDriveId and siteDrives both go through the wrapper");
has("if (!(e instanceof RegionAccessError)) throw e;", "list_project_documents catches only region-access failures");
has("recordSays = siteMismatchHint(team, region.siteId, p?.projectFolderUrl);", "…compares the record's own folder URL with the region's site");
has("const driveAnnex = num && region.shares.length ? await azureAnnexFor(team, num) : null;", "…and still hands over the drive annex");
has('if (c.req.query("probe") === "regions")', "the health probe for region sites exists");
has("const entries: Array<[string | null, RegionSite]> = [[null, DEFAULT_REGION], ...(await regionMap()).entries()];", "the probe covers the default region and every mapped one");
// Drive fallback: a SharePoint region whose site refuses the connector, and
// which has drive shares, is served from its drives like an azure_files
// region (browse, read, drawing index, sheet index, current set) instead of
// dying on the first Graph call. Every storage-kind gate reads the EFFECTIVE
// kind; the refusal is remembered 300 s; other failures keep the declared kind.
has("async function effectiveRegionForTeam(team: string | null | undefined): Promise<EffectiveRegion> {", "the effective-storage resolver exists");
has("return effectiveRegionForTeam(await teamForProject(projectNumber));", "storageFor resolves the EFFECTIVE kind");
check((shipped.match(/const region = await effectiveRegionForTeam\(team\);/g) || []).length === 4,
  "list_project_documents, projectTree, subtreeFiles and drawingScopeWalk gate on the effective kind");
check(!/const region = await siteForTeam\(team\);\n\s*if \(region\.kind !== "sharepoint"(\)| &&)/.test(shipped), "no storage-kind gate still reads the DECLARED kind (only the resolver itself does)");
has('if (region.kind !== "sharepoint" || !region.shares.length) return region;', "a region without drive shares never falls back (its SharePoint error stands)");
has("if (!(e instanceof RegionAccessError)) return region;", "a network/token failure keeps the declared kind");
has("return { ...region, kind: \"azure_files\", siteError: e };", "a refused site flips the region to its drives and carries the reason");
const effSeg = shipped.slice(shipped.indexOf("const _siteRefusal"), shipped.indexOf("function siteFallbackFields"));
check(effSeg.includes("300000"), "the refusal is remembered on the 300s clock");
check((shipped.match(/\.\.\.siteFallbackFields\(/g) || []).length >= 5, "drive-served results say the drive is a fallback and why");

console.log(failures
  ? `\n${failures} of ${total} assertions FAILED`
  : `\nall ${total} assertions pass`);
process.exit(failures ? 1 : 0);

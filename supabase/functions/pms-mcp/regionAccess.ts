// regionAccess.ts — what a Graph refusal on a REGION's SharePoint site means,
// and who fixes it (2026-09-17).
//
// The connector reads SharePoint app-only with `Sites.Selected`, which IT
// grants ONE SITE AT A TIME. A region row (pms_regions) that names a site the
// app has no grant on makes every SharePoint call for that region's projects
// fail with `Graph 403 accessDenied` before anything project-specific runs:
// docDriveId / siteDrives resolve the site's drives first, so
// list_project_documents, get_current_set, search_drawings, extract_sheet_index
// and the rest all die identically, and the drive annex the region may carry
// is never reached. The first time this bit was Tivoly (SIPX251008.00), the
// first project tagged BT: the BT row routes to the Baltimore site, the grant
// covers NYCProjects, and the PMS record's own folder URL pointed at
// NYCProjects anyway.
//
// This module is pure so regionAccess.test.mjs drives it without Graph.
// index.ts owns the Graph calls and wraps their failures with
// `regionAccessError`; a null return means "not a site-access problem, rethrow
// what you had".

export const CONNECTOR_APP_NAME = "Setty PMS - Claude Connector";
// Client id prefix only: enough to pick the right app registration in Entra
// (the three Setty apps had near-identical names once), not a secret.
export const CONNECTOR_APP_ID_PREFIX = "b49e795c";

export type RegionAccessKind = "forbidden" | "site_not_found";

export class RegionAccessError extends Error {
  readonly team: string | null;
  readonly siteRef: string;
  readonly status: number;
  readonly code: string | null;
  readonly kind: RegionAccessKind;
  readonly nextStep: string;
  constructor(init: { team: string | null; siteRef: string; status: number; code: string | null; kind: RegionAccessKind; message: string; nextStep: string }) {
    super(init.message);
    this.name = "RegionAccessError";
    this.team = init.team;
    this.siteRef = init.siteRef;
    this.status = init.status;
    this.code = init.code;
    this.kind = init.kind;
    this.nextStep = init.nextStep;
  }
}

// graphGet throws `Graph <status>: <body>`; read the status back off the message.
export function graphStatusOf(err: unknown): number | null {
  const m = /^Graph (\d{3})\b/.exec(String((err as any)?.message ?? err ?? ""));
  return m ? Number(m[1]) : null;
}

// The Graph error envelope's `code` ("accessDenied", "itemNotFound", ...).
export function graphErrorCodeOf(err: unknown): string | null {
  const m = /"code"\s*:\s*"([A-Za-z0-9_.-]+)"/.exec(String((err as any)?.message ?? err ?? ""));
  return m ? m[1] : null;
}

function teamLabel(team: string | null | undefined): string {
  const t = String(team || "").toUpperCase().trim();
  return t ? `region ${t}` : "the default (NY) region";
}

// Wrap a Graph failure raised while resolving a region's site or its drives.
// 403 → the grant (or the row) is wrong; 404 → the row names a site Graph
// cannot find. Anything else is not a region-access problem: null.
export function regionAccessError(team: string | null | undefined, siteRef: string, err: unknown): RegionAccessError | null {
  if (err instanceof RegionAccessError) return err;
  const status = graphStatusOf(err);
  if (status === null) return null;
  const code = graphErrorCodeOf(err);
  const t = String(team || "").toUpperCase().trim() || null;
  const where = teamLabel(team);
  const site = String(siteRef || "").trim() || "(unset)";
  if (status === 403) {
    return new RegionAccessError({
      team: t, siteRef: site, status, code, kind: "forbidden",
      message:
        `${where[0].toUpperCase()}${where.slice(1)}'s SharePoint site (${site}) refused the connector: Graph 403 ${code || "accessDenied"}. ` +
        `The connector reads SharePoint app-only with Sites.Selected, which IT grants one site at a time; this site has no grant ` +
        `for the "${CONNECTOR_APP_NAME}" app yet, or the region row names the wrong site. Every SharePoint tool on ` +
        `${where}'s projects fails the same way until one of those is fixed.`,
      nextStep:
        `Either IT (Nikhil) grants the "${CONNECTOR_APP_NAME}" app registration (client id ${CONNECTOR_APP_ID_PREFIX}…) read access on ` +
        `${site} through Sites.Selected, or an admin points ${where} at the site the project folders actually live on ` +
        `(Admin console → Regions). GET /pms-mcp/health?probe=regions shows which region sites the connector can reach. ` +
        `Legacy documents on the region's network-drive annex stay readable meanwhile (list_project_documents → driveAnnex.folders).`,
    });
  }
  if (status === 404) {
    return new RegionAccessError({
      team: t, siteRef: site, status, code, kind: "site_not_found",
      message: `${where[0].toUpperCase()}${where.slice(1)}'s SharePoint site could not be found by Graph (${site}: Graph 404 ${code || "itemNotFound"}).`,
      nextStep: `Fix the site URL for ${where} in Admin console → Regions (paste the site's browser URL, e.g. https://setty.sharepoint.com/sites/<SiteName>).`,
    });
  }
  return null;
}

// "/sites/<name>" of a SharePoint URL, lower-cased, or null when the value is
// not a URL (a Graph composite site id passes through as null: we cannot
// compare it to a folder URL without a Graph call).
export function sitePathOf(ref: string | null | undefined): string | null {
  const raw = String(ref || "").trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const u = new URL(raw);
    const m = /^\/(sites|teams)\/([^/]+)/i.exec(u.pathname);
    return m ? `${u.hostname.toLowerCase()}/${m[1].toLowerCase()}/${decodeURIComponent(m[2]).toLowerCase()}` : `${u.hostname.toLowerCase()}/`;
  } catch { return null; }
}

// When the PMS record's own folder URL sits on a DIFFERENT site from the one
// the region routes to, the row is the likelier fault, not the grant: the
// PMS web app creates every project folder on its hardcoded (NY) drive, so a
// project tagged into a new region still has its folder where the app put
// it. The Regions tab stores a site as its Graph composite id, which cannot
// be compared to a URL without the very Graph call that just failed; then
// the record's URL is still shown, with the comparison left to the reader.
// Returns the sentence to show, or null when there is nothing to say.
export function siteMismatchHint(team: string | null | undefined, regionSiteRef: string, projectFolderUrl: string | null | undefined): string | null {
  const regionSite = sitePathOf(regionSiteRef);
  const folderSite = sitePathOf(projectFolderUrl);
  if (!folderSite) return null;
  const folderUrl = String(projectFolderUrl).trim();
  const fix = `Until the region's own site holds the project folders, routing ${teamLabel(team)} at the site the record names is the fix that needs no IT grant.`;
  if (!regionSite) {
    return `The PMS record puts this project's folder at ${folderUrl}. ${teamLabel(team)[0].toUpperCase()}${teamLabel(team).slice(1)}'s row stores its site ` +
      `as a Graph id (${String(regionSiteRef).trim()}), so the two cannot be compared here; if that folder is not on the region's site, ` +
      `the row is what is wrong. ${fix}`;
  }
  if (regionSite === folderSite) return null;
  return `The PMS record puts this project's folder at ${folderUrl}, which is on a different SharePoint site ` +
    `from the one ${teamLabel(team)} routes to (${String(regionSiteRef).trim()}). ${fix}`;
}

// The structured tool result for a region-access failure: the message, the
// fix, the bare facts, and whatever the caller could still reach (the drive
// annex, the record's own folder URL).
export function regionAccessResult(e: RegionAccessError, extra?: { recordSays?: string | null; driveAnnex?: Record<string, unknown> | null }): Record<string, unknown> {
  return {
    error: e.message,
    nextStep: e.nextStep,
    region: e.team,
    site: e.siteRef,
    graph: { status: e.status, code: e.code, kind: e.kind },
    ...(extra?.recordSays ? { recordSays: extra.recordSays } : {}),
    ...(extra?.driveAnnex ? { driveAnnex: extra.driveAnnex } : {}),
  };
}

// Tests for regionAccess.ts — a Graph refusal on a region's SharePoint site,
// explained as the configuration fact it is (2026-09-17).
//
//   node supabase/functions/pms-mcp/regionAccess.test.mjs
//
// The module is pure, so this imports the real Edge source (Node strips the
// types). The wiring in index.ts is pinned by drift checks in
// regionRouting.test.mjs.

import {
  RegionAccessError, regionAccessError, regionAccessResult, siteMismatchHint, sitePathOf,
  graphStatusOf, graphErrorCodeOf, CONNECTOR_APP_NAME, CONNECTOR_APP_ID_PREFIX,
} from "./regionAccess.ts";

let total = 0, failures = 0;
const check = (ok, label) => { total++; if (!ok) { failures++; console.error("✗ " + label); } };

// What graphGet actually threw for Tivoly (SIPX251008.00, team BT) on 17 Sep 2026.
const DENIED = new Error('Graph 403: {"error":{"code":"accessDenied","message":"Access denied","innerError":{"date":"2026-09-17T22:54:04","request-id":"ca5fa6b9"}}}');
const MISSING = new Error('Graph 404: {"error":{"code":"itemNotFound","message":"The requested site was not found"}}');
const THROTTLED = new Error('Graph 429: {"error":{"code":"activityLimitReached"}}');
const BT_SITE = "https://setty.sharepoint.com/sites/BaltimoreTeam";

// ── 1. Reading Graph failures back off the message ──────────────────────────
check(graphStatusOf(DENIED) === 403 && graphStatusOf(MISSING) === 404 && graphStatusOf(THROTTLED) === 429, "status is read off graphGet's message");
check(graphStatusOf(new Error("SharePoint not configured yet")) === null && graphStatusOf(null) === null, "non-Graph errors have no status");
check(graphErrorCodeOf(DENIED) === "accessDenied" && graphErrorCodeOf(MISSING) === "itemNotFound", "the envelope code is read too");
check(graphErrorCodeOf(new Error("Graph 500: <html>")) === null, "no envelope, no code");

// ── 2. 403 on a region's site is the grant (or the row) ─────────────────────
const e403 = regionAccessError("BT", BT_SITE, DENIED);
check(e403 instanceof RegionAccessError && e403 instanceof Error, "a 403 becomes a RegionAccessError (still an Error, so `e.message` catch-alls work)");
check(e403.kind === "forbidden" && e403.status === 403 && e403.code === "accessDenied" && e403.team === "BT" && e403.siteRef === BT_SITE, "it carries the facts");
check(/region BT/i.test(e403.message) && e403.message.includes(BT_SITE), "the message names the region and the site");
check(e403.message.includes("Sites.Selected") && e403.message.includes(CONNECTOR_APP_NAME), "…and says the grant is per site, for the connector app");
check(/Every SharePoint tool on region BT/.test(e403.message), "…and that every SharePoint tool on the region fails the same way (not a broken project)");
check(e403.nextStep.includes(CONNECTOR_APP_ID_PREFIX) && /Admin console → Regions/.test(e403.nextStep) && e403.nextStep.includes("health?probe=regions"),
  "nextStep names the app id, the Regions tab, and the probe");
check(e403.nextStep.indexOf('Storage to "Azure share"') < e403.nextStep.indexOf("Sites.Selected") && /every office but NY/.test(e403.nextStep),
  "nextStep leads with making the drive the record (the rule for every office but NY), before the IT grant");
check(/served from them/.test(e403.nextStep) && /drawing index/.test(e403.nextStep), "nextStep says the region's drives serve the project meanwhile");
check(regionAccessError("bt", BT_SITE, DENIED).team === "BT", "team is normalised");
check(/default \(NY\) region/.test(regionAccessError(null, "ny-site-id", DENIED).message), "no team reads as the default region");
check(regionAccessError("BT", BT_SITE, e403) === e403, "an already-wrapped error passes through");

// ── 3. 404 is a wrong site URL; anything else is not ours ───────────────────
const e404 = regionAccessError("BT", BT_SITE, MISSING);
check(e404?.kind === "site_not_found" && /could not be found/.test(e404.message) && /Regions/.test(e404.nextStep), "a 404 says the row's site URL is wrong");
check(regionAccessError("BT", BT_SITE, THROTTLED) === null, "a 429 is not a region-access problem");
check(regionAccessError("BT", BT_SITE, new Error("fetch failed")) === null, "a network error is not either");

// ── 4. The record's own folder URL vs the region's site ─────────────────────
check(sitePathOf("https://setty.sharepoint.com/sites/NYCProjects/Project%20Document%20Library/SIPX251008.00%20-%20Tivoly") === "setty.sharepoint.com/sites/nycprojects", "site path of a folder URL");
check(sitePathOf("https://setty.sharepoint.com/sites/BaltimoreTeam") === "setty.sharepoint.com/sites/baltimoreteam", "site path of a site URL");
check(sitePathOf("setty.sharepoint.com,guid1,guid2") === null && sitePathOf("") === null, "a Graph composite id or nothing gives no path");
const TIVOLY_FOLDER = "https://setty.sharepoint.com/sites/NYCProjects/Project%20Document%20Library/SIPX251008.00%20-%20Tivoly%20EcoVillage%20MGrid";
const hint = siteMismatchHint("BT", BT_SITE, TIVOLY_FOLDER);
check(typeof hint === "string" && hint.includes(TIVOLY_FOLDER) && hint.includes(BT_SITE) && /region BT/.test(hint), "a folder on another site is called out with both URLs");
check(/needs no IT grant/.test(hint), "…and says re-pointing the region is the grant-free fix");
check(siteMismatchHint("BT", "https://setty.sharepoint.com/sites/NYCProjects/", TIVOLY_FOLDER) === null, "same site (trailing slash aside): nothing to say");
check(siteMismatchHint("BT", BT_SITE, "") === null && siteMismatchHint("BT", BT_SITE, undefined) === null, "no folder URL on the record: nothing to say");
const idHint = siteMismatchHint("BT", "setty.sharepoint.com,guid1,guid2", TIVOLY_FOLDER);
check(typeof idHint === "string" && idHint.includes(TIVOLY_FOLDER) && idHint.includes("setty.sharepoint.com,guid1,guid2") && /cannot be compared/.test(idHint),
  "a composite site id (what the Regions tab stores) cannot be compared, so the record's URL is shown and the comparison left to the reader");
check(/needs no IT grant/.test(idHint), "…still with the grant-free fix");

// ── 5. The tool result shape ────────────────────────────────────────────────
const res = regionAccessResult(e403, { recordSays: hint, driveAnnex: { available: true, folders: [{ folderId: "az:BT.SAOP:SAIP/2025/SIPX251008.00" }] } });
check(res.error === e403.message && res.nextStep === e403.nextStep && res.region === "BT" && res.site === BT_SITE, "error, nextStep, region, site");
check(res.graph.status === 403 && res.graph.code === "accessDenied" && res.graph.kind === "forbidden", "the Graph facts ride along");
check(res.recordSays === hint && res.driveAnnex.available === true, "the hint and the annex are passed through");
const bare = regionAccessResult(e403, { recordSays: null, driveAnnex: null });
check(!("recordSays" in bare) && !("driveAnnex" in bare), "absent extras are omitted, not null-valued");

console.log(failures ? `\n${failures} of ${total} assertions FAILED` : `\nall ${total} assertions pass`);
process.exit(failures ? 1 : 0);

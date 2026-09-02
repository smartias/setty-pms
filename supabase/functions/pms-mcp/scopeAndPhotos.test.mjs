// Tests for the 2026-09-02 pair in index.ts: the briefing's scope posture
// (stay in the MEPFP lane; defer to the directory's own experts; no
// volunteered extra work) and view_photos' pure plumbing (share-token
// encoding, image-file detection, stable paging order).
//
//   node supabase/functions/pms-mcp/scopeAndPhotos.test.mjs
//
// The functions are COPIED below, same reason as the other pms-mcp tests:
// index.ts boots a server at import. Drift checks at the bottom.

let total = 0, failures = 0;
const check = (ok, label) => { total++; if (!ok) { failures++; console.error("✗ " + label); } };

// ── copies from index.ts ────────────────────────────────────────────────────
const DEFER_DISCIPLINES = {
  "Architect": "architecture (egress, envelope, finishes, layouts, ADA clearances)",
  "Structural Engineer": "structural",
  "Civil Engineer": "civil / site utilities",
  "Code/Permit Consultant": "code interpretation and filings",
  "Environmental": "environmental / hazardous materials",
  "Cost Estimator": "cost estimating",
  "Construction Manager": "means & methods, sequencing, construction cost",
  "General Contractor": "means & methods",
  "Owners Rep": "owner-side direction",
};
function scopeDeferrals(companyNames, clients) {
  const byName = new Map(clients.map((c) => [String(c?.name || "").toLowerCase().trim(), c]));
  const out = [];
  const seen = new Set();
  for (const raw of companyNames) {
    const name = String(raw || "").trim();
    if (!name) continue;
    const c = byName.get(name.toLowerCase());
    for (const t of (Array.isArray(c?.types) ? c.types : [])) {
      const disc = DEFER_DISCIPLINES[t];
      const key = t + "|" + name.toLowerCase();
      if (!disc || seen.has(key)) continue;
      seen.add(key);
      out.push({ discipline: disc, firm: name });
    }
  }
  return out;
}
const PHOTO_EXT = new Set(["jpg", "jpeg", "png", "heic", "heif", "webp", "gif", "bmp", "tif", "tiff"]);
const isPhotoName = (name) =>
  PHOTO_EXT.has((String(name).split(".").pop() || "").toLowerCase());
function graphShareToken(url) {
  try {
    return "u!" + btoa(url).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  } catch { return null; }
}

// ── 1. Deferrals come from the directory's own firms ────────────────────────
const CLIENTS = [
  { name: "Dattner Architects", types: ["Architect"] },
  { name: "Silman", types: ["Structural Engineer"] },
  { name: "Langan", types: ["Civil Engineer", "Environmental"] },
  { name: "Code Consultants Inc", types: ["Code/Permit Consultant"] },
  { name: "Some Vendor", types: ["Vendor"] },
];
const d = scopeDeferrals(["Dattner Architects", "Langan", "Some Vendor", "Nobody Known LLC"], CLIENTS);
check(d.some((x) => x.firm === "Dattner Architects" && /architecture/.test(x.discipline)),
  "the architect maps to the architecture deferral");
check(d.filter((x) => x.firm === "Langan").length === 2,
  "a firm with two mapped types yields both deferrals");
check(!d.some((x) => x.firm === "Some Vendor"), "unmapped types (Vendor) produce no deferral");
check(!d.some((x) => x.firm === "Nobody Known LLC"), "a company not in the Global Directory is skipped");
check(scopeDeferrals(["dattner architects"], CLIENTS).length === 1, "name match is case-insensitive");
check(scopeDeferrals(["Dattner Architects", "Dattner Architects"], CLIENTS).length === 1,
  "duplicate directory companies collapse");
check(scopeDeferrals([], CLIENTS).length === 0 && scopeDeferrals(["X"], []).length === 0,
  "empty inputs are safe");

// ── 2. Image detection and paging plumbing ──────────────────────────────────
check(isPhotoName("IMG_4021.HEIC") && isPhotoName("panel.jpg") && isPhotoName("a.b.png"),
  "photo extensions match case-insensitively, last dot wins");
check(!isPhotoName("report.pdf") && !isPhotoName("noext") && !isPhotoName("archive.jpg.zip"),
  "non-images are refused");
const tok = graphShareToken("https://setty.sharepoint.com/sites/x/Photos/2026-08-06_Basement");
check(tok && tok.startsWith("u!") && !tok.includes("=") && !tok.includes("+") && !tok.includes("/"),
  "share token is base64url with the u! prefix and no padding");
check(graphShareToken("café—📷") === null, "non-latin1 URLs fail closed, not throw");

// ── 3. Drift checks against the shipped source ─────────────────────────────
import { readFileSync } from "node:fs";
const shipped = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const has = (needle, label) => check(shipped.includes(needle), `${label} has DRIFTED from this test's copy`);
has('mcp.tool("view_photos"', "view_photos is registered");
has("const VIEW_PHOTOS_MAX = 8;", "photo count cap");
has(".sort((a, b) => a.name.localeCompare(b.name));", "stable name-order paging");
has("res.content.length === 1 && res.content[0]?.type === \"text\";", "redaction skips mixed-content responses");
has('"Structural Engineer": "structural",', "deferral mapping");
has("guidance.push(SCOPE_POSTURE_GUIDANCE);", "scope posture rides every briefing");
has("do NOT volunteer extra site visits, studies, investigations", "no-extra-work rule");
has("/setty/i.test(String(p.prime || \"\"))", "prime detection");

console.log(failures
  ? `\n${failures} of ${total} assertions FAILED`
  : `\nall ${total} assertions pass`);
process.exit(failures ? 1 : 0);

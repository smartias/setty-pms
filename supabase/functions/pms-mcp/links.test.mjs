// The linkage system and Related Projects resolution, as surfaced by the MCP.
//
// Links are one-directional pointers the app writes via its Add Link modal;
// the connector renders them sentence-ready (outgoingLinks) and computes
// back-links by scanning the project (incomingLinks), mirroring what the app
// does at render time. Related Projects resolution turns a shared relatedGroup
// string into the actual sibling records.
//
// Run: node supabase/functions/pms-mcp/links.test.mjs
//
// The functions are COPIES (index.ts is not importable under node); a drift
// detector below compares the copies against the shipped bodies, with TS
// annotations normalised away, and fails the run if they diverge.

let failures = 0;
function check(ok, msg) {
  if (!ok) { failures++; console.error("FAIL: " + msg); }
}

// ── copies of the shipped functions ─────────────────────────────────────────

const LINK_TYPE_LABELS = {
  "references": "References", "documents": "Documents",
  "responds-to": "Responds To", "resolves": "Resolves", "supersedes": "Supersedes",
  "originates-from": "Originates From", "affects": "Affects",
};
const LINK_KIND_LABELS = {
  rfi: "RFI", submittal: "Submittal", co: "Change Order",
  milestone: "Milestone", note: "Note", email: "Email",
};
const LINK_LISTS = [
  ["rfi", "rfis"], ["submittal", "submittals"], ["co", "changeOrders"],
  ["milestone", "milestones"], ["note", "notes"],
];
function linkEntityLabel(kind, e) {
  if (!e) return "";
  if (kind === "rfi") return "RFI " + (e.number ?? "") + (e.title ? ": " + e.title : "");
  if (kind === "submittal") return "Submittal " + (e.number ?? "") + (e.description ? ": " + String(e.description).slice(0, 80) : "");
  if (kind === "co") return "CO " + (e.number ?? "") + (e.name ? " – " + e.name : "");
  if (kind === "milestone") return "Milestone: " + (e.name || e.id || "");
  if (kind === "note") return "Note (" + (e.category || "Note") + ", " + String(e.createdAt || "").slice(0, 10) + ")";
  if (kind === "email") return "Email: " + (e.subject || "(no subject)");
  return String(e.name || e.title || e.id || "");
}
function outgoingLinks(project, entity) {
  return (entity?.links ?? []).map((lk) => {
    let target = lk.targetLabel || "";
    if (!target && lk.targetSystem === "pms") {
      const pair = LINK_LISTS.find(([k]) => k === lk.targetType);
      const e = pair ? (project?.[pair[1]] ?? []).find((x) => String(x.id) === String(lk.targetId)) : null;
      if (e) target = linkEntityLabel(lk.targetType, e);
    }
    return {
      relationship: LINK_TYPE_LABELS[lk.linkType] || lk.linkType || "References",
      targetKind: lk.targetSystem === "pms"
        ? (LINK_KIND_LABELS[lk.targetType] || lk.targetType)
        : ({ sharepoint: "SharePoint File/Folder", onenote: "OneNote Page", outlook: "Email", external: "External Link" }[lk.targetSystem] || "Link"),
      target: target || lk.targetUrl || lk.targetId || "(unknown)",
      ...(lk.targetUrl ? { url: lk.targetUrl } : {}),
    };
  });
}
function incomingLinks(project, kind, entityId) {
  const out = [];
  for (const [k, listKey] of LINK_LISTS) {
    for (const e of (project?.[listKey] ?? [])) {
      for (const lk of (e?.links ?? [])) {
        if (lk?.targetSystem === "pms" && lk.targetType === kind && String(lk.targetId) === String(entityId)) {
          out.push({ from: linkEntityLabel(k, e), relationship: LINK_TYPE_LABELS[lk.linkType] || lk.linkType });
        }
      }
    }
  }
  return out;
}

// Sync copy of relatedProjectsOf's FILTER — the async shell around it is
// fetch plumbing; what can regress is the matching, so that is what's tested.
function relatedSiblings(p, all) {
  const norm = (s) => String(s || "").trim().toLowerCase();
  const g = norm(p?.relatedGroup);
  if (!g) return null;
  return all
    .filter((x) => x.id !== p.id && norm(x.relatedGroup) === g)
    .map((x) => ({
      projectNumber: x.projectNumber || null, name: x.name || null,
      role: x.relatedRole || null, status: x.status || null,
      ...(x.archived ? { archived: true } : {}),
    }));
}

// ── fixtures — realistic shapes, matching the app's Add Link output ─────────

const project = {
  id: "p1",
  rfis: [
    { id: "r7", number: "007", title: "Duct routing at Level 3", links: [] },
    { id: "r12", number: "012", title: "Revised duct routing", links: [
      { id: "l1", linkType: "supersedes", targetSystem: "pms", targetType: "rfi", targetId: "r7", targetLabel: "007: Duct routing at Level 3" },
      { id: "l2", linkType: "references", targetSystem: "sharepoint", targetType: "file", targetId: "", targetUrl: "https://setty.sharepoint.com/sites/NYCProjects/M801.pdf", targetLabel: "M801 – Mechanical Schedules" },
    ] },
  ],
  submittals: [
    { id: "s1", number: "260513-001-0", description: "Switchgear shop drawings", links: [
      // Older link with NO snapshotted label — must resolve from the project.
      { id: "l3", linkType: "responds-to", targetSystem: "pms", targetType: "rfi", targetId: "r7", targetLabel: "" },
    ] },
  ],
  changeOrders: [
    { id: "c1", number: "CO-03", name: "Added exhaust riser", links: [
      { id: "l4", linkType: "originates-from", targetSystem: "pms", targetType: "rfi", targetId: "r12", targetLabel: "012: Revised duct routing" },
    ] },
  ],
  milestones: [], notes: [
    { id: "n1", category: "Meeting", createdAt: "2026-07-29T10:00:00Z", links: [
      { id: "l5", linkType: "documents", targetSystem: "pms", targetType: "rfi", targetId: 7, targetLabel: "" }, // numeric id vs "7" string — must NOT match r7
    ] },
  ],
};

// ── outgoing ────────────────────────────────────────────────────────────────

const outR12 = outgoingLinks(project, project.rfis[1]);
check(outR12.length === 2, "r12 should have 2 outgoing links, got " + outR12.length);
check(outR12[0].relationship === "Supersedes" && outR12[0].targetKind === "RFI" &&
  outR12[0].target === "007: Duct routing at Level 3",
  "supersedes link should render label+kind, got " + JSON.stringify(outR12[0]));
check(outR12[1].targetKind === "SharePoint File/Folder" && outR12[1].url?.includes("M801"),
  "sharepoint link should carry kind + url, got " + JSON.stringify(outR12[1]));

const outS1 = outgoingLinks(project, project.submittals[0]);
check(outS1[0].target === "RFI 007: Duct routing at Level 3",
  "label-less PMS link must resolve from the project lists, got " + JSON.stringify(outS1[0].target));

check(outgoingLinks(project, project.rfis[0]).length === 0, "empty links[] should produce no rows");
check(outgoingLinks(project, { number: "x" }).length === 0, "entity without links[] should produce no rows");

// Unknown linkType passes through rather than vanishing.
const weird = outgoingLinks(project, { links: [{ linkType: "blocks", targetSystem: "pms", targetType: "rfi", targetId: "r7", targetLabel: "007" }] });
check(weird[0].relationship === "blocks", "unknown linkType should pass through, got " + weird[0].relationship);

// ── incoming (back-links) ───────────────────────────────────────────────────

const intoR7 = incomingLinks(project, "rfi", "r7");
check(intoR7.length === 2, "r7 should have 2 back-links (r12 supersedes, s1 responds-to), got " + intoR7.length);
check(intoR7.some((x) => x.from.startsWith("RFI 012") && x.relationship === "Supersedes"),
  "r12→r7 supersedes back-link missing: " + JSON.stringify(intoR7));
check(intoR7.some((x) => x.from.startsWith("Submittal 260513-001-0") && x.relationship === "Responds To"),
  "s1→r7 responds-to back-link missing: " + JSON.stringify(intoR7));

const intoR12 = incomingLinks(project, "rfi", "r12");
check(intoR12.length === 1 && intoR12[0].from.startsWith("CO CO-03"),
  "CO back-link into r12 missing (changeOrders must be scanned): " + JSON.stringify(intoR12));

// String(id) comparison is exact-value, not loose: numeric 7 must not hit "r7".
check(incomingLinks(project, "rfi", "7").length === 1,
  "numeric targetId 7 should match entityId '7' only");
check(!incomingLinks(project, "rfi", "r7").some((x) => x.from.startsWith("Note")),
  "note's numeric-7 link must NOT back-link into r7");

// ── related projects ────────────────────────────────────────────────────────

const fam = [
  { id: "a", projectNumber: "SAPX1", name: "Tower A", relatedGroup: "280 Broadway", relatedRole: "Core & Shell", status: "In Progress" },
  { id: "b", projectNumber: "SAPX2", name: "Tower B", relatedGroup: "  280 broadway ", relatedRole: "Fit-Out", status: "In Progress" },
  { id: "c", projectNumber: "SAPX3", name: "Study", relatedGroup: "280 Broadway", relatedRole: null, status: "Completed", archived: true },
  { id: "d", projectNumber: "SAPX4", name: "Elsewhere", relatedGroup: "Other Campus", status: "In Progress" },
  { id: "e", projectNumber: "SAPX5", name: "Loner", relatedGroup: "", status: "In Progress" },
];
const sibs = relatedSiblings(fam[0], fam);
check(sibs.length === 2, "Tower A should have 2 siblings (case/space-insensitive), got " + sibs.length);
check(sibs.some((s) => s.projectNumber === "SAPX2" && s.role === "Fit-Out"), "Tower B sibling missing/wrong: " + JSON.stringify(sibs));
check(sibs.some((s) => s.projectNumber === "SAPX3" && s.archived === true), "archived sibling should be included and flagged");
check(relatedSiblings(fam[4], fam) === null, "empty relatedGroup must resolve to null, not every-blank-project");
check(relatedSiblings({ id: "z", relatedGroup: "   " }, fam) === null, "whitespace-only group must resolve to null");

// ── drift detection against index.ts ────────────────────────────────────────

import { readFileSync } from "node:fs";

function extractBody(src, fnName) {
  const start = src.indexOf("function " + fnName);
  if (start < 0) return null;
  const open = src.indexOf("{", start);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  return null;
}
// Shipped bodies carry TS annotations the node copies cannot; strip them
// before comparing so drift means LOGIC drift, not annotation drift.
const normalise = (body) => body
  .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n")
  .replace(/: any\[\]/g, "").replace(/: any/g, "").replace(/: string/g, "")
  .replace(/\s+/g, " ").trim();

const shipped = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const here = readFileSync(new URL(import.meta.url), "utf8");
for (const fn of ["linkEntityLabel", "outgoingLinks", "incomingLinks"]) {
  const a = extractBody(shipped, fn);
  const b = extractBody(here, fn);
  check(a !== null, `could not find ${fn} in index.ts — extractor needs updating`);
  check(b !== null, `could not find ${fn} in this test file — extractor needs updating`);
  check(a !== null && b !== null && normalise(a) === normalise(b),
    `${fn} has DRIFTED from index.ts. Sync the copy in this test and re-run.`);
}
// The sibling FILTER lives inside async relatedProjectsOf; anchor on the two
// lines that define the matching so a change there fails loudly here.
for (const anchor of [
  'const norm = (s: any) => String(s || "").trim().toLowerCase();',
  ".filter((x: any) => x.id !== p.id && norm(x.relatedGroup) === g)",
]) {
  check(shipped.includes(anchor),
    "relatedProjectsOf matching line missing from index.ts (drift): " + anchor);
}
// And the taxonomy map itself: every app link type must have a label shipped.
for (const t of ["references", "documents", "responds-to", "resolves", "supersedes", "originates-from", "affects"]) {
  check(new RegExp('"' + t + '":\\s*"').test(shipped), "LINK_TYPE_LABELS in index.ts lost type: " + t);
}

console.log(failures ? `\n${failures} assertions FAILED` : "\nall assertions pass (links + related projects)");
process.exit(failures ? 1 : 0);

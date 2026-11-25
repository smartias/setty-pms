// The QA Checklist tab in SettyIntelligence.html (v41, v42): a read-only copy of
// pms_qa_checklist with the preventable-RFI count behind each item, and above
// it everything else a QA review does that has no checklist row.
//
//   node --test qaChecklistTab.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("./SettyIntelligence.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const start = page.indexOf("const QA_SOURCE_LABEL =");
const end = page.indexOf("function standardsFiltered() {");
assert.ok(start > 0 && end > start, "the QA Checklist block is in the page");

// Run the tab's own code against a stand-in page.
function load(rows, rfis, ripple = []) {
  const view = { innerHTML: "" }, list = { innerHTML: "" };
  const state = { qaList: { rows, rfis, loaded: true, loading: false, f: { q: "", section: "", source: "", phase: "" }, open: new Set() }, counts: {} };
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const $ = (id) => (id === "view" ? view : id === "qcList" ? list : null);
  const panels = { innerHTML: "" };
  state.qaList.ripple = ripple; state.qaList.panels = new Set(["steps"]);
  const $2 = (id) => (id === "qcPanels" ? panels : $(id));
  const fn = new Function("state", "esc", "$", "setBusy", "render", "toast", "sb",
    page.slice(start, end) + "\nreturn { renderQaChecklist, renderQaChecklistList, qaChecklistFiltered, toggleQaItem, toggleQaPanel, showQaSection, qaReviewPanelsHTML, QA_REVIEW_STEPS };");
  return { ...fn(state, esc, $2, () => {}, () => {}, () => {}, async () => []), state, view, list, panels };
}

const ROWS = [
  { item_id: "qa-001", section: "General Document Verification", sort: 10, text: "Verify the project name <b>matches</b>.", details: [], automation: "manual", phases: null, source: "seed", enabled: true },
  { item_id: "qa-614", section: "Cross-Discipline Coordination", sort: 1500, text: "Verify equipment above ceilings can be reached and fits.", details: ["Access panel at every unit.", "Working clearance drawn."], automation: "assisted", phases: ["CD", "Bid"], source: "rfi-lesson", enabled: true },
  { item_id: "qa-099", section: "General Document Verification", sort: 20, text: "An item nobody uses.", details: null, automation: "manual", phases: ["DD"], source: "lesson", enabled: false },
];
const RFIS = { "qa-614": { rfis: 47, projects: new Set(["A", "B", "C"]) } };

test("items are grouped by section in checklist order, with the RFI count where there is one", () => {
  const t = load(ROWS, RFIS);
  t.renderQaChecklist();
  assert.ok(t.view.innerHTML.includes("<b>2</b> items in use, 1 switched off"));
  assert.ok(t.view.innerHTML.includes("read-only copy"));
  const html = t.list.innerHTML;
  assert.ok(html.indexOf("General Document Verification") < html.indexOf("Cross-Discipline Coordination"), "sections keep the checklist's own order");
  assert.ok(html.includes("47 RFIs on 3 projects"));
  assert.ok(html.includes("From the RFI log") && html.includes("Claude assists") && html.includes("CD · Bid"));
  assert.ok(html.includes("switched off"));
  assert.ok(html.includes("&lt;b&gt;matches&lt;/b&gt;") && !html.includes("<b>matches</b>"), "checklist text is escaped");
  assert.ok(!/onclick="(set|save|delete|approve)/i.test(html.replace(/toggleQaItem/g, "")), "nothing on the tab writes");
});

test("the steps for an item open and close, and items without steps have no button", () => {
  const t = load(ROWS, RFIS);
  t.renderQaChecklist();
  assert.equal(t.list.innerHTML.split("How to check").length - 1, 1, "only qa-614 has steps");
  assert.ok(!t.list.innerHTML.includes("Working clearance drawn."));
  t.toggleQaItem("qa-614");
  assert.ok(t.list.innerHTML.includes("<li style=\"margin:2px 0\">Working clearance drawn.</li>"));
  t.toggleQaItem("qa-614");
  assert.ok(!t.list.innerHTML.includes("Working clearance drawn."));
});

test("search and filters narrow the list; the tab works without RFI counts", () => {
  const t = load(ROWS, null);
  t.renderQaChecklist();
  assert.ok(!t.list.innerHTML.includes("RFIs on"), "no counts when the tags could not be read");
  t.state.qaList.f.q = "ACCESS PANEL";
  assert.deepEqual(t.qaChecklistFiltered().map((r) => r.item_id), ["qa-614"], "search reads the steps too");
  t.state.qaList.f.q = ""; t.state.qaList.f.source = "seed";
  assert.deepEqual(t.qaChecklistFiltered().map((r) => r.item_id), ["qa-001"]);
  t.state.qaList.f.source = ""; t.state.qaList.f.phase = "Bid";
  assert.deepEqual(t.qaChecklistFiltered().map((r) => r.item_id), ["qa-614"]);
  t.state.qaList.f.phase = ""; t.state.qaList.f.q = "zzz";
  t.renderQaChecklistList();
  assert.ok(t.list.innerHTML.includes("No checklist items match these filters."));
});

test("the tab is wired into the page", () => {
  assert.ok(page.includes('{ key: "checklist", label: "QA Checklist",'));
  assert.ok(page.includes('if (state.tab === "checklist") return renderQaChecklist();'));
  assert.ok(page.includes('window.__appVersion = "2026-11-25-intel-v43-checklist-wording";'));
  assert.ok(!/sb\("(POST|PATCH|DELETE)", "\/rest\/v1\/pms_qa_checklist/.test(page), "the page never writes the checklist");
});

test("the tab says what a review does beyond the checklist, in the skill's own order", () => {
  const t = load(ROWS, RFIS, [{ parameter: "Motor HP / kW, MCA, MOCP", ripples_to: "E: breaker/feeder size, panel schedule row", sort: 10, enabled: true }]);
  t.renderQaChecklist();
  const html = t.view.innerHTML;
  assert.ok(html.includes("What a QA review does, step by step"));
  for (const name of ["Carry-over", "Backgrounds inventory", "Cross-discipline pass", "Bidder's eye pass".replace("'", "&#39;").replace("&#39;", "'"), "Pass 2 — Knowledge layer", "Pass 3 — Engineering review", "Design narrative as read"]) {
    assert.ok(html.includes(name), "step shown: " + name);
  }
  assert.ok(html.includes("What the others ask of us") && html.includes("What we ask of the others"), "the cross-discipline checks are listed");
  assert.ok(html.includes("it runs no load, hydraulic, short-circuit or energy calculations"), "the engineering review states its limits");
  assert.ok(html.includes("no checklist rows"), "steps without checklist rows say so");
  assert.ok(html.includes("1 checklist item ↓"), "the cross-discipline step counts its checklist items");
  // The other panels open on request.
  assert.ok(!html.includes("When this changes"));
  t.toggleQaPanel("ripple");
  assert.ok(t.panels.innerHTML.includes("When this changes") && t.panels.innerHTML.includes("Motor HP / kW, MCA, MOCP"));
  t.toggleQaPanel("extras");
  assert.ok(t.panels.innerHTML.includes("not clash detection"));
  // A step's button filters the checklist to its section.
  t.showQaSection("Cross-Discipline Coordination");
  assert.deepEqual(t.qaChecklistFiltered().map((r) => r.item_id), ["qa-614"]);
});

test("the steps shown are the steps in the QA review skill", () => {
  const skill = readFileSync(new URL("./.claude/skills/qa-coordination-review/SKILL.md", import.meta.url), "utf8");
  const table = skill.slice(skill.indexOf("| # | Step | Output |"), skill.indexOf("A resubmission or a bid addendum"));
  const inSkill = [...table.matchAll(/^\| (\w+) \| \*\*([^*]+)\*\*/gm)].map((m) => [m[1], m[2].trim()]);
  const t = load(ROWS, RFIS);
  assert.deepEqual(t.QA_REVIEW_STEPS.map((s) => [s.n, s.name]), inSkill, "same steps, same order, same names as the skill's run-order table");
  for (const sec of t.QA_REVIEW_STEPS.map((s) => s.section).filter(Boolean)) {
    assert.ok(skill.includes(sec) || ["Cross-Discipline Coordination", "Bidder's Eye", "RFI History"].includes(sec));
  }
});

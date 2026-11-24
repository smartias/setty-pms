// The QA Checklist tab in SettyIntelligence.html (v41): a read-only copy of
// pms_qa_checklist with the preventable-RFI count behind each item.
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
function load(rows, rfis) {
  const view = { innerHTML: "" }, list = { innerHTML: "" };
  const state = { qaList: { rows, rfis, loaded: true, loading: false, f: { q: "", section: "", source: "", phase: "" }, open: new Set() }, counts: {} };
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const $ = (id) => (id === "view" ? view : id === "qcList" ? list : null);
  const fn = new Function("state", "esc", "$", "setBusy", "render", "toast", "sb",
    page.slice(start, end) + "\nreturn { renderQaChecklist, renderQaChecklistList, qaChecklistFiltered, toggleQaItem };");
  return { ...fn(state, esc, $, () => {}, () => {}, () => {}, async () => []), state, view, list };
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
  assert.ok(page.includes('window.__appVersion = "2026-11-24-intel-v41-qa-checklist-tab";'));
  assert.ok(!/sb\("(POST|PATCH|DELETE)", "\/rest\/v1\/pms_qa_checklist/.test(page), "the page never writes the checklist");
});

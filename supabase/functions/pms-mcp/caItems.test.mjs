// Tests for caItems.ts: how search_rfis_submittals classifies a query for the
// search_ca_items RPC, builds its arguments, maps rows back, and summarises a
// reconcile pass. The SQL side is covered by supabase/ca-items-local-test.sql.
import { strict as assert } from "node:assert";
import test from "node:test";
import {
  classifyCaQuery, buildCaSearchArgs, caRowToItem, clampCaLimit, summarizeReconcile,
  CA_SEARCH_DEFAULT_LIMIT, CA_SEARCH_MAX_LIMIT,
} from "./caItems.ts";

test("an item-number token is a number query, with the type the prefix implies", () => {
  assert.deepEqual(classifyCaQuery("RFI-012"), { number: "RFI-012", typeHint: "rfi" });
  assert.deepEqual(classifyCaQuery("rfi 12"), { number: "rfi 12", typeHint: "rfi" });
  assert.deepEqual(classifyCaQuery("R-7"), { number: "R-7", typeHint: "rfi" });
  assert.deepEqual(classifyCaQuery("SUB-004"), { number: "SUB-004", typeHint: "submittal" });
  assert.deepEqual(classifyCaQuery("Submittal #4"), { number: "Submittal #4", typeHint: "submittal" });
  assert.deepEqual(classifyCaQuery("SUB-004.1"), { number: "SUB-004.1", typeHint: "submittal" });
  assert.deepEqual(classifyCaQuery("012"), { number: "012" }, "a bare number has no type hint");
  assert.deepEqual(classifyCaQuery("  12  "), { number: "12" });
});

test("a spec section is a spec query, as digits, whatever the separators", () => {
  assert.deepEqual(classifyCaQuery("23 09 23"), { spec: "230923" });
  assert.deepEqual(classifyCaQuery("23-09-23"), { spec: "230923" });
  assert.deepEqual(classifyCaQuery("230923"), { spec: "230923" });
  assert.deepEqual(classifyCaQuery("23 09 23.13"), { spec: "23092313" });
});

test("everything else is prose; sheet and equipment tags are not item numbers", () => {
  assert.deepEqual(classifyCaQuery("fire smoke damper"), { text: "fire smoke damper" });
  assert.deepEqual(classifyCaQuery("M-401"), { text: "M-401" });
  assert.deepEqual(classifyCaQuery("AHU-3"), { text: "AHU-3" });
  assert.deepEqual(classifyCaQuery("RFI-012 damper"), { text: "RFI-012 damper" });
  assert.deepEqual(classifyCaQuery("  chiller   piping "), { text: "chiller piping" }, "whitespace collapses");
  assert.deepEqual(classifyCaQuery(""), {});
  assert.deepEqual(classifyCaQuery(undefined), {});
  assert.deepEqual(classifyCaQuery(null), {});
});

test("the limit clamps like the tool always has", () => {
  assert.equal(clampCaLimit(undefined), CA_SEARCH_DEFAULT_LIMIT);
  assert.equal(clampCaLimit(NaN), CA_SEARCH_DEFAULT_LIMIT);
  assert.equal(clampCaLimit(0), 1);
  assert.equal(clampCaLimit(-5), 1);
  assert.equal(clampCaLimit(7.9), 7);
  assert.equal(clampCaLimit(1000), CA_SEARCH_MAX_LIMIT);
});

test("RPC arguments: one query shape, filters passed through, type hint only when none given", () => {
  const { args, mode } = buildCaSearchArgs({ query: "RFI-012", rowIds: ["p1", "p2", "p1", ""], openOnly: true, limit: 5 });
  assert.equal(mode, "number");
  assert.deepEqual(args, {
    p_row_ids: ["p1", "p2"], p_text: null, p_number: "RFI-012", p_spec: null, p_type: "rfi",
    p_status: null, p_discipline: null, p_open_only: true, p_limit: 5,
  });

  const explicit = buildCaSearchArgs({ query: "RFI-012", rowIds: ["p1"], type: "submittal" });
  assert.equal(explicit.args.p_type, "submittal", "an explicit type wins over the prefix");

  const prose = buildCaSearchArgs({ query: "dampers", rowIds: ["p1"], status: " Open ", discipline: "Mechanical" });
  assert.equal(prose.mode, "text");
  assert.equal(prose.args.p_text, "dampers");
  assert.equal(prose.args.p_status, "Open", "filters are trimmed");
  assert.equal(prose.args.p_discipline, "Mechanical");
  assert.equal(prose.args.p_open_only, false);
  assert.equal(prose.args.p_limit, CA_SEARCH_DEFAULT_LIMIT);

  const spec = buildCaSearchArgs({ query: "23 09 23", rowIds: ["p1"] });
  assert.equal(spec.mode, "spec");
  assert.equal(spec.args.p_spec, "230923");

  const list = buildCaSearchArgs({ rowIds: ["p1"] });
  assert.equal(list.mode, "list");
  assert.equal(list.args.p_text, null);
  assert.equal(list.args.p_number, null);
  assert.equal(list.args.p_spec, null);

  assert.deepEqual(buildCaSearchArgs({ rowIds: [] }).args.p_row_ids, [], "no visible projects sends an empty list, never null");
});

const ROW = {
  project_row_id: "row-1", project_number: "24-0117", item_type: "rfi", item_id: "r1",
  number: "RFI-001", subject: "Fire smoke damper", discipline: "Mechanical", spec_section: null,
  status: "Closed", is_open: false, date_received: "2026-09-01", due_date: "2026-09-08",
  date_closed: "2026-09-05", link_count: 1, has_ai_review: true, rank: 0.123456, snippet: "Use a [damper]",
};

test("a row maps to the keys the in-memory path has always returned", () => {
  const item = caRowToItem(ROW, true);
  assert.deepEqual(item, {
    project: "24-0117", type: "rfi", number: "RFI-001", subject: "Fire smoke damper",
    discipline: "Mechanical", specSection: undefined, status: "Closed",
    dueDate: "2026-09-08", received: "2026-09-01", closed: "2026-09-05",
    snippet: "Use a [damper]", rank: 0.123,
    linkCount: 1, linkNote: "Has linked items — read_rfi_submittal shows them.",
    aiReviewed: true,
  });
  const listed = caRowToItem({ ...ROW, project_number: null, subject: "  ", link_count: 0, has_ai_review: false, rank: 0 }, false);
  assert.equal(listed.project, "row-1", "a project without a number falls back to the row id");
  assert.equal(listed.subject, "—");
  assert.equal("rank" in listed, false, "no rank on a plain listing");
  assert.equal("linkCount" in listed, false);
  assert.equal("aiReviewed" in listed, false);
});

test("a reconcile pass is summarised with the projects that needed repair and the failures", () => {
  const s = summarizeReconcile([
    { project_row_id: "a", written: 0, error: null },
    { project_row_id: "b", written: 3, error: null },
    { project_row_id: "c", written: -1, error: "23502: null value" },
  ]);
  assert.deepEqual(s, { projects: 3, written: 3, repaired: ["b"], failed: [{ project: "c", error: "23502: null value" }] });
  assert.deepEqual(summarizeReconcile(null), { projects: 0, written: 0, repaired: [], failed: [] });
});

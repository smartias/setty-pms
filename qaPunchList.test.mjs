// Tests for the QA Reviews tab's punch-list helpers in SettyPMS.html: folding
// discipline spellings, inferring a discipline for older rows from their
// sheets, grouping in working order, and picking the review a person's checks
// key to.
//
//   node --test qaPunchList.test.mjs
//
// The helpers are EVALUATED from the shipped source (they are plain script in
// a JSX block and use no JSX), so this cannot drift from the page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("./SettyPMS.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const start = html.indexOf("const QA_DISCIPLINES = [");
const end = html.indexOf("function QAChip(");
assert.ok(start > 0 && end > start, "punch-list helpers not found in SettyPMS.html");
// The email builder reads two lookups defined just above the helpers.
const QA_EXTERNAL_SRC_COPY = 'const QA_EXTERNAL_SRC = { drchecks: "Dr.Checks", owner: "Owner", architect: "Architect", agency: "Agency" };\n';
assert.ok(html.includes(QA_EXTERNAL_SRC_COPY.trim()), "QA_EXTERNAL_SRC changed in SettyPMS.html");
const api = new Function(QA_EXTERNAL_SRC_COPY + html.slice(start, end) +
  "\nreturn { QA_DISCIPLINES, QA_DISCIPLINE_NONE, QA_DISCIPLINE_ALIASES, qaNormalizeDiscipline, qaDisciplineFromSheets, qaFindingDiscipline, qaGroupByDiscipline, qaIsSetReview, qaIsCaFinding, qaSheetKey, qaIssueReadiness, qaPunchListEmailHtml };")();

test("discipline spellings fold to one name", () => {
  assert.equal(api.qaNormalizeDiscipline(" m "), "Mechanical");
  assert.equal(api.qaNormalizeDiscipline("FP"), "Fire Protection");
  assert.equal(api.qaNormalizeDiscipline("fire  alarm"), "Fire Alarm");
  assert.equal(api.qaNormalizeDiscipline("Landscape"), "Landscape"); // prime jobs: kept as typed
  assert.equal(api.qaNormalizeDiscipline(null), "");
});

test("a discipline is inferred from sheet prefixes only when they agree", () => {
  assert.equal(api.qaDisciplineFromSheets(["M-601 Rev 3", "M201"]), "Mechanical");
  assert.equal(api.qaDisciplineFromSheets(["FP-101"]), "Fire Protection");
  assert.equal(api.qaDisciplineFromSheets(["FA100 Rev 2"]), "Fire Alarm");
  assert.equal(api.qaDisciplineFromSheets(["M-601", "E-610 Rev 2"]), "Multi-discipline");
  assert.equal(api.qaDisciplineFromSheets(["A-101", "S-201"]), ""); // not ours to guess
  assert.equal(api.qaDisciplineFromSheets(["General notes"]), "");
  assert.equal(api.qaDisciplineFromSheets(null), "");
});

test("a recorded discipline beats the inference, and the inference is labelled", () => {
  assert.deepEqual(api.qaFindingDiscipline({ discipline: "e", sheets: ["M-601"] }), { name: "Electrical", inferred: false });
  assert.deepEqual(api.qaFindingDiscipline({ sheets: ["P-301"] }), { name: "Plumbing", inferred: true });
  assert.deepEqual(api.qaFindingDiscipline({}), { name: api.QA_DISCIPLINE_NONE, inferred: false });
});

test("groups come in working order and keep the rows' order", () => {
  const rows = [
    { id: 1, sheets: [] }, { id: 2, discipline: "Structural" }, { id: 3, discipline: "PM / Project" },
    { id: 4, discipline: "Electrical" }, { id: 5, discipline: "Mechanical" }, { id: 6, discipline: "Electrical" },
    { id: 7, discipline: "Architectural" },
  ];
  const g = api.qaGroupByDiscipline(rows);
  assert.deepEqual(g.map(x => x.name), ["Mechanical", "Electrical", "PM / Project", "Architectural", "Structural", api.QA_DISCIPLINE_NONE]);
  assert.deepEqual(g[1].rows.map(r => r.id), [4, 6]);
  assert.deepEqual(api.qaGroupByDiscipline([]), []);
});

test("a comment-log ingest or a submittal/RFI review is not a review of the set", () => {
  const reviews = [{ id: 3, kind: "comment-log" }, { id: 2, kind: "ca-review" }, { id: 1, kind: "review" }];
  assert.equal(reviews.find(api.qaIsSetReview).id, 1);
  assert.equal(api.qaIsSetReview({ kind: "backcheck" }), true);
  assert.equal(api.qaIsSetReview(null), false);
});

// Issue readiness: QA runs a few days before a set goes out.
const F = (o) => ({ status: "open", severity: "polish", source: "qa", sheets: [], created_at: "2026-11-10T12:00:00+00:00", ...o });
const review = { id: 10, kind: "review", set_name: "100% CD QAQC", run_at: "2026-11-10T12:00:00+00:00" };

test("sheet keys match the connector's", () => {
  for (const sh of ["M-601 Rev 3", "M601", "m 601", "M.601 (Bulletin #2)"]) assert.equal(api.qaSheetKey(sh), "m601", sh);
  assert.equal(api.qaSheetKey("E101.00 Rev 4"), "e101");
  assert.equal(api.qaSheetKey("General notes"), "");
  const ts = readFileSync(new URL("./supabase/functions/pms-mcp/qaLedgerMatch.ts", import.meta.url), "utf8");
  const page = html.match(/function qaSheetKey\(ref\) \{\n  const m = (\/.+\/)\.exec/)[1];
  assert.ok(ts.includes("const m = " + page + ".exec"), "qaSheetKey's pattern drifted from sheetKey in qaLedgerMatch.ts");
});

test("before issue: the review is newer than the last issue, high-consequence items counted apart", () => {
  const findings = [F({ id: 1, severity: "life-safety" }), F({ id: 2, severity: "cost", assignee: "Mo" }), F({ id: 3 }),
    F({ id: 4, status: "closed" }), F({ id: 5, source: "owner", severity: "agency", status: "ready_to_backcheck" })];
  const r = api.qaIssueReadiness(findings, [review], [{ set: "DD Submission", at: "2026-09-01T12:00:00+00:00" }], []);
  assert.equal(r.phase, "pre");
  assert.deepEqual(r.open, { total: 4, high: 3 });
  assert.equal(r.unanswered, 1);
  assert.equal(r.awaitingClose, 1);
  assert.equal(r.unassigned, 3);
  // Nothing ever issued is still "before issue".
  assert.equal(api.qaIssueReadiness(findings, [review], [], []).phase, "pre");
});

test("after issue: what was open when it went out, narrowed to the sheets in that issue", () => {
  const issue = { set: "100% CD Submission", at: "2026-11-13T15:00:00+00:00" };
  const findings = [
    F({ id: 1, severity: "life-safety", sheets: ["M-201 Rev 2"] }),                                   // open then, open now, on an issued sheet
    F({ id: 2, severity: "cost", sheets: ["E-610"], status: "closed", status_at: "2026-11-14T09:00:00+00:00" }), // closed AFTER issue
    F({ id: 3, sheets: ["E-001"], status: "closed", status_at: "2026-11-12T09:00:00+00:00" }),          // closed before issue
    F({ id: 4, sheets: ["P-301"] }),                                                                   // open, sheet not in this issue
    F({ id: 5, created_at: "2026-11-15T09:00:00+00:00", severity: "agency" }),                          // raised after issue
  ];
  const r = api.qaIssueReadiness(findings, [review], [issue], ["M201", "E-610", "E-001"]);
  assert.equal(r.phase, "post");
  assert.equal(r.reviewedBeforeIssue, true);
  assert.deepEqual(r.openAtIssue, { total: 3, high: 2 });
  assert.deepEqual(r.stillOpen, { total: 2, high: 1 });
  assert.deepEqual(r.onIssuedSheets, { total: 2, high: 2 });
  assert.deepEqual(r.onIssuedSheetsStillOpen, { total: 1, high: 1 });
  // No sheet list on the register entry: not narrowed, and says so with null.
  assert.equal(api.qaIssueReadiness(findings, [review], [issue], []).onIssuedSheets, null);
});

test("a comment-log ingest is not a review of the drawings, and no review at all is reported as such", () => {
  const issue = { set: "Bulletin #1", at: "2026-11-13T15:00:00+00:00" };
  const log = { id: 11, kind: "comment-log", run_at: "2026-11-12T12:00:00+00:00" };
  const r = api.qaIssueReadiness([F({ id: 1 })], [log], [issue], []);
  assert.equal(r.phase, "post");
  assert.equal(r.reviewedBeforeIssue, false);
  assert.equal(api.qaIssueReadiness([], [], [], []).phase, "none");
});

test("RFI and submittal flags are construction administration, not QA", () => {
  assert.equal(api.qaIsCaFinding({ source: "rfi" }), true);
  assert.equal(api.qaIsCaFinding({ source: "submittal" }), true);
  for (const source of ["qa", "ripple", "owner", "agency", "architect", "drchecks", "other"]) assert.equal(api.qaIsCaFinding({ source }), false, source);
  // The punch list, its export and issue readiness are built from the design-phase rows only.
  assert.ok(html.includes("const openRows = qaFindings.filter("));
  assert.ok(html.includes("qaIssueReadiness(qaFindings, reviews, issuedSets, issueSheets)"));
  assert.ok(html.includes("Not QA items."));
});

test("the send-to-team email lists the punch list by discipline and escapes what it prints", () => {
  const groups = [
    { name: "Electrical", rows: [
      { id: 7, severity: "cost", title: "Breaker <20A> vs MCA 24 & MOCP 30", sheets: ["E-601", "E-603"], action: "Change the breaker", assignee: "Dana E" },
      { id: 9, severity: "agency", source: "owner", external_ref: "14", title: "Provide fault current letter", sheets: [] },
    ] },
    { name: "Mechanical", rows: [{ id: 3, severity: "polish", title: "Legend", sheets: ["M-103"] }] },
  ];
  const out = api.qaPunchListEmailHtml({ projectLabel: "TEST1.00 - Demo", groups, setName: "100% CD", reviewDate: "2026-11-10",
    tabUrl: "https://pms.example/SettyPMS.html#project:p1", reportUrl: "javascript:alert(1)", filterNote: "This list is filtered: Electrical." });
  assert.ok(out.includes("3 open items, 2 of them life-safety, agency or cost."));
  assert.ok(out.indexOf("Electrical (2)") < out.indexOf("Mechanical (1)"));
  assert.ok(out.includes("Breaker &lt;20A&gt; vs MCA 24 &amp; MOCP 30") && !out.includes("<20A>"));
  assert.ok(out.includes("Owner comment #14"));
  assert.ok(out.includes("E-601, E-603") && out.includes("Dana E"));
  assert.ok(out.includes('href="https://pms.example/SettyPMS.html#project:p1"'));
  // Only https links are written; anything else is left out.
  assert.ok(!out.includes("javascript:") && !out.includes("filed here"));
  assert.ok(out.includes("Not for the client or the contractor."));
  // The button drafts; it never sends.
  assert.ok(html.includes("const msg = await createOutlookDraft({ subject: \"QA punch list - \""));
});

test("issue readiness stays internal", () => {
  assert.ok(html.includes("Internal - not shown on transmittals or to the client"));
  const transmittal = readFileSync(new URL("./transmittal.html", import.meta.url), "utf8");
  assert.ok(!/pms_qa_findings|pms_qa_reviews|qaIssueReadiness/.test(transmittal), "QA data reached the transmittal page");
});

test("the page and the connector fold disciplines the same way", () => {
  const ts = readFileSync(new URL("./supabase/functions/pms-mcp/index.ts", import.meta.url), "utf8");
  const body = ts.match(/const QA_DISCIPLINE_ALIASES: Record<string, string> = \{([\s\S]*?)\n\};/)[1];
  const fromTs = Object.fromEntries([...body.matchAll(/(?:"([^"]+)"|([a-z]+)):\s*"([^"]+)"/g)].map(m => [m[1] ?? m[2], m[3]]));
  assert.deepEqual(fromTs, { ...api.QA_DISCIPLINE_ALIASES });
});

test("the tab keeps its guard rails", () => {
  // Rows are rendered by function call so the inline editor keeps focus.
  assert.ok(html.includes("g.rows.map(f => renderFinding(f))"));
  assert.ok(!html.includes("<FindingRow"));
  // No browser prompts left in the ledger view for notes, responses or paths.
  const view = html.slice(html.indexOf("function ProjectQAReviewsView("), html.indexOf("function ProjectChecklistsView("));
  assert.ok(!view.includes("window.prompt("), "the QA Reviews tab went back to window.prompt");
  // The picker is not gated on an issued set existing.
  assert.ok(!view.includes("{issuedSets.length > 0 && (\n          <select"));
  assert.ok(view.includes('sheetRefRpc("pms_qa_finding_set_assignment"'));
});

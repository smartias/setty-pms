// node --test closeout.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  TEMPLATE, CATEGORIES, STATUSES, templateFor, seedItems, newItem, setStatus, ballInCourt, isOverdue,
  progress, outstandingForContractor, closeoutLogRows, isDone,
} from "./closeout.js";

let n = 0;
const ctx = { newId: () => "i" + (++n), at: "2026-11-03T10:00:00Z", by: "pm@setty.com" };

test("template rows use known categories and unique titles", () => {
  for (const r of TEMPLATE) assert.ok(CATEGORIES.includes(r.c), r.t);
  assert.equal(new Set(TEMPLATE.map((r) => r.t.toLowerCase())).size, TEMPLATE.length);
});

test("General follows Setty's master spec Division 01", () => {
  const g = TEMPLATE.filter((r) => r.d === "General");
  for (const sec of ["01 50 00", "01 78 23", "01 78 39"]) assert.ok(g.some((r) => r.s === sec), sec);
  assert.ok(g.some((r) => r.c === "Lien Releases / Affidavits"));
  // Both certificates are there; the final one is what readyForFinal leaves for last.
  assert.ok(g.some((r) => /^Certificate of Substantial Completion$/.test(r.t)));
  assert.ok(g.some((r) => /final completion/i.test(r.t)));
  const mech = TEMPLATE.filter((r) => r.d === "Mechanical").map((r) => r.s);
  assert.ok(mech.includes("23 05 93") && mech.includes("23 08 00"));
});

test("Fire Protection, Plumbing and Electrical follow Setty's issued spec sections", () => {
  const secs = (d) => TEMPLATE.filter((r) => r.d === d).map((r) => r.s);
  for (const s of ["21 13 13", "21 31 13"]) assert.ok(secs("Fire Protection").includes(s), s);
  for (const s of ["22 11 16", "22 11 19", "22 13 16"]) assert.ok(secs("Plumbing").includes(s), s);
  for (const s of ["26 05 26", "26 24 16", "28 46 21.11"]) assert.ok(secs("Electrical").includes(s), s);
  // Every row that cites a section explains the requirement.
  for (const r of TEMPLATE) if (r.s && r.d !== "Mechanical") assert.ok(r.n, r.t);
  // Fire alarm is Division 28, issued with Electrical.
  assert.ok(TEMPLATE.some((r) => r.d === "Electrical" && /fire alarm acceptance/i.test(r.t)));
});

test("seeded items carry the spec requirement in their notes", () => {
  const items = seedItems([], ["Mechanical"], { newId: () => "x", at: "2026-11-03" });
  const lien = items.find((i) => i.category === "Lien Releases / Affidavits");
  assert.match(lien.notes, /^Spec 01 50 00: .*notarized/);
  assert.equal(items.find((i) => i.title === "Spare filters and belts").notes, "");
});

test("templateFor: General always, plus the named disciplines", () => {
  const mech = templateFor(["Mechanical"]);
  assert.ok(mech.some((r) => r.t.startsWith("Certificate of Substantial")));
  assert.ok(mech.some((r) => r.d === "Mechanical"));
  assert.ok(!mech.some((r) => r.d === "Electrical"));
  assert.ok(templateFor(["FP"]).some((r) => r.d === "Fire Protection"));
  assert.equal(templateFor([]).length, TEMPLATE.length);
});

test("seedItems skips titles already on the checklist", () => {
  const first = seedItems([], ["Plumbing"], ctx);
  assert.ok(first.length > 3);
  assert.equal(first[0].status, "Not Received");
  assert.equal(first[0].history[0].note, "Added");
  const again = seedItems([{ title: "certificate of substantial completion" }], ["Plumbing"], ctx);
  assert.equal(again.length, first.length - 1);
  assert.equal(seedItems(first, ["Plumbing"], ctx).length, 0);
});

test("setStatus stamps dates and history", () => {
  let i = newItem({ title: "TAB report" }, { id: "x", at: "2026-10-01" });
  i = setStatus(i, "Received", { at: "2026-10-05T09:00:00Z", by: "me" });
  assert.equal(i.dateReceived, "2026-10-05");
  i = setStatus(i, "Revise and Resubmit", { at: "2026-10-07T09:00:00Z" });
  assert.equal(i.dateReceived, "2026-10-05");
  i = setStatus(i, "Accepted", { at: "2026-10-12T09:00:00Z" });
  assert.equal(i.dateAccepted, "2026-10-12");
  assert.deepEqual(i.history.map((h) => h.status), ["Not Received", "Received", "Revise and Resubmit", "Accepted"]);
  assert.equal(i.history[1].from, "Not Received");
  i = setStatus(i, "Under Review", { at: "2026-10-13" });
  assert.equal(i.dateAccepted, "");
  assert.equal(setStatus(i, "Under Review", {}), i);
  // Straight to Accepted fills received too.
  const j = setStatus(newItem({}, {}), "Accepted", { at: "2026-10-20" });
  assert.equal(j.dateReceived, "2026-10-20");
});

test("ballInCourt and overdue", () => {
  const subs = [{ id: "s1", firm: "Acme TAB" }];
  assert.equal(ballInCourt({ status: "Not Received", responsible: "Acme Mech" }).label, "Contractor (Acme Mech)");
  assert.equal(ballInCourt({ status: "Revise and Resubmit" }).who, "contractor");
  assert.equal(ballInCourt({ status: "Under Review" }).who, "setty");
  assert.equal(ballInCourt({ status: "Under Review", reviewerSubId: "s1" }, subs).label, "Sub: Acme TAB");
  assert.equal(ballInCourt({ status: "Accepted" }).who, "none");
  // Setty issues completion certificates.
  assert.deepEqual(ballInCourt({ status: "Not Received", category: "Completion Certificate" }), { who: "setty", label: "Setty (issues it)" });
  assert.equal(isOverdue({ status: "Not Received", dueDate: "2026-11-01" }, "2026-11-03"), true);
  assert.equal(isOverdue({ status: "Accepted", dueDate: "2026-11-01" }, "2026-11-03"), false);
  assert.equal(isOverdue({ status: "Not Received", dueDate: "2026-11-01", required: false }, "2026-11-03"), false);
  assert.equal(isDone({ status: "Not Required" }), true);
});

test("progress counts required items and knows when final completion is next", () => {
  const items = [
    { title: "O&M", status: "Accepted" },
    { title: "TAB", status: "Under Review" },
    { title: "Warranty", status: "Not Received", dueDate: "2026-11-01" },
    { title: "Spare belts", status: "Not Received", required: false },
    { title: "Training", status: "Not Required" },
    { title: "Certificate of Final Completion", status: "Not Received", category: "Completion Certificate" },
  ];
  const p = progress(items, "2026-11-03");
  assert.equal(p.required, 4);
  assert.equal(p.accepted, 1);
  assert.equal(p.pct, 25);
  assert.equal(p.withContractor, 1);
  assert.equal(p.inReview, 2); // TAB under review + the certificate Setty issues
  assert.equal(p.overdue, 1);
  assert.equal(p.readyForFinal, false);
  const done = items.map((i) => (/final/i.test(i.title) ? i : { ...i, status: i.required === false ? i.status : "Accepted" }));
  assert.equal(progress(done, "2026-11-03").readyForFinal, true);
  assert.equal(progress([], "2026-11-03").readyForFinal, false);
  for (const s of STATUSES) assert.ok(s in p.byStatus);
});

test("outstandingForContractor: required, not received or sent back, grouped", () => {
  const items = [
    { title: "Z warranty", category: "Warranty", status: "Not Received" },
    { title: "A O&M", category: "O&M Manual", status: "Revise and Resubmit" },
    { title: "TAB", category: "Test & Balance", status: "Under Review" },
    { title: "Belts", category: "Attic Stock / Spare Parts", status: "Not Received", required: false },
    { title: "Certificate of Substantial Completion", category: "Completion Certificate", status: "Not Received" },
  ];
  assert.deepEqual(outstandingForContractor(items).map((i) => i.title), ["A O&M", "Z warranty"]);
});

test("closeoutLogRows: ordered by category, readable history", () => {
  const p = { subconsultants: [], closeout: { items: [
    { category: "Warranty", title: "W", status: "Not Received", history: [{ at: "2026-10-01T00:00:00Z", status: "Not Received", note: "Added" }] },
    { category: "O&M Manual", title: "O", status: "Accepted", required: true, dateAccepted: "2026-10-09" },
  ] } };
  const { headers, rows } = closeoutLogRows(p);
  assert.deepEqual(rows.map((r) => r[1]), ["O", "W"]);
  assert.equal(rows[0][headers.indexOf("Accepted")], "2026-10-09");
  assert.equal(rows[1][headers.indexOf("Ball in court")], "Contractor");
  assert.equal(rows[1][headers.indexOf("Status history")], "2026-10-01 Not Received: Added");
});

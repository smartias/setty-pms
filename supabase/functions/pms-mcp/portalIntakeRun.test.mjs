// The scheduled client-portal intake loop (portalIntakeRun.ts) with fake I/O:
// what it appends, what it leaves alone, what it remembers, and how it fails.
import { strict as assert } from "node:assert";
import test from "node:test";
import { runPortalIntakePass, loggedFileIds, REQUIRED_FIELDS } from "./portalIntakeRun.ts";
import { buildFormParts, formCellMap, xmlEsc } from "./portalFormSpec.js";

const AT = "2026-11-03T15:00:00Z";
const txt = (u8) => new TextDecoder().decode(u8);

// A filled form as unzipped parts: the blank form's parts with the sheet's
// answer cells replaced by inline strings (what the browser build writes and
// what Excel reads; Excel's own shared-string save is covered in
// portalForms.test.mjs).
function filled(kind, values) {
  const parts = new Map(buildFormParts(kind, "P"));
  const cells = formCellMap(kind);
  let sheet = txt(parts.get("xl/worksheets/sheet1.xml"));
  for (const [name, v] of Object.entries(values)) {
    const ref = cells[name];
    sheet = sheet.replace(`<c r="${ref}" s="2"/>`, `<c r="${ref}" s="2" t="inlineStr"><is><t>${xmlEsc(v)}</t></is></c>`);
  }
  parts.set("xl/worksheets/sheet1.xml", new TextEncoder().encode(sheet));
  return parts;
}
const RFI_OK = { Subject: "Condensate line routing", Question: "Can the condensate line run above the ceiling?", SubmittedBy: "Jane Doe, Acme", Email: "jane@acme.example", SpecSection: "23 05 00", CostImpact: "Yes", DateNeeded: "2026-11-20" };
const SUB_OK = { SpecSection: "23 34 00", Subject: "Exhaust fans EF-1 to EF-4", SubmittedBy: "Jane Doe, Acme", Email: "jane@acme.example", Revision: "1", Manufacturer: "Greenheck" };

const file = (id, name, lastModified = "2026-11-02T10:00:00Z") => ({ id, name, webUrl: "https://sp/" + id, lastModified, driveId: "d1" });

function harness({ projects, folders, forms, failWrite } = {}) {
  const writes = [];
  const reads = [];
  let clock = 0;
  const deps = {
    at: AT, dryRun: false, budgetMs: 40000, maxProjects: 40, recentDays: 30, now: () => clock,
    projects: async () => Object.keys(projects).map((pid) => ({ pid, rfisUrl: "https://sp/" + pid + "/rfis", submittalsUrl: "https://sp/" + pid + "/subs" })),
    listForms: async (url) => ({ folderWebUrl: url, files: folders[url] || [] }),
    readForm: async (f) => { reads.push(f.id); return forms[f.id]; },
    writeProject: async (pid, mutate) => {
      if (failWrite === pid) throw new Error("Project changed since it was read (a concurrent save)");
      const before = projects[pid];
      const after = mutate(before);
      if (after !== before) { writes.push(pid); projects[pid] = after; }
      return after;
    },
    tick: (ms) => { clock += ms; },
  };
  return { deps, writes, reads, projects };
}

const P1 = (extra = {}) => ({ id: "p1", projectNumber: "SAPX176021.01", prime: "Setty & Associates", rfis: [], submittals: [], portalIntake: { rfisUrl: "x", submittalsUrl: "y" }, ...extra });

test("logs a complete RFI and submittal with the prime's next numbers, marked Unreviewed", async () => {
  const h = harness({
    projects: { p1: P1({ rfis: [{ id: "a", number: "RFI-004" }], caNumberHighWater: { submittal: 7 } }) },
    folders: {
      "https://sp/p1/rfis": [file("f1", "Acme RFI 12 - condensate.xlsx"), file("blank", "RFI form.xlsx"), file("lock", "~$Acme RFI 12 - condensate.xlsx")],
      "https://sp/p1/subs": [file("f2", "23 34 00 - fans.xlsx")],
    },
    forms: { f1: filled("rfi", RFI_OK), f2: filled("submittal", SUB_OK) },
  });
  const s = await runPortalIntakePass(h.deps);
  assert.deepEqual(s.created, { rfi: 1, submittal: 1 });
  assert.equal(s.skipped.template, 1);
  assert.deepEqual(h.writes, ["p1"]);
  assert.deepEqual(h.reads, ["f1", "f2"], "the blank template and the lock file are never downloaded");
  const p = h.projects.p1;
  const rfi = p.rfis[1], sub = p.submittals[0];
  assert.equal(rfi.number, "RFI-005");
  assert.equal(sub.number, "SUB-008", "continues past the high-water mark");
  assert.deepEqual(p.caNumberHighWater, { submittal: 8, rfi: 5 });
  assert.equal(rfi.title, "Condensate line routing");
  assert.equal(rfi.description, RFI_OK.Question);
  assert.equal(rfi.dueDate, "2026-11-20");
  assert.equal(rfi.status, "Open");
  assert.equal(rfi.discipline, "Mechanical");
  assert.equal(rfi.intakeReviewed, false);
  assert.equal(rfi.intake.vendor, "Client portal");
  assert.equal(rfi.intake.driveItemId, "f1");
  assert.equal(rfi.intake.formUrl, "https://sp/f1");
  assert.equal(rfi.id, "portal-rfi-p1-f1");
  assert.match(rfi.notes, /cost impact: yes/);
  assert.equal(sub.specSection, "23 34 00");
  assert.equal(sub.description, "Exhaust fans EF-1 to EF-4 — Greenheck");
  assert.equal(sub.resubNumber, 1);
  assert.equal(sub.status, "Received");
  assert.equal(sub.dateReceived, "2026-11-02");
  assert.equal(sub.dueDate, "2026-11-16", "10 working days from the file date when no date is asked for");
  assert.equal(s.items.length, 2);
});

test("a dry run reports what it would add and writes nothing", async () => {
  const h = harness({ projects: { p1: P1() }, folders: { "https://sp/p1/rfis": [file("f1", "a.xlsx")] }, forms: { f1: filled("rfi", RFI_OK) } });
  const s = await runPortalIntakePass({ ...h.deps, dryRun: true });
  assert.equal(s.created.rfi, 1);
  assert.equal(s.items[0].number, "(dry run)");
  assert.deepEqual(h.writes, []);
  assert.equal(h.projects.p1.rfis.length, 0);
});

test("a form already logged is skipped without a download, and an incomplete one is remembered until it changes", async () => {
  const projects = { p1: P1({ rfis: [{ id: "portal-rfi-p1-f1", number: "RFI-001", intake: { driveItemId: "f1" } }] }) };
  const folders = { "https://sp/p1/rfis": [file("f1", "done.xlsx"), file("f3", "half.xlsx", "2026-11-02T09:00:00Z")] };
  const h = harness({ projects, folders, forms: { f3: filled("rfi", { Subject: "No question yet" }) } });
  let s = await runPortalIntakePass(h.deps);
  assert.equal(s.skipped.seen, 1);
  assert.equal(s.skipped.incomplete, 1);
  assert.deepEqual(s.incomplete[0].missing, ["Question", "SubmittedBy", "Email"]);
  assert.deepEqual(h.reads, ["f3"]);
  assert.equal(h.projects.p1.rfis.length, 1, "nothing appended");
  assert.equal(h.projects.p1.portalIntake.skipped.f3.reason, "missing: Question, SubmittedBy, Email");

  // Same file, same modification: not read again.
  s = await runPortalIntakePass(h.deps);
  assert.deepEqual(h.reads, ["f3"]);
  assert.equal(s.skipped.incomplete, 1);

  // The contractor saves a completed version: read again and logged, and the skip is forgotten.
  folders["https://sp/p1/rfis"][1] = file("f3", "half.xlsx", "2026-11-03T09:00:00Z");
  h.deps.readForm = async () => filled("rfi", RFI_OK);
  s = await runPortalIntakePass(h.deps);
  assert.equal(s.created.rfi, 1);
  assert.equal(h.projects.p1.rfis[1].number, "RFI-002");
  assert.equal(h.projects.p1.portalIntake.skipped.f3, undefined);
});

test("a workbook that is not a form, or the wrong form in a folder, is skipped and remembered", async () => {
  const foreign = new Map([["xl/workbook.xml", new TextEncoder().encode("<workbook/>")]]);
  const h = harness({
    projects: { p1: P1() },
    folders: { "https://sp/p1/rfis": [file("f1", "budget.xlsx"), file("f2", "sub in rfi folder.xlsx")] },
    forms: { f1: foreign, f2: filled("submittal", SUB_OK) },
  });
  const s = await runPortalIntakePass(h.deps);
  assert.equal(s.skipped.notForm, 2);
  assert.deepEqual(s.created, { rfi: 0, submittal: 0 });
  assert.equal(h.projects.p1.portalIntake.skipped.f1.reason, "not a portal form");
  assert.match(h.projects.p1.portalIntake.skipped.f2.reason, /submittal form in the RFIs folder/);
});

test("old files, archived projects and a failed write are reported, not fatal", async () => {
  const h = harness({
    projects: { p1: P1(), p2: P1({ id: "p2", archived: true }), p3: P1({ id: "p3" }) },
    folders: {
      "https://sp/p1/rfis": [file("f1", "old.xlsx", "2026-01-01T00:00:00Z")],
      "https://sp/p3/rfis": [file("f9", "new.xlsx")],
    },
    forms: { f9: filled("rfi", RFI_OK) },
    failWrite: "p3",
  });
  const s = await runPortalIntakePass(h.deps);
  assert.equal(s.skipped.old, 1);
  assert.equal(s.archived, 1);
  assert.equal(s.failed.length, 1);
  assert.equal(s.failed[0].project, "p3");
  assert.deepEqual(s.created, { rfi: 0, submittal: 0 });
});

test("the required field lists are what the form marks with *", () => {
  assert.deepEqual(REQUIRED_FIELDS.rfi, ["Subject", "Question", "SubmittedBy", "Email"]);
  assert.deepEqual(REQUIRED_FIELDS.submittal, ["SpecSection", "Subject", "SubmittedBy", "Email"]);
  assert.deepEqual([...loggedFileIds({ rfis: [{ intake: { driveItemId: "a" } }, {}], submittals: [{ intake: { driveItemId: "b" } }] })], ["a", "b"]);
});

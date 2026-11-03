// The scheduled intake loop (caIntakeRun.ts) with fake I/O: what it appends,
// what it leaves alone, and how it fails.
import { strict as assert } from "node:assert";
import test from "node:test";
import { runIntakePass, intakeSince, CA_STATUS } from "./caIntakeRun.ts";

const mail = (subject, date, body = "", from = "x@procoretech.com") =>
  ({ record_id: "r-" + subject.length + date, subject, body_text: body, from_name: "GC", from_address: from, email_date: date, sp_folder_url: "" });

function harness({ projects, emails, recent, failWrite } = {}) {
  const writes = [];
  let clock = 0;
  const deps = {
    since: "2026-10-20", at: "2026-11-02T20:00:00Z", vendors: ["Procore"], dryRun: false,
    budgetMs: 40000, maxProjects: 40, now: () => clock,
    recentProjectIds: async () => recent ?? Object.keys(projects),
    emailsFor: async (pid) => emails[pid] || [],
    writeProject: async (pid, mutate) => {
      if (failWrite === pid) throw new Error("Project changed since it was read (a concurrent save)");
      const before = projects[pid];
      const after = mutate(before);
      if (after !== before) { writes.push(pid); projects[pid] = after; }
      return after;
    },
    tick: (ms) => { clock += ms; },
  };
  return { deps, writes, projects };
}

const P1 = () => ({ id: "p1", projectNumber: "21417-215", status: CA_STATUS, rfis: [], submittals: [] });
const EM = [
  mail("21417-215, NVCC: New RFI #17, New Riser Installation Requirements", "2026-10-25T10:00:00Z", "Due Date: \nNovember 1, 2026\n\nAsked by: \n\nLauren\n\nDate Initiated: \n\nOctober 25, 2026\n"),
  mail("21417-215, NVCC: Submittal Distributed 262416-1.0, Panelboard and Accessories - Product Data", "2026-10-30T13:41:00Z", "Response: \n\nApproved as Noted\n"),
];

test("appends new Procore items, marked Unreviewed, with the tracker's ids and numbers", async () => {
  const h = harness({ projects: { p1: P1() }, emails: { p1: EM } });
  const s = await runIntakePass(h.deps);
  assert.deepEqual(s.created, { rfi: 1, submittal: 1 });
  assert.deepEqual(h.writes, ["p1"]);
  const [r] = h.projects.p1.rfis, [u] = h.projects.p1.submittals;
  assert.equal(r.id, "sync-procore-p1-17"); assert.equal(r.number, "RFI-017"); assert.equal(r.intakeReviewed, false);
  assert.equal(r.intake.vendor, "Procore"); assert.equal(r.dueDate, "2026-11-01");
  assert.equal(u.number, "262416-001-0"); assert.equal(u.status, "Returned"); assert.equal(u.stamp, "Approved as Noted");
  assert.equal(u.discipline, "Electrical");
  assert.deepEqual(s.items.map((i) => [i.project, i.kind, i.number]), [["21417-215", "rfi", "RFI-017"], ["21417-215", "submittal", "262416-001-0"]]);
});

test("idempotent: a second run writes nothing", async () => {
  const h = harness({ projects: { p1: P1() }, emails: { p1: EM } });
  await runIntakePass(h.deps);
  const s2 = await runIntakePass(h.deps);
  assert.deepEqual(s2.created, { rfi: 0, submittal: 0 });
  assert.deepEqual(h.writes, ["p1"], "only the first run wrote");
  assert.equal(s2.skipped.matched, 2);
});

test("never touches an item already logged, even under another id", async () => {
  const proj = { ...P1(), rfis: [{ id: "abc", number: "RFI-17", title: "x", status: "Open" }], submittals: [{ id: "def", number: "262416-001-0" }] };
  const h = harness({ projects: { p1: proj }, emails: { p1: EM } });
  const s = await runIntakePass(h.deps);
  assert.deepEqual(s.created, { rfi: 0, submittal: 0 });
  assert.deepEqual(h.writes, []);
  assert.equal(h.projects.p1.rfis[0].id, "abc");
});

test("a newer revision of a logged submittal is left for a person (UPDATE), not written", async () => {
  const proj = { ...P1(), submittals: [{ id: "def", number: "262416-001-0" }] };
  const h = harness({ projects: { p1: proj }, emails: { p1: [mail("P: Approver Setty CA Updated their Response for Submittal 262416-1.1, Panelboard", "2026-10-30T10:00:00Z")] } });
  const s = await runIntakePass(h.deps);
  assert.equal(s.skipped.update, 1);
  assert.deepEqual(h.writes, []);
});

test("items whose latest email is before `since` are not backfilled", async () => {
  const h = harness({ projects: { p1: P1() }, emails: { p1: [mail("P: New RFI #3, Old one", "2026-06-15T10:00:00Z"), EM[0]] } });
  const s = await runIntakePass(h.deps);
  assert.equal(s.created.rfi, 1);
  assert.equal(s.skipped.old, 1);
  assert.deepEqual(h.projects.p1.rfis.map((r) => r.number), ["RFI-017"]);
});

test("but an old item with a recent event is built from its full history", async () => {
  const h = harness({ projects: { p1: P1() }, emails: { p1: [
    mail("P: New RFI #9, Duct clash", "2026-06-15T10:00:00Z", "Question: \n\nWhere does the duct go?\n\nAttachments"),
    mail("P: RFI Closed, #9, Duct clash", "2026-10-28T10:00:00Z"),
  ] } });
  await runIntakePass(h.deps);
  const [r] = h.projects.p1.rfis;
  assert.equal(r.status, "Closed");
  assert.match(r.description, /Where does the duct go/);
});

test("skips projects not in Construction Administration, and archived ones", async () => {
  const h = harness({
    projects: { p1: { ...P1(), status: "Design" }, p2: { ...P1(), id: "p2", archived: true } },
    emails: { p1: EM, p2: EM },
  });
  const s = await runIntakePass(h.deps);
  assert.equal(s.notInCA, 2);
  assert.deepEqual(h.writes, []);
});

test("dry run reports what it would add and writes nothing", async () => {
  const h = harness({ projects: { p1: P1() }, emails: { p1: EM } });
  h.deps.dryRun = true;
  const s = await runIntakePass(h.deps);
  assert.deepEqual(s.created, { rfi: 1, submittal: 1 });
  assert.deepEqual(h.writes, []);
  assert.equal(h.projects.p1.rfis.length, 0);
});

test("Forma and Newforma mail is not imported unattended", async () => {
  const h = harness({ projects: { p1: P1() }, emails: { p1: [
    mail("Submittal #56 is ready", "2026-10-30T10:00:00Z", "Item #56 VAV\n", "no-reply@mail.forma.autodesk.com"),
    mail("RFI Forwarded: Insulation - RFI:074:SM1mU", "2026-10-30T10:00:00Z", "", "arch@page.com"),
  ] } });
  const s = await runIntakePass(h.deps);
  assert.deepEqual(s.created, { rfi: 0, submittal: 0 });
});

test("a version race fails that project only; the others still run", async () => {
  const h = harness({ projects: { p1: P1(), p2: { ...P1(), id: "p2", projectNumber: "J2" } }, emails: { p1: EM, p2: EM }, failWrite: "p1" });
  const s = await runIntakePass(h.deps);
  assert.equal(s.failed.length, 1);
  assert.equal(s.failed[0].project, "p1");
  assert.deepEqual(h.writes, ["p2"]);
});

test("stops at the time budget and at maxProjects, and says so", async () => {
  const projects = { a: P1(), b: P1(), c: P1() };
  const h = harness({ projects, emails: {} });
  h.deps.emailsFor = async () => { h.deps.tick(30000); return []; };
  const s = await runIntakePass(h.deps);
  assert.equal(s.projectsChecked, 2);
  assert.equal(s.stoppedEarly, true);
  const h2 = harness({ projects: { a: P1(), b: P1(), c: P1() }, emails: {} });
  h2.deps.maxProjects = 1;
  const s2 = await runIntakePass(h2.deps);
  assert.equal(s2.projectsChecked, 1);
  assert.equal(s2.stoppedEarly, true);
});

test("intakeSince", () => {
  assert.equal(intakeSince(Date.parse("2026-11-02T20:00:00Z"), 14), "2026-10-19");
});

test("a confirmed Newforma project imports its Newforma forwards and never the Procore copy", async () => {
  const proj = { ...P1(), caPortal: { platform: "Newforma", gc: "Hunter Roberts" } };
  const emails = [
    ...EM, // Procore RFI #17 + submittal 262416-1.0
    mail("RFI Forwarded: Follow up to RFI 005 - Stony Brook University, Tabler Quad - RFI:RFI-005R:SM1mU", "2026-10-28T10:00:00Z",
      "Project: 1018037.01 Stony Brook University, Tabler Quad \n\nRemarks \n\nSee RFI \n\nDownload all files \n\nFrom: Eileen Duggan (Page) \nDue back: 11/4/2026 \n", "eduggan@pagethink.com"),
    mail("RE: RFI Forwarded: Follow up to RFI 005 - Stony Brook University, Tabler Quad - RFI:RFI-005R:SM1mU", "2026-10-29T10:00:00Z", "", "p@setty.com"),
  ];
  const h = harness({ projects: { p1: proj }, emails: { p1: emails } });
  h.deps.vendors = ["Procore", "Autodesk Forma", "Newforma"];
  const s = await runIntakePass(h.deps);
  assert.deepEqual(s.created, { rfi: 1, submittal: 0 });
  const [r] = h.projects.p1.rfis;
  assert.deepEqual([r.number, r.title, r.dueDate, r.from, r.intake.vendor], ["RFI-005R", "Follow up to RFI 005", "2026-11-04", "Eileen Duggan", "Newforma"]);
});

test("an unconfirmed project stays Procore-only even when the route allows all portals", async () => {
  const h = harness({ projects: { p1: P1() }, emails: { p1: [...EM,
    mail("RFI Forwarded: Something - RFI:RFI-077:SM1mU", "2026-10-28T10:00:00Z", "", "x@page.com")] } });
  h.deps.vendors = ["Procore", "Autodesk Forma", "Newforma"];
  const s = await runIntakePass(h.deps);
  assert.deepEqual(s.created, { rfi: 1, submittal: 1 });
  assert.deepEqual(h.projects.p1.rfis.map((x) => x.number), ["RFI-017"]);
});

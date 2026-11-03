// The client-portal log refresh loop (portalLogsRun.ts) with fake I/O.
import { strict as assert } from "node:assert";
import test from "node:test";
import { runPortalLogsPass, logIsStale } from "./portalLogsRun.ts";

const AT = "2026-11-03T15:00:00Z";
function harness({ projects, records, metas, failWrite } = {}) {
  const writes = [], reads = [];
  const deps = {
    at: AT, dryRun: false, budgetMs: 40000, now: () => 0,
    projects: async () => projects,
    readProject: async (pid) => { reads.push(pid); return records[pid]; },
    logMeta: async (url, file) => metas[url + "/" + file] ?? null,
    writeLog: async (url, file, parts) => {
      if (failWrite === url) throw new Error("Graph 403");
      writes.push({ url, file, parts: parts.length });
      metas[url + "/" + file] = { lastModified: AT };
    },
  };
  return { deps, writes, reads, metas };
}
const REC = { projectNumber: "SAPX1", rfis: [{ number: "RFI-001", title: "A", status: "Open" }], submittals: [] };

test("stale is missing or older than the project's last save", () => {
  assert.equal(logIsStale(null, "2026-11-03T10:00:00Z"), true);
  assert.equal(logIsStale({ lastModified: "2026-11-03T09:00:00Z" }, "2026-11-03T10:00:00+00:00"), true);
  assert.equal(logIsStale({ lastModified: "2026-11-03T11:00:00Z" }, "2026-11-03T10:00:00.123456+00:00"), false);
});

test("writes both logs when missing, reads the project once, and leaves current logs alone next time", async () => {
  const h = harness({ projects: [{ pid: "p1", deliverablesUrl: "https://sp/d1", updatedAt: "2026-11-03T10:00:00Z" }], records: { p1: REC }, metas: {} });
  let s = await runPortalLogsPass(h.deps);
  assert.deepEqual(s.written.map((w) => w.file), ["RFI Log.xlsx", "Submittal Log.xlsx"]);
  assert.equal(s.written[0].project, "SAPX1");
  assert.deepEqual(h.reads, ["p1"]);
  assert.equal(h.writes[0].parts, 6);
  s = await runPortalLogsPass(h.deps);
  assert.equal(s.written.length, 0);
  assert.equal(s.current, 2);
  assert.deepEqual(h.reads, ["p1"], "no read when nothing is stale");
});

test("a project saved after the file was written is refreshed; a dry run writes nothing", async () => {
  const metas = { "https://sp/d1/RFI Log.xlsx": { lastModified: "2026-11-03T09:00:00Z" }, "https://sp/d1/Submittal Log.xlsx": { lastModified: "2026-11-03T12:00:00Z" } };
  const h = harness({ projects: [{ pid: "p1", deliverablesUrl: "https://sp/d1", updatedAt: "2026-11-03T10:00:00Z" }], records: { p1: REC }, metas });
  const dry = await runPortalLogsPass({ ...h.deps, dryRun: true });
  assert.deepEqual(dry.written.map((w) => w.file), ["RFI Log.xlsx"]);
  assert.equal(h.writes.length, 0);
  const s = await runPortalLogsPass(h.deps);
  assert.deepEqual(s.written.map((w) => w.file), ["RFI Log.xlsx"]);
  assert.equal(s.current, 1);
});

test("projects without a Deliverables folder are skipped, archived ones are left alone, failures are reported", async () => {
  const h = harness({
    projects: [
      { pid: "p0", deliverablesUrl: "", updatedAt: AT },
      { pid: "p2", deliverablesUrl: "https://sp/d2", updatedAt: AT },
      { pid: "p3", deliverablesUrl: "https://sp/d3", updatedAt: AT },
    ],
    records: { p2: { ...REC, archived: true }, p3: REC }, metas: {}, failWrite: "https://sp/d3",
  });
  const s = await runPortalLogsPass(h.deps);
  assert.equal(s.projects, 2);
  assert.equal(s.current, 2, "archived project counts as current, nothing written");
  assert.equal(s.failed.length, 1);
  assert.equal(s.failed[0].project, "p3");
  assert.equal(h.writes.length, 0);
});

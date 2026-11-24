// The id/number/name list every project reference is resolved against is read
// once and shared (index.ts loadProjectRefs), and single projects are read by
// primary key. loadProjectRefs is a COPY here (index.ts boots a server at
// import), with the fetch injected; the anchors below fail when the shipped
// code moves away from it.
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

function makeLoader(fetchRows, clock) {
  let _projectRefs = null;
  function loadProjectRefs(maxAgeMs) {
    const now = clock();
    if (_projectRefs && now - _projectRefs.at < maxAgeMs) return _projectRefs.rows;
    const entry = { at: now, rows: fetchRows() };
    _projectRefs = entry;
    entry.rows.catch(() => { if (_projectRefs === entry) _projectRefs = null; });
    return entry.rows;
  }
  return { loadProjectRefs, drop: () => { _projectRefs = null; }, age: () => (_projectRefs ? clock() - _projectRefs.at : null) };
}

test("resolves inside one request, and overlapping requests, share one read", async () => {
  let reads = 0, now = 1000;
  const L = makeLoader(() => { reads++; return new Promise((r) => setTimeout(() => r([{ pid: "p1" }]), 5)); }, () => now);
  const [a, b, c] = await Promise.all([L.loadProjectRefs(60000), L.loadProjectRefs(60000), L.loadProjectRefs(60000)]);
  assert.equal(reads, 1);
  assert.equal(a, b); assert.equal(b, c);
});

test("the list is read again after its lifetime, and at once when asked", async () => {
  let reads = 0, now = 0;
  const L = makeLoader(() => { reads++; return Promise.resolve([]); }, () => now);
  await L.loadProjectRefs(60000); now = 59999; await L.loadProjectRefs(60000);
  assert.equal(reads, 1);
  now = 60000; await L.loadProjectRefs(60000);
  assert.equal(reads, 2);
  await L.loadProjectRefs(0);
  assert.equal(reads, 3, "maxAge 0 is the recheck after a miss");
});

test("a failed read is not kept", async () => {
  let reads = 0;
  const L = makeLoader(() => { reads++; return reads === 1 ? Promise.reject(new Error("Supabase 500")) : Promise.resolve([{ pid: "p1" }]); }, () => 0);
  await assert.rejects(L.loadProjectRefs(60000));
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(await L.loadProjectRefs(60000), [{ pid: "p1" }]);
  assert.equal(reads, 2);
});

test("a write drops the list", async () => {
  let reads = 0;
  const L = makeLoader(() => { reads++; return Promise.resolve([]); }, () => 0);
  await L.loadProjectRefs(60000); L.drop(); await L.loadProjectRefs(60000);
  assert.equal(reads, 2);
});

test("the shipped code matches", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const flat = (t) => t.replace(/\s+/g, "");
  assert.ok(flat(src).includes(flat(`
    if (_projectRefs && now - _projectRefs.at < maxAgeMs) return _projectRefs.rows;`)), "a fresh list is reused");
  assert.ok(flat(src).includes(flat(`entry.rows.catch(() => { if (_projectRefs === entry) _projectRefs = null; });`)), "a failed read is dropped");
  assert.ok(src.includes("return resolveProjectRefIn(identifier, await loadProjectRefs(0));"), "a miss on an older list is looked up once more");
  assert.ok(src.includes("if (found || !_projectRefs || Date.now() - _projectRefs.at < PROJECT_REFS_RECHECK_MS) return found;"), "but not when the list was just read");
  assert.ok(src.includes("_projectRefs = null; // ...and the id/number/name list"), "updateProjectRecord drops the list");
  assert.equal(src.split('pms_projects?select=pid:project->>id,pn:project->>projectNumber,nm:project->>name,team').length - 1, 1, "the list is read in one place");
  assert.ok(!src.includes("project->>id=eq."), "single projects are read by primary key, not by the id inside the blob");
  // The list is shared across callers, so it must be the unfiltered one and
  // visibility must still be applied per request.
  const seg = src.slice(src.indexOf("async function resolveProjectRefIn"), src.indexOf("const MAX_BODY_CHARS"));
  assert.ok(seg.includes("const caps = await resolveCaps();") && seg.includes("projectVisible(caps, r?.pn)"), "visibility is applied per request");
});

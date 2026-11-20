// Tests for backupExport.ts, the connector's half of the off-site backup.
//
//   node --test supabase/functions/pms-mcp/backupExport.test.mjs
//
// Imports the real Edge source (Node strips the types) and drives the Graph
// calls with an in-memory stub of a SharePoint folder tree.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkBackupPath, shareToken, resolveBackupRoot, ensureFolders, createBackupUploadSession,
  listBackupFolder, BackupRequestError,
} from "./backupExport.ts";

test("checkBackupPath accepts only the three file shapes", () => {
  assert.deepEqual(checkBackupPath("core/2026-11-21/pms-core.dump"),
    { ok: true, folders: ["core", "2026-11-21"], name: "pms-core.dump", conflict: "fail" });
  assert.deepEqual(checkBackupPath("emails/emails-2026-06.csv.gz"),
    { ok: true, folders: ["emails"], name: "emails-2026-06.csv.gz", conflict: "replace" });
  assert.deepEqual(checkBackupPath("history/history-2026-11.csv.gz"),
    { ok: true, folders: ["history"], name: "history-2026-11.csv.gz", conflict: "replace" });
  for (const bad of [
    "", null, "core/2026-11-21", "core/2026-02-30/x.dump", "core/2026-11-21/../x", "core/2026-11-21/a/b",
    "core/2026-11-21/X.dump", "../core/2026-11-21/x", "emails/history-2026-06.csv.gz", "emails/emails-2026-13.csv.gz",
    "emails/emails-2026-06.csv", "other/emails-2026-06.csv.gz", "/core/2026-11-21/x", "core/2026-11-21/.hidden",
  ]) {
    assert.equal(checkBackupPath(bad).ok, false, `should refuse ${JSON.stringify(bad)}`);
  }
});

test("shareToken matches Graph's u! encoding", () => {
  assert.equal(shareToken("https://contoso.sharepoint.com/sites/x/Shared Documents/B"),
    "u!" + Buffer.from("https://contoso.sharepoint.com/sites/x/Shared Documents/B").toString("base64")
      .replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_"));
});

// A tiny in-memory drive: items keyed by id, children by parent id + name.
function fakeDrive({ rootIsFile = false } = {}) {
  const items = new Map([["root", { id: "root", name: "PMS Backups", folder: rootIsFile ? undefined : {} }]]);
  const children = new Map(); // `${parent}/${name}` -> id
  let n = 0;
  const calls = [];
  const graph = {
    async get(path) {
      calls.push(["GET", path]);
      let m;
      if (path.startsWith("/shares/")) {
        return { status: 200, json: { ...items.get("root"), webUrl: "https://sp/backups", parentReference: { driveId: "D1" } } };
      }
      if ((m = /^\/drives\/D1\/items\/([^:]+):\/([^:?]+)\?/.exec(path))) {
        const id = children.get(`${m[1]}/${decodeURIComponent(m[2])}`);
        return id ? { status: 200, json: items.get(id) } : { status: 404, json: { error: { code: "itemNotFound" } } };
      }
      if ((m = /^\/drives\/D1\/items\/root:\/([a-z]+):\/children/.exec(path))) {
        const id = children.get(`root/${m[1]}`);
        if (!id) return { status: 404, json: {} };
        const value = [...children.entries()].filter(([k]) => k.startsWith(id + "/")).map(([, cid]) => ({ size: 10, ...items.get(cid) }));
        return { status: 200, json: { value } };
      }
      throw new Error("unexpected GET " + path);
    },
    async post(path, body) {
      calls.push(["POST", path, body]);
      let m;
      if ((m = /^\/drives\/D1\/items\/([^/]+)\/children$/.exec(path))) {
        const key = `${m[1]}/${body.name}`;
        if (children.has(key)) return { status: 409, json: { error: { code: "nameAlreadyExists" } } };
        const id = "i" + ++n;
        items.set(id, { id, name: body.name, folder: {} });
        children.set(key, id);
        return { status: 201, json: items.get(id) };
      }
      if ((m = /^\/drives\/D1\/items\/([^:]+):\/([^:]+):\/createUploadSession$/.exec(path))) {
        const key = `${m[1]}/${decodeURIComponent(m[2])}`;
        if (children.has(key) && body.item["@microsoft.graph.conflictBehavior"] === "fail") {
          return { status: 409, json: { error: { code: "nameAlreadyExists" } } };
        }
        return { status: 200, json: { uploadUrl: `https://upload/${encodeURIComponent(key)}`, expirationDateTime: "2026-11-22T00:00:00Z" } };
      }
      throw new Error("unexpected POST " + path);
    },
  };
  return { graph, items, children, calls, addFile(parent, name) { const id = "f" + ++n; items.set(id, { id, name }); children.set(`${parent}/${name}`, id); return id; } };
}

test("resolveBackupRoot needs the secret and a folder", async () => {
  const d = fakeDrive();
  await assert.rejects(resolveBackupRoot(d.graph, ""), /BACKUP_FOLDER_URL is not set/);
  assert.deepEqual(await resolveBackupRoot(d.graph, "https://sp/backups"), { driveId: "D1", itemId: "root", webUrl: "https://sp/backups" });
  await assert.rejects(resolveBackupRoot(fakeDrive({ rootIsFile: true }).graph, "https://sp/x"), /a file, not a folder/);
});

test("ensureFolders creates missing folders once and reuses them", async () => {
  const d = fakeDrive();
  const root = { driveId: "D1", itemId: "root" };
  const a = await ensureFolders(d.graph, root, ["core", "2026-11-21"]);
  const b = await ensureFolders(d.graph, root, ["core", "2026-11-21"]);
  assert.equal(a, b);
  assert.equal(d.calls.filter(([m, p]) => m === "POST" && p.endsWith("/children")).length, 2);
  // Never asks Graph to replace a folder.
  for (const [m, , body] of d.calls) if (m === "POST") assert.equal(body["@microsoft.graph.conflictBehavior"], "fail");
});

test("ensureFolders refuses a file sitting where a folder should be", async () => {
  const d = fakeDrive();
  d.addFile("root", "core");
  await assert.rejects(ensureFolders(d.graph, { driveId: "D1", itemId: "root" }, ["core"]), /is a file/);
});

test("createBackupUploadSession: core never overwrites, monthly files replace", async () => {
  const d = fakeDrive();
  const root = { driveId: "D1", itemId: "root" };
  const s = await createBackupUploadSession(d.graph, root, "core/2026-11-21/pms-core.dump", 1234);
  assert.match(s.uploadUrl, /^https:\/\/upload\//);
  assert.equal(s.conflict, "fail");
  const dayFolder = d.children.get(`${d.children.get("root/core")}/2026-11-21`);
  d.addFile(dayFolder, "pms-core.dump");
  await assert.rejects(createBackupUploadSession(d.graph, root, "core/2026-11-21/pms-core.dump", 1234),
    (e) => e instanceof BackupRequestError && /never overwritten/.test(e.message));
  const m = await createBackupUploadSession(d.graph, root, "emails/emails-2026-06.csv.gz", 99);
  assert.equal(m.conflict, "replace");
  const sessions = d.calls.filter(([meth, p]) => meth === "POST" && p.endsWith("createUploadSession"));
  assert.equal(sessions.at(-1)[2].item["@microsoft.graph.conflictBehavior"], "replace");
});

test("createBackupUploadSession refuses bad paths and sizes before touching Graph", async () => {
  const d = fakeDrive();
  const root = { driveId: "D1", itemId: "root" };
  await assert.rejects(createBackupUploadSession(d.graph, root, "anything/else.txt", 10), BackupRequestError);
  await assert.rejects(createBackupUploadSession(d.graph, root, "emails/emails-2026-06.csv.gz", 0), BackupRequestError);
  await assert.rejects(createBackupUploadSession(d.graph, root, "emails/emails-2026-06.csv.gz", "x"), BackupRequestError);
  assert.equal(d.calls.length, 0);
});

test("listBackupFolder lists one allowed folder, empty when missing", async () => {
  const d = fakeDrive();
  const root = { driveId: "D1", itemId: "root" };
  assert.deepEqual(await listBackupFolder(d.graph, root, "emails"), []);
  await createBackupUploadSession(d.graph, root, "emails/emails-2026-06.csv.gz", 99); // creates emails/
  d.addFile(d.children.get("root/emails"), "emails-2026-06.csv.gz");
  const list = await listBackupFolder(d.graph, root, "emails");
  assert.deepEqual(list.map((f) => f.name), ["emails-2026-06.csv.gz"]);
  await assert.rejects(listBackupFolder(d.graph, root, "../x"), BackupRequestError);
});

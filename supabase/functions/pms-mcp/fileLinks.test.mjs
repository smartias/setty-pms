// fileLinks.ts — the signed single-file links behind download_document /
// upload_document (1.19.0) — plus drift anchors for the wiring in index.ts.
// Imports the real Edge source (Node strips the types).
//
//   node --test supabase/functions/pms-mcp/fileLinks.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  mintFileToken, verifyFileToken, clampTtlMinutes, b64urlEncode, b64urlDecode,
  mimeFor, contentDisposition, isWritableName, isOutgoingPath, chunkRanges, UPLOAD_CHUNK_BYTES,
  FILE_TOKEN_TTL_DEFAULT_MIN, FILE_TOKEN_TTL_MAX_MIN,
} from "./fileLinks.ts";

const SECRET = "unit-test-secret-that-is-long-enough";
const NOW = 1_800_000_000;
const getPayload = { k: "get", id: "b!drive|01ITEM", n: "CCB Comment Log.xlsx", by: "sara.arias@setty.com", exp: NOW + 1800 };
const putPayload = { k: "put", drive: "b!drive", parent: "01PARENT", name: "CCB Comment Log.xlsx", item: "01ITEM", by: "sara.arias@setty.com", exp: NOW + 1800, max: 52428800 };

test("round trip: a minted token verifies to the same payload", async () => {
  const tok = await mintFileToken(getPayload, SECRET);
  assert.match(tok, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, "base64url body . base64url signature — URL-safe with no padding");
  assert.deepEqual(await verifyFileToken(tok, SECRET, NOW), getPayload);
  const put = await mintFileToken(putPayload, SECRET);
  assert.deepEqual(await verifyFileToken(put, SECRET, NOW), putPayload);
});

test("the token is the credential: any defect verifies to null, never throws", async () => {
  const tok = await mintFileToken(getPayload, SECRET);
  assert.equal(await verifyFileToken(tok, "a-different-secret-of-enough-length", NOW), null, "wrong key");
  assert.equal(await verifyFileToken(tok, SECRET, NOW + 1801), null, "expired");
  const [body, sig] = tok.split(".");
  const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
  assert.equal(await verifyFileToken(body + "." + flipped, SECRET, NOW), null, "tampered signature");
  // Re-signing a forged payload without the key is what HMAC prevents; a
  // payload swap under the old signature must fail too.
  const forgedBody = b64urlEncode(JSON.stringify({ ...getPayload, id: "b!drive|01OTHER" }));
  assert.equal(await verifyFileToken(forgedBody + "." + sig, SECRET, NOW), null, "payload swapped");
  for (const junk of ["", ".", "abc", "abc.", ".abc", "not base64!.sig", tok + "x", 42, null, undefined]) {
    assert.equal(await verifyFileToken(junk, SECRET, NOW), null, `junk: ${String(junk)}`);
  }
  assert.equal(await verifyFileToken(tok, "", NOW), null, "empty secret never verifies");
  await assert.rejects(() => mintFileToken(getPayload, "short"), /secret too short/);
});

test("payload shape is checked per verb, so a GET token cannot be replayed as a PUT (and vice versa)", async () => {
  const noVerb = await mintFileToken({ ...getPayload, k: "delete" }, SECRET);
  assert.equal(await verifyFileToken(noVerb, SECRET, NOW), null);
  const putMissingBy = await mintFileToken({ ...putPayload, by: "" }, SECRET);
  assert.equal(await verifyFileToken(putMissingBy, SECRET, NOW), null, "a write always has a person behind it");
  const getNoId = await mintFileToken({ ...getPayload, id: "" }, SECRET);
  assert.equal(await verifyFileToken(getNoId, SECRET, NOW), null);
  const noExp = await mintFileToken({ ...getPayload, exp: undefined }, SECRET);
  assert.equal(await verifyFileToken(noExp, SECRET, NOW), null, "no expiry = no token");
  // The routes check t.k themselves; the verifier just guarantees the shape.
  const g = await verifyFileToken(await mintFileToken(getPayload, SECRET), SECRET, NOW);
  const p = await verifyFileToken(await mintFileToken(putPayload, SECRET), SECRET, NOW);
  assert.equal(g.k, "get"); assert.equal(p.k, "put");
});

test("base64url survives binary and non-ASCII payloads", () => {
  const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 37) % 256);
  assert.deepEqual(b64urlDecode(b64urlEncode(bytes)), bytes);
  const s = "Émails/2026_08_24 CCB Reporting/log — ✅.xlsx";
  assert.equal(new TextDecoder().decode(b64urlDecode(b64urlEncode(s))), s);
  assert.doesNotMatch(b64urlEncode(bytes), /[+/=]/);
});

test("TTL is clamped to 5–240 minutes with a 30 minute default", () => {
  assert.equal(clampTtlMinutes(undefined), FILE_TOKEN_TTL_DEFAULT_MIN);
  assert.equal(FILE_TOKEN_TTL_DEFAULT_MIN, 30);
  assert.equal(clampTtlMinutes(0), 5);
  assert.equal(clampTtlMinutes(-10), 5);
  assert.equal(clampTtlMinutes(10_000), FILE_TOKEN_TTL_MAX_MIN);
  assert.equal(FILE_TOKEN_TTL_MAX_MIN, 240);
  assert.equal(clampTtlMinutes(44.6), 45);
  assert.equal(clampTtlMinutes("60"), 30, "strings are not minutes");
  assert.equal(clampTtlMinutes(NaN), 30);
});

test("content type and disposition for the streamed download", () => {
  assert.equal(mimeFor("log.xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(mimeFor("Log.XLSM"), "application/vnd.ms-excel.sheet.macroEnabled.12");
  assert.equal(mimeFor("spec.PDF"), "application/pdf");
  assert.equal(mimeFor("narrative.docx"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(mimeFor("M-101.dwg"), "application/acad");
  assert.equal(mimeFor("whatever.bin"), "application/octet-stream");
  assert.equal(mimeFor(""), "application/octet-stream");
  const cd = contentDisposition('CCB "Log" — Août.xlsx');
  assert.ok(cd.startsWith("attachment; "), cd);
  assert.ok(cd.includes('filename="CCB _Log_ _ Ao_t.xlsx"'), "ASCII fallback with quotes and non-ASCII replaced: " + cd);
  assert.ok(cd.includes("filename*=UTF-8''CCB%20_Log_%20%E2%80%94%20Ao%C3%BBt.xlsx"), "RFC 5987 form carries the real name: " + cd);
  assert.doesNotMatch(contentDisposition("evil\r\nX-Injected: 1.pdf"), /[\r\n]/, "no header injection");
});

test("upload_document writes office and text formats only, with clean names", () => {
  for (const ok of ["CCB Comment Log.xlsx", "log.XLSM", "DD Narrative.docx", "deck.pptx", "report.pdf", "rows.csv", "notes.txt", "README.md", "data.json", "x.xml", "page.html"]) {
    assert.ok(isWritableName(ok), `should be writable: ${ok}`);
  }
  for (const bad of ["", "noext", "run.exe", "macro.bat", "script.js", "M-101.dwg", "model.rvt", "sheet.xls",
    "../escape.xlsx", "sub/dir.xlsx", "C:\\x.xlsx", "what?.xlsx", "a:b.docx", "hash#1.xlsx", "pct%.xlsx",
    ".hidden.xlsx", "~$lock.xlsx", "x".repeat(201) + ".xlsx"]) {
    assert.ok(!isWritableName(bad), `should be refused: ${JSON.stringify(bad)}`);
  }
});

test("Outgoing is recognised anywhere in a Graph parentReference.path, in every spelling the offices use", () => {
  const drive = "/drives/b!abc/root:";
  for (const p of [
    `${drive}/SAPX196006.00 Tabler/Outgoing`,
    `${drive}/SAPX196006.00 Tabler/Outgoing/2026-08-01_100% CD`,
    `${drive}/SIPX262012.00/99-SIPX262012.00_OUTGOING`,
    `${drive}/SIPX262012.00/99-SIPX262012.00_OUTGOING/2026-06-01 DD`,
    `${drive}/P/05 %F0%9F%93%A4 Outgoing`,      // emoji-prefixed provisioned name, URL-encoded by Graph
    `${drive}/P/05 📤 Outgoing/Set`,
    "/SAPX196006.00/OUTGOING",                    // no root: prefix (folder name appended by the tool)
  ]) assert.ok(isOutgoingPath(p), `should be Outgoing: ${p}`);
  for (const p of [
    `${drive}/SAPX196006.00 Tabler/Emails/2026_08_24 CCB Reporting`,
    `${drive}/SAPX196006.00 Tabler/02 Design Reports and Narratives`,
    `${drive}/SAPX196006.00 Tabler/Incoming`,
    `${drive}/SAPX196006.00 Tabler/Outgoings Tracker`,   // a different word
    `${drive}/SAPX196006.00 Tabler/QAQC`,
    "", null, undefined,
  ]) assert.ok(!isOutgoingPath(p), `should NOT be Outgoing: ${p}`);
});

test("upload-session chunks are 320 KiB multiples and cover the file exactly once", () => {
  assert.equal(UPLOAD_CHUNK_BYTES % 327_680, 0);
  assert.ok(UPLOAD_CHUNK_BYTES <= 60 * 1024 * 1024);
  const total = UPLOAD_CHUNK_BYTES * 2 + 12_345;
  const ranges = chunkRanges(total);
  assert.equal(ranges.length, 3);
  assert.deepEqual(ranges[0], { start: 0, end: UPLOAD_CHUNK_BYTES - 1 });
  assert.deepEqual(ranges[2], { start: UPLOAD_CHUNK_BYTES * 2, end: total - 1 });
  let covered = 0;
  for (const r of ranges) covered += r.end - r.start + 1;
  assert.equal(covered, total);
  assert.deepEqual(chunkRanges(0), []);
  assert.deepEqual(chunkRanges(10, 4), [{ start: 0, end: 3 }, { start: 4, end: 7 }, { start: 8, end: 9 }]);
});

// sharePointProjectFolderName (index.ts) isn't exported — index.ts boots a
// server at import, same reason every other pms-mcp test copies pure logic
// instead of importing it. Copied here to cover the #289 follow-up: a
// Dynamics-named top folder (Proposals/Contract/Contract Library) must still
// read out a name — fileMetaById relies on it resolving to "" only for the
// item that truly has none (a file sitting at the drive root).
function sharePointProjectFolderNameCopy(meta) {
  const path = meta.parentReference?.path || "";
  const marker = "root:";
  const idx = path.indexOf(marker);
  const afterRoot = idx >= 0 ? path.slice(idx + marker.length) : "";
  const first = afterRoot.split("/").filter(Boolean)[0];
  if (first) { try { return decodeURIComponent(first); } catch { return first; } }
  return meta.folder ? (meta.name || "") : "";
}
test("sharePointProjectFolderName reads a Dynamics-named top folder same as a numbered one", () => {
  assert.equal(
    sharePointProjectFolderNameCopy({ parentReference: { path: "/drives/b!x/root:/SAPX256015.00 Tabler/Outgoing" } }),
    "SAPX256015.00 Tabler",
  );
  assert.equal(
    sharePointProjectFolderNameCopy({ parentReference: { path: "/drives/b!x/root:/2026 — NYS Museum Plan/Proposal.docx" } }),
    "2026 — NYS Museum Plan",
    "a Proposals/Contract folder is read the same way, even though it carries no project number",
  );
  assert.equal(
    sharePointProjectFolderNameCopy({ parentReference: { path: "/drives/b!x/root:" }, folder: true, name: "SAPX256015.00 Tabler" }),
    "SAPX256015.00 Tabler",
    "a folder sitting directly at the drive root names itself",
  );
  assert.equal(
    sharePointProjectFolderNameCopy({ parentReference: { path: "/drives/b!x/root:" }, name: "orphan.docx" }),
    "",
    "a FILE sitting directly at the drive root has no project ancestry at all",
  );
});

// ── Drift anchors: the wiring in index.ts ────────────────────────────────────
test("index.ts wiring: tools, routes, gates and caps", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, "index.ts"), "utf8");
  for (const anchor of [
    'from "./fileLinks.ts"',
    'mcp.tool("download_document"',
    'mcp.tool("upload_document"',
    // The link is served by the function itself; the base is overridable.
    'Deno.env.get("FILE_LINK_BASE") || `${SUPABASE_URL}/functions/v1/pms-mcp/file`',
    // The key never defaults to something guessable.
    'Deno.env.get("FILE_LINK_SECRET") || `pms-mcp:file-link:v1:${SERVICE_KEY}`',
    // Both routes, token-gated, verb-checked.
    'app.get("/pms-mcp/file/:token"',
    'app.put("/pms-mcp/file/:token"',
    'if (!t || t.k !== "get")',
    'if (!t || t.k !== "put")',
    // The GET re-runs visibility AS THE MINTING CALLER, not as nobody.
    "callerStore.run(callerFromToken(t.by), () => openFileById(t.id))",
    // The drive gate runs on every az: id before any share call (meta and bytes).
    "const gate = await azurePathProject(dec.team, dec.relPath);\n    if (!gate.ok) return gate;",
    // Streamed, never cached, never buffered.
    "return new Response(upstream.body, { status: 200, headers });",
    'headers.set("Cache-Control", "private, no-store");',
    // Write posture: a person, SharePoint only, never Outgoing, writable names, caps.
    'if (c.kind !== "user" || !c.email) {',
    "if (isAzId(itemId)) {\n      return asText({ error: \"Drives are read-only to Claude",
    "if (isOutgoingPath(folderPath)) {",
    "if (!isWritableName(finalName)) {",
    "const UPLOAD_MAX_BYTES = 50 * 1024 * 1024;",
    "const UPLOAD_SIMPLE_MAX_BYTES = 3_500_000;",
    "const DOWNLOAD_INLINE_MAX_BYTES = 1_000_000;",
    // A new name never silently replaces a sibling: only overwrite:true by id does.
    ":/content?@microsoft.graph.conflictBehavior=fail`",
    '"@microsoft.graph.conflictBehavior": existingItemId ? "replace" : "fail"',
    // The PUT route enforces the token's own cap before and after reading the body.
    "if (declared > t.max) return overCap(declared);",
    "if (bytes.byteLength > t.max) return overCap(bytes.byteLength);",
    // Every write is logged with the person.
    'console.log("[upload_document]", c.email,',
    'console.log("[upload_document]", t.by,',
    // read_document points at the new path instead of pretending text is the file.
    "use download_document; ",
    // Follow-up on #289: a Dynamics-named top folder (Proposals/Contract/
    // Contract Library) has no resolvable project number, so the item is let
    // through, not denied — denying it broke download_document/upload_document
    // on those libraries entirely (the same regression #288 fixed in
    // read_document's parallel gate, sharePointItemVisible).
    "if (projectNum && !(await projectRefVisible(projectNum))) {",
  ]) {
    assert.ok(src.includes(anchor), `index.ts lost anchor: ${JSON.stringify(anchor)}`);
  }
  assert.ok(!src.includes("if (!projectNum || !(await projectRefVisible(projectNum))) {"),
    "fileMetaById must not have regressed back to denying every name-based-library item");
  // The routes sit after the MCP handler and before Deno.serve, like the others.
  const iGet = src.indexOf('app.get("/pms-mcp/file/:token"');
  assert.ok(iGet > src.indexOf('app.all("/pms-mcp/mcp"') && iGet < src.indexOf("Deno.serve(app.fetch)"));
  // The MCP auth middleware is scoped to /mcp, so the file routes are reachable bearer-less.
  assert.ok(src.includes('app.use("/pms-mcp/mcp", async (c, next) => {'));
  assert.ok(!/app\.use\("\/pms-mcp\/file/.test(src), "file routes must not sit behind the bearer middleware — the token is the credential");
});

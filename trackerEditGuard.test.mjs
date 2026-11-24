// The Tracker's edit guard (RFISubmittalSync_Preview.html): only changed fields
// are written, a field changed underneath is reported, a new item's number is
// settled against the live log, and a stored value that is not on a dropdown's
// list survives a save. The helpers are sliced out of the page and run here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./RFISubmittalSync_Preview.html", import.meta.url), "utf8");
const a = src.indexOf("// ── EDIT GUARD (begin)"), b = src.indexOf("// ── EDIT GUARD (end)");
assert.ok(a > 0 && b > a, "edit-guard markers must exist in the Tracker");
const { changedKeys, mergeEdit, resolveNewNumber } = new Function(src.slice(a, b) + "\nreturn { changedKeys, mergeEdit, resolveNewNumber };")();

const opened = { number: "RFI-7", title: "Duct at beam", status: "Open", discipline: "", response: "", assignedTo: [], spFolderUrl: "", dueDate: "2026-12-01" };

test("nothing changed means nothing is written", () => {
  assert.deepEqual(changedKeys(opened, { ...opened }), []);
  // null / undefined / "" on the record are the same blank the form shows
  assert.deepEqual(changedKeys({ notes: "" }, { notes: "" }), []);
  const stored = { ...opened, spFolderUrl: "https://sp/folder", status: "Responded", response: "See M-101", extra: 1 };
  const m = mergeEdit(stored, opened, { ...opened });
  assert.deepEqual(m.next, stored, "a form opened earlier and saved untouched leaves the newer record exactly as it is");
  assert.deepEqual(m.keys, []); assert.deepEqual(m.conflicts, []);
});

test("only the changed field is written; what someone else wrote meanwhile is kept", () => {
  const stored = { ...opened, spFolderUrl: "https://sp/folder", response: "Engineer's answer", status: "Responded" };
  const m = mergeEdit(stored, opened, { ...opened, dueDate: "2026-12-05" });
  assert.deepEqual(m.keys, ["dueDate"]);
  assert.equal(m.next.dueDate, "2026-12-05");
  assert.equal(m.next.spFolderUrl, "https://sp/folder"); assert.equal(m.next.response, "Engineer's answer"); assert.equal(m.next.status, "Responded");
  assert.deepEqual(m.conflicts, []);
});

test("the same field changed by both sides is a conflict; the same value is not", () => {
  const stored = { ...opened, status: "Responded" };
  assert.deepEqual(mergeEdit(stored, opened, { ...opened, status: "Closed" }).conflicts, ["status"]);
  assert.deepEqual(mergeEdit(stored, opened, { ...opened, status: "Responded" }).conflicts, []);
  const both = mergeEdit({ ...opened, assignedTo: ["a"] }, opened, { ...opened, assignedTo: ["b"] });
  assert.deepEqual(both.conflicts, ["assignedTo"]); assert.deepEqual(both.next.assignedTo, ["b"]);
});

test("a blank discipline or an off-list value is not rewritten by an unrelated save", () => {
  const stored = { number: "S-1", discipline: "Multi-Discipline", stamp: null, status: "Received", notes: "" };
  const form = { number: "S-1", discipline: "Multi-Discipline", stamp: "", status: "Received", notes: "" };
  const m = mergeEdit(stored, form, { ...form, notes: "called the GC" });
  assert.equal(m.next.discipline, "Multi-Discipline"); assert.equal(m.next.stamp, null); assert.deepEqual(m.keys, ["notes"]);
  // and the dropdown renders the stored value as its own option
  assert.match(src, /f\.sel\.includes\(v\)\?"":`<option value="\$\{esc\(v\)\}" selected>/);
});

test("a new item's number follows the live log; a typed number that is taken is refused", () => {
  const live = [{ number: "RFI-007" }, { number: "RFI-008" }];
  const next = () => "RFI-009";
  assert.deepEqual(resolveNewNumber("RFI-009", "RFI-009", live, next), { number: "RFI-009" });
  assert.deepEqual(resolveNewNumber("RFI-008", "RFI-008", live, next), { number: "RFI-009", moved: true });
  assert.match(resolveNewNumber("rfi-007 ", "RFI-008", live, next).error, /already in the log/);
  assert.deepEqual(resolveNewNumber("GC-12", "RFI-008", live, next), { number: "GC-12" });
});

test("the editor uses the guard: close asks first, save is single-flight and writes through mergeEdit", () => {
  assert.match(src, /const merged=mergeEdit\(r, EDIT\.base, edits\);/);
  assert.ok(!/let m=\{\.\.\.r, \.\.\.edits\}/.test(src), "the whole-form overwrite is gone from saveEditor");
  assert.match(src, /if\(!EDIT\|\|EDIT\.saving\)return;/);
  assert.match(src, /onclick="requestCloseEditor\(\)">Cancel</);
  assert.match(src, /else requestCloseEditor\(\); return; \}/, "Escape asks before discarding");
  assert.match(src, /const today = \(\) => localISO\(new Date\(\)\);/, "new items are dated with the local day");
});

// ── failure reasons ─────────────────────────────────────────────────────────
{
  const a2 = src.indexOf("// ── FAILURE REASONS (begin)"), b2 = src.indexOf("// ── FAILURE REASONS (end)");
  assert.ok(a2 > 0 && b2 > a2, "failure-reason markers must exist in the Tracker");
  const { loadFailureText, saveOutcome } = new Function(src.slice(a2, b2) + "\nreturn { loadFailureText, saveOutcome };")();

  test("a save that returns no rows is a race only when the version moved; otherwise it is permission", () => {
    assert.deepEqual(saveOutcome(true, 200, "[]", 1, 5, null), { kind: "saved" });
    assert.deepEqual(saveOutcome(true, 200, "[]", 0, 5, 6), { kind: "race" });
    const denied = saveOutcome(true, 200, "[]", 0, 5, 5);
    assert.equal(denied.kind, "denied"); assert.match(denied.text, /can open this project but not edit it/);
    assert.equal(saveOutcome(true, 200, "[]", 0, 5, null).kind, "denied", "an unreadable version is not assumed to be a race");
  });

  test("an expired sign-in, a refusal and a server error each say so", () => {
    assert.match(saveOutcome(false, 401, '{"message":"JWT expired"}', 0, 5, null).text, /sign-in has expired.*still here/);
    assert.match(saveOutcome(false, 403, "", 0, 5, null).text, /cannot edit this project/);
    assert.match(saveOutcome(false, 503, "", 0, 5, null).text, /HTTP 503.*Nothing was written/);
    assert.match(loadFailureText(401), /sign-in has expired/); assert.match(loadFailureText(0), /No connection/);
    assert.ok(!/pms_projects|select=/.test(loadFailureText(500)), "no query text in what the person reads");
  });

  test("the old catch-all conflict message is gone, and every write goes through patchProject", () => {
    assert.ok(!src.includes("Project changed since you opened it"));
    assert.equal(src.split("await patchProject(").length - 1, 3, "writeProject (twice: first try and the one re-read) and writeArray");
    assert.match(src, /impSet\('\$\{kind\}',this\.dataset\.ext,'pick',this\.checked\)/, "import ticks are kept in state");
    assert.match(src, /saveAssignment\(kind\);/, "the assignment email records the assignment");
  });
}

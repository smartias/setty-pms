// Tests for caLookup.ts: finding an RFI or submittal by the number as a person
// types it. The cases are the lookups that failed in production (2026-11).
import { strict as assert } from "node:assert";
import test from "node:test";
import { caNumberKey, findCaItemLoose, caMissMessage } from "./caLookup.ts";

const rfi = (number, extra = {}) => ({ id: "id-" + number, number, ...extra });

test("the exact number wins, even when another item is the same number written differently", () => {
  const log = [rfi("RFI-012"), rfi("012")];
  const m = findCaItemLoose(log, "012", "rfi");
  assert.equal(m.item, log[1]);
  assert.equal(m.matchedBy, "number");
});

test("an id still finds the item", () => {
  const log = [rfi("RFI-011")];
  assert.equal(findCaItemLoose(log, "id-RFI-011", "rfi").matchedBy, "id");
});

test("an RFI is found when the prefix or leading zeros differ", () => {
  const log = [rfi("RFI-011"), rfi("RFI-343"), rfi("019"), rfi("003 Pre-Bid RFI")];
  assert.equal(findCaItemLoose(log, "011", "rfi").item, log[0]);
  assert.equal(findCaItemLoose(log, "343", "rfi").item, log[1]);
  assert.equal(findCaItemLoose(log, "19", "rfi").item, log[2]);
  assert.equal(findCaItemLoose(log, "RFI-19", "rfi").item, log[2]);
  assert.equal(findCaItemLoose(log, "003 Pre-Bid", "rfi").item, log[3]);
  assert.equal(findCaItemLoose(log, "011", "rfi").matchedBy, "format");
});

test("a different RFI is never taken for the one asked", () => {
  const log = [rfi("BID-RFI-314"), rfi("121.1"), rfi("RFI-005R")];
  assert.equal(findCaItemLoose(log, "121", "rfi").item, null, "121.1 is a follow-up, not RFI 121");
  assert.equal(findCaItemLoose(log, "5", "rfi").item, null, "5R is a revision, not RFI 5");
  assert.equal(findCaItemLoose(log, "314", "rfi").item, null, "the bid RFI is its own item");
  assert.deepEqual(findCaItemLoose(log, "314", "rfi").similar, ["BID-RFI-314"]);
});

test("two live items that fit come back as candidates, not a guess", () => {
  const log = [rfi("RFI-016"), rfi("#16")];
  const m = findCaItemLoose(log, "16", "rfi");
  assert.equal(m.item, null);
  assert.deepEqual(m.candidates, ["RFI-016", "#16"]);
  assert.match(caMissMessage(m, "rfi", "16", "on this project", 2), /fits 2 rfis.*RFI-016, #16/);
});

test("a voided twin does not make the live item ambiguous", () => {
  const log = [rfi("RFI-016", { status: "Void" }), rfi("#16", { status: "Open" })];
  assert.equal(findCaItemLoose(log, "16", "rfi").item, log[1]);
});

test("a submittal is found across spacing, prefix and leading zeros", () => {
  const log = [rfi("23 22 16-1.0"), rfi("230523-001-0"), rfi("SUB-004")];
  assert.equal(findCaItemLoose(log, "232216-1.0", "submittal").item, log[0]);
  assert.equal(findCaItemLoose(log, "23 05 23-1-0", "submittal").item, log[1]);
  assert.equal(findCaItemLoose(log, "4", "submittal").item, log[2]);
  assert.equal(findCaItemLoose(log, "232216-2.0", "submittal").item, null);
});

test("caNumberKey", () => {
  assert.equal(caNumberKey("rfi", "RFI-012"), "12");
  assert.equal(caNumberKey("submittal", "Submittal #23 22 16-1.0"), "232216-1.0");
  assert.equal(caNumberKey("submittal", "SUB-004"), "4");
  assert.equal(caNumberKey("submittal", null), "");
});

test("a miss says what is in the log", () => {
  const log = [rfi("RFI-190A"), rfi("RFI-200")];
  const m = findCaItemLoose(log, "RFI-190", "rfi");
  assert.equal(m.item, null);
  assert.equal(caMissMessage(m, "rfi", "RFI-190", "on project X", 2), 'No rfi "RFI-190" on project X. Closest numbers in the log: RFI-190A.');
  assert.equal(caMissMessage(findCaItemLoose([], "19", "rfi"), "rfi", "19", "on project X", 0),
    'No rfi "19" on project X. The rfi log on project X is empty.');
  assert.equal(findCaItemLoose(log, "", "rfi").item, null);
  assert.equal(findCaItemLoose(null, "1", "rfi").item, null);
});

// ── log statuses (backload_ca_item) ─────────────────────────────────────────
{
  const { canonicalCaStatus, CA_STATUSES } = await import("./caLookup.ts");
  const { readFileSync } = await import("node:fs");
  test("backfill statuses: the log's spelling, known near misses mapped, anything else refused", () => {
    assert.equal(canonicalCaStatus("submittal", "under review"), "Under Review");
    assert.equal(canonicalCaStatus("submittal", "In Review"), "Under Review");
    assert.equal(canonicalCaStatus("submittal", " Revise and  Resubmit "), "Resubmittal Required");
    assert.equal(canonicalCaStatus("rfi", "CLOSED"), "Closed");
    assert.equal(canonicalCaStatus("rfi", "Returned"), null);
    assert.equal(canonicalCaStatus("submittal", "Responded"), null);
    assert.equal(canonicalCaStatus("rfi", ""), null);
  });
  test("the connector's status lists are the ones the PMS and Tracker use (caStatus.js)", async () => {
    const shared = await import("../../../caStatus.js");
    assert.deepEqual(CA_STATUSES.rfi, shared.RFI_STATUSES);
    assert.deepEqual(CA_STATUSES.submittal, shared.SUBMITTAL_STATUSES);
    const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    const body = src.slice(src.indexOf('mcp.tool("backload_ca_item"'));
    assert.match(body.slice(0, 9000), /canonicalCaStatus\(type, args\.status\)/, "backload_ca_item checks the status before writing");
  });
}

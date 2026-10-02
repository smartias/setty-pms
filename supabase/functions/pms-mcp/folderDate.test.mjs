// Folder dates: the PMS creates "yyyy_mm_dd Name" milestone folders while older
// set folders use "yyyy-mm-dd_Name". Mirrors isoDateIn/setFolderDate and
// parseDriveSessionFolderName in index.ts. Fixtures are real folder shapes.
import { strict as assert } from "node:assert";
import test from "node:test";

const NAME_DATE_RE = /(\d{4})[-_.](\d{2})[-_.](\d{2})/;
function isoDateIn(text, anchored = false) {
  const t = String(text || "");
  const m = (anchored ? /^\s*(\d{4})[-_.](\d{2})[-_.](\d{2})/ : NAME_DATE_RE).exec(t);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
const setFolderDate = (name) => isoDateIn(name, true);
const DRIVE_PHOTO_SESSION_RE = /^(\d{4}[-_.]\d{2}[-_.]\d{2})[\s_-]*(.*)$/;
function parseDriveSessionFolderName(name) {
  const m = DRIVE_PHOTO_SESSION_RE.exec(String(name || ""));
  return { date: m ? m[1].replace(/[_.]/g, "-") : null, label: (m ? m[2] : name).trim() || null };
}

test("set folder dates read with hyphen, underscore or dot separators", () => {
  assert.equal(setFolderDate("2025-11-18_Updated 100% CD"), "2025-11-18");
  assert.equal(setFolderDate("2026_02_18 Bid Phase"), "2026-02-18");
  assert.equal(setFolderDate("2026.03.26 SD Interim 2"), "2026-03-26");
});
test("undated or mid-name dates do not anchor", () => {
  assert.equal(setFolderDate("Addendum #1"), null);
  assert.equal(setFolderDate("Revised 2026_02_18"), null);
});
test("a date anywhere in the folder path is found for recency", () => {
  assert.equal(isoDateIn("Outgoing/2026_02_18 Bid Phase"), "2026-02-18");
  assert.equal(isoDateIn("Outgoing/Final CD"), null);
});
test("photo session folders normalise the date to ISO", () => {
  assert.deepEqual(parseDriveSessionFolderName("2026_08_27_Varun"), { date: "2026-08-27", label: "Varun" });
  assert.deepEqual(parseDriveSessionFolderName("2026-01-06 Sam's Photos"), { date: "2026-01-06", label: "Sam's Photos" });
  assert.deepEqual(parseDriveSessionFolderName("Roof"), { date: null, label: "Roof" });
});

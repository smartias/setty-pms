// P0.2 supersession: the fold and the filename lookup.
//
// These mirror the implementations in index.ts. They are duplicated rather than
// imported because index.ts is a Deno module that boots a server on import;
// the shapes below are copied verbatim and must be kept in step.
//
// Fixtures are REAL rows from pms_filing_log (project ids bxesxpi3 / h90kd8wv),
// including the two collisions that actually exist in the register: the
// STTQ-01 series key that carries both an E and an M sheet, and the P111/P111-F
// pair. A test suite built on invented data would have missed both.
import { strict as assert } from "node:assert";
import test from "node:test";

const SHEET_NO_RE = /^([A-Z]{1,3})[-_ ]?(\d{2,4}[A-Z]?)$/;

function canonicalSheet(sheet) {
  const raw = String(sheet?.sheetNo || "").toUpperCase().replace(/\s+/g, "");
  const m = SHEET_NO_RE.exec(raw);
  if (!m) return null;
  return { sheetNo: m[1] + m[2], discipline: m[1] };
}

const sheetsOf = (row) => (Array.isArray(row?.files?.sheets) ? row.files.sheets : []);

function registerIssueDate(row) {
  const explicit = row?.files?.issuedAt;
  if (explicit) return String(explicit).slice(0, 10);
  const named = /^\s*(\d{4})[-_](\d{2})[-_](\d{2})/.exec(String(row?.files?.milestoneName || ""));
  if (named) return `${named[1]}-${named[2]}-${named[3]}`;
  return String(row?.created_at || "").slice(0, 10);
}

function buildSupersessionIndex(rows) {
  const bySheet = new Map();
  const byFilename = new Map();
  let registeredFiles = 0;
  for (const row of rows) {
    const issueDate = registerIssueDate(row);
    const setName = row?.files?.milestoneName || null;
    const transmittalNumber = row?.files?.transmittalNumber || null;
    for (const s of sheetsOf(row)) {
      const fn = String(s?.filename || "").trim().toLowerCase();
      const c = canonicalSheet(s);
      if (c && !bySheet.has(c.sheetNo)) {
        bySheet.set(c.sheetNo, {
          status: "current", sheetNo: c.sheetNo, discipline: c.discipline,
          revision: s?.revision ?? null, issuedIn: setName, transmittalNumber,
          issueDate, backfilled: row?.files?.backfilled === true,
        });
      }
      if (fn) {
        registeredFiles++;
        let list = byFilename.get(fn);
        if (!list) { list = []; byFilename.set(fn, list); }
        list.push({
          sheetNo: c ? c.sheetNo : "",
          setName, issueDate, transmittalNumber, revision: s?.revision ?? null,
        });
      }
    }
  }
  return { bySheet, byFilename, registeredFiles, sets: rows.length };
}

function fileSupersessionStatus(fileName, folderPath, idx) {
  const nameLower = String(fileName || "").trim().toLowerCase();
  if (!nameLower) return null;
  const pathLower = String(folderPath || "").toLowerCase();
  const regs = idx.byFilename.get(nameLower);
  let sheetNo = "";
  let mine = null;
  if (regs && regs.length) {
    const keys = new Set(regs.map((r) => r.sheetNo).filter(Boolean));
    if (keys.size > 1) {
      return { status: "ambiguous", basis: "multi-sheet filename", sheetNumbers: [...keys].sort() };
    }
    if (keys.size === 0) return null;
    sheetNo = [...keys][0];
    mine = regs.find((r) => r.setName && pathLower.includes(String(r.setName).toLowerCase())) ?? null;
    if (!mine) {
      if (regs.length === 1) mine = regs[0];
      else return null;
    }
  } else {
    const stem = nameLower.replace(/\.[a-z0-9]+$/i, "").toUpperCase().replace(/\s+/g, "");
    const c = canonicalSheet({ sheetNo: stem });
    if (!c || !idx.bySheet.has(c.sheetNo)) return null;
    sheetNo = c.sheetNo;
  }
  const currentRec = idx.bySheet.get(sheetNo);
  if (!currentRec) return null;
  if (!mine) return { ...currentRec, basis: "matched by sheet number parsed from the filename" };
  const isCurrent = mine.issueDate === currentRec.issueDate &&
    (mine.setName ?? null) === (currentRec.issuedIn ?? null);
  if (isCurrent) return { ...currentRec, basis: "matched by filename in the transmittal register" };
  return {
    status: "superseded", sheetNo, discipline: currentRec.discipline,
    revision: mine.revision, issuedIn: mine.setName,
    transmittalNumber: mine.transmittalNumber, issueDate: mine.issueDate,
    backfilled: currentRec.backfilled,
    basis: "this copy is from an earlier set; a later set reissued the same sheet",
    supersededBy: currentRec,
  };
}

// Rows are supplied newest-issue-first, which is what transmittalRows() guarantees.
const rows = [
  {
    created_at: "2026-07-30T12:00:00Z",
    files: {
      milestoneName: "2026-04-17_Bulletin #13", transmittalNumber: "T-001",
      issuedAt: "2026-04-17T12:00:00.000Z", backfilled: true,
      sheets: [
        { sheetNo: "E-211", discipline: "Electrical", revision: "13", filename: "E211.pdf" },
        { sheetNo: "STTQ-01", discipline: "STTQ", revision: "13", filename: "STTQ-01-E_Bulletin #13.pdf" },
        { sheetNo: "STTQ-01", discipline: "STTQ", revision: "13", filename: "STTQ-01-M_Bulletin #13.pdf" },
      ],
    },
  },
  {
    created_at: "2026-07-30T12:00:00Z",
    files: {
      milestoneName: "2025-04-10_Bulletin #1", transmittalNumber: "T-002",
      issuedAt: "2025-04-10T12:00:00.000Z", backfilled: true,
      sheets: [
        { sheetNo: "E-211", discipline: "Electrical", revision: "C", filename: "E211.pdf" },
        { sheetNo: "M-507", discipline: "Mechanical", revision: "B", filename: "M507.pdf" },
      ],
    },
  },
];

const NEW_SET = "Outgoing/2026-04-17_Bulletin #13/Drawings";
const OLD_SET = "Outgoing/2025-04-10_Bulletin #1/Drawings";

test("the copy in the newest set is current", () => {
  const idx = buildSupersessionIndex(rows);
  const v = fileSupersessionStatus("E211.pdf", NEW_SET, idx);
  assert.equal(v.status, "current");
  assert.equal(v.revision, "13", "must take the revision from the NEWEST set");
  assert.equal(v.transmittalNumber, "T-001");
});

test("REGRESSION: the copy in an OLDER set is superseded, not current", () => {
  // The bug this guards: looking the sheet up in bySheet returns its CURRENT
  // issuance, so every physical copy of E211.pdf was labelled "current" —
  // including the one sitting in the 2025 Bulletin #1 folder. On real Tabler
  // data one filename lives in three set folders, so this mislabelled two of
  // three copies as current: a wrong-revision claim, which is the exact harm
  // P0.2 exists to prevent.
  const idx = buildSupersessionIndex(rows);
  const v = fileSupersessionStatus("E211.pdf", OLD_SET, idx);
  assert.equal(v.status, "superseded");
  assert.equal(v.revision, "C", "reports the revision of THIS copy, not the current one");
  assert.equal(v.issuedIn, "2025-04-10_Bulletin #1");
  assert.equal(v.supersededBy.issuedIn, "2026-04-17_Bulletin #13");
  assert.equal(v.supersededBy.transmittalNumber, "T-001");
});

test("a sheet only in an older set is still current if never reissued", () => {
  const idx = buildSupersessionIndex(rows);
  const v = fileSupersessionStatus("M507.pdf", OLD_SET, idx);
  assert.equal(v.status, "current", "M-507 appears once; nothing has replaced it");
  assert.equal(v.issuedIn, "2025-04-10_Bulletin #1");
});

test("the STTQ-01 collision never yields a winner", () => {
  const idx = buildSupersessionIndex(rows);
  // STTQ-01 fails SHEET_NO_RE, so it never enters bySheet: both files are
  // registered with no usable sheet number and must resolve to unknown.
  assert.equal(fileSupersessionStatus("STTQ-01-E_Bulletin #13.pdf", NEW_SET, idx), null);
  assert.equal(fileSupersessionStatus("STTQ-01-M_Bulletin #13.pdf", NEW_SET, idx), null);
});

test("a filename registered in several sets, in a folder naming none of them, stays unknown", () => {
  const idx = buildSupersessionIndex(rows);
  // Cannot tell which issuance this copy is, and guessing the newest is the one
  // direction that causes harm.
  assert.equal(fileSupersessionStatus("E211.pdf", "Documents/loose files", idx), null);
});

test("a filename the register has never seen is unknown", () => {
  const idx = buildSupersessionIndex(rows);
  assert.equal(fileSupersessionStatus("2026-05-19 BOYLAN HALL.pdf", NEW_SET, idx), null);
  assert.equal(fileSupersessionStatus("Con Edison Steam Load Letter.pdf", NEW_SET, idx), null);
});

test("sheet number parsed from a filename resolves when the register knows it", () => {
  const idx = buildSupersessionIndex(rows);
  // "E-211.pdf" was never a registered filename (the register holds E211.pdf),
  // but the stem parses to the same canonical sheet.
  const v = fileSupersessionStatus("E-211.pdf", NEW_SET, idx);
  assert.equal(v.status, "current");
  assert.equal(v.basis, "matched by sheet number parsed from the filename");
});

test("a prose filename never parses into a sheet number", () => {
  const idx = buildSupersessionIndex(rows);
  // Guards the FP601/STTQ-01-P trap: only a stem that IS a sheet number counts.
  assert.equal(fileSupersessionStatus("Fire Protection Narrative Phase 3.pdf", NEW_SET, idx), null);
  assert.equal(fileSupersessionStatus("2026-01-27 00-MASTER COVER SHEET.pdf", NEW_SET, idx), null);
});

test("an empty register yields no claims at all", () => {
  const idx = buildSupersessionIndex([]);
  assert.equal(idx.sets, 0);
  assert.equal(fileSupersessionStatus("E211.pdf", NEW_SET, idx), null);
});

test("issue date drives the fold, not filing timestamp", () => {
  // Both rows were FILED the same day (created_at identical). If the fold used
  // created_at, order would be arbitrary and Bulletin #1 could win. This is the
  // Tabler bug: a 2025 set filed in 2026 reported as current.
  const idx = buildSupersessionIndex(rows);
  assert.equal(fileSupersessionStatus("E211.pdf", NEW_SET, idx).issueDate, "2026-04-17");
});

// currentSet.ts — the transmittal-register FOLD, extracted so it is defined once.
//
// "What is the current set?" is answered by folding pms_filing_log rows tagged
// operation = 'transmittal-generated' into one entry per sheet at its most recent
// issuance. That fold is subtle (issue-date precedence, first-sighting-wins,
// discipline-from-prefix, non-drawing rejection) and it must give the SAME answer
// in two places: the MCP connector (index.ts, Deno) and the "Current Set" panel in
// SettyPMS.html (browser). This module is the single source for the connector.
//
// The browser cannot import a Deno .ts, so a mirror lives in ../../../currentSetFold.js
// and composeCurrentSet.test.mjs imports BOTH and asserts identical output on the real
// register fixtures — the same drift guard setty-docx.js uses. Any change here must
// be mirrored there or that test fails (run it by hand; there is no CI).

// When was this set ISSUED, as opposed to when the record was filed?
//
// created_at is a filing timestamp. It equals the issue date only when the set
// was logged the day it went out. Saving an OLD folder through the transmittal
// tool stamps today, and that is exactly how Tabler ended up reporting a
// year-superseded Bulletin #1 as current.
//
// Precedence, most to least trustworthy:
//   1. files.issuedAt   — someone stated the issue date explicitly.
//   2. the set folder's leading date — what the set is called.
//   3. created_at       — last resort, may be a filing timestamp.
export function registerIssueDate(row: any): string {
  const explicit = row?.files?.issuedAt;
  if (explicit) return String(explicit).slice(0, 10);
  const named = /^\s*(\d{4})[-_](\d{2})[-_](\d{2})/.exec(String(row?.files?.milestoneName || ""));
  if (named) return `${named[1]}-${named[2]}-${named[3]}`;
  // created_at is UTC; slicing it directly stamps an evening-ET filing with the
  // NEXT day's date, which can outrank a genuinely newer same-day set. The firm
  // operates in Eastern time, so the filing DAY is the ET calendar day.
  const d = new Date(String(row?.created_at || ""));
  if (!isNaN(d.getTime())) return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return String(row?.created_at || "").slice(0, 10);
}
// Which of the three it used, so a caller can judge the answer.
export function registerIssueDateSource(row: any): string {
  if (row?.files?.issuedAt) return "stated issue date";
  if (/^\s*\d{4}[-_]\d{2}[-_]\d{2}/.test(String(row?.files?.milestoneName || ""))) return "set folder name";
  return "filing timestamp (may not be the issue date)";
}

export const sheetsOf = (row: any): any[] => Array.isArray(row?.files?.sheets) ? row.files.sheets : [];

// Prepare raw register rows for the fold: drop the marked-superseded trail rows
// (a corrected set leaves its old record behind rather than deleting it), then
// order NEWEST-ISSUE-FIRST so the first sighting of a sheet number is current.
// This mirrors what transmittalRows() does in index.ts before calling the fold.
export function prepareRegisterRows(rows: any[]): any[] {
  return (Array.isArray(rows) ? rows : [])
    .filter((r: any) => r?.files?.superseded !== true)
    // Same-issue-date rows tiebreak on created_at then id, so the fold is
    // deterministic regardless of the fetch order a caller happened to use —
    // first-sighting-wins makes ordering outcome-affecting, and the connector
    // and the panel previously fetched with different orderings.
    .sort((a: any, b: any) =>
      registerIssueDate(b).localeCompare(registerIssueDate(a)) ||
      String(b?.created_at || "").localeCompare(String(a?.created_at || "")) ||
      String(b?.id || "").localeCompare(String(a?.id || "")));
}

// A real sheet number is a discipline prefix and a number: "E221", "M-507",
// "FP301A". The register also holds filename-parsed backfill rows that recorded
// a building SERIES instead ("STTQ-01"), which names no single sheet: both the
// E and the M sheet of a bulletin land on that one key. Folding those in would
// collapse two disciplines onto one row and overstate coverage, so they are
// counted out separately where the caller can see them.
// The optional `.NN` tail is a DOB-NOW filing suffix (e.g. P101.00, PD101.01).
export const SHEET_NO_RE = /^([A-Z]{1,3})[-_ ]?(\d{2,4}[A-Z]?(?:\.\d{1,2})?)$/;

export function canonicalSheet(sheet: any): { sheetNo: string; key: string; discipline: string } | null {
  const raw = String(sheet?.sheetNo || "").toUpperCase().replace(/\s+/g, "");
  const m = SHEET_NO_RE.exec(raw);
  if (!m) return null;
  // The prefix is the only reliable statement of discipline. The register's own
  // `discipline` field is free text that has held "Electrical", "STTQ" and
  // "General" on the same project, depending on which era wrote the row.
  //
  // `key` is the sheet's IDENTITY and strips the DOB-NOW filing suffix: P101,
  // P101.00 and P101.01 are the same physical sheet across filings, and keeping
  // the suffix in the fold key meant a re-filing never superseded its
  // predecessor — both showed as "current". `sheetNo` keeps the suffix for
  // display, so the filing designation is never lost.
  return { sheetNo: m[1] + m[2], key: m[1] + m[2].replace(/\.\d{1,2}$/, ""), discipline: m[1] };
}

// pms_filing_log.sp_folder_url is stored DECODED (a set named "Addendum #2"
// carries a literal '#', and milestone folders are named "50% CD"/"100% CD").
// A raw href truncates at the '#', and encoding spaces BEFORE '%' turns
// "100% CD" into the invalid escape "100%%20CD" — so '%' must go first. Graph
// webUrls arrive pre-encoded and must NOT pass through this.
export const encodeSpUrl = (u: any): string | null =>
  u ? String(u).replace(/%/g, "%25").replace(/ /g, "%20").replace(/#/g, "%23") : null;

// Conventional AEC set order, not alphabetical: a PM scanning a set expects
// mechanical before electrical. Anything unrecognised sorts last, alphabetically.
export const DISCIPLINE_ORDER = ["G", "M", "MS", "P", "FP", "FA", "E", "ES", "T", "TS", "EN"];
export const DISCIPLINE_NAME: Record<string, string> = {
  G: "General", M: "Mechanical", MS: "Mechanical Site", P: "Plumbing",
  FP: "Fire Protection", FA: "Fire Alarm", E: "Electrical", ES: "Electrical Site",
  T: "Technology", TS: "Technology Security", EN: "Energy",
};
export const disciplineRank = (d: string) => {
  const i = DISCIPLINE_ORDER.indexOf(d);
  return i === -1 ? DISCIPLINE_ORDER.length : i;
};
// Sheets sort NUMERICALLY within a discipline. A plain string sort puts E1000
// before E221, which reads as a renumbered set to anyone scanning the list.
export const sheetRank = (no: string) => {
  const m = SHEET_NO_RE.exec(no);
  return m ? Number(String(m[2]).replace(/[A-Z]$/, "")) : 0;
};

// Fold register rows (NEWEST-ISSUE-FIRST — call prepareRegisterRows first) into
// one entry per sheet at its most recent issuance, grouped by discipline. The
// first sighting of a sheet number wins; every later sighting is superseded.
// Do NOT re-sort by revision LABEL: the scheme changes mid-project (A/B/C, then
// 2, 3, 6, 13), so a label sort returns the superseded sheet.
export function composeCurrentSet(rows: any[]) {
  const current = new Map<string, any>();
  const unusable: any[] = [];
  const sourceSets = new Map<string, any>();
  let supersededCount = 0;

  for (const row of rows) {
    const issueDate = registerIssueDate(row);
    const setName = row?.files?.milestoneName || null;
    const transmittalNumber = row?.files?.transmittalNumber || null;
    for (const s of sheetsOf(row)) {
      const c = canonicalSheet(s);
      if (!c) {
        unusable.push({
          recordedAs: s?.sheetNo ?? null,
          filename: s?.filename ?? null,
          fromSet: setName,
          transmittalNumber,
        });
        continue;
      }
      if (current.has(c.key)) { supersededCount++; continue; }
      current.set(c.key, {
        sheetNo: c.sheetNo,
        discipline: c.discipline,
        title: String(s?.title || "").replace(/\s+/g, " ").trim() || null,
        revision: s?.revision ?? null,
        revisionDate: s?.revisionDate ?? null,
        issuedIn: setName,
        transmittalNumber,
        issueDate,
        // A backfilled row is a set reconstructed after the fact, not a live
        // send. It is still authoritative, but the difference matters to anyone
        // auditing where a sheet's current revision came from.
        backfilled: row?.files?.backfilled === true,
        folderUrl: encodeSpUrl(row?.sp_folder_url),
        // Phase 2: the file's own Graph webUrl when the register captured it
        // (new sends and backfilled rows). Null falls back to the set folder.
        webUrl: s?.webUrl ?? null,
      });
      const key = `${issueDate}|${setName ?? ""}`;
      let ss = sourceSets.get(key);
      if (!ss) {
        ss = { setName, issueDate, transmittalNumbers: new Set<string>(), currentSheets: 0 };
        sourceSets.set(key, ss);
      }
      ss.currentSheets++;
      if (transmittalNumber) ss.transmittalNumbers.add(transmittalNumber);
    }
  }

  const all = [...current.values()].sort((a, b) =>
    disciplineRank(a.discipline) - disciplineRank(b.discipline) ||
    a.discipline.localeCompare(b.discipline) ||
    sheetRank(a.sheetNo) - sheetRank(b.sheetNo) ||
    a.sheetNo.localeCompare(b.sheetNo));

  const disciplines: any[] = [];
  for (const s of all) {
    let d = disciplines[disciplines.length - 1];
    if (!d || d.discipline !== s.discipline) {
      d = {
        discipline: s.discipline,
        name: DISCIPLINE_NAME[s.discipline] || s.discipline,
        sheetCount: 0,
        sheets: [],
      };
      disciplines.push(d);
    }
    d.sheetCount++;
    // The grouping already states the discipline, so it is left off each sheet:
    // repeating it 190 times is pure response weight.
    const sheet = { ...s };
    delete sheet.discipline;
    d.sheets.push(sheet);
  }

  return {
    disciplines,
    sheetCount: all.length,
    supersededCount,
    sourceSets: [...sourceSets.values()]
      .sort((a, b) => String(b.issueDate).localeCompare(String(a.issueDate)))
      .map((s) => ({ ...s, transmittalNumbers: [...s.transmittalNumbers].sort() })),
    unusable,
  };
}

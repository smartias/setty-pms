// Tests for documentMeta.ts: how one file becomes one pms_documents row.
// Fixtures are real folder and file shapes from Tabler (SAPX196006.00) and the
// Dutchess CA project, plus the PMS's own "yyyy_mm_dd" milestone folders.
// documentMeta.ts is plain TypeScript with no Deno imports, so it is imported
// directly; the parity checks at the bottom keep its vocabulary copies in step
// with the ones find_document scores with in index.ts.
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  deriveDocumentRow, deriveDocType, deriveDiscipline, derivePhase, deriveSet, deriveArea,
  parseRecordFolder, isoDateIn, isIndexable, normaliseSitePhase, normaliseDiscipline,
  normaliseDesignPhase, linkLibraryFolder, folderUrlOf, normaliseFolderUrl,
  DOC_TYPE_WORDS, DISCIPLINE_WORDS, PHASE_PATTERNS, PHASE_ALIASES,
} from "./documentMeta.ts";

const NOW = "2026-10-02T12:00:00.000Z";
const file = (over) => ({
  itemId: "d|1", name: "x.pdf", library: "Project Document Library", folderPath: "Outgoing",
  webUrl: "https://setty.sharepoint.com/x", modified: "2026-09-09T16:44:42Z", size: 10, ext: "pdf", ...over,
});
const ctx = (over = {}) => ({ scope: "sapx196006.00", projectPrefix: "sapx196006.00", now: NOW, ...over });

test("a sheet PDF in a dated set folder gets drawing, discipline, phase, set and date", () => {
  const r = deriveDocumentRow(
    file({ name: "M501 - MECHANICAL DETAILS.pdf", folderPath: "Outgoing/2024-10-24_Revised 100% CD Submission/Drawings" }), ctx());
  assert.equal(r.doc_type, "Drawing");
  assert.equal(r.discipline, "M");
  assert.equal(r.design_phase, "CD");
  assert.equal(r.set_name, "2024-10-24_Revised 100% CD Submission");
  assert.equal(r.set_date, "2024-10-24");
  assert.equal(r.sheet_no, "M501");
  assert.equal(r.area, "Outgoing");
  assert.equal(r.derived_from.discipline, "sheet number");
});

test("the register wins: sheet number, revision, discipline code and supersession", () => {
  const r = deriveDocumentRow(
    file({ name: "STTQ-01-E_Bulletin #13.pdf", folderPath: "Outgoing/2026-04-17_Bulletin #13" }),
    ctx({ verdict: { status: "superseded", sheetNo: "E211", revision: "3", discipline: "Electrical", transmittalNumber: "T-014" } }));
  assert.equal(r.sheet_no, "E211");
  assert.equal(r.revision, "3");
  assert.equal(r.discipline, "E");
  assert.equal(r.issue_status, "superseded");
  assert.equal(r.transmittal_number, "T-014");
  assert.equal(r.design_phase, "CA");
  assert.equal(r.derived_from.discipline, "register");
});

test("an ambiguous register verdict is recorded but does not assign a sheet", () => {
  const r = deriveDocumentRow(
    file({ name: "STTQ-01-E_Bulletin #13.pdf", folderPath: "Outgoing/2026-04-17_Bulletin #13" }),
    ctx({ verdict: { status: "ambiguous" } }));
  assert.equal(r.issue_status, "ambiguous");
  assert.equal(r.sheet_no, null);
});

test("underscore milestone folders from the PMS read as dated sets", () => {
  const r = deriveDocumentRow(file({ name: "Set.pdf", folderPath: "Outgoing/2026_02_18 Bid Phase" }), ctx());
  assert.equal(r.set_date, "2026-02-18");
  assert.equal(r.design_phase, "Bid");
});

test("phase-less folders stay null instead of being dropped or guessed", () => {
  const r = deriveDocumentRow(file({ name: "Fan schedule.xlsx", ext: "xlsx", folderPath: "Design/Mechanical" }), ctx());
  assert.equal(r.design_phase, null);
  assert.equal(r.discipline, "M");
  assert.equal(r.doc_type, null);
});

test("doc type from filename, then folder; narratives and minutes", () => {
  assert.equal(deriveDocType(file({ name: "FP Basis of Design.docx", ext: "docx" }))?.value, "Narrative");
  assert.equal(deriveDocType(file({ name: "2026-05-26 Meeting Minutes.pdf", folderPath: "01 📋 Project Management" }))?.value, "Minutes");
  assert.equal(deriveDocType(file({ name: "Letter.pdf", folderPath: "Reports/Existing" }))?.value, "Report");
  assert.equal(deriveDocType(file({ name: "Random.pdf", folderPath: "Misc" })), null);
});

test("RFI and submittal files take their number and kind from the folder", () => {
  assert.deepEqual(parseRecordFolder("RFIs/0012 Duct conflict at L3/Response"), { kind: "RFI", number: "0012" });
  assert.deepEqual(parseRecordFolder("Submittals/23 05 00-1 VAV boxes"), { kind: "Submittal", number: "23" });
  assert.equal(parseRecordFolder("RFIs"), null);
  const r = deriveDocumentRow(file({ name: "response.pdf", folderPath: "RFIs/12 Duct conflict" }), ctx());
  assert.equal(r.record_kind, "RFI");
  assert.equal(r.record_number, "12");
  assert.equal(r.doc_type, "RFI");
});

test("email folders: email vs attachment, joined to the email row by folder URL", () => {
  const folder = "https://setty.sharepoint.com/sites/NYCProjects/Project Document Library/SAPX196006.00 - Tabler/Emails/2026_09_12 RE CA meeting";
  const map = new Map([[normaliseFolderUrl(folder), "rec-77"]]);
  const mail = file({ name: "email.html", ext: "html", folderPath: "Emails/2026_09_12 RE CA meeting",
    webUrl: folder.replace(/ /g, "%20") + "/email.html" });
  const att = file({ name: "scope.pdf", folderPath: "Emails/2026_09_12 RE CA meeting",
    webUrl: folder.replace(/ /g, "%20") + "/scope.pdf" });
  const a = deriveDocumentRow(mail, ctx({ emailFolders: map }));
  const b = deriveDocumentRow(att, ctx({ emailFolders: map }));
  assert.equal(a.doc_type, "Email");
  assert.equal(b.doc_type, "Email Attachment");
  assert.equal(a.email_record_id, "rec-77");
  assert.equal(b.email_record_id, "rec-77");
  assert.equal(a.design_phase, null, "a subject line saying CA is not a project phase");
  assert.equal(folderUrlOf(mail.webUrl), normaliseFolderUrl(folder));
});

test("proposal and contract library files are typed by library and carry no phase", () => {
  const p = deriveDocumentRow(file({ library: "Proposals", name: "Fee proposal CD.pdf", folderPath: "Dutchess County/Round 2" }),
    ctx({ scope: "lib:Proposals/Dutchess County", projectPrefix: "sapx176021.01", linkBasis: "name-exact" }));
  assert.equal(p.doc_type, "Proposal");
  assert.equal(p.area, "Proposals");
  assert.equal(p.design_phase, null);
  assert.equal(p.link_basis, "name-exact");
  const c = deriveDocumentRow(file({ library: "Contract Library", name: "Agreement.pdf", folderPath: "Dutchess County" }), ctx());
  assert.equal(c.doc_type, "Contract");
  assert.equal(c.area, "Contracts");
});

test("scope: images, the sidecar and OS litter are not documents", () => {
  assert.equal(isIndexable({ name: "IMG_0001.JPG", ext: "jpg" }), false);
  assert.equal(isIndexable({ name: "_pms-metadata.json", ext: "json" }), false);
  assert.equal(isIndexable({ name: "~$Narrative.docx", ext: "docx" }), false);
  assert.equal(isIndexable({ name: "Thumbs.db", ext: "db" }), false);
  assert.equal(isIndexable({ name: "Narrative.docx", ext: "docx" }), true);
});

test("vocabularies normalise whatever the apps wrote", () => {
  assert.equal(normaliseSitePhase("Demo/Abatement"), "Demo / Abatement");
  assert.equal(normaliseSitePhase("final / completed"), "Final / Completed");
  assert.equal(normaliseSitePhase("Lunch"), null);
  assert.equal(normaliseDiscipline("Fire Protection"), "FP");
  assert.equal(normaliseDiscipline("fp"), "FP");
  assert.equal(normaliseDiscipline("STTQ"), null, "a building series is not a discipline");
  assert.equal(normaliseDesignPhase("100% CD"), "CD");
  assert.equal(normaliseDesignPhase("Construction Documents"), "CD");
});

test("dates: any separator, ISO out, impossible dates rejected", () => {
  assert.equal(isoDateIn("2026_02_18 Bid Phase", true), "2026-02-18");
  assert.equal(isoDateIn("x 2026.03.26 y"), "2026-03-26");
  assert.equal(isoDateIn("2026-13-40 nonsense"), null);
  assert.deepEqual(deriveSet("Outgoing/2025-01-21_Addendum #1/Specifications"), { setName: "2025-01-21_Addendum #1", setDate: "2025-01-21" });
  assert.equal(deriveSet("Design/Mechanical"), null);
  assert.equal(derivePhase("Outgoing/2026-05-26_SD-2 Updated Option Drawings")?.phase, "SD");
});

test("areas ignore numbering and emoji", () => {
  assert.equal(deriveArea("01 📋 Project Management/Meetings", "Project Document Library"), "Project Management");
  assert.equal(deriveArea("04 🏗 Site Field Reports/2026-09-10", "Project Document Library"), "Site Reports");
  assert.equal(deriveArea("09 ✅ QAQC", "Project Document Library"), "QAQC");
});

test("library folders link to a project only on unambiguous evidence", () => {
  const projects = [
    { projectNumber: "SAPX176021.01", name: "County of Dutchess 10 Market Street CA" },
    { projectNumber: "SAPX196006.00", name: "Tabler Quad" },
    { projectNumber: "SAPX266021.00", name: "St. Nicholas of Tolentine Feasibility Study" },
  ];
  assert.deepEqual(linkLibraryFolder("SAPX196006 Tabler proposal", projects), { projectPrefix: "sapx196006.00", basis: "number-in-name" });
  assert.deepEqual(linkLibraryFolder("Tabler Quad", projects), { projectPrefix: "sapx196006.00", basis: "name-exact" });
  assert.deepEqual(linkLibraryFolder("County of Dutchess 10 Market Street CA - Proposal", projects),
    { projectPrefix: "sapx176021.01", basis: "name-exact" });
  assert.equal(linkLibraryFolder("Acme Hospital", projects), null);
  assert.equal(linkLibraryFolder("Quad", projects), null, "too short to trust");
});

test("two projects sharing a name never auto-link", () => {
  const dup = [{ projectNumber: "A1.00", name: "Library Renovation" }, { projectNumber: "B2.00", name: "Library Renovation" }];
  assert.equal(linkLibraryFolder("Library Renovation", dup), null);
});

// ── Regressions found on the first real sync (Homeport II, SAPX206004.00) ────
// Every fixture below is a real folder or file name from that project.
test("email files get area Emails, whatever their subject says", () => {
  assert.equal(deriveArea("Emails/2023_11_17 Homeport II Fuel and Sanitary Answers 11-1", "Project Document Library"), "Emails");
  assert.equal(deriveArea("Emails/2024_03_22 Fw- MEP Coordination", "Project Document Library"), "Emails");
  assert.equal(deriveArea("Emails/2026_05_11 RE- Design review of the submittal", "Project Document Library"), "Emails",
    "a subject saying design, submittal or outgoing must not change the area");
  assert.equal(deriveArea("03 Emails/2026_05_11 x", "Project Document Library"), "Emails", "numbered top folder");
  assert.equal(deriveArea("05 ⚡ Electrical Design", "Project Document Library"), "Design");
  assert.equal(deriveArea("RFIs/E/RFI-001/IN/2026-07-30 RE- Homeport II Bi-Weekly OAC Check-in", "Project Document Library"), "RFIs");
  assert.equal(deriveArea("Submittals/M/SUB-144/IN/2026-05-19 NYCEDC HomePort II", "Project Document Library"), "Submittals");
  assert.equal(deriveArea("", "Project Document Library"), "Other");
});

test("RFI and submittal records nested under a discipline letter are found", () => {
  assert.deepEqual(parseRecordFolder("RFIs/E/RFI-001/IN/2026-07-30 RE- Homeport II Bi-Weekly OAC Check-in"),
    { kind: "RFI", number: "RFI-001", discipline: "E" });
  assert.deepEqual(parseRecordFolder("Submittals/M/SUB-144/IN/2026-05-19 NYCEDC HomePort II - Submittal Update"),
    { kind: "Submittal", number: "SUB-144", discipline: "M" });
  assert.deepEqual(parseRecordFolder("Submittals/FP/SUB-098/OUT"), { kind: "Submittal", number: "SUB-098", discipline: "FP" });
  assert.equal(parseRecordFolder("Submittals/M"), null, "a discipline folder alone is not a record");
  assert.equal(parseRecordFolder("Submittals/M/Misc/loose"), null);
  const r = deriveDocumentRow(file({ name: "cut sheet.pdf", folderPath: "Submittals/M/SUB-144/IN/2026-05-19 NYCEDC" }), ctx());
  assert.equal(r.record_kind, "Submittal");
  assert.equal(r.record_number, "SUB-144");
  assert.equal(r.discipline, "M");
  assert.equal(r.derived_from.discipline, "record folder");
  assert.equal(r.area, "Submittals");
});

test("whole-discipline drawing PDFs in a drawings set folder are drawings", () => {
  const d = (name, folderPath, ext = "pdf") => deriveDocType(file({ name, folderPath, ext }));
  assert.equal(d("2025-02-07_Homeport_Marina_Electrical.pdf", "Outgoing/2025-02-18 Drawings Docusigned")?.value, "Drawing");
  assert.equal(d("SAPX206004.00_E-Homeport marina.pdf", "Outgoing/2025-04-08 Updated Sheets with bubbles")?.value, "Drawing");
  assert.equal(d("2025-12-19_Hompeport_Marina_Fueling.pdf", "Outgoing/2025-12-19 TAA comment responses")?.value, "Comment Log");
  assert.equal(d("Schedule.xlsx", "Outgoing/2025-02-18 Drawings Docusigned", "xlsx"), null, "a spreadsheet is not a drawing");
  const r = deriveDocumentRow(file({ name: "2025-02-07_Homeport_Marina_Electrical.pdf",
    folderPath: "Outgoing/2025-02-18 Drawings Docusigned" }), ctx());
  assert.equal(r.doc_type, "Drawing");
  assert.equal(r.discipline, "E");
  assert.equal(r.set_date, "2025-02-18");
});

test("a leading code that is not a discipline is not a sheet number", () => {
  const r = deriveDocumentRow(file({ name: "K-515-61-5 - Setty Responses.pdf",
    folderPath: "Outgoing/2025-11-26_SignedSealed BFP Plan and Form" }), ctx());
  assert.equal(r.sheet_no, null);
  assert.notEqual(r.doc_type, "Drawing");
  const ok = deriveDocumentRow(file({ name: "E211 - GROUND FLOOR PLAN.pdf", folderPath: "Outgoing/2026-04-17_Bulletin #13" }), ctx());
  assert.equal(ok.sheet_no, "E211");
  assert.equal(ok.doc_type, "Drawing");
});

test("an email's discipline comes from the attachment filename, never the subject line", () => {
  const folder = "Emails/2023_11_17 Homeport II Fuel and Sanitary Answers 11-1";
  const mail = deriveDocumentRow(file({ name: "email.html", ext: "html", folderPath: folder }), ctx());
  assert.equal(mail.discipline, null, "the subject says sanitary but the email is not a plumbing document");
  const att = deriveDocumentRow(file({ name: "2023-12-01_Electrical - Homeport II Upland.pdf", folderPath: "Emails/2023_12_29 x" }), ctx());
  assert.equal(att.discipline, "E");
  assert.equal(att.derived_from.discipline, "filename");
});

// ── parity with index.ts (find_document's scoring vocabulary) ───────────────
const shipped = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
const block = (src, startRe) => {
  const m = startRe.exec(src);
  assert.ok(m, "block not found: " + startRe);
  const open = src.indexOf("{", m.index + m[0].length - 1);
  let depth = 0, i = open;
  for (; i < src.length; i++) { if (src[i] === "{") depth++; else if (src[i] === "}") { depth--; if (!depth) break; } }
  return src.slice(open, i + 1).replace(/\s+/g, " ");
};
const literal = (obj) => JSON.stringify(obj);
const parse = (txt) => Function("return (" + txt + ")")();

test("DOC_TYPE_WORDS matches index.ts", () => {
  assert.deepEqual(parse(block(shipped, /const DOC_TYPE_WORDS: Record<string, string\[\]> = \{/)), DOC_TYPE_WORDS);
});
test("DISCIPLINE_WORDS matches index.ts", () => {
  assert.deepEqual(parse(block(shipped, /const DISCIPLINE_WORDS: Record<string, string\[\]> = \{/)), DISCIPLINE_WORDS);
});
test("PHASE_ALIASES matches index.ts", () => {
  assert.deepEqual(parse(block(shipped, /const PHASE_ALIASES: Record<string, string> = \{/)), PHASE_ALIASES);
});
test("PHASE_PATTERNS match index.ts", () => {
  const src = /const PHASE_PATTERNS: Array<\{ phase: string; re: RegExp \}> = \[([\s\S]*?)\n\];/.exec(shipped)[1];
  const theirs = [...src.matchAll(/phase: "(\w+)", re: (\/.*\/) \}/g)].map((m) => [m[1], m[2]]);
  const ours = PHASE_PATTERNS.map((p) => [p.phase, String(p.re)]);
  assert.deepEqual(theirs, ours);
  assert.ok(literal(theirs).length > 10);
});

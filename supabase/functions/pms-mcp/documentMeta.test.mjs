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
  normaliseDesignPhase, linkLibraryFolder, folderUrlOf, normaliseFolderUrl, disciplineFromSpecSection,
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

test("a filed email inside an RFI or submittal folder is still an Email, and still links to its email row", () => {
  const folderUrl = "https://setty.sharepoint.com/sites/NYCProjects/Project Document Library/SAPX206004.00 - Homeport II- Upland/RFIs/E/RFI-001/IN/2026-07-30 RE- Homeport II Bi-Weekly OAC Check-in";
  const map = new Map([[normaliseFolderUrl(folderUrl), "rec-9"]]);
  const folderPath = "RFIs/E/RFI-001/IN/2026-07-30 RE- Homeport II Bi-Weekly OAC Check-in";
  const mail = deriveDocumentRow(file({ name: "email.html", ext: "html", folderPath,
    webUrl: folderUrl.replace(/ /g, "%20") + "/email.html" }), ctx({ emailFolders: map }));
  assert.equal(mail.doc_type, "Email");
  assert.equal(mail.record_kind, "RFI", "it still belongs to the record");
  assert.equal(mail.record_number, "RFI-001");
  assert.equal(mail.email_record_id, "rec-9");
  const minutes = deriveDocumentRow(file({ name: "20260729 - Homeport II - OAC Meeting 060 - Minutes.pdf", folderPath,
    webUrl: folderUrl.replace(/ /g, "%20") + "/m.pdf" }), ctx({ emailFolders: map }));
  assert.equal(minutes.doc_type, "Minutes", "minutes attached to an RFI email are minutes");
  assert.equal(minutes.email_record_id, "rec-9");
  const cut = deriveDocumentRow(file({ name: "ACS - 233300-002-001 - Fire Dampers.pdf",
    folderPath: "Submittals/M/SUB-144/IN/2026-05-19 NYCEDC HomePort II" }), ctx());
  assert.equal(cut.doc_type, "Submittal", "everything else in a record folder keeps the record's type");
  const resp = deriveDocumentRow(file({ name: "SUB-098_Review.docx", ext: "docx", folderPath: "Submittals/M/SUB-098/OUT" }), ctx());
  assert.equal(resp.doc_type, "Submittal");
});

test("files outside any email folder never link to an email row", () => {
  const map = new Map([["https://x/emails/a", "rec-1"]]);
  const r = deriveDocumentRow(file({ name: "M501.pdf", folderPath: "Outgoing/2026_02_18 CD Set", webUrl: "https://x/outgoing/M501.pdf" }),
    ctx({ emailFolders: map }));
  assert.equal(r.email_record_id, null);
});

// ── Regressions found on the second real sync (CSI Kitchen, SAPX246005.00) ───
test("spec files in a discipline folder take that discipline, even when the name has no discipline word", () => {
  const spec = (name, folderPath) => deriveDocumentRow(file({ name, ext: "pdf", folderPath }), ctx());
  // Real folder shape: Outgoing/<set>/Specs/<M|P|FP|E and FA>. Names are real section titles or, for the
  // word-less cases, constructed from the same MasterFormat numbering.
  const a = spec("230517 - SLEEVES AND SLEEVE SEALS FOR HVAC PIPING.pdf", "Outgoing/2025-11-19 CD 100%/Specs/M");
  assert.equal(a.doc_type, "Spec");
  assert.equal(a.discipline, "M");
  const b = spec("230993 - Sequence of Operations.pdf", "Outgoing/2025-11-19 CD 100%/Specs/M");
  assert.equal(b.discipline, "M");
  assert.equal(b.derived_from.discipline, "spec section number");
  assert.equal(spec("211313 - Wet-Pipe Systems.pdf", "Outgoing/2025-11-19 CD 100%/Specs/FP").discipline, "FP");
  assert.equal(spec("260519 - Conductors and Cables.pdf", "Outgoing/2025-11-19 CD 100%/Specs/E and FA").discipline, "E");
  assert.equal(spec("283100 - Addressable Devices.pdf", "Outgoing/2025-11-19 CD 100%/Specs/E and FA").discipline, "FA");
  // No section number and no word: the single-code folder decides.
  const c = spec("Cover Letter.pdf", "Outgoing/2025-11-19 CD 100%/Specs/P");
  assert.equal(c.discipline, "P");
  assert.equal(c.derived_from.discipline, "folder code");
  // "E and FA" holds two disciplines, so on its own it decides nothing.
  assert.equal(spec("Cover Letter.pdf", "Outgoing/2025-11-19 CD 100%/Specs/E and FA").discipline, null);
});

test("a six-digit prefix is only a spec section on a spec, never on a dated file", () => {
  assert.equal(disciplineFromSpecSection("230517 - SLEEVES.pdf"), "M");
  assert.equal(disciplineFromSpecSection("Section 26 05 19 Conductors.pdf"), "E");
  assert.equal(disciplineFromSpecSection("02 Fire Alarm.pdf"), null);
  assert.equal(disciplineFromSpecSection("20260116_notes.pdf"), null, "an eight-digit date is not a section");
  assert.equal(disciplineFromSpecSection("2026-01-16 Dr Check.pdf"), null);
  // Real library file whose name starts with a YYMMDD date: division 26 would read as electrical.
  const r = deriveDocumentRow(file({ library: "Contract Library", name: "260310 HPCM Refrigeration WO01 Appendix A FE 26.05.pdf",
    folderPath: "/" }), ctx({ scope: "lib:Contract Library/Buro Happold" }));
  assert.equal(r.discipline, null);
  assert.equal(r.doc_type, "Contract");
});

test("project-root shortcuts and temp files are not documents", () => {
  for (const name of ["Field Photos.url", "N Drive.url", "Contracts Folder.url", "Link.lnk", "desktop.ini", "~$spec.docx", "x.tmp"]) {
    assert.equal(isIndexable({ name, ext: name.split(".").pop() }), false, name);
  }
  assert.equal(isIndexable({ name: "Narrative.docx", ext: "docx" }), true);
});

// ── Drive projects (Baltimore, DC), first synced on Tivoly EcoVillage (SIPX251008.00) ──
// Folders are named "NN-<project number>_NAME". Every path below is a real one from that project.
test("drive-style folder names read as areas, with the project number dropped", () => {
  const lib = "SAOP:";
  assert.equal(deriveArea("01-SIPX251008.00_INCOMING/2026-04-20_Houses Backgrounds", lib), "Incoming");
  assert.equal(deriveArea("02-SIPX251008.00_PM/01-SOW-Contracts-COs", lib), "Project Management");
  assert.equal(deriveArea("26-SIPX251008.00_E/02-SUPPORT", lib), "Design");
  assert.equal(deriveArea("22-SIPX251008.00_P/06-CUTSHEET", lib), "Design");
  assert.equal(deriveArea("23-SIPX251008.00_M/03-MARKUPS", lib), "Design");
  assert.equal(deriveArea("21-SIPX251008.00_FP/05-CALCULATIONS", lib), "Design");
  assert.equal(deriveArea("80-SIPX251008.00_REVIT", lib), "Models");
  assert.equal(deriveArea("90-SIPX251008.00_XREF", lib), "Models");
  assert.equal(deriveArea("99-SIPX262004.00_OUTGOING/2026-03-01 CD Set", lib), "Outgoing");
  assert.equal(deriveArea("70-SIPX262004.00_CA/8. RFIs/E/RFI-001", lib), "RFIs");
  assert.equal(deriveArea("70-SIPX262004.00_CA/9. Submittals/M/SUB-004", lib), "Submittals");
  assert.equal(deriveArea("70-SIPX262004.00_CA/Meeting Notes", lib), "CA");
});

test("a discipline folder on a drive sets the discipline", () => {
  const drive = (name, folderPath) => deriveDocumentRow(file({ library: "SAOP:", name, ext: "pdf", folderPath }), ctx());
  assert.equal(drive("Cutsheet.pdf", "26-SIPX251008.00_E/02-SUPPORT").discipline, "E");
  assert.equal(drive("Cutsheet.pdf", "22-SIPX251008.00_P/06-CUTSHEET").discipline, "P");
  assert.equal(drive("Markup.pdf", "23-SIPX251008.00_M/03-MARKUPS").discipline, "M");
  const fp = drive("Calcs.pdf", "21-SIPX251008.00_FP/05-CALCULATIONS");
  assert.equal(fp.discipline, "FP");
  assert.equal(fp.derived_from.discipline, "folder code");
  assert.equal(fp.doc_type, "Calc");
  assert.equal(drive("Rendering.pdf", "01-SIPX251008.00_INCOMING/2025-08-06_Renderings, Site Plan, CAD Files").discipline, null);
});

test("an Outgoing set on a drive still reads as a dated set", () => {
  const r = deriveDocumentRow(file({ library: "SAOP:", name: "M-101.pdf", folderPath: "99-SIPX262004.00_OUTGOING/2026-03-01 CD Set" }), ctx());
  assert.equal(r.set_name, "2026-03-01 CD Set");
  assert.equal(r.set_date, "2026-03-01");
  assert.equal(r.design_phase, "CD");
  assert.equal(r.area, "Outgoing");
});

test("drive CA folders: RFI and submittal items sit under a discipline folder", () => {
  assert.deepEqual(parseRecordFolder("70-SIPX262004.00_CA/8. RFIs/E/RFI-001/Response"), { kind: "RFI", number: "RFI-001", discipline: "E" });
  assert.deepEqual(parseRecordFolder("70-SIPX262004.00_CA/9. Submittals/M/260513-001-0 VAV boxes/IN"),
    { kind: "Submittal", number: "260513-001-0", discipline: "M" });
  assert.deepEqual(parseRecordFolder("70-SIPX262004.00_CA/8. RFIs/004_Duct sizes"), { kind: "RFI", number: "004" });
  assert.equal(parseRecordFolder("70-SIPX262004.00_CA/9. Submittals/M"), null);
});

test("the SharePoint reading is unchanged by the drive prefix rule", () => {
  assert.equal(deriveArea("01 📋 Project Management/Meetings", "Project Document Library"), "Project Management");
  assert.equal(deriveArea("Emails/2026_05_11 Design review", "Project Document Library"), "Emails");
  assert.equal(deriveArea("Misc/loose", "Project Document Library"), "Other");
});

// ── Tivoly's "RFIs" and "Submittals" were vendor cut sheets, not records ─────────
test("RFIs and Submittals are areas only where a real record folder sits", () => {
  const lib = "SAOP:";
  // Real Tivoly paths: a saved vendor web page, a manufacturer submittal package, a dated incoming drop.
  assert.equal(deriveArea("26-SIPX251008.00_E/06-CUTSHEET/BESS/Central/RFIs", lib), "Design");
  assert.equal(deriveArea("26-SIPX251008.00_E/06-CUTSHEET/BESS/Central/RFIs/Energy Storage - Chint Power Systems_files", lib), "Design");
  assert.equal(deriveArea("26-SIPX251008.00_E/06-CUTSHEET/BESS/Central/Fortress/030 Submittal Package/Datasheet", lib), "Design");
  assert.equal(deriveArea("01-SIPX251008.00_INCOMING/205-10-17 GSHP Submittals", lib), "Incoming");
  // Real records still read as records.
  assert.equal(deriveArea("RFIs/E/RFI-001/IN/2026-07-30 RE- Homeport II", "Project Document Library"), "RFIs");
  assert.equal(deriveArea("Submittals/M/SUB-144", "Project Document Library"), "Submittals");
  assert.equal(deriveArea("70-SIPX262004.00_CA/8. RFIs/E/RFI-001", lib), "RFIs");
  assert.equal(deriveArea("70-SIPX262004.00_CA/9. Submittals/M/SUB-004", lib), "Submittals");
  assert.equal(deriveArea("Submittals", "Project Document Library"), "Submittals");
});

test("a deep folder that merely says RFIs or Submittals gives no record number", () => {
  assert.equal(parseRecordFolder("26-SIPX251008.00_E/06-CUTSHEET/BESS/Central/RFIs/Energy Storage_files"), null);
  assert.equal(parseRecordFolder("26-SIPX251008.00_E/06-CUTSHEET/BESS/Central/Fortress/030 Submittal Package/Certifications"), null);
  assert.equal(parseRecordFolder("01-SIPX251008.00_INCOMING/205-10-17 GSHP Submittals"), null);
  const r = deriveDocumentRow(file({ library: "SAOP:", name: "eSpire_306_UL1973_Certificate.pdf",
    folderPath: "26-SIPX251008.00_E/06-CUTSHEET/BESS/Central/Fortress/030 Submittal Package/Certifications" }), ctx());
  assert.equal(r.record_kind, null);
  assert.notEqual(r.doc_type, "Submittal");
  assert.equal(r.area, "Design");
  assert.equal(r.discipline, "E");
});

test("a saved web page keeps its page but not its stylesheets and scripts", () => {
  const folder = "26-SIPX251008.00_E/06-CUTSHEET/BESS/Central/RFIs/Energy Storage - Chint Power Systems_files";
  assert.equal(isIndexable({ name: "all.min.css", ext: "css", folderPath: folder }), false);
  assert.equal(isIndexable({ name: "app.js", ext: "js", folderPath: folder }), false);
  assert.equal(isIndexable({ name: "Energy Storage - Chint Power Systems.htm", ext: "htm", folderPath: "26-SIPX251008.00_E/06-CUTSHEET/BESS/Central/RFIs" }), true);
  assert.equal(isIndexable({ name: "Spec Sheet.pdf", ext: "pdf", folderPath: folder }), true, "a PDF in a _files folder is still a document");
  assert.equal(isIndexable({ name: "styles.css", ext: "css", folderPath: "Outgoing/2026-01-01 Web" }), true, "only inside a _files folder");
});

test("drive spec, report and photo folders read as their own areas", () => {
  const lib = "SAOP:";
  assert.equal(deriveArea("40-SIPX262004.00_SPECS", lib), "Specs");
  assert.equal(deriveArea("40-SIPX262004.00_SPECS/Division 23", lib), "Specs");
  assert.equal(deriveArea("30-SIPX262004.00_REPORTS", lib), "Reports");
  assert.equal(deriveArea("05-SIPX262004.00_PHOTOS/01-Pictures", lib), "Photos");
  assert.equal(deriveArea("Misc/Specs", "Project Document Library"), "Other", "only a top-level folder names the area");
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

test("the sync endpoint can run libraries only, for testing them in isolation", () => {
  assert.ok(shipped.includes("body?.librariesOnly === true"));
  assert.ok(shipped.includes("librariesOnly ? [] : projects.map"));
});

test("the sync's bigger caps reach the drive walk, which has its own listing cap", () => {
  assert.ok(shipped.includes("maxListings = AZ_WALK_MAX_LISTINGS, maxFiles = TREE_MAX_FILES"));
  assert.ok(shipped.includes("azureWalkFiles(h.ctx, h.folder, h.folder, opts?.maxRequests ?? AZ_WALK_MAX_LISTINGS, maxFiles)"));
});

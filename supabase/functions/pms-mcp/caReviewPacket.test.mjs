// get_ca_review_packet: the selection and budgeting rules (caReviewPacket.ts)
// run against fake fetchers, plus anchors that the tool is registered, counted
// as a one-record tool, documented, and named first by the review skill.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildCaReviewPacket, pickFilesToRead, fileRank, clipToBudget, specSectionsIn, matchSpecs,
  caFamilyRoot, relatedItems, resolveSheets, PACKET_LIMITS, matchDefaultResponses, defaultFileSections, defaultFileWords, isSubmittalStandardsFolder,
} from "./caReviewPacket.ts";

const here = new URL("./", import.meta.url);
const F = (name, path, extra = {}) => ({ itemId: "d|" + name, name, path, size: 1000, ...extra });

test("contractor's files are read before Setty's own, PDFs before the filed email", () => {
  const files = [F("RFI-012_Response.docx", "OUT"), F("email.html", "IN/2026-11-03 RFI 12"), F("sketch.pdf", "IN/2026-11-03 RFI 12"),
    F("_pms-metadata.json", ""), F("logo.png", "IN/2026-11-03 RFI 12"), F("cut sheet.pdf", "")];
  assert.deepEqual(pickFilesToRead(files).map((f) => f.name), ["sketch.pdf", "email.html", "cut sheet.pdf", "RFI-012_Response.docx"]);
  assert.ok(fileRank(F("a.pdf", "IN")) < fileRank(F("a.pdf", "OUT")));
});

test("no more files are read than the limit allows", () => {
  const files = Array.from({ length: 20 }, (_, i) => F(`a${i}.pdf`, "IN"));
  assert.equal(pickFilesToRead(files).length, PACKET_LIMITS.filesRead);
});

test("text is clipped to the per-file cap and to what is left of the shared budget", () => {
  assert.deepEqual(clipToBudget("abc", 10, 10), { text: "abc", truncated: false });
  const c = clipToBudget("x".repeat(50), 10, 100);
  assert.equal(c.truncated, true); assert.ok(c.text.startsWith("x".repeat(10) + "\n"));
  assert.deepEqual(clipToBudget("x".repeat(50), 10, 0), { text: "", truncated: true });
});

test("spec sections: the record's own first, then the ones the text names", () => {
  assert.deepEqual(specSectionsIn({ specSection: "23 09 23" }, ["see Section 230923 and spec section 26 05 19.13"]), ["23 09 23", "26 05 19.13"]);
  assert.deepEqual(specSectionsIn({}, ["per 23 73 13, the AHU shall"]), ["23 73 13"]);
  assert.deepEqual(specSectionsIn({}, ["Section 15950 controls"]), ["15950"]);
});

test("a date or a phone-like number is not a spec section", () => {
  assert.deepEqual(specSectionsIn({}, ["received 11-24-26, due 12.01.26", "call 555 12 34 56", "sheet 2026-11-24"]), []);
});

test("register specs match exactly, or a sub-section of the wanted section", () => {
  const specs = [{ section: "23 09 23.13", title: "Controls" }, { section: "26 05 19", title: "Wire" }];
  const m = matchSpecs(["23 09 23", "26 05 19", "22 11 16"], specs);
  assert.equal(m[0].spec.title, "Controls"); assert.equal(m[1].spec.title, "Wire"); assert.equal(m[2].spec, null);
});

test("family root joins follow-ups and resubmittals", () => {
  assert.equal(caFamilyRoot("RFI-121.1"), "RFI-121"); assert.equal(caFamilyRoot("RFI-121"), "RFI-121");
  assert.equal(caFamilyRoot("23 22 16-2.0"), "23 22 16"); assert.equal(caFamilyRoot("23 22 16-1.0"), "23 22 16");
  assert.equal(caFamilyRoot("SUB-012 R1"), "SUB-012");
});

test("related: earlier rounds first, then the same spec section, then a shared sheet", () => {
  const item = { id: "a", number: "23 22 16-2.0", specSection: "23 22 16" };
  const project = {
    rfis: [{ id: "r1", number: "RFI-9", title: "pipe", status: "Closed", response: "<p>Route above</p>", sheetRefs: [{ sheet: "P-201", status: "confirmed" }] },
           { id: "r2", number: "RFI-10", title: "other", sheetRefs: [{ sheet: "M-101", status: "suggested" }] }],
    submittals: [item, { id: "b", number: "23 22 16-1.0", specSection: "23 22 16", status: "Resubmittal Required", stamp: "Revise and Resubmit", comments: "Wrong valve" },
                 { id: "c", number: "23 22 16.A-1.0", specSection: "232216", status: "Returned" }, { id: "d", number: "26 05 19-1.0", specSection: "26 05 19" }],
  };
  const rel = relatedItems(project, item, "submittal", ["P201"]);
  assert.deepEqual(rel.map((r) => r.number), ["23 22 16-1.0", "23 22 16.A-1.0", "RFI-9"]);
  assert.equal(rel[0].stamp, "Revise and Resubmit"); assert.equal(rel[0].answer, "Wrong valve"); assert.equal(rel[2].answer, "Route above");
});

test("sheets: confirmed and named sheets are matched to the current set, unknown tokens dropped", () => {
  const current = new Map([["E201", { sheetNo: "E-201", title: "Power Plan", revision: "2", revisionDate: "2026-10-01", issuedIn: "Bulletin 2", webUrl: "https://x/e201" }]]);
  const indexed = new Map([["M101", { sheetNo: "M-101", title: "HVAC Plan" }]]);
  const tokens = [{ sheet: "E201", discipline: "E", spaceSeparated: false, field: "question", snippet: "see E-201" },
                  { sheet: "M101", discipline: "M", spaceSeparated: false, field: "question", snippet: "and M-101" },
                  { sheet: "A999", discipline: "A", spaceSeparated: false, field: "question", snippet: "A-999" }];
  const r = resolveSheets([{ sheet: "E-201" }, { sheet: "P-500" }], tokens, current, indexed, "SAPX1");
  assert.deepEqual(r.sheets.map((s) => s.sheet), ["E-201", "P-500", "M-101"]);
  assert.equal(r.sheets[0].confirmedByPerson, true); assert.equal(r.sheets[0].currentRevision, "2");
  assert.deepEqual(r.sheets[0].view, { projectNumber: "SAPX1", sheet: "E-201" });
  assert.equal(r.sheets[2].inCurrentSet, false); assert.ok(r.sheets[2].view);
  assert.deepEqual(r.unresolved, ["P-500"]); assert.equal(r.sheets[1].view, undefined);
});

// ── the whole packet, with fake fetchers ────────────────────────────────────
function deps(over = {}) {
  const calls = [];
  const d = {
    markStarted: async () => { calls.push("mark"); return "2026-11-24T12:00:00Z"; },
    listFiles: async () => ({ folderUrl: "https://sp/RFIs/M/RFI-012", files: [F("sketch.pdf", "IN/2026-11-03 RFI 12"), F("email.html", "IN/2026-11-03 RFI 12"), F("photo.jpg", "IN/2026-11-03 RFI 12"), F("scan.pdf", "IN")] }),
    fileText: async (f) => { calls.push("text:" + f.name);
      if (f.name === "scan.pdf") return { totalPages: 2, pagesRead: "1-2", text: "", imageOnlyPages: [1, 2] };
      return f.name === "sketch.pdf" ? { totalPages: 1, pagesRead: "1-1", text: "Duct conflicts with beam at grid C-4, see M-101" } : { text: "From GC: please advise on RFI 12" }; },
    sourceEmail: async () => ({ recordId: "e1", subject: "RFI 12 duct at beam", body: "Refer to spec section 23 31 13" }),
    sheetTokens: (fields) => fields.flatMap(([field, text]) => [...String(text).matchAll(/\b([A-Z])-(\d{3})\b/g)].map((m) => ({ sheet: m[1] + m[2], discipline: m[1], spaceSeparated: false, field, snippet: m[0] }))),
    currentSet: async () => ({ sheets: new Map([["M101", { sheetNo: "M-101", title: "HVAC Plan", revision: "1", revisionDate: "2026-09-01", issuedIn: "IFC" }]]),
      specifications: [{ section: "23 31 13", title: "Metal Ducts", filename: "233113.pdf", webUrl: "https://sp/spec" }], label: "IFC, 2026-09-01", sheetCount: 40 }),
    indexedSheets: async () => new Map(),
    specText: async () => ({ itemId: "d|spec", totalPages: 12, pagesRead: "1-10", text: "PART 2 PRODUCTS 2.1 galvanized steel" }),
    ledger: async () => [{ id: 7, source: "internal", status: "open", title: "Duct clearance at C-4" }],
    ...over,
  };
  return { d, calls };
}
const ARGS = {
  project: { rfis: [], submittals: [] }, projectNumber: "SAPX1", type: "rfi",
  item: { id: "x", number: "RFI-012", title: "Duct at beam" }, itemView: { number: "RFI-012" },
  itemTexts: [["subject", "Duct at beam"], ["question", "Duct hits beam, how to route?"]], markStarted: true,
};

test("packet: one call gathers item, files with text, email, sheets, spec and ledger", async () => {
  const { d, calls } = deps();
  const p = await buildCaReviewPacket(d, ARGS);
  assert.equal(p.reviewStarted, "2026-11-24T12:00:00Z");
  assert.equal(p.files.length, 4);
  assert.match(p.files[0].text, /grid C-4/); assert.equal(p.files[2].note, "Image: look at it with view_drawing {itemId}.");
  assert.deepEqual(p.files[3].imageOnlyPages, [1, 2]); assert.equal(p.files[3].text, undefined);
  assert.equal(p.sourceEmail.recordId, "e1");
  assert.deepEqual(p.sheets.map((s) => s.sheet), ["M-101"]); assert.match(p.sheets[0].source, /attachment sketch\.pdf/);
  assert.equal(p.reviewedAgainstSet, "IFC, 2026-09-01");
  assert.equal(p.specs[0].section, "23 31 13"); assert.match(p.specs[0].text, /galvanized/); assert.equal(p.specs[0].itemId, "d|spec");
  assert.equal(p.qaLedger.count, 1);
  assert.ok(p.coverage.gaps.some((g) => /image-only/.test(g) && /scan\.pdf/.test(g)));
  assert.ok(!calls.includes("text:photo.jpg"), "an image is not read as text");
  assert.ok(calls.includes("mark"));
});

test("packet: markStarted false reads without writing", async () => {
  const { d, calls } = deps();
  const p = await buildCaReviewPacket(d, { ...ARGS, markStarted: false });
  assert.equal(p.reviewStarted, undefined); assert.ok(!calls.includes("mark"));
});

test("packet: a fetcher that throws becomes a coverage gap, not a failed call", async () => {
  const boom = async () => { throw new Error("Graph 503"); };
  const { d } = deps({ listFiles: boom, sourceEmail: boom, currentSet: boom, ledger: boom, markStarted: boom });
  const p = await buildCaReviewPacket(d, ARGS);
  assert.deepEqual(p.files, []); assert.equal(p.sourceEmail, undefined); assert.equal(p.reviewedAgainstSet, null);
  const gaps = p.coverage.gaps.join(" | ");
  for (const want of [/folder could not be listed: Graph 503/, /source email could not be read/, /current issued set could not be composed/, /NOT marked as under review/]) assert.match(gaps, want);
});

test("packet: says so when nothing is filed, when the spec is missing, and when no sheet is named", async () => {
  const { d } = deps({
    listFiles: async () => ({ files: [], note: "The record has no SharePoint folder." }), sourceEmail: async () => null,
    currentSet: async () => ({ sheets: new Map(), specifications: [], label: null, sheetCount: 0 }),
  });
  const p = await buildCaReviewPacket(d, { ...ARGS, type: "submittal", item: { id: "s", number: "SUB-001", specSection: "23 09 23" }, itemTexts: [["description", "VAV boxes"]] });
  const gaps = p.coverage.gaps.join(" | ");
  assert.match(gaps, /no SharePoint folder/); assert.match(gaps, /Spec section 23 09 23 is not on the issued register/);
  assert.match(gaps, /No issued set is on the transmittal register/); assert.match(gaps, /No sheet number was found on the item/);
  assert.deepEqual(p.specs, [{ section: "23 09 23", found: false }]);
});

test("packet: a submittal with no spec section on the record is flagged", async () => {
  const { d } = deps({ sourceEmail: async () => null });
  const p = await buildCaReviewPacket(d, { ...ARGS, type: "submittal", item: { id: "s", number: "SUB-002" }, itemTexts: [["description", "Pumps"]] });
  assert.ok(p.coverage.gaps.some((g) => /no spec section on the record/.test(g)));
});

test("packet: attachment text stays inside the shared budget", async () => {
  const big = "y".repeat(20000);
  const { d } = deps({ listFiles: async () => ({ files: Array.from({ length: 6 }, (_, i) => F(`a${i}.pdf`, "IN")) }), fileText: async () => ({ text: big }) });
  const p = await buildCaReviewPacket(d, ARGS);
  const total = p.files.reduce((n, f) => n + (f.text ? f.text.length : 0), 0);
  assert.ok(total <= PACKET_LIMITS.charsAllFiles + 6 * 60, "total " + total);
  assert.ok(p.files.every((f) => f.truncated));
});

// ── firm default responses ──────────────────────────────────────────────────
// The real file names in the folder (November 2026).
const DEFAULTS = ["017823 O & M Manuals - Architectural & LED Interior Lighting.docx", "017823 O & M Manuals - Disconnect Switches.docx",
  "017823 O & M Manuals - Enclosed Busway.docx", "017823 O & M Manuals - Fire Alarm System.docx", "017823 O & M Manuals - Generator.docx",
  "017823 O & M Manuals - Lighting Control Devices.docx", "017823 O & M Manuals - Panel boards.docx", "017823 O & M Manuals - Surge Protection Devices.docx",
  "017823 O & M Manuals - Switchboards Warranty.docx", "017823 O & M Manuals - Switchboards.docx", "017823 O & M Manuals - Transfer Switches.docx",
  "017823 O & M Manuals - Transformers.docx", "017823 O & M Manuals - VFDs Warranty.docx", "017823 O & M Manuals - VFDs.docx", "017823 O & M Manuals.docx",
  "142100 Elevator.docx", "213113 Fire Pump and Jockey Pump.docx", "260519 Low Voltage Electrical Power Conductors & Cables.docx", "260526 Grounding & Bonding.docx",
  "260529 Hangers & Supports.docx", "260533 Raceways and Boxes.docx", "260543 Underground Ducts and Raceways.docx", "260544 Sleeves & Sleeve Seals.docx",
  "260553 Electrical ID.docx", "260573 & 260574 Short Circuit Coordination & Arc Flash Study.docx", "262200 Transformers.docx", "262416 Panelboards.docx",
  "262726 Wiring Devices.docx", "262813 Fuses.docx", "262816 Safety Switch & Enclosed Circuit Breaker.docx", "262923 VFD.docx", "263100 PV.docx",
  "263213 Generator.docx", "263353 UPS.docx", "263600 ATS.docx", "264113 Lightning Protection for Structure.docx", "265100 & 265600 Lighting.docx",
  "273000 Two-Way Communication System.docx", "283111 Fire Alarm.docx", "Equipment Discrepancy.docx", "Misc Power Equipment.docx", "Qualifications.docx",
  "Submeter.docx", "Surge Protection Device.docx", "Switchboard.docx", "Utility CT and Transocket.docx"].map((name) => ({ name, itemId: "d|" + name, path: "Submittal Default Responses" }));
const pick = (item) => matchDefaultResponses(DEFAULTS, item).map((m) => m.file.name);

test("default response: file names give their section numbers and words", () => {
  assert.deepEqual(defaultFileSections("260573 & 260574 Short Circuit Coordination & Arc Flash Study.docx"), ["260573", "260574"]);
  assert.deepEqual(defaultFileSections("Switchboard.docx"), []);
  assert.deepEqual(defaultFileWords("017823 O & M Manuals - Transfer Switches.docx"), ["transfer", "switch"]);
});

test("default response: matched by spec section, however the record writes it", () => {
  assert.deepEqual(pick({ specSection: "26 24 16", description: "Panelboards" }), ["262416 Panelboards.docx"]);
  assert.deepEqual(pick({ specSection: "262416" }), ["262416 Panelboards.docx"]);
  assert.deepEqual(pick({ specSection: "26 05 74", description: "Arc flash study" }), ["260573 & 260574 Short Circuit Coordination & Arc Flash Study.docx"]);
  assert.deepEqual(pick({ specSection: "26 56 00.13", description: "Exterior lighting" }), ["265100 & 265600 Lighting.docx"]);
  assert.equal(matchDefaultResponses(DEFAULTS, { specSection: "28 31 11" })[0].matchedOn, "spec section 283111");
});

test("default response: several files for one section narrow by the description, with the general notes", () => {
  assert.deepEqual(pick({ specSection: "01 78 23", description: "O&M Manual - Generator" }), ["017823 O & M Manuals - Generator.docx", "017823 O & M Manuals.docx"]);
  assert.deepEqual(pick({ specSection: "01 78 23", description: "Operation and maintenance data" }), ["017823 O & M Manuals.docx"]);
  assert.deepEqual(pick({ specSection: "01 78 23", description: "O&M - Switchboards warranty" }), ["017823 O & M Manuals - Switchboards Warranty.docx", "017823 O & M Manuals.docx"]);
});

test("default response: with no file for the section, the equipment name decides", () => {
  assert.deepEqual(pick({ specSection: "26 24 13", description: "Switchboards - shop drawings" }), ["Switchboard.docx"]);
  assert.deepEqual(pick({ specSection: "26 43 13", description: "Surge protection devices" }), ["Surge Protection Device.docx"]);
  assert.deepEqual(pick({ description: "Electrical contractor qualifications" }), ["Qualifications.docx"]);
});

test("default response: nothing is guessed for a section the folder does not cover", () => {
  assert.deepEqual(pick({ specSection: "23 09 23", description: "VAV boxes and controls" }), []);
  assert.deepEqual(pick({ specSection: "22 11 16", description: "Domestic water piping" }), []);
  assert.deepEqual(pick({}), []);
  // A section number wins over a name: the generator SECTION is not the O&M file.
  assert.deepEqual(pick({ specSection: "26 32 13", description: "Generator" }), ["263213 Generator.docx"]);
});

test("packet: a submittal carries the default response; an RFI does not ask for it", async () => {
  let asked = 0;
  const lib = async () => { asked++; return { found: true, folderUrl: "https://sp/defaults", files: DEFAULTS }; };
  const { d } = deps({ defaultResponses: lib, sourceEmail: async () => null, fileText: async (f) => ({ text: f.name.startsWith("262416") ? "Approved as Noted\nProvide copper bussing (Reminder to check.)" : "cut sheet" }) });
  const sub = await buildCaReviewPacket(d, { ...ARGS, type: "submittal", item: { id: "s", number: "SUB-9", specSection: "26 24 16", description: "Panelboards" }, itemTexts: [["description", "Panelboards"]] });
  assert.equal(sub.defaultResponse.matches[0].name, "262416 Panelboards.docx");
  assert.match(sub.defaultResponse.matches[0].text, /copper bussing/);
  assert.match(sub.defaultResponse.note, /notes to the\s+reviewer|notes to the reviewer/);
  assert.ok(sub.coverage.included.includes("firm default response"));
  const rfi = await buildCaReviewPacket(d, ARGS);
  assert.equal(rfi.defaultResponse, undefined); assert.equal(asked, 1);
});

test("packet: says so when no default matches, or the folder is missing", async () => {
  const args = { ...ARGS, type: "submittal", item: { id: "s", number: "SUB-1", specSection: "23 09 23", description: "VAV" }, itemTexts: [["description", "VAV"]] };
  const a = await buildCaReviewPacket(deps({ defaultResponses: async () => ({ found: true, files: DEFAULTS }), sourceEmail: async () => null }).d, args);
  assert.ok(a.coverage.gaps.some((g) => /No firm default response matches this submittal \(spec 23 09 23\); the firm's submittal standards hold 46 file/.test(g)));
  const b = await buildCaReviewPacket(deps({ defaultResponses: async () => ({ found: false, files: [] }), sourceEmail: async () => null }).d, args);
  assert.ok(b.coverage.gaps.some((g) => /No submittal-standards folder .* was found in the templates project/.test(g)));
});

test("the standards folders are recognised by name, wherever the discipline sits", () => {
  for (const n of ["Electrical Submittal Standards", "Mechanical Submittal Standards", "Submittal Default Responses", "05 submittal standard"]) assert.equal(isSubmittalStandardsFolder(n), true, n);
  for (const n of ["Templates for MCP Connector", "Submittals", "Electrical Standards", "CAD Standards", ""]) assert.equal(isSubmittalStandardsFolder(n), false, n);
  const src = readFileSync(new URL("index.ts", here), "utf8");
  assert.match(src, /isSubmittalStandardsFolder\(it\.name\)/, "the connector finds the folders with the same rule");
});

// ── anchors ─────────────────────────────────────────────────────────────────
test("the tool is registered, counted as one record, documented and led by the skill", () => {
  const src = readFileSync(new URL("index.ts", here), "utf8");
  assert.equal(src.split('mcp.tool("get_ca_review_packet"').length - 1, 1, "registered once");
  assert.match(src, /const RECORD_TOOLS = new Set\(\["get_project", "get_ca_review_packet", "get_qa_review_packet"\]\);/);
  assert.match(src, /import \{ buildCaReviewPacket,[^}]*\} from "\.\/caReviewPacket\.ts";/);
  // Opening a file by id goes through the same gates read_document uses.
  const body = src.slice(src.indexOf("async function packetFileBytes"), src.indexOf("async function packetBytesToText"));
  assert.match(body, /azurePathProject\(/); assert.match(body, /sharePointItemVisible\(/);
  const list = src.slice(src.indexOf("async function packetListFiles"), src.indexOf('mcp.tool("get_ca_review_packet"'));
  assert.match(list, /sharePointItemVisible\(drive, root\)/, "the item folder is gated before it is listed");
  assert.match(readFileSync(new URL("README.md", here), "utf8"), /get_ca_review_packet/);
  const skill = readFileSync(new URL("../../../.claude/skills/submittal-rfi-review/SKILL.md", here), "utf8");
  assert.match(skill, /`get_ca_review_packet`/);
  assert.ok(skill.indexOf("`get_ca_review_packet`") < skill.indexOf("`read_rfi_submittal` (project + type + number)"), "the packet is named before the piecemeal reads");
});

// Pure derivation for pms_documents: turns one SharePoint/Azure file row into
// the searchable attributes stored on it. No Graph, no database, no Deno APIs,
// so it is tested directly (documentMeta.test.mjs) and imported by index.ts.
//
// Order of evidence, strongest first; `derived_from` records which one won:
//   register (transmittal) > file/folder name > library/area convention.
// The folder sidecar (_pms-metadata.json) is reserved for a later phase: it
// needs one Graph download per folder, which the nightly walk does not pay yet.
//
// The vocabulary constants below are COPIES of the ones index.ts uses for
// find_document's scoring (DOC_TYPE_WORDS, DISCIPLINE_WORDS, PHASE_PATTERNS,
// PHASE_ALIASES). documentMeta.test.mjs asserts they are textually identical,
// so a change to one fails loudly until the other follows. They collapse into a
// single definition when find_document is switched to read pms_documents.

export type DocFile = {
  itemId: string; name: string; library: string; folderPath: string;
  webUrl: string | null; modified: string | null; size: number; ext: string;
};

export const norm = (s: string) => String(s || "").toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();

// ── Vocabulary (copies, see header) ─────────────────────────────────────────
export const DOC_TYPE_WORDS: Record<string, string[]> = {
  Narrative: ["narrative", "basis of design", "bod", "opr", "owners project requirements", "design report", "criteria"],
  Calc: ["calc", "calculation", "calculations", "load", "sizing", "takeoff"],
  Spec: ["spec", "specs", "specification", "specifications", "division"],
  "Comment Log": ["comment", "comments", "drchecks", "dr checks", "response", "responses", "backcheck"],
  Transmittal: ["transmittal", "cover sheet"],
  Minutes: ["minutes", "meeting notes", "mtg", "notes"],
  Report: ["report", "survey", "study", "assessment", "scorecard"],
};
const wholeWord = (code: string) => new RegExp("(^| )" + code.toLowerCase() + "( |$)");
export const DISCIPLINE_WORDS: Record<string, string[]> = {
  M: ["mechanical", "hvac", "ductwork", "hthw"],
  E: ["electrical", "power", "lighting", "normal power"],
  P: ["plumbing", "domestic water", "sanitary"],
  FP: ["fire protection", "sprinkler", "standpipe"],
  FA: ["fire alarm"],
  T: ["technology", "telecom", "security", "av"],
  EN: ["energy", "energy analysis", "energy model"],
};
export const PHASE_PATTERNS: Array<{ phase: string; re: RegExp }> = [
  { phase: "CD", re: /(?:^|[^A-Z0-9])(?:\d{1,3}\s*%?\s*)?CD\d?(?:[^A-Z0-9]|$)/ },
  { phase: "DD", re: /(?:^|[^A-Z0-9])(?:\d{1,3}\s*%?\s*)?DD\d?(?:[^A-Z0-9]|$)/ },
  { phase: "SD", re: /(?:^|[^A-Z0-9])(?:\d{1,3}\s*%?\s*)?SD\d?(?:[^A-Z0-9]|$)/ },
  { phase: "Bid", re: /(?:^|[^A-Z0-9])BID(?:[^A-Z0-9]|$)/ },
  { phase: "CA", re: /(?:^|[^A-Z0-9])CA(?:[^A-Z0-9]|$)/ },
  { phase: "Programming", re: /(?:^|[^A-Z0-9])PROGRAMMING(?:[^A-Z0-9]|$)/ },
  { phase: "Validation", re: /(?:^|[^A-Z0-9])VALIDATION(?:[^A-Z0-9]|$)/ },
];
export const PHASE_BY_ACTIVITY: Array<{ phase: string; re: RegExp; what: string }> = [
  { phase: "Bid", re: /(?:^|[^A-Z0-9])ADDEND/, what: "addendum" },
  { phase: "CA", re: /(?:^|[^A-Z0-9])(?:BULLETIN|ASI|RFI)(?:[^A-Z0-9]|$)/, what: "bulletin/ASI/RFI" },
];
export const PHASE_ALIASES: Record<string, string> = {
  SD: "SD", SCHEMATIC: "SD", "SCHEMATIC DESIGN": "SD",
  DD: "DD", "DESIGN DEVELOPMENT": "DD",
  CD: "CD", "CONSTRUCTION DOCUMENTS": "CD", "CONSTRUCTION DOCUMENT": "CD",
  BID: "Bid", BIDDING: "Bid",
  CA: "CA", "CONSTRUCTION ADMINISTRATION": "CA",
  PROGRAMMING: "Programming", VALIDATION: "Validation",
};

export function derivePhase(text: string): { phase: string; basis: string } | null {
  const t = String(text || "").toUpperCase();
  if (!t) return null;
  for (const { phase, re } of PHASE_PATTERNS) {
    if (re.test(t)) return { phase, basis: "named in the set folder" };
  }
  for (const { phase, re, what } of PHASE_BY_ACTIVITY) {
    if (re.test(t)) return { phase, basis: `inferred from ${what}` };
  }
  return null;
}
export function normaliseDesignPhase(input: string): string | null {
  const raw = String(input || "").toUpperCase().replace(/\d{1,3}\s*%?\s*/g, "").trim();
  return PHASE_ALIASES[raw] ?? null;
}

// ── New vocabulary (not in index.ts yet) ────────────────────────────────────
// Field/photo phases as the Field Photos app lists them, in the spaced form the
// PMS gallery uses. Stored sessions carry both "Demo/Abatement" and
// "Demo / Abatement", so lookups ignore the spacing around "/".
export const SITE_PHASES = [
  "Existing Conditions", "Demo / Abatement", "Rough-In", "Construction Progress",
  "Commissioning", "Substantial Completion", "Punch List", "Final / Completed",
] as const;
const sitePhaseKey = (s: string) => String(s || "").toLowerCase().replace(/\s*\/\s*/g, "/").replace(/[\s_]+/g, " ").trim();
const SITE_PHASE_BY_KEY = new Map<string, string>(SITE_PHASES.map((p) => [sitePhaseKey(p), p]));
export function normaliseSitePhase(input: string): string | null {
  return SITE_PHASE_BY_KEY.get(sitePhaseKey(input)) ?? null;
}

// Sheet-number leading codes accepted as a discipline. Wider than
// DISCIPLINE_WORDS (which is about phrases) because drawing sets carry the
// consultants' own sheets too.
export const DISCIPLINE_CODES = ["G", "M", "MS", "P", "FP", "FA", "E", "ES", "T", "TS", "EN", "A", "S", "C", "L"];
const DISCIPLINE_FROM_NAME: Record<string, string> = {
  general: "G", mechanical: "M", "mechanical site": "MS", plumbing: "P", "fire protection": "FP",
  "fire alarm": "FA", electrical: "E", "electrical site": "ES", technology: "T",
  "technology security": "TS", energy: "EN", architectural: "A", structural: "S", civil: "C", landscape: "L",
};
// The register stores full names ("Mechanical"); drawing text and the connector
// use codes. Accept either, return the code.
export function normaliseDiscipline(input: string): string | null {
  const t = String(input || "").trim();
  if (!t) return null;
  const up = t.toUpperCase();
  if (DISCIPLINE_CODES.includes(up)) return up;
  return DISCIPLINE_FROM_NAME[t.toLowerCase()] ?? null;
}

// Canonical doc types the sync can assign. find_document's `docType` filter
// accepts any spelling of these (case, plural), nothing else.
export const DOC_TYPES = [
  "Narrative", "Calc", "Spec", "Comment Log", "Transmittal", "Minutes", "Report",
  "Drawing", "Email", "Email Attachment", "RFI", "Submittal", "Proposal", "Contract",
] as const;
const DOC_TYPE_ALIASES: Record<string, string> = {
  narratives: "Narrative", calcs: "Calc", calculation: "Calc", calculations: "Calc",
  specs: "Spec", specification: "Spec", specifications: "Spec",
  "comment logs": "Comment Log", comments: "Comment Log", transmittals: "Transmittal",
  reports: "Report", drawings: "Drawing", sheet: "Drawing", sheets: "Drawing",
  emails: "Email", "email attachments": "Email Attachment", attachment: "Email Attachment",
  rfis: "RFI", submittals: "Submittal", proposals: "Proposal", contracts: "Contract",
};
export function normaliseDocType(input: string): string | null {
  const t = String(input || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return null;
  return DOC_TYPES.find((d) => d.toLowerCase() === t) ?? DOC_TYPE_ALIASES[t] ?? null;
}

// ── Dates ───────────────────────────────────────────────────────────────────
// Same helper as index.ts: the PMS creates "yyyy_mm_dd Name" folders, older sets
// use "yyyy-mm-dd_Name". Always ISO.
export function isoDateIn(text: string, anchored = false): string | null {
  const t = String(text || "");
  const m = (anchored ? /^\s*(\d{4})[-_.](\d{2})[-_.](\d{2})/ : /(\d{4})[-_.](\d{2})[-_.](\d{2})/).exec(t);
  if (!m) return null;
  const mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

// ── Path reading ────────────────────────────────────────────────────────────
const segs = (folderPath: string) => String(folderPath || "").split("/").map((s) => s.trim()).filter(Boolean);
// Strip the "01 📋 " / "04 " numbering and emoji so areas compare by words.
// Drive projects (DC, Baltimore) name folders "NN-<project number>_NAME", e.g.
// "26-SIPX251008.00_E" or "99-SIPX251008.00_OUTGOING"; the project number is
// dropped too, so the segment reads as just "E" or "OUTGOING".
const stripPrefix = (s: string) =>
  s.replace(/^[\d.\s\-_]*[^A-Za-z0-9]*\s*/u, "").replace(/^[A-Z]{4}\d{6}(?:\.\d{2})?[_\s-]*/i, "").trim();

export function deriveArea(folderPath: string, library: string): string {
  if (/^proposal/i.test(library)) return "Proposals";
  if (/contract/i.test(library)) return "Contracts";
  // Compared per path SEGMENT. norm() keeps "/" between segments, so a boundary
  // test like "(^| )emails( |$)" on the whole path never matched "Emails/2026...":
  // on the first real sync 196 email files came out as "Other" and 26 as "Design"
  // (their subject said so).
  const parts = segs(folderPath).map((x) => norm(stripPrefix(x)));
  const top = parts[0] || "";
  if (/^emails?$/.test(top)) return "Emails";
  const any = (re: RegExp) => parts.some((x) => re.test(x));
  if (any(/outgoing/)) return "Outgoing";
  if (any(/project management/) || /^pm$/.test(top)) return "Project Management";
  // RFIs and Submittals are record folders only where the project keeps them: at
  // the top, or directly under the CA folder. The word also turns up deep inside
  // other trees (a vendor's "030 Submittal Package" in cut sheets, a saved
  // "RFIs" web page, a dated "GSHP Submittals" drop), and those are not records.
  const kindIdx = (re: RegExp) => {
    const i = parts.findIndex((x) => re.test(x));
    return i === 0 || (i === 1 && /^(ca|construction administration)$/.test(top)) ? i : -1;
  };
  if (kindIdx(/^rfis?$/) >= 0) return "RFIs";
  if (kindIdx(/^submittals?$/) >= 0) return "Submittals";
  if (any(/site field report/)) return "Site Reports";
  if (any(/qaqc|qa qc/)) return "QAQC";
  // Drive layout: 01-<num>_INCOMING, 70-<num>_CA, 80/90-<num>_REVIT/XREF, and one
  // folder per discipline (21 FP, 22 P, 23 M, 26 E) holding the design files.
  if (/^incoming$/.test(top)) return "Incoming";
  if (/^ca$/.test(top)) return "CA";
  if (/^(revit|xref)$/.test(top)) return "Models";
  if (/^specs?$|^specifications?$/.test(top)) return "Specs";
  if (/^reports?$/.test(top)) return "Reports";
  if (/^photos?$/.test(top)) return "Photos";
  if (any(/design/)) return "Design";
  if (top.length <= 2 && normaliseDiscipline(stripPrefix(segs(folderPath)[0] || ""))) return "Design";
  return "Other";
}

// "Outgoing/2025-04-10_Bulletin #1/…" -> name and date of the set.
export function deriveSet(folderPath: string): { setName: string; setDate: string | null } | null {
  const parts = segs(folderPath);
  const i = parts.findIndex((p) => p.toLowerCase().includes("outgoing"));
  if (i < 0 || !parts[i + 1]) return null;
  return { setName: parts[i + 1], setDate: isoDateIn(parts[i + 1], true) };
}

// Record folders come in two shapes in the field:
//   RFIs/<number title>/            Submittals/<number description>/   (made by the PMS)
//   RFIs/E/RFI-001/IN/<email>/…     Submittals/M/SUB-144/OUT/…         (discipline letter, then the record)
// The number is the record token ("RFI-001", "SUB-144") or, in the first shape,
// the first token of the folder name. A single discipline-code folder between the
// kind folder and the record names the discipline. Null when no number is found.
export function parseRecordFolder(
  folderPath: string,
): { kind: "RFI" | "Submittal"; number: string; discipline?: string } | null {
  const parts = segs(folderPath);
  for (let i = 0; i < parts.length - 1; i++) {
    const head = stripPrefix(parts[i]).toLowerCase();
    const kind = /^rfis?$/.test(head) ? "RFI" : /^submittals?$/.test(head) ? "Submittal" : null;
    if (!kind) continue;
    // Only a record container: at the top, or directly under the CA folder.
    // A deeper "RFIs" or "Submittals" folder is just a folder with that word.
    const underCa = i === 1 && /^(ca|construction administration)$/i.test(stripPrefix(parts[0]));
    if (i !== 0 && !underCa) return null;
    let discipline: string | undefined;
    for (let j = i + 1; j < Math.min(parts.length, i + 4); j++) {
      const seg = parts[j];
      const token = /^(?:RFI|SUB(?:MITTAL)?)[-_\s#]*\d+(?:[.\-]\d+)*/i.exec(seg);
      if (token) return { kind, number: token[0].replace(/\s+/g, ""), ...(discipline ? { discipline } : {}) };
      if (j === i + 1 || (discipline && j === i + 2)) {
        const lead = /^#?\s*([A-Za-z]{0,3}[-\s]?\d+(?:[.\-]\d+)*)/.exec(seg);
        if (lead) return { kind, number: lead[1].replace(/\s+/g, ""), ...(discipline ? { discipline } : {}) };
        const code = j === i + 1 ? normaliseDiscipline(seg) : null;
        if (code && seg.length <= 2) { discipline = code; continue; }
      }
      if (j > i + 1 && !discipline) break;
    }
    return null;
  }
  return null;
}

// Emails/<yyyy_mm_dd Subject>/… : the folder URL is what pms_project_emails
// stores as sp_folder_url, so it is the join key back to the email row.
export function isEmailFolderPath(folderPath: string): boolean {
  const parts = segs(folderPath);
  return parts.length >= 2 && /^emails?$/i.test(stripPrefix(parts[0]));
}
export function folderUrlOf(webUrl: string | null): string | null {
  if (!webUrl) return null;
  let u = String(webUrl);
  try { u = decodeURIComponent(u); } catch { /* keep the raw string */ }
  const i = u.lastIndexOf("/");
  return i > 0 ? u.slice(0, i).replace(/\/+$/, "").toLowerCase() : null;
}
export function normaliseFolderUrl(url: string | null | undefined): string {
  let u = String(url || "");
  try { u = decodeURIComponent(u); } catch { /* keep */ }
  return u.replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
}

// Same reading as index.ts leadingSheetNo(): the whole leading token must be a
// sheet number, so "STTQ-01-E_Bulletin #13.pdf" and dated names do not match.
export function leadingSheetNo(filename: string): { sheetNo: string; discipline: string } | null {
  const stem = String(filename || "").replace(/\.[a-z0-9]+$/i, "").toUpperCase().trim();
  const m = /^([A-Z]{1,3})[-_ ]?(\d{2,4}[A-Z]?)(?=[-_ .]|$)/.exec(stem);
  return m ? { sheetNo: m[1] + m[2], discipline: m[1] } : null;
}

// ── Scope rules ─────────────────────────────────────────────────────────────
const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "gif", "heic", "heif", "webp", "tif", "tiff", "bmp"]);
const NOISE_NAMES = new Set(["thumbs.db", "desktop.ini", ".ds_store", "_pms-metadata.json"]);
// Shortcuts and temp files ("Field Photos.url", "N Drive.url") sit at the root of
// every project folder; they are links to other places, not documents.
const NOISE_EXT = new Set(["url", "lnk", "ini", "tmp"]);
// Photos stay session-level (pms_field_photo_sessions), and the sidecar and OS
// litter are not documents.
// A browser's "Save page as" leaves "<page>_files/" beside the .htm, full of the
// page's stylesheets, scripts and fonts (66 of them under one vendor page on
// Tivoly). The page itself is kept; its assets are not documents.
const WEB_ASSET_EXT = new Set(["css", "js", "map", "json", "svg", "ico", "woff", "woff2", "ttf", "eot", "otf"]);
export function isIndexable(file: { name: string; ext: string; folderPath?: string }): boolean {
  const name = String(file.name || "").toLowerCase();
  if (!name || NOISE_NAMES.has(name) || name.startsWith("~$")) return false;
  const ext = String(file.ext || "").toLowerCase();
  if (IMAGE_EXT.has(ext) || NOISE_EXT.has(ext)) return false;
  if (WEB_ASSET_EXT.has(ext) && segs(file.folderPath || "").some((x) => /_files$/i.test(x))) return false;
  return true;
}

// ── Doc type and discipline ─────────────────────────────────────────────────
const EMAIL_FILE_RE = /^email\.(html?|msg|eml)$/i;
export function deriveDocType(
  file: Pick<DocFile, "name" | "folderPath" | "ext" | "library">,
  hint: { sheetNo?: string | null; record?: { kind: string } | null; email?: boolean } = {},
): { value: string; basis: string } | null {
  if (/^proposal/i.test(file.library)) return { value: "Proposal", basis: "library" };
  if (/contract/i.test(file.library)) return { value: "Contract", basis: "library" };
  if (hint.email) {
    return EMAIL_FILE_RE.test(file.name)
      ? { value: "Email", basis: "email folder" }
      : { value: "Email Attachment", basis: "email folder" };
  }
  // The filed email itself is an Email wherever it sits, including inside an RFI
  // or submittal folder (RFIs/E/RFI-001/IN/<subject>/email.html).
  if (EMAIL_FILE_RE.test(file.name)) return { value: "Email", basis: "email file" };
  const name = norm(file.name);
  const path = norm(file.folderPath);
  // A sheet PDF under Outgoing is a drawing even when its title contains a word
  // like "load" or "power" that would otherwise read as another type.
  if (hint.sheetNo && file.ext.toLowerCase() === "pdf") return { value: "Drawing", basis: "sheet number" };
  // Files inside an RFI or submittal folder belong to that record: "response.pdf"
  // there is the RFI response, not a review-comment log.
  // Meeting minutes attached to an RFI email are still minutes.
  if (hint.record) {
    if (/(^| )minutes( |$)/.test(name)) return { value: "Minutes", basis: "filename" };
    return { value: hint.record.kind, basis: "record folder" };
  }
  for (const [type, words] of Object.entries(DOC_TYPE_WORDS)) {
    if (words.some((w) => name.includes(w))) return { value: type, basis: "filename" };
  }
  // Whole-discipline PDFs ("2025-02-07_Homeport_Marina_Electrical.pdf" in
  // "Drawings Docusigned") carry no sheet number but are drawings: the set folder
  // or the name says so.
  if (DRAWING_EXT.has(file.ext.toLowerCase()) && /(^| )(drawings?|sheets?)( |$)/.test(`${name} ${path}`)) {
    return { value: "Drawing", basis: "drawing set folder or name" };
  }
  for (const [type, words] of Object.entries(DOC_TYPE_WORDS)) {
    if (words.some((w) => path.includes(w))) return { value: type, basis: "folder" };
  }
  return null;
}
const DRAWING_EXT = new Set(["pdf", "dwg", "dxf", "rvt"]);

// CSI MasterFormat divisions that map to one of the firm's disciplines. Only
// consulted for specifications: a bare six-digit prefix on any other file can
// just as well be a YYMMDD date ("260310 HPCM Refrigeration WO01.pdf").
const SPEC_DIVISION_DISCIPLINE: Record<string, string> = { "21": "FP", "22": "P", "23": "M", "26": "E", "27": "T", "28": "FA" };
export function disciplineFromSpecSection(filename: string): string | null {
  const m = /^\s*(?:section\s+)?(\d{2})[\s.]?(\d{2})[\s.]?(\d{2})(?!\d)/i.exec(String(filename || ""));
  return m ? SPEC_DIVISION_DISCIPLINE[m[1]] ?? null : null;
}
// A folder segment that IS a discipline code ("Specs/M", "Drawings/FP"). Names
// like "E and FA" hold two disciplines, so they say nothing on their own.
function disciplineFromFolderCode(folderPath: string): string | null {
  for (const seg of segs(folderPath)) {
    const t = stripPrefix(seg);
    if (t.length <= 2) {
      const code = normaliseDiscipline(t);
      if (code) return code;
    }
  }
  return null;
}

export function deriveDiscipline(
  file: Pick<DocFile, "name" | "folderPath">,
  fromRegister?: string | null,
  sheetLead?: string | null,
  recordDiscipline?: string | null,
  isSpec = false,
): { value: string; basis: string } | null {
  const reg = normaliseDiscipline(fromRegister || "");
  if (reg) return { value: reg, basis: "register" };
  const lead = normaliseDiscipline(sheetLead || "");
  if (lead) return { value: lead, basis: "sheet number" };
  const rec = normaliseDiscipline(recordDiscipline || "");
  if (rec) return { value: rec, basis: "record folder" };
  if (isSpec) {
    const sec = disciplineFromSpecSection(file.name);
    if (sec) return { value: sec, basis: "spec section number" };
  }
  const name = norm(file.name);
  const path = norm(file.folderPath);
  for (const [code, words] of Object.entries(DISCIPLINE_WORDS)) {
    if (words.some((w) => name.includes(w)) || wholeWord(code).test(name)) return { value: code, basis: "filename" };
  }
  const folderCode = disciplineFromFolderCode(file.folderPath);
  if (folderCode) return { value: folderCode, basis: "folder code" };
  for (const [code, words] of Object.entries(DISCIPLINE_WORDS)) {
    if (words.some((w) => path.includes(w))) return { value: code, basis: "folder" };
  }
  return null;
}

// ── One row ─────────────────────────────────────────────────────────────────
export type Verdict = {
  status: "current" | "superseded" | "ambiguous";
  sheetNo?: string | null; revision?: string | null; discipline?: string | null;
  transmittalNumber?: string | null;
} | null;

export type DocumentRow = {
  item_id: string; scope: string; project_prefix: string | null; link_basis: string | null;
  library: string; folder_path: string; name: string; ext: string | null;
  size_bytes: number | null; web_url: string | null; modified_at: string | null;
  area: string; doc_type: string | null; discipline: string | null;
  design_phase: string | null; site_phase: string | null;
  set_name: string | null; set_date: string | null;
  sheet_no: string | null; revision: string | null;
  record_kind: string | null; record_number: string | null; email_record_id: string | null;
  issue_status: "current" | "superseded" | "ambiguous" | "unknown"; transmittal_number: string | null;
  derived_from: Record<string, string>;
  last_seen_at: string; deleted_at: null; updated_at: string;
};

export type RowContext = {
  scope: string;
  projectPrefix: string | null;
  linkBasis?: string | null;
  now: string;
  verdict?: Verdict;
  // normalised folder URL -> pms_project_emails.record_id
  emailFolders?: Map<string, string>;
};

// Deliberately omits `overrides`, `first_seen_at` and `sidecar`: an upsert that
// does not name a column leaves it alone, which is how a human correction
// survives every nightly run.
export function deriveDocumentRow(file: DocFile, ctx: RowContext): DocumentRow {
  const from: Record<string, string> = {};
  const set = deriveSet(file.folderPath);
  const record = parseRecordFolder(file.folderPath);
  const email = isEmailFolderPath(file.folderPath);
  // A leading code only counts as a sheet when it is a real discipline code:
  // "K-515-61-5 - Setty Responses.pdf" is a response document, not sheet K515.
  const leadRaw = leadingSheetNo(file.name);
  const lead = leadRaw && DISCIPLINE_CODES.includes(leadRaw.discipline) ? leadRaw : null;
  const v = ctx.verdict && ctx.verdict.status !== "ambiguous" ? ctx.verdict : null;

  const sheetNo = v?.sheetNo || (set && lead ? lead.sheetNo : null);
  if (sheetNo) from.sheet_no = v?.sheetNo ? "register" : "filename";
  const revision = v?.revision != null && String(v.revision) !== "" ? String(v.revision) : null;
  if (revision) from.revision = "register";

  // Phase comes from the set folder, then the rest of the path (a folder like
  // "03 Design/SD" names it too). Site phase is only ever a stated value.
  // Email subjects and proposal/contract folders are free text ("Re: CA meeting"),
  // so a phase read out of them would be noise.
  const nameBased = email || /^proposal|contract/i.test(file.library);
  const ph = nameBased ? null : derivePhase(file.folderPath);
  if (ph) from.design_phase = "folder";

  const type = deriveDocType(file, { sheetNo, record, email });
  if (type) from.doc_type = type.basis;
  // An email's folder name is its subject line, so only the attachment's own
  // filename may suggest a discipline, never the subject.
  const disc = deriveDiscipline(email ? { name: file.name, folderPath: "" } : file, v?.discipline, lead?.discipline, record?.discipline, type?.value === "Spec");
  if (disc) from.discipline = disc.basis;
  if (set?.setDate) from.set_date = "folder";

  // Any file whose folder is a filed email's folder links to that email row:
  // emails are also filed under RFIs/<d>/<record>/IN/<subject>/ and similar.
  let emailRecordId: string | null = null;
  if (ctx.emailFolders) {
    const key = folderUrlOf(file.webUrl);
    emailRecordId = (key && ctx.emailFolders.get(key)) || null;
    if (emailRecordId) from.email_record_id = "email row";
  }
  if (record) from.record_number = "folder";

  const status = ctx.verdict ? ctx.verdict.status : "unknown";
  if (ctx.verdict) from.issue_status = "register";

  return {
    item_id: file.itemId,
    scope: ctx.scope,
    project_prefix: ctx.projectPrefix,
    link_basis: ctx.linkBasis ?? null,
    library: file.library,
    folder_path: file.folderPath || "/",
    name: file.name,
    ext: file.ext || null,
    size_bytes: Number.isFinite(file.size) ? file.size : null,
    web_url: file.webUrl || null,
    modified_at: file.modified || null,
    area: deriveArea(file.folderPath, file.library),
    doc_type: type?.value ?? null,
    discipline: disc?.value ?? null,
    design_phase: ph?.phase ?? null,
    site_phase: null,
    set_name: set?.setName ?? null,
    set_date: set?.setDate ?? null,
    sheet_no: sheetNo,
    revision,
    record_kind: record?.kind ?? null,
    record_number: record?.number ?? null,
    email_record_id: emailRecordId,
    issue_status: status,
    transmittal_number: v?.transmittalNumber ?? null,
    derived_from: from,
    last_seen_at: ctx.now,
    deleted_at: null,
    updated_at: ctx.now,
  };
}

// ── Name-based libraries (Proposals, Contract Library) ──────────────────────
// Their top folders are named by project or client, not number. Tie a folder to
// a project only when the evidence is unambiguous; an unlinked folder is still
// indexed (project_prefix null) and searchable by library.
const NAME_NOISE = /\b(the|of|and|inc|llc|corp|corporation|company|co|ltd|proposal|proposals|contract|contracts|agreement)\b/g;
const nameKey = (s: string) =>
  String(s || "").toLowerCase().replace(NAME_NOISE, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

export function linkLibraryFolder(
  folderName: string,
  projects: Array<{ projectNumber?: string | null; name?: string | null }>,
): { projectPrefix: string; basis: string } | null {
  const folder = String(folderName || "");
  const list = projects.filter((p) => p?.projectNumber);
  // 1. A project number written in the folder name.
  const byNumber = list.filter((p) => {
    const bare = String(p.projectNumber).replace(/\.\d+$/, "").toLowerCase();
    return bare.length >= 6 && folder.toLowerCase().includes(bare);
  });
  if (byNumber.length === 1) return { projectPrefix: String(byNumber[0].projectNumber).toLowerCase().trim(), basis: "number-in-name" };
  if (byNumber.length > 1) return null;
  // 2. The folder name IS the project name, after dropping filler words.
  const fk = nameKey(folder);
  if (!fk) return null;
  const exact = list.filter((p) => nameKey(p.name || "") === fk);
  if (exact.length === 1) return { projectPrefix: String(exact[0].projectNumber).toLowerCase().trim(), basis: "name-exact" };
  if (exact.length > 1) return null;
  // 3. Exactly one project name is contained in the folder name (or the other
  //    way round). Short names are too common to trust.
  const contains = list.filter((p) => {
    const pk = nameKey(p.name || "");
    return pk.length >= 8 && (fk.includes(pk) || (pk.includes(fk) && fk.length >= 8));
  });
  if (contains.length === 1) return { projectPrefix: String(contains[0].projectNumber).toLowerCase().trim(), basis: "name-contains" };
  return null;
}

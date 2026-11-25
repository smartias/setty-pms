// get_qa_review_packet: what a QA drawing review needs at its start, in one
// call. Before this the review spent its first twenty or so tool calls finding
// the set, the index coverage, the backgrounds, the open findings and the notes
// that hand work to others, and on a large building it ran out of budget before
// the cross-discipline pass was done.
//
// Pure assembly, like caReviewPacket.ts: every read is a dependency passed in,
// a dependency that throws becomes a line in `coverage.gaps`, and the packet
// still returns. Nothing here writes.
//
// What it does NOT do: read drawings. It tells the review where to look and
// what is missing; the checks themselves still open the sheets.

export const QA_PACKET_LIMITS = {
  sheetsListed: 400,       // above this, per-discipline counts only
  hitsPerScan: 40,
  snippetChars: 220,
  findingsListed: 60,
  backgroundFiles: 6,      // example files per other discipline
  possibleBackgrounds: 10, // received drawings no rule could classify
  schedulesListed: 80,
};

// Notes that hand work to someone else (cross-discipline check X-1b, qa-611 and
// qa-620), and notes that leave a decision open (qa-637). One regex each: the
// search function ANDs its patterns, so alternatives go inside one pattern.
export const HANDOFF_PATTERN =
  "BY\\s+(ARCHITECT|ARCH\\.|OTHERS|G\\.?\\s?C\\.?|STRUCTURAL|OWNER|CIVIL)|(REFER\\s+TO|SEE)\\s+(ARCH|STRUCT|CIVIL)|N\\.\\s?I\\.\\s?C\\.|COORDINATE\\s+WITH\\s+(THE\\s+)?(ARCHITECT|STRUCTURAL|OWNER)|FURNISHED\\s+BY";
export const DEFERRAL_PATTERN =
  "AS\\s+(ALLOWED|PERMITTED|APPROVED|DIRECTED)\\s+BY|IF\\s+(APPLICABLE|REQUIRED)|WHERE\\s+PERMITTED|EXACT\\s+LOCATION\\s+TO\\s+BE\\s+(COORDINATED|DETERMINED)|TO\\s+BE\\s+DETERMINED";

// Phase from the set name, the way the review derives it by hand.
export function phaseOfSet(name: unknown): string | null {
  // Set folders are named like "2026-10-01_Bid Set": an underscore is a word
  // character to a regex, so separators become spaces first.
  const n = String(name ?? "").toLowerCase().replace(/[_/\\-]+/g, " ").trim();
  if (!n) return null;
  if (/bulletin|\basi\b|\bccd\b|rfi\s+response/.test(n)) return "Construction";
  if (/addend/.test(n)) return "Addendum";
  if (/\bbid\b|pre-?bid|conformed/.test(n)) return "Bid";
  if (/permit|dob\s+filing/.test(n)) return "Permit";
  if (/\bcd\b|construction\s+doc/.test(n)) return "CD";
  if (/\bdd\b|design\s+dev/.test(n)) return "DD";
  if (/\bsd\b|schematic/.test(n)) return "SD";
  return null;
}

// Disciplines Setty draws. Everything else in a project folder is a background.
const OURS = new Set(["M", "E", "P", "FP", "FA", "T", "EN", "ES", "TS", "MS"]);
const BACKGROUND_NAMES: Record<string, string> = { A: "Architectural", S: "Structural", C: "Civil", L: "Landscape", G: "General / life safety" };
// A file with no discipline code is classed by its name, and only when the name
// is unambiguous; an unclassified file is left out, never guessed.
export function backgroundDiscipline(f: { discipline?: string | null; name?: string | null }): string | null {
  const d = String(f.discipline ?? "").toUpperCase().trim();
  if (d) return OURS.has(d) ? null : (BACKGROUND_NAMES[d] ? d : null);
  const n = String(f.name ?? "").toUpperCase();
  if (/\bSTRUCT|\bS-?\d{3}/.test(n)) return "S";
  if (/\bARCH|\bRCP\b|REFLECTED\s+CEILING|\bA-?\d{3}/.test(n)) return "A";
  if (/\bCIVIL\b|\bC-?\d{3}/.test(n)) return "C";
  if (/LIFE\s*SAFETY|CODE\s+ANALYSIS/.test(n)) return "G";
  return null;
}

// Architects name their sets by building or by their own job number
// ("202237-01_Rosenthal Library.pdf"), so most backgrounds carry no discipline
// in the name. On SAPX256011.00 (2026-11-25) 84 PDFs had been received and the
// name rule classified none. A received PDF that is ours, or plainly not a
// drawing, is left out; what remains is offered as a POSSIBLE background, the
// largest first, for the reviewer to open. Size is the signal: the architect's
// sets on that project were 4 to 7 MB each, a letter or a cut sheet is far
// smaller.
const NOT_A_DRAWING = /\b(MINUTES?|AGENDA|REPORT|MANUAL|O&?M|SPEC(IFICATION)?S?|RFI|SUBMITTAL|INVOICE|LETTER|MEMO|PROPOSAL|SCHEDULE OF VALUES|TRANSMITTAL|COMMENTS?|RESPONSES?|PHOTOS?|TAB|PRECON|CUT ?SHEETS?|CALC(ULATION)?S?|ESTIMATE|LOG)\b/i;
export const POSSIBLE_BACKGROUND_MIN_BYTES = 2_000_000;
export function possibleBackground(f: { discipline?: string | null; name?: string | null; size_bytes?: number | string | null }): boolean {
  const d = String(f.discipline ?? "").toUpperCase().trim();
  if (d) return false;                               // classified already: ours, or a named background
  if (backgroundDiscipline(f)) return false;
  const name = String(f.name ?? "").replace(/[_\-.]+/g, " ");
  if (NOT_A_DRAWING.test(name)) return false;
  return Number(f.size_bytes) >= POSSIBLE_BACKGROUND_MIN_BYTES;
}

export interface QaPacketDeps {
  currentSet: () => Promise<any>;                       // composeCurrentSet(...)
  indexFiles: () => Promise<any[]>;                     // pms_drawing_index_files rows
  search: (pattern: string, limit: number) => Promise<any[]>;   // pms_drawing_search hits
  schedules: () => Promise<any[]>;                      // pms_drawing_schedules rows
  backgroundFiles: () => Promise<any[]>;                // pms_documents rows received from others
  openFindings: () => Promise<any[]>;                   // pms_qa_findings, open
  reviews: () => Promise<any[]>;                        // pms_qa_reviews, newest first
  rfiHistory: () => Promise<Record<string, unknown> | null>;
  knowledge: () => Promise<Record<string, unknown> | null>;
}

export interface QaPacketArgs {
  projectNumber: string;
  projectName?: string | null;
  owner?: string | null;
  prime?: string | null;
  status?: string | null;
  set?: string | null;          // a named set folder, when the review is not on the current issued set
  limits?: typeof QA_PACKET_LIMITS;
}

const day = (v: unknown) => (v ? String(v).slice(0, 10) : null);

export async function buildQaReviewPacket(deps: QaPacketDeps, a: QaPacketArgs): Promise<Record<string, unknown>> {
  const L = a.limits ?? QA_PACKET_LIMITS;
  const gaps: string[] = [];
  const attempt = async <T>(what: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn(); }
    catch (e) { gaps.push(`${what}: ${String((e as any)?.message ?? e).slice(0, 160)}`); return fallback; }
  };

  const [cs, files, handoffs, deferrals, sched, bgRows, findings, reviews, rfiHistory, knowledge] = await Promise.all([
    attempt("current set", deps.currentSet, null as any),
    attempt("drawing index", deps.indexFiles, [] as any[]),
    // Three times the rows shown: the index holds every revision of a sheet,
    // and each sheet is reported once, at its latest revision.
    attempt("hand-off notes", () => deps.search(HANDOFF_PATTERN, L.hitsPerScan * 3), [] as any[]),
    attempt("deferred decisions", () => deps.search(DEFERRAL_PATTERN, L.hitsPerScan * 3), [] as any[]),
    attempt("schedules", deps.schedules, [] as any[]),
    attempt("backgrounds", deps.backgroundFiles, [] as any[]),
    attempt("open findings", deps.openFindings, [] as any[]),
    attempt("earlier reviews", deps.reviews, [] as any[]),
    attempt("RFI history", deps.rfiHistory, null),
    attempt("knowledge", deps.knowledge, null),
  ]);

  // ── The set ────────────────────────────────────────────────────────────────
  const disciplines = Array.isArray(cs?.disciplines) ? cs.disciplines : [];
  const sheetCount = disciplines.reduce((n: number, d: any) => n + (Array.isArray(d.sheets) ? d.sheets.length : Number(d.sheetCount) || 0), 0);
  const listSheets = sheetCount > 0 && sheetCount <= L.sheetsListed;
  const sourceSets: string[] = Array.isArray(cs?.sourceSets) ? cs.sourceSets.map((s: any) => String(s?.name ?? s)) : [];
  const setName = a.set || sourceSets[sourceSets.length - 1] || null;
  const set = {
    ...(a.set ? { named: a.set, note: "A named set: pass it as `subfolder` (search_drawings, extract_sheet_index, find_equipment) and as `set` (view_drawing, read_drawing_schedule) on EVERY drawing call." } : {}),
    phase: phaseOfSet(setName),
    phaseFrom: setName,
    sheetCount,
    ...(sourceSets.length ? { issuedIn: sourceSets.slice(-8) } : {}),
    disciplines: disciplines.map((d: any) => ({
      discipline: d.discipline, name: d.name, sheets: Array.isArray(d.sheets) ? d.sheets.length : Number(d.sheetCount) || 0,
      ...(listSheets ? { list: (d.sheets ?? []).map((s: any) => ({ sheet: s.sheetNo, title: s.title ?? null, revision: s.revision ?? null, issuedIn: s.issuedIn ?? null })) } : {}),
    })),
    ...(sheetCount === 0 ? { note: "No set is logged in the transmittal register. That is not the end of the review: list_project_documents to find the set folder under QAQC or Outgoing, then name it as `set` here and as `subfolder` on the drawing tools." } : {}),
    ...(sheetCount > L.sheetsListed ? { sheetsNotListed: `More than ${L.sheetsListed} sheets: counts only. get_current_set lists them.` } : {}),
  };

  // ── What the text checks can and cannot see ────────────────────────────────
  const inScope = (f: any) => !a.set || String(f.folder_path ?? "").toLowerCase().includes(String(a.set).toLowerCase());
  const scoped = files.filter(inScope);
  const done = scoped.filter((f: any) => f.status === "done");
  const textless = done.filter((f: any) => Number(f.pages) > 0 && Number(f.text_pages) === 0);
  const index = {
    files: scoped.length,
    indexed: done.length,
    notIndexedYet: scoped.length - done.length,
    pages: done.reduce((n: number, f: any) => n + (Number(f.pages) || 0), 0),
    ...(textless.length ? { textlessFiles: textless.slice(0, 20).map((f: any) => f.file_name), textlessNote: "Scanned or flattened PDFs: invisible to every text search. Read them with view_drawing and list them in the report as not machine-reviewed." } : {}),
    ...(scoped.length - done.length > 0 || !scoped.length
      ? { nextStep: "Index before searching: search_drawings {indexOnly: true" + (a.set ? ", subfolder" : "") + "} until coverage.currentSets.complete." } : {}),
  };

  // ── Notes worth chasing ────────────────────────────────────────────────────
  const hit = (h: any) => ({
    sheet: h.sheet_no ?? null, title: h.sheet_title ?? null, file: h.file_name ?? null, page: h.page ?? null, itemId: h.item_id ?? null,
    matches: Number(h.matches) || 1, snippet: String(h.snippet ?? "").replace(/\s+/g, " ").trim().slice(0, L.snippetChars),
  });
  const latestPerSheet = (rows: any[]) => {
    const by = new Map<string, any>();
    for (const h of rows) {
      const k = h.sheet_no ? "s:" + String(h.sheet_no).toUpperCase() : "f:" + h.item_id + "#" + h.page;
      const cur = by.get(k);
      if (!cur || String(h.revision_date ?? "") > String(cur.revision_date ?? "")) by.set(k, h);
    }
    return [...by.values()];
  };
  const scan = (raw: any[], note: string) => {
    const rows = latestPerSheet(raw).sort((x, y) => (Number(y.matches) || 0) - (Number(x.matches) || 0));
    return {
      sheets: rows.length,
      ...(raw.length >= L.hitsPerScan * 3 || rows.length > L.hitsPerScan ? { capped: true, cappedNote: "More sheets match than are shown: search_drawings for the phrase to see the rest." } : {}),
      hits: rows.slice(0, L.hitsPerScan).map(hit), note,
    };
  };

  // ── Backgrounds: the other disciplines' drawings on file ───────────────────
  const byDisc = new Map<string, any[]>();
  for (const f of bgRows) {
    const d = backgroundDiscipline(f);
    if (!d) continue;
    (byDisc.get(d) ?? byDisc.set(d, []).get(d)!).push(f);
  }
  const dated = (f: any) => day(f.set_date) || day(f.modified_at);
  const found = [...byDisc.entries()].map(([d, rows]) => {
    const sorted = rows.slice().sort((x, y) => String(dated(y) ?? "").localeCompare(String(dated(x) ?? "")));
    return {
      discipline: d, name: BACKGROUND_NAMES[d], files: rows.length, newest: dated(sorted[0]),
      examples: sorted.slice(0, L.backgroundFiles).map((f: any) => ({ itemId: f.item_id, name: f.name, folder: f.folder_path, date: dated(f) })),
    };
  }).sort((x, y) => String(x.discipline).localeCompare(String(y.discipline)));
  const notFound = ["A", "S"].filter((d) => !byDisc.has(d)).map((d) => BACKGROUND_NAMES[d]);
  // The same file name is often filed under several emails, and a re-sent set
  // can keep its name: one line per name, and that line is the NEWEST copy
  // (larger on a tie), so the reviewer opens the current set, not the first one
  // received. Only then are the names ordered largest first.
  const newestByName = new Map<string, any>();
  for (const f of bgRows.filter(possibleBackground)) {
    const k = String(f.name ?? "").toLowerCase();
    const cur = newestByName.get(k);
    const order = cur ? String(dated(f) ?? "").localeCompare(String(dated(cur) ?? "")) : 1;
    if (order > 0 || (order === 0 && (Number(f.size_bytes) || 0) > (Number(cur.size_bytes) || 0))) newestByName.set(k, f);
  }
  const possible = [...newestByName.values()]
    .sort((x: any, y: any) => (Number(y.size_bytes) || 0) - (Number(x.size_bytes) || 0));
  const backgrounds = {
    found,
    ...(possible.length ? {
      possible: possible.slice(0, L.possibleBackgrounds).map((f: any) => ({
        itemId: f.item_id, name: f.name, folder: f.folder_path, date: dated(f), megabytes: Math.round((Number(f.size_bytes) || 0) / 1e5) / 10,
      })),
      ...(possible.length > L.possibleBackgrounds ? { possibleNotShown: possible.length - L.possibleBackgrounds } : {}),
      possibleNote: "Large PDFs received from others whose names do not say what they are (architects name sets by building or by their own job number). Any of them may be the architectural or structural set: open the first page of each (view_drawing with the itemId) before deciding a background is missing.",
    } : {}),
    ...(notFound.length ? { notFound, notFoundNote: possible.length
      ? "Not found BY NAME. That is not the same as missing: check `possible` first. Only when none of those is the set, ask the PM for it: a cross-discipline check is never marked clean without the other discipline's sheet."
      : "Nothing on file by name or folder, and no large unclassified PDF has been received. Look once with list_project_documents (Email and Incoming) before reporting it missing, then ask the PM for the current set: a cross-discipline check is never marked clean without the other discipline's sheet." } : {}),
    note: "Found by file name and folder only, with the file's date. Compare each date with the issue date of the set under review: older means stale. Index the current ones (search_drawings {subfolder, indexOnly: true}) so the cross-discipline pass can search them.",
  };

  // ── Carry-over ─────────────────────────────────────────────────────────────
  const bySource: Record<string, number> = {};
  for (const f of findings) bySource[f.source || "qa"] = (bySource[f.source || "qa"] || 0) + 1;
  const carryOver = {
    open: findings.length, bySource,
    keyItems: findings.filter((f: any) => f.key_item).length,
    findings: findings.slice(0, L.findingsListed).map((f: any) => ({
      id: f.id, source: f.source, severity: f.severity ?? null, title: String(f.title ?? "").slice(0, 160),
      sheets: f.sheets ?? null, discipline: f.discipline ?? null, since: day(f.created_at), ...(f.key_item ? { keyItem: true } : {}),
    })),
    ...(findings.length > L.findingsListed ? { moreNotShown: findings.length - L.findingsListed, nextStep: "list_qa_findings has the rest." } : {}),
    earlierReviews: reviews.slice(0, 8).map((r: any) => ({ id: r.id, set: r.set_name, phase: r.phase, kind: r.kind, on: day(r.run_at) })),
    note: "Back-check each of these against this set before the passes start: fixed, still open, or cannot tell.",
  };

  const schedules = {
    cached: sched.length,
    sheets: [...new Set(sched.map((s: any) => s.sheet_no).filter(Boolean))].slice(0, L.schedulesListed),
    note: "Sheets whose schedules have already been read and cached (fast to read again). A sheet not listed may still carry a schedule nobody has read: read_drawing_schedule on each M, P and E schedule sheet.",
  };

  return {
    project: { projectNumber: a.projectNumber, name: a.projectName ?? null, owner: a.owner ?? null, status: a.status ?? null,
      settyRole: /setty/i.test(String(a.prime ?? "")) ? "prime" : "MEPFP consultant" + (a.prime ? ` to ${a.prime}` : "") },
    set, index,
    handOffNotes: scan(handoffs, "Sheets whose text hands work to another party (by architect, by others, see structural, N.I.C., furnished by). Each is a hand-off to find in the other discipline's documents (qa-611) and a who-provides question to settle (qa-620). The snippet is the first match on the sheet; open the sheet for the rest."),
    deferredDecisions: scan(deferrals, "Sheets whose text leaves a decision open (as allowed by, if applicable, exact location to be coordinated). Each either states the answer elsewhere or is a finding (qa-637)."),
    schedules, backgrounds, carryOver,
    ...(rfiHistory ? { rfiHistory } : {}),
    ...(knowledge ? { knowledge } : {}),
    coverage: {
      gaps,
      note: "This packet finds things; it does not read the drawings. The checklist (get_qa_checklist), the cross-discipline pass and the engineering review still open the sheets. Text scans cover indexed sheets with a text layer only.",
    },
  };
}

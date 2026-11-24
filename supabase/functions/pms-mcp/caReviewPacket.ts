// caReviewPacket.ts — everything a reviewer needs for ONE RFI or submittal,
// assembled in a single tool call (get_ca_review_packet).
//
// Why: telemetry over 37 Claude reviews showed a median of about 20 calls per
// item, half of them the hunt for material — listing the item's folder level
// by level, reading each attachment, finding the source email, working out
// which sheets and which spec section apply. This module does that hunt once.
//
// It is pure: index.ts injects the fetchers (Graph, Supabase, the PDF reader),
// so the selection and budgeting rules below are tested without a network
// (caReviewPacket.test.mjs). Every part is fail-soft: a fetcher that throws
// becomes a line in `coverage.gaps`, never a failed call. A packet that
// silently lacks the governing spec would be worse than no packet, so what is
// missing is always said.

export type CaKind = "rfi" | "submittal";

export interface PacketFile {
  itemId: string;          // read_document / view_drawing / download_document id
  name: string;
  path: string;            // folder path inside the item folder, e.g. "IN/2026-11-03 RFI 12"
  size?: number | null;
  modified?: string | null;
  webUrl?: string | null;
  ext?: string;
}

export interface FileText {
  totalPages?: number;
  pagesRead?: string;       // "1-12" or "3, 7"
  text?: string;
  truncated?: boolean;
  imageOnlyPages?: number[]; // pages with no text layer: look at them with view_drawing
  note?: string;
  error?: string;
}

export const PACKET_LIMITS = {
  filesListed: 60,
  filesRead: 6,
  charsPerFile: 9000,
  charsAllFiles: 36000,
  pagesPerFile: 12,
  specChars: 12000,
  sheets: 12,
  related: 8,
  ledgerRows: 10,
};

const TEXT_EXTS = new Set(["pdf", "html", "htm", "txt", "md", "csv", "docx", "json", "xml"]);
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "tif", "tiff", "webp", "heic"]);

export function extOfName(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || ""));
  return m ? m[1].toLowerCase() : "";
}

// The add-in drops a sidecar beside what it files; it is bookkeeping, not evidence.
function isBookkeeping(f: PacketFile): boolean {
  return /^_pms-metadata\.json$/i.test(f.name) || /^thumbs\.db$/i.test(f.name) || /^~\$/.test(f.name);
}

// Lower rank = read first. What the contractor sent (IN) outranks what Setty
// sent back (OUT); a PDF outranks the filed copy of the email; small inline
// images (signature logos) come last and are never read as text.
export function fileRank(f: PacketFile): number {
  const p = ("/" + String(f.path || "") + "/").toLowerCase();
  const ext = f.ext || extOfName(f.name);
  let r = 50;
  if (/\/in\//.test(p)) r = 10;
  else if (/\/out\//.test(p)) r = 70;
  if (ext === "pdf") r += 0;
  else if (ext === "docx") r += 2;
  else if (ext === "html" || ext === "htm") r += 4;
  else if (TEXT_EXTS.has(ext)) r += 6;
  else r += 20;
  return r;
}

// Which files get their text pulled into the packet, in order, within the caps.
export function pickFilesToRead(files: PacketFile[], limits = PACKET_LIMITS): PacketFile[] {
  return files
    .filter((f) => !isBookkeeping(f) && TEXT_EXTS.has(f.ext || extOfName(f.name)))
    .map((f, i) => ({ f, i, r: fileRank(f) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limits.filesRead)
    .map((x) => x.f);
}

// Clip one file's text to its own cap and to what is left of the shared budget.
export function clipToBudget(text: string, perFile: number, remaining: number): { text: string; truncated: boolean } {
  const cap = Math.max(0, Math.min(perFile, remaining));
  const t = String(text || "");
  if (t.length <= cap) return { text: t, truncated: false };
  return { text: cap > 0 ? t.slice(0, cap) + "\n…[truncated: read_document for the rest]" : "", truncated: true };
}

// ── Spec sections ────────────────────────────────────────────────────────────
// CSI MasterFormat as people write it: "23 09 23", "230923", "23 09 23.13",
// and the five-digit 1995 form "15950" when it follows the word Section.
const SPEC_SPACED_RE = /\b(\d{2})[ .\-](\d{2})[ .\-](\d{2})(?:\.(\d{2}))?\b/g;
const SPEC_SOLID_RE = /\b(?:spec(?:ification)?(?:\s+section)?|section)\s*#?\s*(\d{6})(?:\.(\d{2}))?\b/gi;
const SPEC_OLD_RE = /\b(?:spec(?:ification)?(?:\s+section)?|section)\s*#?\s*(\d{5})\b/gi;

export function specKeyOf(section: string): string {
  return String(section || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}

// Sections named by the item: its own specSection field first, then any the
// text mentions. Returned as display strings ("23 09 23"), de-duplicated.
export function specSectionsIn(item: any, texts: string[] = []): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (s: string) => { const k = specKeyOf(s); if (k.length >= 5 && !seen.has(k)) { seen.add(k); out.push(s); } };
  const own = String(item?.specSection || "").trim();
  if (own) add(own);
  for (const raw of texts) {
    const t = String(raw || "");
    let m: RegExpExecArray | null;
    SPEC_SPACED_RE.lastIndex = 0;
    while ((m = SPEC_SPACED_RE.exec(t))) {
      const div = +m[1];
      // Divisions that exist; this also drops most dates (2026-11-24 has a
      // four-digit year and never matches; 11-24-26 would, so require a
      // facility-services or common division and a separator that is a space
      // unless the word Section/Spec sits just before it).
      const before = t.slice(Math.max(0, m.index - 24), m.index).toLowerCase();
      const named = /(spec|section|div)[^a-z]*$/.test(before);
      const spaced = /^\d{2} \d{2} \d{2}/.test(m[0]);
      if (!named && !spaced) continue;
      // Part of a longer run of digit groups (a phone number, a part number).
      if (!named && (/\d[ .\-]$/.test(t.slice(Math.max(0, m.index - 2), m.index)) || /^[ .\-]\d/.test(t.slice(m.index + m[0].length, m.index + m[0].length + 2)))) continue;
      if (div > 48) continue;
      add(`${m[1]} ${m[2]} ${m[3]}${m[4] ? "." + m[4] : ""}`);
    }
    SPEC_SOLID_RE.lastIndex = 0;
    while ((m = SPEC_SOLID_RE.exec(t))) add(`${m[1].slice(0, 2)} ${m[1].slice(2, 4)} ${m[1].slice(4, 6)}${m[2] ? "." + m[2] : ""}`);
    SPEC_OLD_RE.lastIndex = 0;
    while ((m = SPEC_OLD_RE.exec(t))) add(m[1]);
  }
  return out.slice(0, 6);
}

// Match wanted sections to the register's current specifications. A wanted
// "23 09 23" also accepts "23 09 23.13" (a sub-section of it) and the reverse.
export function matchSpecs(wanted: string[], specifications: any[]): Array<{ wanted: string; spec: any | null }> {
  const specs = Array.isArray(specifications) ? specifications : [];
  return wanted.map((w) => {
    const k = specKeyOf(w);
    const exact = specs.find((s) => specKeyOf(s?.section) === k);
    const near = exact || specs.find((s) => { const sk = specKeyOf(s?.section); return sk.length >= 6 && k.length >= 6 && (sk.startsWith(k) || k.startsWith(sk)); });
    return { wanted: w, spec: near || null };
  });
}

// ── Firm default responses ───────────────────────────────────────────────────
// The "Submittal Default Responses" folder in the templates project holds the
// firm's standing review notes, one Word file per spec section, named with the
// section number ("262416 Panelboards.docx", "260573 & 260574 Short Circuit
// ….docx") or, where no single section applies, with the equipment
// ("Switchboard.docx"). A submittal is matched by section number first; when
// several files share the number (the O&M manual set), by the words of the
// file name that the submittal's own text contains; and only when no number
// matches, by equipment name alone.
const DEFAULT_NAME_STOP = new Set(["and", "for", "the", "with", "system", "systems", "docx", "doc", "manual", "manuals"]);
// Plural-insensitive: "devices" and "device", "switches" and "switch".
const stem = (w: string) => { const x = w.toLowerCase(); return /(?:ch|sh|x|ss)es$/.test(x) ? x.slice(0, -2) : x.replace(/s$/, ""); };

export function defaultFileSections(name: string): string[] {
  // Section numbers lead the name; a later number is a model or a date.
  const head = String(name || "").split(/[A-Za-z]{3,}/)[0] || "";
  return [...head.matchAll(/(?<!\d)(\d{6})(?!\d)/g)].map((m) => m[1]);
}
export function defaultFileWords(name: string): string[] {
  const base = String(name || "").replace(/\.[A-Za-z0-9]+$/, "");
  return [...new Set((base.match(/[A-Za-z]{3,}/g) || []).map(stem).filter((w) => !DEFAULT_NAME_STOP.has(w)))];
}

export function matchDefaultResponses<T extends { name: string }>(files: T[], item: any, max = 3): Array<{ file: T; matchedOn: string }> {
  const list = (Array.isArray(files) ? files : []).filter((f) => f && /\.docx?$/i.test(f.name));
  const text = [item?.title, item?.description, item?.fullDescription, item?.specSection].map((x) => String(x || "").replace(/<[^>]+>/g, " ")).join(" ");
  const have = new Set((text.match(/[A-Za-z]{3,}/g) || []).map(stem));
  const overlap = (f: T) => { const w = defaultFileWords(f.name); return { w, hit: w.filter((x) => have.has(x)).length }; };
  const want = specKeyOf(item?.specSection || "").slice(0, 6);
  if (/^\d{6}$/.test(want)) {
    const same = list.filter((f) => defaultFileSections(f.name).includes(want));
    if (same.length === 1) return [{ file: same[0], matchedOn: "spec section " + want }];
    if (same.length > 1) {
      // Several files for one section: the ones whose names the submittal's
      // text speaks to, else the general one (the shortest name).
      const scored = same.map((f) => ({ f, ...overlap(f) })).sort((a, b) => b.hit - a.hit || a.f.name.length - b.f.name.length);
      const best = scored.filter((x) => x.hit > 0 && x.hit === scored[0].hit);
      const general = [...same].sort((a, b) => a.name.length - b.name.length)[0];
      const picked = best.length ? best.map((x) => x.f) : [general];
      if (best.length && !picked.includes(general)) picked.push(general);
      return picked.slice(0, max).map((f) => ({ file: f, matchedOn: "spec section " + want + (f === general && best.length ? " (general notes)" : best.length ? " and the description" : " (general notes)") }));
    }
  }
  // No file carries the section number: a file named for the equipment, when
  // every word of its name appears in the submittal's own text.
  return list.filter((f) => !defaultFileSections(f.name).length)
    .map((f) => ({ f, ...overlap(f) })).filter((x) => x.w.length > 0 && x.hit === x.w.length)
    .sort((a, b) => b.hit - a.hit).slice(0, max)
    .map((x) => ({ file: x.f, matchedOn: "equipment name" }));
}

export const DEFAULT_RESPONSE_NOTE =
  "The firm's standing review notes for this kind of submittal: a starting point, not the review. Keep only the " +
  "lines that apply to what was actually submitted, and check each against the cut sheet and the spec. Text in " +
  "parentheses such as \"(Reminder to check.)\" and scope tags such as \"(Base Building)\" are notes to the " +
  "reviewer: act on them, never send them to the contractor. The stamp named in the file is the usual outcome, " +
  "not a decision: the stamp follows from what you find.";

// ── Related items ────────────────────────────────────────────────────────────
// "121.1" follows "121"; "23 22 16-2.0" resubmits "23 22 16-1.0". The family
// root is the number with a trailing revision part removed.
export function caFamilyRoot(number: unknown): string {
  const n = String(number || "").trim().toUpperCase();
  const m = /^(.*?\d)(?:[.\-_ ]R?\d{1,2}(?:\.\d)?)$/.exec(n);
  return (m ? m[1] : n).replace(/\s+/g, " ");
}

export function relatedItems(project: any, item: any, type: CaKind, sheetKeys: string[] = [], limits = PACKET_LIMITS): any[] {
  const out: Array<{ row: any; score: number }> = [];
  const root = caFamilyRoot(item?.number);
  const spec = specKeyOf(item?.specSection || "");
  const sheets = new Set(sheetKeys);
  const visit = (x: any, kind: CaKind) => {
    if (!x || x === item || (x.id && x.id === item?.id)) return;
    let why = "";
    let score = 0;
    if (kind === type && root && caFamilyRoot(x.number) === root && String(x.number) !== String(item?.number)) { why = kind === "rfi" ? "follow-up / earlier round of this RFI" : "earlier or later submission of this submittal"; score = 100; }
    else if (kind === "submittal" && type === "submittal" && spec && specKeyOf(x.specSection || "") === spec) { why = "same spec section"; score = 60; }
    else if (sheets.size) {
      const refs = (Array.isArray(x.sheetRefs) ? x.sheetRefs : []).filter((r: any) => r && r.status === "confirmed").map((r: any) => String(r.sheet || "").toUpperCase().replace(/[^A-Z0-9]/g, ""));
      const hit = refs.find((r: string) => sheets.has(r));
      if (hit) { why = "refers to the same sheet (" + hit + ")"; score = 40; }
    }
    if (!why) return;
    const answer = String(x.response || x.comments || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    out.push({
      score,
      row: {
        type: kind, number: x.number, subject: x.title || String(x.description || "").slice(0, 100) || null,
        status: x.status || null, ...(x.stamp && x.stamp !== "—" ? { stamp: x.stamp } : {}),
        closed: x.dateResponded || x.dateReturned || null, why,
        ...(answer ? { answer: answer.slice(0, 400) + (answer.length > 400 ? "…" : "") } : {}),
      },
    });
  };
  for (const r of (project?.rfis ?? [])) visit(r, "rfi");
  for (const s of (project?.submittals ?? [])) visit(s, "submittal");
  return out.sort((a, b) => b.score - a.score || String(b.row.closed || "").localeCompare(String(a.row.closed || ""))).slice(0, limits.related).map((x) => x.row);
}

// ── Sheets ───────────────────────────────────────────────────────────────────
export interface SheetToken { sheet: string; discipline: string; spaceSeparated: boolean; field: string; snippet: string }

// Merge the sheets a person confirmed on the item with the ones its text
// names, keep those the current set or the drawing index knows, and attach the
// current revision. `current` maps a canonical key ("E201") to the register's
// current entry; `indexed` to a drawing-index row {page, itemId, title, …}.
export function resolveSheets(
  confirmed: Array<{ sheet: string; discipline?: string }>,
  tokens: SheetToken[],
  current: Map<string, any>,
  indexed: Map<string, any>,
  project: string,
  limits = PACKET_LIMITS,
): { sheets: any[]; unresolved: string[] } {
  const keyOf = (s: string) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const rows = new Map<string, any>();
  const unresolved: string[] = [];
  const put = (key: string, display: string, source: string, snippet?: string, field?: string) => {
    const cur = current.get(key);
    const idx = indexed.get(key);
    if (!cur && !idx) { if (source === "confirmed" && !unresolved.includes(display)) unresolved.push(display); else if (source !== "confirmed") return; }
    const have = rows.get(key);
    if (have) { if (source === "confirmed") have.confirmedByPerson = true; return; }
    rows.set(key, {
      sheet: (cur && cur.sheetNo) || (idx && idx.sheetNo) || display,
      ...(cur?.title || idx?.title ? { title: cur?.title || idx?.title } : {}),
      source: source === "confirmed" ? "confirmed on the item" : "named in the " + (field || "text"),
      ...(source === "confirmed" ? { confirmedByPerson: true } : {}),
      ...(snippet ? { snippet } : {}),
      ...(cur ? { currentRevision: cur.revision ?? null, revisionDate: cur.revisionDate ?? null, issuedIn: cur.issuedIn ?? null } : {}),
      ...(cur?.webUrl || idx?.webUrl ? { webUrl: cur?.webUrl || idx?.webUrl } : {}),
      inCurrentSet: !!cur,
      // Ready-made arguments: paste into view_drawing to see the sheet.
      ...(cur || idx ? { view: { projectNumber: project, sheet: (cur && cur.sheetNo) || (idx && idx.sheetNo) || display } } : {}),
    });
  };
  for (const c of confirmed) put(keyOf(c.sheet), String(c.sheet), "confirmed");
  for (const t of tokens) put(keyOf(t.sheet), t.sheet, "text", t.snippet, t.field);
  const all = [...rows.values()];
  return { sheets: all.slice(0, limits.sheets), unresolved };
}

// ── Assembly ─────────────────────────────────────────────────────────────────
export interface PacketDeps {
  // Mark the item "Claude is reviewing" (mark_ca_review_started). Resolves to
  // the timestamp, or throws with the reason.
  markStarted?: () => Promise<string>;
  // Every file in the item's folder, all levels, with read ids.
  listFiles: () => Promise<{ files: PacketFile[]; folderUrl?: string | null; note?: string; truncated?: boolean }>;
  // Extracted text of one listed file (no OCR: image-only pages are reported).
  fileText: (f: PacketFile, o: { maxPages: number }) => Promise<FileText>;
  // The email the item was logged from, if the record names one.
  sourceEmail: () => Promise<any | null>;
  // Sheet tokens found in the given texts (index.ts: sheetTokensInText).
  sheetTokens: (fields: Array<[string, string]>) => SheetToken[];
  // Current issued set: keyed sheets, specifications, and a one-line label.
  currentSet: () => Promise<{ sheets: Map<string, any>; specifications: any[]; label: string | null; sheetCount: number }>;
  // Drawing-index rows for these canonical sheet keys.
  indexedSheets: (keys: string[]) => Promise<Map<string, any>>;
  // Text of one spec section from the register's file for it.
  specText: (spec: any, wanted: string) => Promise<FileText & { itemId?: string }>;
  // QA-ledger rows on these sheets.
  ledger: (sheets: string[]) => Promise<any[]>;
  // Files in the firm's "Submittal Default Responses" folder (submittals only).
  // `found` false when the folder is not in the templates project.
  defaultResponses?: () => Promise<{ found: boolean; folderUrl?: string | null; files: PacketFile[] }>;
}

export interface PacketArgs {
  project: any;            // full project blob
  projectNumber: string;
  type: CaKind;
  item: any;
  itemView: Record<string, unknown>;   // the read_rfi_submittal fields
  itemTexts: Array<[string, string]>;  // [field, plain text]
  markStarted: boolean;
  limits?: typeof PACKET_LIMITS;
}

const msg = (e: unknown) => String((e as any)?.message ?? e).slice(0, 200);

export async function buildCaReviewPacket(deps: PacketDeps, a: PacketArgs): Promise<Record<string, unknown>> {
  const L = a.limits ?? PACKET_LIMITS;
  const gaps: string[] = [];
  const included: string[] = ["item record"];
  const isRFI = a.type === "rfi";

  // Independent fetches run together; each is caught on its own.
  const [started, listed, email, set] = await Promise.all([
    a.markStarted && deps.markStarted
      ? deps.markStarted().then((at) => ({ at }), (e) => ({ error: msg(e) }))
      : Promise.resolve(null),
    deps.listFiles().then((r) => r, (e) => ({ files: [] as PacketFile[], error: msg(e) } as any)),
    deps.sourceEmail().then((r) => r, (e) => ({ error: msg(e) })),
    deps.currentSet().then((r) => r, (e) => ({ error: msg(e) } as any)),
  ]);

  // ── Files, and the text of the ones worth reading ──
  const allFiles: PacketFile[] = (listed.files || []).map((f: PacketFile) => ({ ...f, ext: f.ext || extOfName(f.name) }));
  const files = allFiles.slice(0, L.filesListed);
  const toRead = pickFilesToRead(files, L);
  const texts = new Map<string, FileText>();
  // Two at a time: enough to cut the wait, few enough that two attachments
  // and their parsed copies fit in the worker's memory.
  for (let i = 0; i < toRead.length; i += 2) {
    const batch = toRead.slice(i, i + 2);
    const got = await Promise.all(batch.map((f) => deps.fileText(f, { maxPages: L.pagesPerFile }).then((r) => r, (e) => ({ error: msg(e) } as FileText))));
    batch.forEach((f, j) => texts.set(f.itemId, got[j]));
  }
  let budget = L.charsAllFiles;
  const fileRows = files.map((f) => {
    const t = texts.get(f.itemId);
    const row: Record<string, unknown> = {
      name: f.name, path: f.path || "", itemId: f.itemId,
      ...(f.size != null ? { size: f.size } : {}), ...(f.modified ? { modified: f.modified } : {}), ...(f.webUrl ? { webUrl: f.webUrl } : {}),
    };
    if (!t) {
      const ext = f.ext || "";
      if (IMAGE_EXTS.has(ext)) row.note = "Image: look at it with view_drawing {itemId}.";
      else if (!isBookkeeping(f) && TEXT_EXTS.has(ext)) row.note = "Not read into this packet (file limit reached): read_document {itemId}.";
      return row;
    }
    if (t.error) { row.error = t.error; return row; }
    const clip = clipToBudget(t.text || "", L.charsPerFile, budget);
    budget -= clip.text.length;
    if (t.totalPages != null) row.totalPages = t.totalPages;
    if (t.pagesRead) row.pagesRead = t.pagesRead;
    if (t.imageOnlyPages && t.imageOnlyPages.length) {
      row.imageOnlyPages = t.imageOnlyPages.slice(0, 20);
      row.imageNote = "These pages have no text layer (scan, sketch or screenshot). Look at them with view_drawing {itemId, page}; read_document can OCR them.";
    }
    if (t.note) row.note = t.note;
    if (clip.text) row.text = clip.text;
    if (clip.truncated || t.truncated) row.truncated = true;
    return row;
  });
  if (listed.error) gaps.push("The item's folder could not be listed: " + listed.error);
  else if (!files.length) gaps.push(listed.note || "No files are filed for this item, so there is no cut sheet, sketch or form to read. Ask where the contractor's attachments are before reviewing.");
  else included.push(`${files.length} filed file(s), ${[...texts.values()].filter((t) => t && !t.error && (t.text || "").length).length} with text`);
  if (allFiles.length > files.length || listed.truncated) gaps.push(`The folder holds more files than the ${L.filesListed} listed here; list_project_documents shows the rest.`);
  const unreadable = fileRows.filter((r) => Array.isArray(r.imageOnlyPages) && !r.text);
  if (unreadable.length) gaps.push(`${unreadable.length} file(s) are image-only (no text layer): ${unreadable.map((r) => r.name).slice(0, 4).join(", ")}. View them before relying on what they show.`);

  // ── Source email ──
  let sourceEmail: any = null;
  if (email && (email as any).error) gaps.push("The source email could not be read: " + (email as any).error);
  else if (email) { sourceEmail = email; included.push("source email"); }

  // ── Sheets ──
  const confirmed = (Array.isArray(a.item?.sheetRefs) ? a.item.sheetRefs : []).filter((x: any) => x && x.status === "confirmed" && x.sheet);
  const fileFields: Array<[string, string]> = fileRows.filter((r) => typeof r.text === "string").slice(0, 3).map((r) => ["attachment " + r.name, String(r.text).slice(0, 6000)]);
  const emailField: Array<[string, string]> = sourceEmail?.body ? [["source email", String(sourceEmail.body)]] : [];
  let tokens: SheetToken[] = [];
  try { tokens = deps.sheetTokens([...a.itemTexts, ...emailField, ...fileFields]); } catch (e) { gaps.push("Sheet references could not be detected: " + msg(e)); }
  const keyOf = (s: string) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const wantedKeys = [...new Set([...confirmed.map((c: any) => keyOf(c.sheet)), ...tokens.map((t) => keyOf(t.sheet))])].slice(0, 40);
  const current: Map<string, any> = set && !(set as any).error ? (set as any).sheets : new Map();
  let indexed = new Map<string, any>();
  if (wantedKeys.length) {
    try { indexed = await deps.indexedSheets(wantedKeys); } catch (e) { gaps.push("The drawing index could not be read: " + msg(e)); }
  }
  const resolved = resolveSheets(confirmed, tokens, current, indexed, a.projectNumber, L);
  if ((set as any)?.error) gaps.push("The current issued set could not be composed: " + (set as any).error);
  else if (!(set as any)?.sheetCount) gaps.push("No issued set is on the transmittal register for this project, so sheets could not be matched to a current revision. Say which drawings you reviewed against.");
  if (resolved.unresolved.length) gaps.push(`Confirmed on the item but in neither the current set nor the drawing index: ${resolved.unresolved.join(", ")}.`);
  if (!resolved.sheets.length) gaps.push(isRFI
    ? "No sheet number was found in the question, the email or the attachments. Work out which sheets the question is about (search_drawings, find_equipment) before answering."
    : "No sheet number was found on the item. Find the schedule sheet for this equipment with find_equipment / read_drawing_schedule.");
  else included.push(`${resolved.sheets.length} sheet(s) matched to the set`);

  // ── Spec ──
  const specTextSources = [...a.itemTexts.map(([, t]) => t), ...(sourceEmail?.subject ? [String(sourceEmail.subject)] : []), ...(sourceEmail?.body ? [String(sourceEmail.body).slice(0, 5000)] : [])];
  const wantedSpecs = specSectionsIn(a.item, specTextSources);
  const specifications: any[] = set && !(set as any).error ? ((set as any).specifications || []) : [];
  const specRows: any[] = [];
  let specBudget = L.specChars;
  for (const m of matchSpecs(wantedSpecs, specifications).slice(0, 2)) {
    if (!m.spec) { specRows.push({ section: m.wanted, found: false }); continue; }
    const row: Record<string, unknown> = {
      section: m.spec.section, found: true, title: m.spec.title ?? null, revision: m.spec.revision ?? null, revisionDate: m.spec.revisionDate ?? null,
      issuedIn: m.spec.issuedIn ?? null, filename: m.spec.filename ?? null, ...(m.spec.webUrl ? { webUrl: m.spec.webUrl } : {}),
    };
    try {
      const t = await deps.specText(m.spec, m.wanted);
      if (t.itemId) row.itemId = t.itemId;
      if (t.error) row.textError = t.error;
      else {
        const clip = clipToBudget(t.text || "", specBudget, specBudget);
        specBudget -= clip.text.length;
        if (t.totalPages != null) row.totalPages = t.totalPages;
        if (t.pagesRead) row.pagesRead = t.pagesRead;
        if (t.note) row.note = t.note;
        if (clip.text) row.text = clip.text;
        if (clip.truncated || t.truncated) row.truncated = true;
      }
    } catch (e) { row.textError = msg(e); }
    specRows.push(row);
  }
  const missingSpecs = specRows.filter((r) => !r.found).map((r) => r.section);
  const specNoText = specRows.filter((r) => r.found && !r.text);
  if (!wantedSpecs.length) {
    if (!isRFI) gaps.push("The submittal has no spec section on the record, so the governing spec was not looked up. Find it (find_document docType Spec, or the cut sheet's cover) and say which section you reviewed against.");
  } else {
    if (missingSpecs.length) gaps.push(`Spec section ${missingSpecs.join(", ")} is not on the issued register${specifications.length ? "" : " (the register lists no specifications for this project)"}. The review is against the drawings only unless you find the spec (find_document docType Spec).`);
    if (specNoText.length) gaps.push(`Spec section ${specNoText.map((r) => r.section).join(", ")} is on the register but its text was not read here${specNoText[0].textError ? " (" + specNoText[0].textError + ")" : ""}: open it with read_document.`);
    if (specRows.some((r) => r.text)) included.push("governing spec text");
  }

  // ── Firm default response for this spec section (submittals) ──
  let defaultResponse: any = null;
  if (!isRFI && deps.defaultResponses) {
    try {
      const lib = await deps.defaultResponses();
      if (!lib.found) gaps.push("The firm's \"Submittal Default Responses\" folder was not found in the templates project, so no standing review notes were looked up.");
      else {
        const hits = matchDefaultResponses(lib.files, a.item);
        if (!hits.length) {
          gaps.push(`No firm default response matches this submittal${a.item?.specSection ? " (spec " + a.item.specSection + ")" : ""}; the folder holds ${lib.files.length} file(s). Review from the spec and drawings alone.`);
        } else {
          const rows: any[] = [];
          for (const h of hits) {
            const row: Record<string, unknown> = { name: h.file.name, matchedOn: h.matchedOn, itemId: h.file.itemId, ...(h.file.webUrl ? { webUrl: h.file.webUrl } : {}) };
            try {
              const t = await deps.fileText(h.file, { maxPages: 6 });
              if (t.error) row.error = t.error;
              else { const clip = clipToBudget(t.text || "", 5000, 5000); row.text = clip.text; if (clip.truncated) row.truncated = true; }
            } catch (e) { row.error = msg(e); }
            rows.push(row);
          }
          defaultResponse = { matches: rows, note: DEFAULT_RESPONSE_NOTE, ...(lib.folderUrl ? { folderUrl: lib.folderUrl } : {}) };
          if (rows.some((r) => r.text)) included.push("firm default response");
        }
      }
    } catch (e) { gaps.push("The firm default responses could not be read: " + msg(e)); }
  }

  // ── QA ledger on the sheets, and related items ──
  let qaLedger: any = null;
  const ledgerSheets = resolved.sheets.map((s) => String(s.sheet));
  if (ledgerSheets.length) {
    try {
      const rows = await deps.ledger(ledgerSheets);
      if (rows.length) { qaLedger = { count: rows.length, rows: rows.slice(0, L.ledgerRows) }; included.push("QA ledger rows on those sheets"); }
    } catch (e) { gaps.push("The QA ledger could not be read: " + msg(e)); }
  }
  const related = relatedItems(a.project, a.item, a.type, resolved.sheets.map((s) => keyOf(String(s.sheet))), L);
  if (related.length) included.push(`${related.length} related item(s)`);

  if (started && (started as any).error) gaps.push("The item was NOT marked as under review: " + (started as any).error);

  return {
    packetFor: `${isRFI ? "RFI" : "Submittal"} ${a.item?.number ?? ""}`.trim(),
    project: a.projectNumber,
    ...(started && (started as any).at ? { reviewStarted: (started as any).at } : {}),
    item: a.itemView,
    ...(sourceEmail ? { sourceEmail } : {}),
    ...(listed.folderUrl ? { folderUrl: listed.folderUrl } : {}),
    files: fileRows,
    sheets: resolved.sheets,
    reviewedAgainstSet: (set as any)?.label ?? null,
    specs: specRows,
    ...(defaultResponse ? { defaultResponse } : {}),
    ...(qaLedger ? { qaLedger } : {}),
    ...(related.length ? { related } : {}),
    coverage: { included, gaps },
    nextSteps: [
      "Look at the sheets with view_drawing (each sheet row carries ready `view` arguments) and at image-only attachment pages with view_drawing {itemId, page}. Nothing here replaces looking at the drawing.",
      isRFI ? "Check related items first: a follow-up or neighbouring RFI may already have settled the question."
            : "Reconcile the submitted model, size and options against the schedule (read_drawing_schedule) and the spec text above." + (defaultResponse ? " Start the suggested response from defaultResponse, keeping only the lines that apply." : ""),
      "Carry every line of coverage.gaps into the review's coverage note, then finish with save_ca_review (reviewedAgainstSet above).",
    ],
  };
}

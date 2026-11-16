// Finding the QA ledger rows that concern a given sheet or piece of equipment.
//
// The ledger (pms_qa_findings) holds internal review findings AND external
// reviewer comments (owner, agency, architect, DrChecks) with the responses
// Setty gave. Its sheet references are free text written by a review
// ("M601 Rev 11", "E-211 Rev 6 (Bulletin #13)") and equipment tags appear only
// inside the title/evidence/action prose, so there is no column to join on.
// This module is the join: it reduces a sheet reference to a comparable key
// and matches tags hyphen/space-tolerantly and word-bounded (EF-7 never
// matches EF-70). Pure, so the tests import it directly.

export interface LedgerQuery { sheets?: string[]; mentions?: string[] }
export interface LedgerMatch { sheets: string[]; mentions: string[] }

/** "M-601 Rev 3" / "m601" / "M 601 (Bulletin #2)" → "m601". "" when the text does not start with a sheet number. */
export function sheetKey(ref: unknown): string {
  const m = /^\s*([A-Za-z]{1,3})\s?[-.]?\s?(\d{1,4}(?:\.\d{1,2})?[A-Za-z]?)/.exec(String(ref ?? ""));
  if (!m) return "";
  // "E101.00" is how "E-101" is numbered on a DOB filing, not another sheet.
  return (m[1] + m[2].replace(/\.0+$/, "")).toLowerCase();
}

const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One regex per term; parts split on hyphen/space match with a hyphen, a space, or nothing between them. */
export function mentionRegex(term: string): RegExp | null {
  const parts = String(term ?? "").trim().split(/[-\s]+/).filter(Boolean).map(esc);
  if (!parts.length || parts.join("").length < 2) return null;
  return new RegExp(`(?<![A-Za-z0-9])${parts.join("[-\\s]?")}(?![A-Za-z0-9])`, "i");
}

/** A sheet named in prose: "see E-610", "E610 Rev 2". Letters and digits from the key, any of hyphen/space/dot between. */
function sheetProseRegex(key: string): RegExp | null {
  const m = /^([a-z]{1,3})(\d.*)$/.exec(key);
  if (!m) return null;
  return new RegExp(`(?<![A-Za-z0-9])${esc(m[1])}\\s?[-.]?\\s?${esc(m[2])}(?![A-Za-z0-9.]*\\d)`, "i");
}

/** A tag as stored on a row: upper case, single hyphen between parts ("ef 7" → "EF-7"). */
export function normalizeTag(tag: unknown): string {
  return String(tag ?? "").trim().toUpperCase().split(/[-\s]+/).filter(Boolean).join("-").slice(0, 40);
}
const tagKey = (tag: unknown) => normalizeTag(tag).replace(/-/g, "");

export interface RefMatcher {
  active: boolean;
  /** citedSheets: sheet references recorded on the record. citedTags: equipment tags recorded on it. prose: its free text. */
  matchParts: (citedSheets: unknown[], citedTags: unknown[], prose: string) => LedgerMatch | null;
  match: (row: any) => LedgerMatch | null;
}

export function buildLedgerMatcher(q: LedgerQuery): RefMatcher {
  const sheetKeys = [...new Set((q.sheets ?? []).map(sheetKey).filter(Boolean))];
  const sheetRes = sheetKeys.map((k) => ({ key: k, re: sheetProseRegex(k) }));
  const mentions = [...new Set((q.mentions ?? []).map((t) => String(t ?? "").trim()).filter(Boolean))]
    .map((term) => ({ term, key: tagKey(term), re: mentionRegex(term) }))
    .filter((x) => x.re);
  const active = sheetKeys.length > 0 || mentions.length > 0;
  const matchParts = (citedSheets: unknown[], citedTags: unknown[], prose: string): LedgerMatch | null => {
    if (!active) return null;
    const cited = new Set((Array.isArray(citedSheets) ? citedSheets : []).map(sheetKey).filter(Boolean));
    const tags = new Set((Array.isArray(citedTags) ? citedTags : []).map(tagKey).filter(Boolean));
    const hitSheets = sheetRes.filter((s) => cited.has(s.key) || (s.re ? s.re.test(prose) : false)).map((s) => s.key.toUpperCase());
    const hitMentions = mentions.filter((m) => tags.has(m.key) || m.re!.test(prose)).map((m) => m.term);
    return hitSheets.length || hitMentions.length ? { sheets: hitSheets, mentions: hitMentions } : null;
  };
  return {
    active, matchParts,
    match(row: any): LedgerMatch | null {
      const prose = [row?.title, row?.evidence, row?.action, row?.response, row?.status_note].filter(Boolean).join("\n");
      return matchParts(row?.sheets, row?.tags, prose);
    },
  };
}

// ── Cached schedules: the rows that name a tag ───────────────────────────────
export interface ScheduleTable { title: string; columns: number; rows: string[][]; truncatedRows?: number }

/**
 * From one sheet's parsed schedules, the rows that name the tag. Header rows
 * ride along so the values can be read: every row above the first row that
 * looks like data (a row whose first cells carry a hyphenated tag), capped at
 * three. A schedule with no matching row is left out.
 */
export function scheduleRowsForTag(tables: ScheduleTable[], tag: string): Array<{ title: string; header: string[][]; rows: string[][] }> {
  const re = mentionRegex(tag);
  if (!re) return [];
  const looksLikeData = (r: string[]) => r.slice(0, 2).some((c) => /^[A-Za-z]{1,5}[-\s]?\d/.test(String(c || "").trim()));
  const out: Array<{ title: string; header: string[][]; rows: string[][] }> = [];
  for (const t of Array.isArray(tables) ? tables : []) {
    const rows = Array.isArray(t?.rows) ? t.rows : [];
    const hit = rows.filter((r) => Array.isArray(r) && r.some((c) => re.test(String(c ?? ""))));
    if (!hit.length) continue;
    const firstData = rows.findIndex(looksLikeData);
    const header = rows.slice(0, Math.min(firstData < 0 ? 1 : Math.max(firstData, 1), 3));
    out.push({ title: String(t.title || ""), header, rows: hit.slice(0, 12) });
  }
  return out;
}

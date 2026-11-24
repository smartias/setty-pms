// Matching a free-text query against knowledge-layer rows: lessons, best
// practices, engineering standards and agency preferences.
//
// These tools matched only when the WHOLE query appeared, word for word and in
// order, inside one field. "A2L electric resistance heat" returned nothing
// while three lessons carry all four words, and 71 to 83% of queries to these
// tools came back empty in the 30 days to 2026-11-24 (search_knowledge 58 of
// 82, search_engineering_standards 27 of 35, search_agency_preferences 13 of
// 16). Of 18 of those empty queries checked against the tables, 10 had rows
// carrying every word.
//
// Now a row matches when every meaningful word of the query appears somewhere
// in its searched fields, at the start of a word ("duct" finds "ducts" and
// "ductwork", not "product"). Rows carrying the query as a phrase come first.
// When no row carries every word, closeByQuery gives the rows that carry at
// least half, with what matched and what did not: returned apart from the
// results, to weigh, not as the answer.
//
// Pure; see knowledgeQuery.test.mjs.

const STOPWORDS = new Set([
  "a", "an", "the", "of", "for", "and", "or", "to", "in", "on", "at", "by", "with", "from",
  "is", "are", "be", "do", "does", "we", "our", "what", "how", "when", "which", "should",
]);

export function queryTerms(query: unknown): string[] {
  const all = String(query ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const kept = all.filter((t) => !STOPWORDS.has(t) && (t.length > 1 || /\d/.test(t)));
  // A query of nothing but stopwords ("what do we do") still has to mean something.
  return [...new Set(kept.length ? kept : all)];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// At the start of a word, and a plural asked for finds the singular.
export function termInText(text: string, term: string): boolean {
  const forms = term.length > 3 && term.endsWith("s") ? [term, term.slice(0, -1)] : [term];
  return forms.some((f) => new RegExp("(^|[^a-z0-9])" + escapeRe(f)).test(text));
}

export type QueryMatch = { phrase: boolean; matched: string[]; missing: string[] };

export function matchQuery(fields: unknown[], query: unknown): QueryMatch {
  const text = fields.filter((v) => v !== null && v !== undefined && v !== "").map((v) => String(v)).join(" \n ").toLowerCase();
  const q = String(query ?? "").toLowerCase().trim();
  const terms = queryTerms(q);
  const matched: string[] = [], missing: string[] = [];
  for (const t of terms) (termInText(text, t) ? matched : missing).push(t);
  return { phrase: !!q && text.includes(q), matched, missing };
}

// Rows carrying every word of the query; those carrying it as a phrase first,
// otherwise in the order given. No query returns the rows unchanged.
export function rankByQuery<T>(rows: T[], fieldsOf: (row: T) => unknown[], query: unknown): T[] {
  if (!String(query ?? "").trim()) return rows;
  const hits = rows.map((row) => ({ row, m: matchQuery(fieldsOf(row), query) }))
    .filter((r) => r.m.phrase || (r.m.matched.length > 0 && r.m.missing.length === 0));
  return [...hits.filter((r) => r.m.phrase), ...hits.filter((r) => !r.m.phrase)].map((r) => r.row);
}

export const CLOSE_QUERY_MAX = 8;
// Rows carrying at least half the words (two-word queries and up), most words
// first. Only meaningful when rankByQuery found nothing.
export function closeByQuery<T>(
  rows: T[], fieldsOf: (row: T) => unknown[], query: unknown, max = CLOSE_QUERY_MAX,
): Array<{ row: T; matchedTerms: string[]; missingTerms: string[] }> {
  const terms = queryTerms(query);
  if (terms.length < 2) return [];
  const need = Math.ceil(terms.length / 2);
  return rows.map((row) => ({ row, m: matchQuery(fieldsOf(row), query) }))
    .filter((r) => r.m.matched.length >= need && r.m.missing.length > 0)
    .sort((a, b) => b.m.matched.length - a.m.matched.length)
    .slice(0, max)
    .map((r) => ({ row: r.row, matchedTerms: r.m.matched, missingTerms: r.m.missing }));
}

export const CLOSE_QUERY_NOTE =
  "No entry carries every word of the query. These carry SOME of the words (see missingTerms): read them as " +
  "possibly related, not as the firm's answer to the question asked.";

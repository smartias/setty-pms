// search_projects: matching a description against the portfolio.
//
// People describe a job ("the feasibility study with SCA for Morphosis"); they
// do not recite its record. Three layers, each added because the one before it
// answered "nothing" for a job that exists:
//
//   1. PRIMARY fields: name, number, status, agency, prime, client, type,
//      city, state, category, contract numbers. A term may land anywhere in
//      them (substring), and an agency acronym matches the spelled-out agency.
//   2. SECONDARY fields (2026-11-24): site address, project manager, related
//      group, the drive folder the record was created from, the project
//      directory (companies and people) and the team. Most records fill few
//      primary fields (owner on 124 of 613, city on 79), so "Gilbane" matched
//      nothing while Gilbane sat in nine projects' directories. A term matches
//      here at the START of a word only, and the answer says where it matched.
//   3. CLOSE matches: when no project carries every term, the projects that
//      carry at least half of them, with what matched and what did not. They
//      are returned apart from `projects`, to confirm with the user, never as
//      the answer: one wrong word used to return nothing at all (40% of
//      searches in the 30 days to 2026-11-24).
//
// The drive folders with no PMS record (pms_project_candidates) are matched by
// matchDriveCandidates: a fifth of the searches that found nothing named a job
// that has a folder on the office drive and has not been set up in the PMS.

export const SEARCH_STOPWORDS = new Set([
  "a", "an", "the", "with", "for", "of", "on", "at", "in", "and", "to", "by",
  "project", "job", "study", "our",
]);

// Agencies are written in full on the record but spoken as acronyms. Mapping is
// one-way on purpose: typing "SCA" should find "School Construction Authority",
// and the full name still matches itself by ordinary term overlap.
export const AGENCY_ALIASES: Record<string, string> = {
  sca: "school construction authority",
  ddc: "department of design and construction",
  dasny: "dormitory authority",
  cuny: "city university",
  suny: "state university",
  sucf: "state university construction fund",
  ogs: "office of general services",
  edc: "economic development corporation",
  dep: "department of environmental protection",
  dot: "department of transportation",
  nycha: "housing authority",
  hpd: "housing preservation development",
};

export function searchTerms(raw: unknown): string[] {
  return String(raw ?? "").toLowerCase().trim()
    .split(/[^a-z0-9.#&-]+/)
    .filter((t) => t && t.length > 1 && !SEARCH_STOPWORDS.has(t));
}

export function projectHaystack(p: any): string {
  return [
    p.name, p.projectNumber, p.status, p.owner, p.prime, p.clientName,
    p.projectType, p.projectCity, p.projectState, p.buildingCategory,
    p.contractNumber, p.primeProjectNumber,
  ].filter(Boolean).join(" ").toLowerCase();
}

export type SearchExtra = { label: string; text: string };

// The secondary fields of one project record, as lowercased text per source.
// Built once when the portfolio is loaded; the directory itself is not kept.
export function projectSearchExtras(r: any): SearchExtra[] {
  const out: SearchExtra[] = [];
  const add = (label: string, ...parts: unknown[]) => {
    const text = parts.filter((x) => typeof x === "string" && x.trim()).join(" ").toLowerCase();
    if (text) out.push({ label, text });
  };
  const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);
  add("site address", r?.projectAddress);
  add("project manager", r?.projectManager, r?.deputyProjectManager);
  add("related group", r?.relatedGroup);
  add("drive folder", r?.drivePath);
  add("project directory", ...list(r?.directory).flatMap((d) => [d?.company, d?.name]));
  add("team", ...list(r?.teamMembers).map((m) => m?.name));
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A term at the start of a word: "gilbane" finds "Gilbane Building Co", and
// "tx" does not find "textile".
export function wordStartMatch(text: string, term: string): boolean {
  return new RegExp("(^|[^a-z0-9])" + escapeRe(term)).test(text);
}

export type ProjectMatch = {
  matched: string[];
  missing: string[];
  primaryHits: number;
  // term → where it matched, for the terms found outside the primary fields.
  matchedOn: Record<string, string>;
};

export function matchProject(p: any, terms: string[]): ProjectMatch {
  const hay = projectHaystack(p);
  const extras: SearchExtra[] = Array.isArray(p?.searchExtras) ? p.searchExtras : [];
  const m: ProjectMatch = { matched: [], missing: [], primaryHits: 0, matchedOn: {} };
  for (const t of terms) {
    const alias = AGENCY_ALIASES[t];
    if (hay.includes(t) || (alias && hay.includes(alias))) { m.matched.push(t); m.primaryHits++; continue; }
    const where = extras.find((e) => wordStartMatch(e.text, t));
    if (where) { m.matched.push(t); m.matchedOn[t] = where.label; } else m.missing.push(t);
  }
  return m;
}

export const CLOSE_MATCH_MAX = 5;

export type ProjectSearchResult = {
  // Every term matched. Best first: more terms in the primary fields, then name.
  full: Array<{ project: any; match: ProjectMatch }>;
  // Only when `full` is empty and there are at least two terms.
  close: Array<{ project: any; match: ProjectMatch }>;
  closeTotal: number;
};

export function searchProjectPool(pool: any[], terms: string[]): ProjectSearchResult {
  if (!terms.length) {
    return { full: pool.map((project) => ({ project, match: { matched: [], missing: [], primaryHits: 0, matchedOn: {} } })), close: [], closeTotal: 0 };
  }
  const all = pool.map((project) => ({ project, match: matchProject(project, terms) }));
  const byName = (a: any, b: any) => String(a.project.name).localeCompare(String(b.project.name));
  const full = all.filter((r) => r.match.missing.length === 0)
    .sort((a, b) => b.match.primaryHits - a.match.primaryHits || byName(a, b));
  if (full.length || terms.length < 2) return { full, close: [], closeTotal: 0 };
  // At least half the terms, and at least one of them in the primary fields:
  // a project that only shares a directory entry with the query is not close.
  const need = Math.ceil(terms.length / 2);
  const close = all.filter((r) => r.match.matched.length >= need && r.match.primaryHits >= 1)
    .sort((a, b) => b.match.matched.length - a.match.matched.length || b.match.primaryHits - a.match.primaryHits || byName(a, b));
  return { full: [], close: close.slice(0, CLOSE_MATCH_MAX), closeTotal: close.length };
}

// ── Drive folders with no PMS record ─────────────────────────────────────────
// Rows of pms_project_candidates with status 'new'. A folder matches when it
// carries the project number in the query, or every term at the start of a
// word of its number or names.
export const DRIVE_CANDIDATE_MAX = 5;
export function matchDriveCandidates(rows: any[], terms: string[], numberToken: string | null): any[] {
  if (!terms.length && !numberToken) return [];
  const num = (numberToken || "").toLowerCase();
  const hits = (Array.isArray(rows) ? rows : []).filter((r) => {
    const number = String(r?.project_number || "").toLowerCase();
    if (num && number.includes(num)) return true;
    const text = [r?.project_number, r?.name_from_folder, r?.folder_name].filter(Boolean).join(" ").toLowerCase();
    return terms.length > 0 && terms.every((t) => wordStartMatch(text, t) || number.includes(t));
  });
  return hits.slice(0, DRIVE_CANDIDATE_MAX).map((r) => ({
    projectNumber: r.project_number, folderName: r.name_from_folder || r.folder_name || null,
    ...(r.team ? { team: r.team } : {}), ...(r.year ? { year: r.year } : {}),
  }));
}

// find_document's read side of pms_documents: building the PostgREST query,
// deciding whether the table is fresh enough to trust, and shaping a row back
// into the file object the existing scorer ranks. Pure (no fetch, no Deno), so
// documentSearch.test.mjs covers it directly; the I/O stays in index.ts.
//
// Ranking is NOT done here. index.ts still scores candidates with
// scoreDocument() exactly as before; this module only narrows the candidate set
// in SQL (hard filters on stored attributes, plus a token prefilter that is a
// strict superset of what the scorer could match) and maps rows.

// Past this age the table is treated as stale and the live walk answers instead.
// The sync rotates through every scope roughly daily; three days tolerates a
// missed night without serving a tree that old.
export const DOCS_TABLE_MAX_AGE_MS = 3 * 24 * 3600 * 1000;
// Rows pulled per query. PostgREST pages at 1000, so this is five round trips at
// worst; past it the answer says so rather than ranking a silent sample.
export const DOCS_TABLE_MAX_ROWS = 5000;

export type SyncState = { last_completed_at?: string | null; complete?: boolean | null; file_count?: number | null } | null | undefined;

export function tableIsFresh(state: SyncState, nowMs: number): boolean {
  if (!state?.last_completed_at) return false;
  const at = Date.parse(state.last_completed_at);
  return Number.isFinite(at) && nowMs - at < DOCS_TABLE_MAX_AGE_MS;
}

// Tokens come from norm(), which keeps characters like "#", "%" and ",". Those
// are not safe inside a PostgREST or=() filter, and ilike would treat "%" and
// "_" as wildcards. Keeping letters and digits only yields a pattern that matches
// a superset of what the scorer's includes() can match: the scorer compares
// against a string whose separators became spaces, and a separator-free token can
// only sit inside one run of letters and digits of the raw name.
export function safeTokens(tokens: string[]): string[] {
  const out = new Set<string>();
  for (const t of tokens) {
    const c = String(t || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (c) out.add(c);
  }
  return [...out];
}

export type DocQuery = {
  projectPrefix: string;
  tokens: string[];
  docType?: string | null;       // canonical, already normalised
  discipline?: string | null;    // canonical code, already normalised
  offset?: number;
  limit?: number;
};

const SELECT =
  "item_id,scope,library,folder_path,name,ext,web_url,modified_at," +
  "area,doc_type,discipline,design_phase,set_name,sheet_no,derived_from";

export function buildDocumentsQuery(q: DocQuery): string {
  const parts = [
    `select=${SELECT}`,
    `project_prefix=eq.${encodeURIComponent(q.projectPrefix.toLowerCase().trim())}`,
  ];
  if (q.docType) parts.push(`doc_type=eq.${encodeURIComponent(q.docType)}`);
  if (q.discipline) parts.push(`discipline=eq.${encodeURIComponent(q.discipline)}`);
  const toks = safeTokens(q.tokens);
  if (toks.length) {
    // `scope` only carries searchable words for library rows (the client or project
    // folder name). On a project row it is the project number, and matching it
    // would pull in the whole project for a query that merely names it.
    const cond = toks.flatMap((t) => [
      `name.ilike.*${t}*`, `folder_path.ilike.*${t}*`, `and(scope.like.lib:*,scope.ilike.*${t}*)`,
    ]);
    parts.push(`or=(${cond.join(",")})`);
  }
  // Deterministic paging: item_id is unique, so offset pages never overlap.
  parts.push("order=item_id");
  parts.push(`limit=${q.limit ?? 1000}`);
  parts.push(`offset=${q.offset ?? 0}`);
  return "pms_documents_v?" + parts.join("&");
}

// A library row's folder_path is relative to its TOP folder, which is named for
// the client or project and only survives in `scope` ("lib:Proposals/<folder>").
// Put it back, so the scorer sees the same words a person would.
export function fullFolderPath(row: { scope?: string | null; folder_path?: string | null }): string {
  const rel = String(row.folder_path || "");
  const scope = String(row.scope || "");
  if (!scope.startsWith("lib:")) return rel || "/";
  const top = scope.slice(scope.indexOf("/") + 1);
  return !rel || rel === "/" ? top : `${top}/${rel}`;
}

export type TableFile = {
  itemId: string; name: string; library: string; folderPath: string;
  webUrl: string | null; modified: string | null; size: number; ext: string;
};
export function rowToFile(row: any): TableFile {
  return {
    itemId: String(row.item_id),
    name: String(row.name || ""),
    library: String(row.library || ""),
    folderPath: fullFolderPath(row),
    webUrl: row.web_url ?? null,
    modified: row.modified_at ?? null,
    size: 0,
    ext: String(row.ext || "").toLowerCase(),
  };
}

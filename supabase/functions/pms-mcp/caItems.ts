// search_rfis_submittals' read side of pms_ca_items (PROPOSAL-ca-items-table.md,
// step 2): classifying the query, building the search_ca_items RPC arguments,
// shaping a row back into the tool's output, and summarising a reconcile run.
// Pure (no fetch, no Deno), so caItems.test.mjs covers it directly; the I/O
// and the in-memory fallback stay in index.ts.
//
// Visibility is NOT decided here: the row ids passed in are the projects the
// caller may see, resolved by index.ts through the same getProjects() path as
// every other tool. The RPC fails closed on an empty list.

export type CaItemType = "rfi" | "submittal";

// How a query is sent to the RPC. Exactly one of text / number / spec is set
// when the query is non-empty; typeHint narrows the type only when the caller
// gave none ("RFI-012" means an RFI, "12" means either).
export type CaQuery = {
  text?: string;
  number?: string;
  spec?: string;
  typeHint?: CaItemType;
};

// An item-number token: an optional RFI/SUB/S/R prefix, a separator, digits,
// an optional letter or ".1" resubmittal suffix. Two-letter prefixes other
// than these ("M-401", "AHU-3") are sheet or equipment tags and go to text.
const NUMBER_RE = /^(rfi|submittal|sub|r|s)?[\s#:._-]*(\d{1,5}[a-z]?(?:\.\d{1,2})?)$/i;
// A spec section: three (or four) pairs of digits with any separator, or the
// digits run together: "23 09 23", "23-09-23", "230923", "23 09 23.13".
const SPEC_RE = /^\d{2}[\s.-]?\d{2}[\s.-]?\d{2}(?:[\s.-]?\d{2})?$/;

export function classifyCaQuery(raw: string | null | undefined): CaQuery {
  const q = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!q) return {};
  if (SPEC_RE.test(q)) return { spec: q.replace(/\D/g, "") };
  const m = NUMBER_RE.exec(q);
  if (m) {
    const prefix = (m[1] ?? "").toLowerCase();
    const typeHint: CaItemType | undefined =
      prefix === "rfi" || prefix === "r" ? "rfi"
      : prefix === "sub" || prefix === "submittal" || prefix === "s" ? "submittal"
      : undefined;
    return { number: q, ...(typeHint ? { typeHint } : {}) };
  }
  return { text: q };
}

export const CA_SEARCH_DEFAULT_LIMIT = 30;
export const CA_SEARCH_MAX_LIMIT = 100;

export function clampCaLimit(limit: number | null | undefined): number {
  const n = Number(limit);
  if (!Number.isFinite(n)) return CA_SEARCH_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(n), 1), CA_SEARCH_MAX_LIMIT);
}

// ── Embeddings (PROPOSAL-ca-items-embeddings.md) ─────────────────────────────
// The edge runtime's built-in model. The column is vector(384) and the model
// name is pinned here and in the migration comment; change both together.
export const CA_EMBED_MODEL = "gte-small";
export const CA_EMBED_DIMS = 384;
export const CA_MIN_SIMILARITY = 0.75;

// A pgvector literal as PostgREST wants it on an RPC call: "[0.1,0.2,...]".
export function vectorLiteral(v: ArrayLike<number>): string {
  const out: string[] = [];
  for (let i = 0; i < v.length; i++) out.push(Number(v[i]).toString());
  return "[" + out.join(",") + "]";
}

// The model's output is trusted only when it has the column's shape; anything
// else is a configuration or runtime fault and must not reach the RPC.
export function isEmbedding(v: unknown): v is ArrayLike<number> {
  if (!v || typeof (v as any).length !== "number") return false;
  const a = v as ArrayLike<number>;
  if (a.length !== CA_EMBED_DIMS) return false;
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(Number(a[i]))) return false;
  return true;
}

export type CaSearchInput = {
  query?: string | null;
  rowIds: string[];
  type?: CaItemType | null;
  status?: string | null;
  discipline?: string | null;
  openOnly?: boolean | null;
  limit?: number | null;
  // the query's embedding; used only when the query is prose (mode "text")
  embedding?: ArrayLike<number> | null;
  minSimilarity?: number | null;
};

export type CaSearchArgs = {
  p_row_ids: string[];
  p_text: string | null;
  p_number: string | null;
  p_spec: string | null;
  p_type: CaItemType | null;
  p_status: string | null;
  p_discipline: string | null;
  p_open_only: boolean;
  p_limit: number;
  p_embedding?: string;
  p_min_similarity?: number;
};

export type CaSearchMode = "list" | "number" | "spec" | "text" | "hybrid";

// The RPC body. `mode` says which shape the query took, for the tool's answer.
// An embedding is attached only to a prose query: the number and spec shapes
// are exact by nature, and the RPC ignores it for them anyway.
export function buildCaSearchArgs(input: CaSearchInput): { args: CaSearchArgs; mode: CaSearchMode } {
  const q = classifyCaQuery(input.query);
  const type = input.type ?? q.typeHint ?? null;
  const args: CaSearchArgs = {
    p_row_ids: [...new Set((input.rowIds ?? []).map((x) => String(x ?? "")).filter(Boolean))],
    p_text: q.text ?? null,
    p_number: q.number ?? null,
    p_spec: q.spec ?? null,
    p_type: type,
    p_status: nonEmpty(input.status),
    p_discipline: nonEmpty(input.discipline),
    p_open_only: input.openOnly === true,
    p_limit: clampCaLimit(input.limit),
  };
  let mode: CaSearchMode = q.number ? "number" : q.spec ? "spec" : q.text ? "text" : "list";
  if (mode === "text" && isEmbedding(input.embedding)) {
    args.p_embedding = vectorLiteral(input.embedding);
    const f = Number(input.minSimilarity);
    args.p_min_similarity = Number.isFinite(f) && f >= 0 && f <= 1 ? f : CA_MIN_SIMILARITY;
    mode = "hybrid";
  }
  return { args, mode };
}

// What the documents-sync response reports about the embed pass.
export type EmbedRunCounts = { queued: number; embedded: number; failed: number; batches: number; ms: number; stoppedEarly?: boolean };
export function summarizeEmbedRun(c: EmbedRunCounts): Record<string, unknown> {
  return {
    queued: c.queued, embedded: c.embedded, failed: c.failed, batches: c.batches, ms: Math.round(c.ms),
    ...(c.stoppedEarly ? { stoppedEarly: true, note: "Time budget reached; the next run continues." } : {}),
  };
}

function nonEmpty(s: string | null | undefined): string | null {
  const t = String(s ?? "").trim();
  return t ? t : null;
}

export type CaSearchRow = {
  project_row_id: string; project_number: string | null; item_type: CaItemType; item_id: string;
  number: string | null; subject: string | null; discipline: string | null; spec_section: string | null;
  status: string | null; is_open: boolean; date_received: string | null; due_date: string | null;
  date_closed: string | null; link_count: number | null; has_ai_review: boolean | null;
  rank: number | null; snippet: string | null;
  total?: number | string | null;   // matches before the limit; absent on the pre-total function
};

// The same keys the in-memory path has always returned, so a caller cannot
// tell which path answered except by the `source` the tool adds; `rank` is new
// and only present when a query ranked the rows.
export function caRowToItem(r: CaSearchRow, ranked: boolean): Record<string, unknown> {
  const links = Number(r.link_count) || 0;
  return {
    project: r.project_number || r.project_row_id,
    type: r.item_type,
    number: r.number ?? null,
    subject: (r.subject && r.subject.trim()) || "—",
    discipline: r.discipline || null,
    specSection: r.spec_section || undefined,
    status: r.status || null,
    dueDate: r.due_date || null,
    received: r.date_received || null,
    closed: r.date_closed || null,
    snippet: String(r.snippet ?? "").slice(0, 300),
    ...(ranked && typeof r.rank === "number" ? { rank: Math.round(r.rank * 1000) / 1000 } : {}),
    ...(links ? { linkCount: links, linkNote: "Has linked items — read_rfi_submittal shows them." } : {}),
    ...(r.has_ai_review ? { aiReviewed: true } : {}),
  };
}

// Matches before the limit, carried on every row by the RPC's window count.
// Null when the rows carry none (an older search_ca_items), so the caller can
// fall back to the row count rather than claim a total it does not have.
export function caTotalOf(rows: Array<{ total?: number | string | null }> | null | undefined): number | null {
  const first = Array.isArray(rows) ? rows[0] : undefined;
  if (!first || first.total === null || first.total === undefined) return null;
  const n = Number(first.total);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

export type ReconcileRow = { project_row_id: string; written: number | null; error: string | null };

// What the documents-sync response reports about the CA projection pass. A
// `written` above zero on a project means the trigger had missed something
// (or a save landed between), so it is worth seeing; errors are listed so the
// log line names the project.
export function summarizeReconcile(rows: ReconcileRow[] | null | undefined): {
  projects: number; written: number; repaired: string[]; failed: Array<{ project: string; error: string }>;
} {
  const list = Array.isArray(rows) ? rows : [];
  const repaired: string[] = [];
  const failed: Array<{ project: string; error: string }> = [];
  let written = 0;
  for (const r of list) {
    if (r.error) { failed.push({ project: r.project_row_id, error: String(r.error) }); continue; }
    const w = Number(r.written) || 0;
    written += w;
    if (w > 0) repaired.push(r.project_row_id);
  }
  return { projects: list.length, written, repaired: repaired.slice(0, 20), failed: failed.slice(0, 20) };
}

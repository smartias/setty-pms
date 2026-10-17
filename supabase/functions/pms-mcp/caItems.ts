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

export type CaSearchInput = {
  query?: string | null;
  rowIds: string[];
  type?: CaItemType | null;
  status?: string | null;
  discipline?: string | null;
  openOnly?: boolean | null;
  limit?: number | null;
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
};

// The RPC body. `mode` says which shape the query took, for the tool's answer.
export function buildCaSearchArgs(input: CaSearchInput): { args: CaSearchArgs; mode: "list" | "number" | "spec" | "text" } {
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
  const mode = q.number ? "number" : q.spec ? "spec" : q.text ? "text" : "list";
  return { args, mode };
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

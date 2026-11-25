// How one documents-sync run decides which scopes to start (2026-11-25).
//
// Why this exists: a run used to start scopes until 90 s had passed, so a
// 3,000-7,000-file project starting at 85 s ran the request to 150-170 s. pg_net
// gave up at 120 s, the edge runtime killed the worker, and calls sharing that
// worker (embeds, CA intake, connector calls) failed with 546
// WORKER_RESOURCE_LIMIT. Runs are now short and frequent instead (cron every
// 5 minutes) and a big scope runs alone, first in its run.

// Stop STARTING new scopes after this. A small scope (< DOCS_BIG_SCOPE_FILES)
// has taken up to ~35 s, so a run ends by roughly 75 s.
export const DOCS_RUN_BUDGET_MS = 40000;
// A scope whose last walk saw this many indexable files, or never finished its
// walk, is "big": 50-85 s on its own.
export const DOCS_BIG_SCOPE_FILES = 1500;

export type DocsScopeHistory = { fileCount?: number | null; complete?: boolean | null } | undefined;

export function isBigDocsScope(h: DocsScopeHistory): boolean {
  if (!h) return false; // never synced: size unknown, treat as small
  if (h.complete === false) return true; // last walk hit its cap
  return (Number(h.fileCount) || 0) >= DOCS_BIG_SCOPE_FILES;
}

// "run": start it now. "skip": leave it for a later run (it keeps its place at
// the head of the rotation, since its last_completed_at does not move).
// "stop": start nothing more in this run.
export function docsScopeDecision(args: {
  started: number; // scopes already run in this run
  elapsedMs: number;
  maxScopes: number;
  big: boolean;
  ranBig: boolean; // a big scope already ran in this run
  budgetMs?: number;
}): "run" | "skip" | "stop" {
  const budget = args.budgetMs ?? DOCS_RUN_BUDGET_MS;
  if (args.started >= args.maxScopes) return "stop";
  if (args.ranBig) return "stop";
  if (args.elapsedMs > budget) return "stop";
  if (args.big && args.started > 0) return "skip";
  return "run";
}

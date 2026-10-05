// knowledgebase.ts — the firm Knowledgebase share (SETTYfy "KB" region).
//
// Unlike every other share, this one holds no project folders: it is Setty's
// internal reference material (IntranetFiles/Knowledgebase on ffxfilestorage).
// Registered in Admin → Regions as team KB, share label K, secret AZURE_SAS_K.
// The project visibility gate (azurePathProject) cannot apply, so a KB path
// gets its own, simpler rule: any signed-in caller may read it, minus any
// folder named in the KB_EXCLUDE env var (comma-separated folder names matched
// on any path segment, case-insensitive). Writes never happen: the SAS is
// read + list by policy.
//
// Pure (no fetch, no Deno): the walker takes an injected listing function so
// knowledgebase.test.mjs drives the real code without a share.

import { joinRel, extOf, type AzEntry } from "./azureFiles.ts";

export const KB_TEAM = "KB";
export function isKbTeam(team: string | null | undefined): boolean {
  return String(team || "").toUpperCase().trim() === KB_TEAM;
}

function normSeg(s: string): string {
  return String(s || "").toLowerCase().replace(/[_\s]+/g, " ").trim();
}

export function parseKbExclude(raw: string | null | undefined): string[] {
  return String(raw || "").split(",").map(normSeg).filter(Boolean);
}

// True when any segment of the path is an excluded folder (or file) name.
export function kbExcluded(relPath: string, exclude: string[]): boolean {
  if (!exclude.length) return false;
  return String(relPath || "").split("/").some((seg) => exclude.includes(normSeg(seg)));
}

export type KbFile = { name: string; path: string; folder: string; ext: string; size?: number; modified?: string };

// Breadth-first walk of the Knowledgebase, bounded by listings and files. An
// excluded folder is never listed. A folder that will not list is skipped (and
// the result is marked partial) rather than failing the whole walk.
export async function walkKb(
  list: (rel: string) => Promise<{ entries: AzEntry[]; truncated: boolean }>,
  startRel: string,
  opts: { maxListings?: number; maxFiles?: number; exclude?: string[] } = {},
): Promise<{ files: KbFile[]; truncated: boolean; failedListings: number }> {
  const maxListings = opts.maxListings ?? 80;
  const maxFiles = opts.maxFiles ?? 5000;
  const exclude = opts.exclude ?? [];
  const files: KbFile[] = [];
  const queue: string[] = [startRel];
  let listings = 0, truncated = false, failedListings = 0;
  while (queue.length) {
    if (listings >= maxListings || files.length >= maxFiles) { truncated = true; break; }
    const dir = queue.shift()!;
    let r: { entries: AzEntry[]; truncated: boolean };
    try { r = await list(dir); listings++; } catch { listings++; failedListings++; truncated = true; continue; }
    if (r.truncated) truncated = true;
    for (const e of r.entries) {
      const full = joinRel(dir, e.name);
      if (kbExcluded(full, exclude)) continue;
      if (e.type === "folder") queue.push(full);
      else if (files.length < maxFiles) {
        files.push({ name: e.name, path: full, folder: dir, ext: extOf(e.name), size: e.size, modified: e.modified });
      } else truncated = true;
    }
  }
  return { files, truncated, failedListings };
}

function tokensOf(q: string): string[] {
  return String(q || "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 0);
}

// Every query word must appear in the file name or its folder path; name hits
// outweigh folder hits, and a whole-word hit outweighs a substring. Returns 0
// for a non-match so callers can filter on score > 0.
export function kbScore(file: Pick<KbFile, "name" | "folder">, tokens: string[]): number {
  if (!tokens.length) return 0;
  const name = file.name.toLowerCase();
  const nameWords = new Set(name.split(/[^a-z0-9]+/).filter(Boolean));
  const folder = file.folder.toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (nameWords.has(t)) score += 10;
    else if (name.includes(t)) score += 6;
    else if (folder.includes(t)) score += 3;
    else return 0;
  }
  return score;
}

export function kbSearch(files: KbFile[], query: string, limit = 25): Array<KbFile & { score: number }> {
  const tokens = tokensOf(query);
  return files
    .map((f) => ({ ...f, score: kbScore(f, tokens) }))
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score || String(b.modified || "").localeCompare(String(a.modified || "")) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// Rules for the 14-digit version at the start of every file name in
// supabase/migrations/ (e.g. 20261124140000_knowledge_embeddings.sql).
// Used by check-source.mjs; tested by migrationVersions.test.mjs.
//
// Supabase records an applied migration by that version alone. Two files with
// the same version are one migration to it: the first is applied and the
// second is skipped without an error (PRs #564 and #565, 2026-11-24). A file
// whose version sorts before the last one applied is rejected.

export const MIGRATIONS_DIR = "supabase/migrations";

const NAME = /^(\d{14})_.+\.sql$/;

// "20261124140000" for a well-formed name, otherwise null.
export function migrationVersion(file) {
  const m = NAME.exec(file);
  return m ? m[1] : null;
}

// .sql files whose name does not start with a 14-digit version and "_".
// The two checks below cannot see such a file, so it is a failure of its own.
export function malformedNameProblems(files) {
  return files
    .filter((f) => f.endsWith(".sql") && !migrationVersion(f))
    .map((f) => `${MIGRATIONS_DIR}/${f}: the name must start with a 14-digit version and "_" (YYYYMMDDHHMMSS_name.sql).`);
}

// One message per version that more than one file uses, naming every file.
export function duplicateVersionProblems(files) {
  const byVersion = new Map();
  for (const f of [...files].sort()) {
    const v = migrationVersion(f);
    if (!v) continue;
    byVersion.set(v, [...(byVersion.get(v) || []), f]);
  }
  const problems = [];
  for (const [v, names] of byVersion) {
    if (names.length < 2) continue;
    problems.push(
      `${MIGRATIONS_DIR}: ${names.length} files share the version ${v}: ${names.join(" and ")}. ` +
      `Supabase applies only one file per version and silently skips the rest. Rename the newer file to a later, unused timestamp.`,
    );
  }
  return problems;
}

// `files` is the folder as it is here; `baseFiles` is the folder on main.
// A file that main does not have must sort after every migration on main.
export function staleVersionProblems(files, baseFiles) {
  const onBase = new Set(baseFiles);
  let newest = null; // file with the highest version on main
  for (const f of baseFiles) {
    const v = migrationVersion(f);
    if (v && (!newest || v > migrationVersion(newest))) newest = f;
  }
  if (!newest) return [];
  const newestVersion = migrationVersion(newest);
  const problems = [];
  for (const f of [...files].sort()) {
    const v = migrationVersion(f);
    if (!v || onBase.has(f) || v > newestVersion) continue;
    problems.push(
      `${MIGRATIONS_DIR}/${f}: new migration with version ${v}, which ` +
      `${v === newestVersion ? "is the same as" : "sorts before"} the newest migration on main (${newest}). ` +
      `Rename it to a timestamp after ${newestVersion}.`,
    );
  }
  return problems;
}

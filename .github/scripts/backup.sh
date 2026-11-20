#!/usr/bin/env bash
# Off-site backup of the PMS database to SharePoint. Run nightly by
# .github/workflows/backup.yml; can be run by hand with the same env.
#
# Env:
#   SUPABASE_DB_URL  Postgres connection string (Supabase "Session pooler" URI)
#   PMS_MCP_URL      https://<ref>.supabase.co/functions/v1/pms-mcp
#   RUN_URL          optional: link to this run, stored with the run record
#
# Writes, under the SharePoint folder named by the connector's
# BACKUP_FOLDER_URL secret:
#   core/YYYY-MM-DD/pms-core-HHMMSS.dump      pg_dump of the public schema
#                                             (all structure; all data except
#                                             the tables below)
#   core/YYYY-MM-DD/manifest-HHMMSS.json      what was written, with checksums
#   emails/emails-YYYY-MM.csv.gz              filed emails, one file per month
#   history/history-YYYY-MM.csv.gz            project save history, per month
# Monthly files are rewritten for the current and previous month every night,
# for a missing month, and for every month on the 1st (catches edits to old
# rows). pms_documents and pms_drawing_text are search indexes the connector
# rebuilds from SharePoint, so their data is not exported. How to restore:
# docs/RESTORE.md.
set -Eeuo pipefail   # -E: the ERR trap also fires inside functions and $(...)

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is not set}"
: "${PMS_MCP_URL:?PMS_MCP_URL is not set}"
HERE="$(cd "$(dirname "$0")" && pwd)"
UP="node $HERE/backup-upload.mjs"
WORK="$(mktemp -d)"
DAY="$(date -u +%F)"
STAMP="$(date -u +%H%M%S)"
FILES="$WORK/files.jsonl"
: > "$FILES"
# Keep a copy of error output, so a failed run records why it failed.
exec 2> >(tee -a "$WORK/stderr.log" >&2)

psql_() { psql "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

PMS_BACKUP_TOKEN="$(psql_ -Atc "select token from public.pms_integration_secrets where name = 'backup-upload'")"
if [ -z "$PMS_BACKUP_TOKEN" ]; then
  echo "No 'backup-upload' token in pms_integration_secrets (has migration 20261121100000 run?)" >&2
  exit 1
fi
[ -n "${GITHUB_ACTIONS:-}" ] && echo "::add-mask::$PMS_BACKUP_TOKEN"
export PMS_BACKUP_TOKEN PMS_MCP_URL

RUN_ID="$(psql_ -At -v url="${RUN_URL:-}" <<'SQL'
insert into public.pms_backup_runs (run_url) values (nullif(:'url', '')) returning id;
SQL
)"
FINISHED=0

finish() {
  local ok="$1" note="$2"
  local files bytes
  files="$(jq -s -c '.' "$FILES")"
  bytes="$(jq -s 'map(.bytes) | add // 0' "$FILES")"
  psql_ -v id="$RUN_ID" -v ok="$ok" -v note="$note" -v files="$files" -v bytes="$bytes" <<'SQL'
update public.pms_backup_runs
   set finished_at = now(), ok = :'ok'::boolean, note = nullif(:'note', ''),
       files = :'files'::jsonb, bytes = :'bytes'::bigint
 where id = :'id'::bigint;
SQL
  FINISHED=1
}
on_exit() {
  local rc=$?
  if [ "$FINISHED" = 0 ]; then
    local why
    why="$(tail -c 600 "$WORK/stderr.log" 2>/dev/null | tr '\n' ' ')"
    finish false "exit $rc at line ${FAILED_LINE:-?} (${FAILED_CMD:-?}): ${why:-no error output}" || true
  fi
  rm -rf "$WORK"
}
trap '[ -z "${FAILED_LINE:-}" ] && FAILED_LINE=$LINENO && FAILED_CMD=$BASH_COMMAND' ERR
trap on_exit EXIT

upload() { # <local file> <remote path>
  $UP put "$1" "$2" >> "$FILES"
  echo "uploaded $2 ($(stat -c %s "$1") bytes)"
}

# ── 1. Core dump ────────────────────────────────────────────────────────────
CORE="$WORK/pms-core-$STAMP.dump"
pg_dump "$SUPABASE_DB_URL" --format=custom --schema=public \
  --exclude-table-data=public.pms_project_emails \
  --exclude-table-data=public.pms_projects_history \
  --exclude-table-data=public.pms_documents \
  --exclude-table-data=public.pms_drawing_text \
  --exclude-table-data=public.pms_mcp_tree_cache \
  --file="$CORE"
pg_restore --list "$CORE" > /dev/null   # fails if the archive is unreadable
upload "$CORE" "core/$DAY/pms-core-$STAMP.dump"

# ── 2. Monthly files for the two large tables ───────────────────────────────
# Columns are read from the database, so a new column is exported without a
# change here. Derived columns are left out (search vectors, embeddings): the
# insert triggers and the embedding cron job rebuild them after a restore.
monthly() { # <table> <folder> <prefix> <date columns, in preference order> <excluded columns regex>
  local table="$1" folder="$2" prefix="$3" datecols="$4" skip="$5"
  local cols first key months existing today_day cur prev
  cols="$(psql_ -At -v t="$table" -v skip="$skip" <<'SQL'
select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
  from information_schema.columns
 where table_schema = 'public' and table_name = :'t' and column_name !~ :'skip';
SQL
)"
  # A row with none of the date columns set is filed under the earliest month,
  # so every row lands in exactly one file.
  first="$(psql_ -At -c "select coalesce(min(coalesce($datecols)), now()) from public.$table")"
  key="coalesce($datecols, '$first'::timestamptz)"
  # Through the latest dated row as well as today, so a future-dated row is kept.
  months="$(psql_ -At -c "select to_char(m, 'YYYY-MM') from generate_series(
      date_trunc('month', '$first'::timestamptz),
      date_trunc('month', greatest(now(), (select max($key) from public.$table))),
      interval '1 month') m")"
  existing="$($UP list "$folder")"
  today_day="$(date -u +%d)"
  cur="$(date -u +%Y-%m)"
  prev="$(date -u -d "$(date -u +%Y-%m-01) -1 day" +%Y-%m)"
  for m in $months; do
    local name="$prefix-$m.csv.gz" rows
    if [ "$m" != "$cur" ] && [ "$m" != "$prev" ] && [ "$today_day" != "01" ] && grep -qx "$name" <<<"$existing"; then
      continue
    fi
    local out="$WORK/$name"
    psql_ -c "set statement_timeout = 0" \
      -c "\\copy (select $cols from public.$table where $key >= '$m-01'::timestamptz and $key < ('$m-01'::timestamptz + interval '1 month') order by 1) to stdout with (format csv, header)" \
      | gzip -6 > "$out"
    # Counted in SQL: a quoted CSV field can span lines, so wc -l would overcount.
    rows="$(psql_ -At -c "select count(*) from public.$table where $key >= '$m-01'::timestamptz and $key < ('$m-01'::timestamptz + interval '1 month')")"
    echo "$table $m: $rows rows"
    if [ "$rows" -gt 0 ]; then upload "$out" "$folder/$name"; fi
    rm -f "$out"
  done
}

monthly pms_project_emails emails emails "created_at, saved_at, email_date" \
  '^(embedding|embedded_at|embedded_hash|search_tsv)$'
monthly pms_projects_history history history "recorded_at, updated_at" '^$'

# ── 3. Manifest ─────────────────────────────────────────────────────────────
MANIFEST="$WORK/manifest-$STAMP.json"
jq -s --arg day "$DAY" --arg pgdump "$(pg_dump --version)" --arg run "${RUN_URL:-}" \
  --arg sha "$(sha256sum "$CORE" | cut -d' ' -f1)" \
  '{day: $day, pg_dump: $pgdump, run: $run, core_sha256: $sha, files: .}' "$FILES" > "$MANIFEST"
upload "$MANIFEST" "core/$DAY/manifest-$STAMP.json"

finish true ""
echo "Backup complete: $(jq -s 'length' "$FILES") files, $(jq -s 'map(.bytes) | add' "$FILES") bytes"

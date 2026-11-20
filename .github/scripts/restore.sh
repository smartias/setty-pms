#!/usr/bin/env bash
# Restore an off-site backup (see docs/RESTORE.md) into an EMPTY database.
#
#   bash .github/scripts/restore.sh <backup folder> <target database URL>
#
# <backup folder> is a local copy of the SharePoint backup folder, laid out as
# the backup job writes it:
#   core/YYYY-MM-DD/pms-core-HHMMSS.dump   the newest one is used
#   emails/emails-YYYY-MM.csv.gz
#   history/history-YYYY-MM.csv.gz
#
# Never point this at production: it refuses a database whose public schema
# already has tables, and it is meant for a new Supabase project or a scratch
# Postgres.
set -euo pipefail

SRC="${1:?usage: restore.sh <backup folder> <target database URL>}"
DB="${2:?usage: restore.sh <backup folder> <target database URL>}"
psql_() { psql "$DB" -X -q -v ON_ERROR_STOP=1 "$@"; }

CORE="$(ls -1 "$SRC"/core/*/pms-core-*.dump 2>/dev/null | sort | tail -1 || true)"
[ -n "$CORE" ] || { echo "No core/*/pms-core-*.dump under $SRC" >&2; exit 1; }

existing="$(psql_ -At -c "select count(*) from pg_tables where schemaname = 'public'")"
if [ "$existing" != "0" ]; then
  echo "Refusing: the target database already has $existing tables in public. Restore into an empty one." >&2
  exit 1
fi

echo "Restoring structure and core data from $CORE"
# --no-owner: the objects become owned by whoever restores. On a fresh Supabase
# project, run as the postgres user. Errors about extensions or roles that the
# target lacks are reported by pg_restore and listed at the end.
# The dump names the public schema itself; every database already has one, so
# that entry is left out of the restore list.
LIST="$(mktemp)"
trap 'rm -f "$LIST"' EXIT
pg_restore --list "$CORE" | grep -v ' SCHEMA - public ' > "$LIST"
pg_restore --dbname="$DB" --no-owner --exit-on-error --use-list="$LIST" "$CORE" || {
  echo "pg_restore stopped on an error. On Supabase, extensions such as vector and pg_trgm" >&2
  echo "must exist first (Dashboard -> Database -> Extensions); see docs/RESTORE.md." >&2
  exit 1
}

load() { # <table> <folder> <prefix>
  local table="$1" folder="$2" prefix="$3" f header total=0
  for f in $(ls -1 "$SRC/$folder/$prefix"-*.csv.gz 2>/dev/null | sort); do
    # "|| true": head stops reading after one line, which ends zcat with SIGPIPE.
    header="$( { zcat "$f" || true; } | head -1 )"
    zcat "$f" | psql_ -c "\\copy public.$table ($header) from stdin with (format csv, header)"
    echo "loaded $(basename "$f")"
  done
  total="$(psql_ -At -c "select count(*) from public.$table")"
  echo "$table: $total rows"
}
load pms_project_emails emails emails
load pms_projects_history history history

# Identity columns: continue numbering after the restored rows.
psql_ <<'SQL'
do $$
declare r record;
begin
  for r in
    select c.table_name, c.column_name
      from information_schema.columns c
     where c.table_schema = 'public' and c.is_identity = 'YES'
       and c.table_name in ('pms_projects_history')
  loop
    execute format(
      'select setval(pg_get_serial_sequence(%L, %L), coalesce((select max(%I) from public.%I), 1))',
      'public.' || r.table_name, r.column_name, r.column_name, r.table_name);
  end loop;
end
$$;
SQL

echo "Restore finished. Next steps (docs/RESTORE.md): refresh materialized views, let the"
echo "embedding and documents-sync jobs rebuild what was not backed up, and spot-check projects."

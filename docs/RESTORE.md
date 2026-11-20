# Restoring the PMS database from the off-site backup

The "Off-site backup" GitHub Actions workflow (`.github/workflows/backup.yml`)
copies the database to a SharePoint folder every night at 08:41 UTC. This page
says what is in that folder and how to get a working database back from it.

## What is backed up, and what is not

| In the SharePoint folder | What it is |
|---|---|
| `core/YYYY-MM-DD/pms-core-HHMMSS.dump` | A `pg_dump` (custom format) of the `public` schema: every table, view, function, trigger and RLS policy, and the data of every table except the four below. One per run, never overwritten. |
| `core/YYYY-MM-DD/manifest-HHMMSS.json` | The list of files that run wrote, their sizes, and the SHA-256 of the dump. |
| `emails/emails-YYYY-MM.csv.gz` | Filed emails (`pms_project_emails`), one file per month of filing. |
| `history/history-YYYY-MM.csv.gz` | Every saved version of every project (`pms_projects_history`), per month. |

Monthly files are rewritten for the current and previous month every night,
and for every month on the 1st. SharePoint keeps the replaced copies as
file versions.

**Not in the backup, on purpose:**

- `pms_documents` and `pms_drawing_text`: search indexes the connector rebuilds
  from SharePoint (the `pms-documents-sync` and `pms-drawings-index` jobs).
- Email `embedding` / `search_tsv` columns: rebuilt by the `pms-emails-embed`
  job and the table's insert trigger.
- The `backups` schema (the older in-database copies) and the `auth`, `cron`
  and `storage` schemas. Sign-in is Microsoft-only, so users reappear when they
  next sign in; roles are in `public.pms_user_roles`, which IS backed up.
  Scheduled jobs (`cron.job`) must be recreated; their definitions are in the
  migration files and in `CLAUDE.md`.
- **Files in Supabase Storage** (e.g. site report photos). These live outside
  the database and need their own copy.
- The SharePoint documents themselves, which Microsoft 365 already protects.

## Restoring

Always restore into a **new, empty** database (a new Supabase project, or a
scratch Postgres to look at the data). Never restore over production. The
script refuses a database that already has tables.

1. Download the backup folder from SharePoint to a computer with PostgreSQL 17
   client tools (`pg_restore`, `psql`) installed. You need one `core/<day>/`
   folder (the newest is used) and the whole `emails/` and `history/` folders.
2. On a new Supabase project, enable the same extensions first
   (Dashboard → Database → Extensions): at least `vector`, `pg_trgm`, `pg_net`
   and `pg_cron`.
3. Run, with the new project's **Session pooler** connection string:

   ```bash
   bash .github/scripts/restore.sh ./pms-backup "postgresql://postgres.<ref>:<password>@<pooler-host>:5432/postgres"
   ```

   It restores the dump, loads every monthly email and history file, and
   prints the row count of each table.
4. Compare those counts with production (or with the numbers in the newest
   `manifest-*.json`), and open a few projects in the PMS against the restored
   database before trusting it.
5. Then, on the restored project: refresh the materialized views
   (`refresh materialized view pms_project_index;` and the others), redeploy
   the edge functions, recreate the cron jobs, and let the embedding and
   documents-sync jobs rebuild their tables.

## Testing it

A backup that has never been restored is not yet a backup. The restore path
was tested end to end on 2026-11-20 against a sample database: every table's
rows and content came back identical, including emails whose subjects contain
quotes, commas and line breaks. Repeat a restore into a scratch database
**every few months**, and after any large schema change.

## When the backup fails

`pms-cron-alert` emails "No off-site backup has reached SharePoint in the last
30 hours" (`backup-offsite-stale`). Each run is recorded in
`public.pms_backup_runs` with the files it wrote, or the error it stopped on,
and a link to the GitHub Actions run:

```sql
select started_at, ok, bytes, note, run_url
  from pms_backup_runs order by started_at desc limit 5;
```

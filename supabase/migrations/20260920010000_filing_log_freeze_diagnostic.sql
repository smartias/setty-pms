-- Filing log freeze trigger (20 Sep 2026, follow-up to
-- 20260920000000_filing_log_author_binding): ignore generated columns, and
-- name the columns that moved.
--
-- The first live run of filing-log-author-verify.sql failed its "files
-- column accepted" check: the freeze trigger rejected an UPDATE that set only
-- `files`, which it must allow. Root cause: the live table carries a STORED
-- GENERATED column (queue_key), and inside a BEFORE UPDATE trigger Postgres
-- has not yet computed generated columns on NEW — they read as null while OLD
-- holds the stored value — so the whole-row comparison always saw a change.
-- Reproduced in an embedded Postgres by declaring queue_key generated; the
-- original trigger rejects a files-only update there too.
--
-- Fix: look up the table's generated columns from pg_attribute at run time
-- and drop them from both sides before comparing. Every real column except
-- `files` stays frozen, and the rule survives any generated column added
-- later. The error now also lists the changed columns and values, so a
-- rejection is self-explaining instead of a guess. Safe to run more than
-- once (create or replace).

create or replace function public.pms_filing_log_freeze()
returns trigger
language plpgsql
as $$
declare
  ignored text[];
  changed text;
begin
  -- `files` (the one column the transmittal register legitimately patches)
  -- plus every generated column, which a BEFORE trigger cannot compare.
  select array_agg(attname::text) || array['files']
    into ignored
  from pg_attribute
  where attrelid = tg_relid
    and attnum > 0
    and not attisdropped
    and attgenerated <> '';
  ignored := coalesce(ignored, array['files']);

  select string_agg(format('%s: %s -> %s', key, coalesce(o.value::text, 'null'), coalesce(n.value::text, 'null')), '; ' order by key)
    into changed
  from jsonb_each(to_jsonb(new) - ignored) as n(key, value)
  full join jsonb_each(to_jsonb(old) - ignored) as o(key, value) using (key)
  where n.value is distinct from o.value;

  if changed is not null then
    raise exception 'pms_filing_log is append-only: only the files column may be updated (row %; changed: %)', old.id, changed
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.pms_filing_log_freeze() is
  'BEFORE UPDATE on pms_filing_log: rejects any change outside the files column (generated columns excluded, since they are not computed on NEW in a BEFORE trigger) and names the columns that changed. The transmittal register (supersede/backfill) is the only legitimate updater and only ever patches files.';

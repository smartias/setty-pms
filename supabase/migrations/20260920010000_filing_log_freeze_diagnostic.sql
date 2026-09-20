-- Filing log freeze trigger (20 Sep 2026, follow-up to
-- 20260920000000_filing_log_author_binding): name the columns that moved.
--
-- The first live run of filing-log-author-verify.sql failed its "files
-- column accepted" check: the freeze trigger rejected an UPDATE that set only
-- `files`, which it must allow. That never reproduced in the embedded-Postgres
-- check that shipped with the migration, so something about the live row
-- differs in a way the trigger's message ("only the files column may be
-- updated") cannot show. This replaces the whole-row comparison with a
-- per-column diff of everything except `files`, and puts the changed column
-- names in the error, so a rejection is self-explaining instead of a guess.
--
-- Same rule, same strictness: any column other than `files` changing is
-- rejected. Only the diagnostics change. Safe to run more than once.

create or replace function public.pms_filing_log_freeze()
returns trigger
language plpgsql
as $$
declare
  changed text;
begin
  select string_agg(format('%s: %s -> %s', key, coalesce(o.value::text, 'null'), coalesce(n.value::text, 'null')), '; ' order by key)
    into changed
  from jsonb_each(to_jsonb(new) - 'files') as n(key, value)
  full join jsonb_each(to_jsonb(old) - 'files') as o(key, value) using (key)
  where n.value is distinct from o.value;

  if changed is not null then
    raise exception 'pms_filing_log is append-only: only the files column may be updated (row %; changed: %)', old.id, changed
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.pms_filing_log_freeze() is
  'BEFORE UPDATE on pms_filing_log: rejects any change outside the files column and names the columns that changed. The transmittal register (supersede/backfill) is the only legitimate updater and only ever patches files.';

-- Filing log integrity (20 Sep 2026): bind the author to the JWT, and make
-- the audit trail append-only except for the one column the transmittal
-- register legitimately edits.
--
-- Why. pms_filing_log is the audit trail behind the add-in's filing queue,
-- the transmittal register, and the Claude connector's "current set". Its
-- policies already require a signed-in user (Phase 4 flip), but two things
-- kept it from being evidence rather than a claim:
--
--   1. user_email was whatever the client put in the row. The add-in sends
--      its MSAL username; transmittal.html sends nothing (every one of its
--      101 rows has user_email null). Any signed-in user could write any
--      name, or none. A BEFORE INSERT trigger now stamps user_email from
--      the caller's JWT email whenever there is one, overriding the client
--      value. Rows written without a JWT email (service role, SQL editor)
--      keep whatever they carried, so edge functions and backfills are
--      unaffected.
--   2. UPDATE was open on every column to every signed-in user
--      (using true / with check true). The only legitimate update in the
--      codebase is transmittal.html patching `files` (supersede + backfill
--      of sheet links, always by id, always `{ files }`). A BEFORE UPDATE
--      trigger now rejects a change to any other column, so operation,
--      status, project_id, user_email, msg_id and created_at are frozen
--      once written.
--
-- Deliberately NOT done: an author-only UPDATE policy. Transmittal supersede
-- and backfill patch rows written by other people and rows that predate
-- user_email entirely; restricting by author would silently no-op those
-- PATCHes (the exact failure transmittal.html already documents around its
-- return=representation check). Column freezing gives the integrity that
-- matters without breaking that flow.
--
-- Stays capability-free on purpose (Phase 5 runbook: "every writer must
-- always be able to log"). The only new requirement on INSERT/UPDATE is a
-- JWT that carries an email — which pms_has_cap already demands for the
-- filing itself (pms_project_emails), so nobody who can file loses the
-- ability to log.
--
-- Run order: this file (rollback capture is section 1) -> verify with
-- ../filing-log-author-verify.sql (persona sweep, self-rolling-back).

-- ── 1. Rollback capture (Phase 5 pattern) ───────────────────────────────────
insert into pms_ops_snapshots (name, content)
select 'filing-log-author-binding-rollback-2026-09-20',
       'drop trigger if exists pms_filing_log_bind_author on public.pms_filing_log;' || E'\n' ||
       'drop trigger if exists pms_filing_log_freeze on public.pms_filing_log;' || E'\n' ||
       'drop function if exists public.pms_filing_log_bind_author();' || E'\n' ||
       'drop function if exists public.pms_filing_log_freeze();' || E'\n' ||
       'drop policy if exists filing_log_insert on public.pms_filing_log;' || E'\n' ||
       'drop policy if exists filing_log_update on public.pms_filing_log;' || E'\n' ||
       string_agg(
         format(
           'drop policy if exists %I on public.%I; create policy %I on public.%I as %s for %s to %s%s%s;',
           policyname, tablename, policyname, tablename,
           case when permissive = 'PERMISSIVE' then 'permissive' else 'restrictive' end,
           cmd, array_to_string(roles, ','),
           coalesce(' using (' || qual || ')', ''),
           coalesce(' with check (' || with_check || ')', '')
         ), E'\n')
from pg_policies
where schemaname = 'public'
  and tablename = 'pms_filing_log';

-- ── 2. Author binding: user_email comes from the JWT, not the client ────────
create or replace function public.pms_filing_log_bind_author()
returns trigger
language plpgsql
as $$
declare
  jwt_email text := lower(nullif(trim(coalesce(auth.jwt() ->> 'email', '')), ''));
begin
  if jwt_email is not null then
    new.user_email := jwt_email;
  end if;
  return new;
end;
$$;

comment on function public.pms_filing_log_bind_author() is
  'BEFORE INSERT on pms_filing_log: stamps user_email from the caller''s JWT email when present, so the audit trail records who actually wrote the row rather than what the client claimed.';

drop trigger if exists pms_filing_log_bind_author on public.pms_filing_log;
create trigger pms_filing_log_bind_author
  before insert on public.pms_filing_log
  for each row execute function public.pms_filing_log_bind_author();

-- ── 3. Append-only: only `files` may change after insert ────────────────────
create or replace function public.pms_filing_log_freeze()
returns trigger
language plpgsql
as $$
begin
  if (to_jsonb(new) - 'files') is distinct from (to_jsonb(old) - 'files') then
    raise exception 'pms_filing_log is append-only: only the files column may be updated (row %)', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.pms_filing_log_freeze() is
  'BEFORE UPDATE on pms_filing_log: rejects any change outside the files column. The transmittal register (supersede/backfill) is the only legitimate updater and only ever patches files.';

drop trigger if exists pms_filing_log_freeze on public.pms_filing_log;
create trigger pms_filing_log_freeze
  before update on public.pms_filing_log
  for each row execute function public.pms_filing_log_freeze();

-- ── 4. Policy swap: writes need a JWT that carries an email ─────────────────
-- SELECT (filing_log_anon_select — misnamed, already TO authenticated) is
-- untouched. No DELETE policy exists and none is added: the log is append-only.
drop policy if exists filing_log_anon_insert on public.pms_filing_log;
drop policy if exists filing_log_insert on public.pms_filing_log;
create policy filing_log_insert on public.pms_filing_log
  for insert to authenticated
  with check (coalesce(auth.jwt() ->> 'email', '') <> '');

drop policy if exists filing_log_auth_update on public.pms_filing_log;
drop policy if exists filing_log_update on public.pms_filing_log;
create policy filing_log_update on public.pms_filing_log
  for update to authenticated
  using (true)
  with check (coalesce(auth.jwt() ->> 'email', '') <> '');

comment on table public.pms_filing_log is
  'Filing-integrity audit trail (add-in saves, transmittal register). Append-only: user_email is bound to the writer''s JWT on insert; only files may be updated afterwards. See migration 20260920000000_filing_log_author_binding.';

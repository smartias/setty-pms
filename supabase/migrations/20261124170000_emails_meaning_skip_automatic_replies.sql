-- Filed emails: automatic (out-of-office) replies are not searched by meaning.
--
-- 20261124160000 left calendar replies and subject-less records without a
-- vector. The check after it shipped ("city rejected permit request over wrong
-- job number") still returned one "Automatic reply: ..." row: an out-of-office
-- note says nothing about the project, so its vector is the subject line it
-- answered and sits near any question about that subject.
--
-- Production on 2026-11-24: 347 emails have a subject beginning
-- "Automatic reply:", all 347 carry a vector. No "Auto-reply:", "Autoreply:"
-- or "Out of office:" subjects exist, so only the Outlook wording is added.
--
-- They stay in the log and are still found by their words. The embed queue
-- (pms_emails_to_embed) already calls this function, so it needs no change.
--
-- Rollback: re-apply pms_emails_skip_meaning from 20261124160000; the embed
-- job gives the rows their vectors back.

create or replace function public.pms_emails_skip_meaning(p_subject text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select btrim(coalesce(p_subject, '')) in ('', '{}')
      or coalesce(p_subject, '') ~* '^\s*(accepted|declined|tentative|tentatively accepted|canceled|cancelled|automatic reply)\s*:'
$$;

revoke all on function public.pms_emails_skip_meaning(text) from public, anon, authenticated;
grant execute on function public.pms_emails_skip_meaning(text) to service_role;

-- One-off: clear the vectors these rows already carry.
update public.pms_project_emails e
   set embedding = null, embedded_hash = null, embedded_at = null
 where e.embedding is not null
   and public.pms_emails_skip_meaning(e.subject);

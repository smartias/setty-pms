-- Accolade-O-Meter: an email the moment someone is recognized.
--
-- Until now the people named in an accolade heard about it in the Monday
-- digest, and only if they had the digest switched on. Now:
--
--   a new accolade        -> one email to each person it names
--   a gift on an accolade -> one email to each person it names, from the giver
--
-- How it works. An AFTER INSERT trigger on pms_accolades and on
-- pms_accolade_cheers asks pg_net to POST the row's id to the pms-user-emails
-- edge function (route /accolade-notify), which builds and sends the email.
-- pg_net queues the call and sends it after the insert commits, so saving an
-- accolade never waits on email, and the trigger swallows every error: a
-- broken email path must not stop anyone posting praise.
--
-- The x-pms-cron value is read from pms_integration_secrets when the trigger
-- fires (the same row the Monday digest uses). Where pg_net or that row is
-- missing (preview branches) the trigger does nothing, so a preview database
-- never calls production.
--
-- pms_accolade_notices is the "already told" list: one row per accolade, kind,
-- giver and recipient. The function claims a row before sending, so a gift
-- taken back and sent again does not email twice. Only the service role
-- touches it.
--
-- Off switch: update public.pms_accolade_settings set instant_emails = false;
-- Loading accolades in bulk by SQL: turn the switch off first (or
-- alter table ... disable trigger pms_accolades_notify), or every row emails.

alter table public.pms_accolade_settings
  add column if not exists instant_emails boolean not null default true;

create table if not exists public.pms_accolade_notices (
  id          bigint generated always as identity primary key,
  accolade_id bigint not null references public.pms_accolades (id) on delete cascade,
  kind        text not null,
  giver       text not null default '',   -- who sent the gift; '' for the accolade itself
  recipient   text not null,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  error       text,
  constraint pms_accolade_notices_kind_chk check (kind in ('accolade','gift')),
  constraint pms_accolade_notices_once unique (accolade_id, kind, giver, recipient)
);

alter table public.pms_accolade_notices enable row level security;
revoke all on public.pms_accolade_notices from anon, authenticated;
grant select, insert, update on public.pms_accolade_notices to service_role;

create or replace function public.pms_accolade_notify()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_token text;
  v_body  jsonb;
begin
  begin
    if not exists (select 1 from pg_extension where extname = 'pg_net')
       or to_regclass('public.pms_integration_secrets') is null then
      return new;
    end if;
    execute 'select token from public.pms_integration_secrets where name = $1'
      into v_token using 'user-emails-cron';
    if v_token is null then
      return new;
    end if;
    if tg_table_name = 'pms_accolades' then
      v_body := jsonb_build_object('kind', 'accolade', 'accolade_id', new.id);
    else
      v_body := jsonb_build_object('kind', 'gift', 'accolade_id', new.accolade_id, 'giver', lower(new.email));
    end if;
    perform net.http_post(
      url := 'https://khxmgjilwhdguuepbhne.supabase.co/functions/v1/pms-user-emails/accolade-notify',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-pms-cron', v_token),
      body := v_body,
      timeout_milliseconds := 30000
    );
  exception when others then
    raise warning 'pms_accolade_notify: email not queued: %', sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.pms_accolade_notify() from public, anon, authenticated;

drop trigger if exists pms_accolades_notify on public.pms_accolades;
create trigger pms_accolades_notify
  after insert on public.pms_accolades
  for each row when (new.removed_at is null)
  execute function public.pms_accolade_notify();

drop trigger if exists pms_accolade_cheers_notify on public.pms_accolade_cheers;
create trigger pms_accolade_cheers_notify
  after insert on public.pms_accolade_cheers
  for each row execute function public.pms_accolade_notify();

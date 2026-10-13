-- pms_followups: outgoing requests we are waiting on (a signed contract, an add
-- service, a payment, an answer). One table, many kinds: `kind` is a label with
-- a default cadence kept in the connector (followups.ts), not a schema branch.
--
-- Rows arrive from:
--   outlook_flag   a sent message the sender flagged in Outlook; flag_due_at
--                  seeds next_followup_at and (owner_email, internet_message_id)
--                  makes a re-sync idempotent
--   pms_generated  emails the PMS builds (add service request, transmittal)
--   manual         the add-in's Track button or the create_followup tool
--   suggested      a classifier's guess the person confirmed
--
-- Visibility: a person sees and changes their own rows; PMS admins see all.
-- The connector (service role) bypasses RLS and always stamps a real owner.
-- Whether PMs should see each other's follow-ups on a shared project is an open
-- decision; widening it is a policy change, not a schema change.

create table if not exists public.pms_followups (
  id                  bigint generated always as identity primary key,
  kind                text not null default 'general',
  label               text,                         -- free sub-label: 'Add Service 7', 'Invoice 3'
  subject             text not null,
  project_number      text,
  counterpart_name    text,
  counterpart_email   text,
  company             text,
  amount              numeric(14,2),

  -- the sent message this follows up on
  message_id          text,                         -- Graph message id (changes if the item moves folders)
  internet_message_id text,                         -- stable across moves; the dedupe key
  conversation_id     text,                         -- reply detection
  web_link            text,
  sent_at             timestamptz,
  flag_due_at         timestamptz,                  -- Outlook flag dueDateTime, when sourced from a flag

  -- state
  status              text not null default 'open',
  next_followup_at    timestamptz,
  snoozed_until       timestamptz,
  reminder_count      integer not null default 0,
  last_reminded_at    timestamptz,
  source              text not null default 'manual',
  resolution          text,                         -- 'signed', 'paid', 'received', 'replied', free text
  resolved_at         timestamptz,
  resolved_by         text,
  notes               text,

  owner_email         text not null,
  created_by          text not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint pms_followups_kind_chk
    check (kind in ('signature','payment','info','approval','general')),
  constraint pms_followups_status_chk
    check (status in ('open','snoozed','resolved','dismissed')),
  constraint pms_followups_source_chk
    check (source in ('outlook_flag','manual','pms_generated','suggested')),
  constraint pms_followups_resolved_chk
    check ((status in ('resolved','dismissed')) = (resolved_at is not null))
);

-- One tracked item per sent message per person; re-syncing a flag never duplicates.
create unique index if not exists pms_followups_msg_uidx
  on public.pms_followups (owner_email, internet_message_id)
  where internet_message_id is not null;
create index if not exists pms_followups_owner_open_idx
  on public.pms_followups (owner_email, next_followup_at)
  where status in ('open','snoozed');
create index if not exists pms_followups_project_idx
  on public.pms_followups (project_number) where project_number is not null;
create index if not exists pms_followups_conversation_idx
  on public.pms_followups (conversation_id) where conversation_id is not null;

create or replace function public.pms_followups_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists pms_followups_touch on public.pms_followups;
create trigger pms_followups_touch before update on public.pms_followups
  for each row execute function public.pms_followups_touch();

alter table public.pms_followups enable row level security;

-- Caller identity is the JWT email, the same claim the QA ledger RPCs read.
create or replace function public.pms_followups_caller_email()
returns text
language sql
stable
set search_path = public
as $$
  select lower(coalesce(
    nullif(current_setting('request.jwt.claims', true)::json ->> 'email', ''),
    nullif(current_setting('request.jwt.claims', true)::json ->> 'preferred_username', '')))
$$;

drop policy if exists pms_followups_select on public.pms_followups;
create policy pms_followups_select on public.pms_followups
  for select to authenticated
  using (lower(owner_email) = pms_followups_caller_email() or is_pms_admin());

drop policy if exists pms_followups_insert on public.pms_followups;
create policy pms_followups_insert on public.pms_followups
  for insert to authenticated
  with check (lower(owner_email) = pms_followups_caller_email()
              and lower(created_by) = pms_followups_caller_email());

drop policy if exists pms_followups_update on public.pms_followups;
create policy pms_followups_update on public.pms_followups
  for update to authenticated
  using (lower(owner_email) = pms_followups_caller_email() or is_pms_admin())
  with check (lower(owner_email) = pms_followups_caller_email() or is_pms_admin());

-- No delete policy: dismiss instead, so the record of what was chased survives.

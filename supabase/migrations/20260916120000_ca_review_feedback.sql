-- Feedback on Claude's CA reviews (per Sara, 2026-09-16): when an engineer
-- accepts, edits, replaces or dismisses the suggested RFI response / submittal
-- comments that save_ca_review put on a record, keep the SUGGESTED text, the
-- FINAL text the record was saved with, the stamps, and an optional one-line
-- "why" the reviewer types in the modal. The submittal-rfi-review skill reads
-- these back (connector tool search_review_feedback) before drafting the next
-- one, and recurring patterns get promoted into the skill's rules by a person
-- with the rows as evidence. Nothing here changes the CA record itself.
--
-- One row per (project, item, aiReview.at): the same review re-saved after
-- more edits UPDATES its row (the latest final text wins); a NEW review on the
-- same item (a different aiReview.at) gets its own row.
--
-- Writes come from the PMS app as the signed-in reviewer through the
-- SECURITY DEFINER function below (which stamps the caller from the JWT, never
-- from a client-supplied name), or from the connector (service role). Direct
-- table writes are admin-only; reads are open to every signed-in user, as the
-- QA ledger's are.

create table if not exists public.pms_ca_review_feedback (
  id                 bigserial primary key,
  project            text not null,             -- project NUMBER (matches pms_lessons.project_id)
  project_name       text,
  item_type          text not null check (item_type in ('rfi','submittal')),
  item_number        text not null,
  item_subject       text,
  discipline         text,
  ai_at              text not null default '',  -- aiReview.at as saved by save_ca_review
  ai_by              text,
  suggested_response text,
  final_response     text,
  suggested_stamp    text,
  final_stamp        text,
  outcome            text not null check (outcome in ('accepted','edited','replaced','dismissed')),
  why                text,                      -- the reviewer's own words on what changed and why
  reviewer           text not null,             -- caller email from the JWT
  recorded_at        timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists pms_ca_review_feedback_item
  on public.pms_ca_review_feedback (project, item_type, item_number, ai_at);
create index if not exists pms_ca_review_feedback_recent
  on public.pms_ca_review_feedback (updated_at desc);

alter table public.pms_ca_review_feedback enable row level security;
drop policy if exists ca_review_feedback_read on public.pms_ca_review_feedback;
create policy ca_review_feedback_read on public.pms_ca_review_feedback
  for select to authenticated using (true);
drop policy if exists ca_review_feedback_admin_all on public.pms_ca_review_feedback;
create policy ca_review_feedback_admin_all on public.pms_ca_review_feedback
  for all using (is_pms_admin()) with check (is_pms_admin());

create or replace function public.pms_ca_review_feedback_record(
  p_project            text,
  p_item_type          text,
  p_item_number        text,
  p_outcome            text,
  p_ai_at              text default '',
  p_ai_by              text default null,
  p_project_name       text default null,
  p_item_subject       text default null,
  p_discipline         text default null,
  p_suggested_response text default null,
  p_final_response     text default null,
  p_suggested_stamp    text default null,
  p_final_stamp        text default null,
  p_why                text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_row   public.pms_ca_review_feedback;
begin
  v_email := coalesce(
    nullif(current_setting('request.jwt.claims', true)::json ->> 'email', ''),
    nullif(current_setting('request.jwt.claims', true)::json ->> 'preferred_username', ''));
  if v_email is null then
    raise exception 'sign-in required: review feedback records who edited the suggestion';
  end if;
  if p_item_type not in ('rfi','submittal') then
    raise exception 'invalid item_type %', p_item_type;
  end if;
  if p_outcome not in ('accepted','edited','replaced','dismissed') then
    raise exception 'invalid outcome %', p_outcome;
  end if;
  if p_project is null or btrim(p_project) = '' or p_item_number is null or btrim(p_item_number) = '' then
    raise exception 'project and item_number are required';
  end if;

  insert into public.pms_ca_review_feedback as f
    (project, project_name, item_type, item_number, item_subject, discipline, ai_at, ai_by,
     suggested_response, final_response, suggested_stamp, final_stamp, outcome, why, reviewer)
  values
    (btrim(p_project), nullif(btrim(coalesce(p_project_name,'')),''), p_item_type, btrim(p_item_number),
     nullif(btrim(coalesce(p_item_subject,'')),''), nullif(btrim(coalesce(p_discipline,'')),''),
     coalesce(p_ai_at,''), nullif(btrim(coalesce(p_ai_by,'')),''),
     p_suggested_response, p_final_response,
     nullif(btrim(coalesce(p_suggested_stamp,'')),''), nullif(btrim(coalesce(p_final_stamp,'')),''),
     p_outcome, nullif(btrim(coalesce(p_why,'')),''), lower(v_email))
  on conflict (project, item_type, item_number, ai_at) do update set
     project_name       = coalesce(excluded.project_name, f.project_name),
     item_subject       = coalesce(excluded.item_subject, f.item_subject),
     discipline         = coalesce(excluded.discipline, f.discipline),
     ai_by              = coalesce(excluded.ai_by, f.ai_by),
     suggested_response = coalesce(excluded.suggested_response, f.suggested_response),
     final_response     = excluded.final_response,
     suggested_stamp    = coalesce(excluded.suggested_stamp, f.suggested_stamp),
     final_stamp        = excluded.final_stamp,
     outcome            = excluded.outcome,
     -- a "why" once typed is kept unless the reviewer types a new one
     why                = coalesce(excluded.why, f.why),
     reviewer           = excluded.reviewer,
     updated_at         = now()
  returning * into v_row;

  return json_build_object('id', v_row.id, 'outcome', v_row.outcome, 'reviewer', v_row.reviewer,
                           'updated_at', v_row.updated_at);
end;
$$;

revoke all on function public.pms_ca_review_feedback_record(text,text,text,text,text,text,text,text,text,text,text,text,text,text) from public;
revoke all on function public.pms_ca_review_feedback_record(text,text,text,text,text,text,text,text,text,text,text,text,text,text) from anon;
grant execute on function public.pms_ca_review_feedback_record(text,text,text,text,text,text,text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.pms_ca_review_feedback_record(text,text,text,text,text,text,text,text,text,text,text,text,text,text) to service_role;

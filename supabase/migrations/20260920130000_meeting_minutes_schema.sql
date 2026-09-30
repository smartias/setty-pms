-- Meeting minutes → structured items (issue #291).
--
-- Two new real tables, not JSONB-in-pms_projects: this mirrors pms_lessons,
-- not project.notes[]/rfis[]/submittals[]. A meeting record is authored by a
-- machine pipeline, not a person editing the PMS, and it needs its own
-- review-gate lifecycle (suggested -> confirmed/rejected) plus a carry-
-- forward chain across meetings — exactly the shape pms_lessons already
-- solved for knowledge. Splitting firm data across two homes for the same
-- pattern is the failure knowledge_capabilities.sql (2026-09-01) warned
-- against, so this follows it as closely as the domain allows.
--
-- project_number, not project_id: pms_project_emails.project_id is the
-- internal project->>'id' string, but pms_has_cap_for()'s p_project argument
-- resolves against pms_project_permissions.project_number (see
-- pms_lessons.project_id, which — despite its name — already holds a
-- project NUMBER for exactly this reason). Naming the column here for what
-- it actually holds avoids repeating that trap under a misleading name.
-- Application code resolves project_number itself (getProjectsUnfiltered /
-- resolveProjectId already return it) when correlating against
-- pms_project_emails, which is keyed on the internal id.
--
-- RFI/submittal links use the existing links[] convention (outgoingLinks /
-- incomingLinks, pms-mcp/index.ts) instead of a real foreign key: RFIs and
-- submittals live as elements of project.rfis[]/submittals[] JSONB arrays
-- with no stable relational PK to reference.

-- ── 1. pms_meetings — one row per parsed minutes document / OneNote page ────
create table if not exists public.pms_meetings (
  id uuid primary key default gen_random_uuid(),
  project_number text not null,
  meeting_date date,
  source text not null
    check (source = any (array['sharepoint-pm-folder','sharepoint-email-folder','onenote','manual'])),
  -- Stable id of the source document (SharePoint 'driveId|itemId', a filed
  -- email's record_id, or a OneNote page id) — the unique constraint below
  -- makes a re-sweep idempotent instead of re-extracting the same minutes.
  source_ref text not null,
  source_name text,
  source_url text,
  attendees jsonb not null default '[]'::jsonb,
  raw_text_chars integer,
  status text not null default 'processed' check (status = any (array['processed','failed'])),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_number, source_ref)
);

create index if not exists pms_meetings_project on public.pms_meetings (project_number);
create index if not exists pms_meetings_date on public.pms_meetings (meeting_date);

-- ── 2. pms_meeting_items — decisions / action items / open questions ───────
create table if not exists public.pms_meeting_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.pms_meetings(id) on delete cascade,
  project_number text not null,
  item_type text not null check (item_type = any (array['decision','action_item','open_question'])),
  item_number text,      -- printed number as it appears in the minutes, e.g. "3.2"
  text text not null,
  owner_name text,
  owner_email text,      -- resolved against pms_meta.data.staff, same lookup the digest uses
  owner_is_setty boolean not null default false,
  due_date date,
  status text not null default 'suggested'
    check (status = any (array['suggested','confirmed','rejected'])),
  -- Soft references (see file header) — {linkType, targetSystem, targetType,
  -- targetId, targetLabel, targetUrl}, same shape as project.rfis[]/etc links[].
  links jsonb not null default '[]'::jsonb,
  -- Carry-forward chain: matched at extraction time against this project's
  -- still-open items (see meeting-minutes-extract's carryForwardMatch).
  -- carried_from_item_id is a SUGGESTION until the reviewer confirms this
  -- item — the confirm cascade trigger (below) is what actually marks the
  -- prior item superseded, so a wrong auto-match never goes live silently.
  carried_from_item_id uuid references public.pms_meeting_items(id),
  superseded_by uuid references public.pms_meeting_items(id),
  first_seen_meeting_id uuid references public.pms_meetings(id),
  carry_count integer not null default 1,
  pushed_action_item boolean not null default false,
  pushed_note_id text,
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pms_meeting_items_project on public.pms_meeting_items (project_number);
create index if not exists pms_meeting_items_status on public.pms_meeting_items (status);
create index if not exists pms_meeting_items_meeting on public.pms_meeting_items (meeting_id);
create index if not exists pms_meeting_items_due on public.pms_meeting_items (due_date)
  where status = 'confirmed';
-- "Current" (not-yet-superseded) items are the hot path for project_briefing
-- and the CA digest — both filter status + superseded_by is null.
create index if not exists pms_meeting_items_current on public.pms_meeting_items (project_number, status)
  where superseded_by is null;

-- ── 3. Sweep rotation state ──────────────────────────────────────────────────
-- One cron invocation cannot walk every project's SharePoint folders in its
-- time budget (each project costs at least one Graph round trip, often
-- several for dated subfolders). last_swept_at lets the sweep route order
-- projects "least recently checked first" so repeated runs rotate through
-- the whole portfolio instead of the same alphabetical prefix every time.
create table if not exists public.pms_meeting_sweep_state (
  project_number text primary key,
  last_swept_at timestamptz not null default '1970-01-01T00:00:00Z'::timestamptz
);
-- Service-role only (the sweep route writes it with the service key); no
-- capability gives a browser session any reason to see or touch this table.
alter table public.pms_meeting_sweep_state enable row level security;

-- ── 4. Capability catalog + role defaults ───────────────────────────────────
insert into pms_capability_catalog (capability, label, description, sort)
values
  ('meeting_items.review', 'Review meeting items',
   'Confirm or reject decisions, action items and open questions extracted from filed meeting minutes — promotes suggestions into what project_briefing, the CA digest and the action-item list serve.',
   62)
on conflict (capability) do nothing;

-- New capability, no prior behavior to preserve, so this is a deliberately
-- conservative default rather than "everyone who could write today keeps
-- writing" (there is no "today" for a brand-new review gate). Admins can
-- widen it per-role from the Users & Roles tab (catalog-driven, no code
-- change needed) the same way knowledge.review is tuned.
insert into pms_role_permissions (role, capability, allowed)
select r.role, 'meeting_items.review', r.role in ('admin', 'project_manager', 'engineer')
from (values ('admin'),('project_manager'),('engineer'),('operations'),
             ('accounting'),('contracts'),('marketing'),('qaqc'),('staff')) as r(role)
on conflict (role, capability) do nothing;

-- ── 5. RLS (pms_meetings / pms_meeting_items) ───────────────────────────────
-- Reads stay wide, like every other intelligence/log table (pms_lessons,
-- pms_project_emails). Writes are two different stories:
--   - pms_meetings / new pms_meeting_items rows: service-role only (the
--     extraction pipeline runs as the edge function's service key, which
--     bypasses RLS entirely) — no insert policy for `authenticated` at all,
--     so a browser session can never forge a suggested item.
--   - pms_meeting_items UPDATE/DELETE (confirm/reject): RLS-gated on
--     meeting_items.review, called directly from the console via PostgREST,
--     exactly the pms_lessons pattern (no dedicated edge endpoint needed).
alter table public.pms_meetings enable row level security;
alter table public.pms_meeting_items enable row level security;

create policy pms_meetings_select on public.pms_meetings
  for select to authenticated using (true);

create policy pms_meeting_items_select on public.pms_meeting_items
  for select to authenticated using (true);
create policy pms_meeting_items_update on public.pms_meeting_items
  for update to authenticated
  using (pms_has_cap('meeting_items.review', project_number))
  with check (pms_has_cap('meeting_items.review', project_number));
create policy pms_meeting_items_delete on public.pms_meeting_items
  for delete to authenticated
  using (pms_has_cap('meeting_items.review', project_number));

-- ── 6. Confirm cascade ───────────────────────────────────────────────────────
-- Fires once, on the transition INTO 'confirmed' (not on every edit of an
-- already-confirmed row). Two side effects, both idempotent against a retry:
--   1. A confirmed, Setty-owned action item is pushed into the project's own
--      project.notes[] (the same "note with actionItem:true" shape the PMS
--      and Outlook add-in already write) via a single atomic jsonb_set +
--      version bump — see CLAUDE.md "any direct SQL edit must bump version".
--      Guarded by pushed_action_item so a second confirm (e.g. after an
--      edit) never double-pushes.
--   2. If this item carries forward from a prior one, that prior item is
--      marked superseded_by = this item's id, so "current open items"
--      queries (project_briefing, the CA digest) show only the latest
--      instance of a renumbered item while first_seen_meeting_id/carry_count
--      (set at extraction time) still carry the aging signal forward.
create or replace function public.pms_meeting_item_confirm_cascade()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_note_id text;
  v_note jsonb;
begin
  if new.status = 'confirmed' and old.status is distinct from new.status then
    if new.item_type = 'action_item' and new.owner_is_setty and not coalesce(new.pushed_action_item, false) then
      v_note_id := gen_random_uuid()::text;
      v_note := jsonb_build_object(
        'id', v_note_id,
        'body', new.text,
        'category', 'Action Item',
        'actionItem', true,
        'actionOwner', new.owner_name,
        'actionDueDate', new.due_date,
        'actionStatus', 'open',
        'author', 'Meeting minutes' || case when new.reviewed_by is not null then ' (confirmed by ' || new.reviewed_by || ')' else '' end,
        'createdAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'updatedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'links', jsonb_build_array(jsonb_build_object(
          'linkType', 'source', 'targetSystem', 'pms', 'targetType', 'meeting_item',
          'targetId', new.id, 'targetLabel', coalesce(new.item_number, 'Meeting minutes item')
        ))
      );
      update public.pms_projects
         set project = jsonb_set(
               coalesce(project, '{}'::jsonb),
               '{notes}',
               (coalesce(project -> 'notes', '[]'::jsonb)) || v_note
             ),
             version = coalesce(version, 0) + 1,
             updated_by = 'meeting-minutes-extraction'
       where project ->> 'projectNumber' = new.project_number;
      -- Fail loudly rather than silently mark this pushed: NEW.status is
      -- already becoming 'confirmed' by the time this trigger runs again,
      -- so a swallowed miss here would lose the action item with no retry.
      if not found then
        raise exception 'pms_meeting_item_confirm_cascade: no project with projectNumber %', new.project_number;
      end if;
      new.pushed_action_item := true;
      new.pushed_note_id := v_note_id;
    end if;

    if new.carried_from_item_id is not null then
      update public.pms_meeting_items
         set superseded_by = new.id, updated_at = now()
       where id = new.carried_from_item_id
         and superseded_by is null;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists pms_meeting_item_confirm_cascade on public.pms_meeting_items;
create trigger pms_meeting_item_confirm_cascade
  before update on public.pms_meeting_items
  for each row execute function public.pms_meeting_item_confirm_cascade();

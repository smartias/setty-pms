-- pms_mcp_telemetry: two additions the connector's tool wrapper writes from
-- build 2026-09-17-telemetry-fixes (pms-mcp 1.19.1) onward.
--
-- 1. project_arg: WHICH project parameter name the call used
--    ('projectNumber' | 'identifier' | 'project' | null). project_number
--    already folds all three into one value, so the deprecated `identifier`
--    alias (accepted since 2026-08-05 for clients that cached the old schema)
--    could never be retired on evidence. Now it can:
--      select count(*) from public.pms_mcp_telemetry
--       where project_arg = 'identifier' and created_at > now() - interval '30 days';
--    0 means every connected client has cycled and the alias can go.
--
-- 2. outcome 'hidden': a project-scoped call the caller's PMS role may not
--    view. The wrapper answers not-found without running the tool; until now
--    it logged that as 'error', so the Admin card's error count mixed access
--    denials with typos and real failures.
--
-- APPLY BEFORE deploying the connector build: PostgREST rejects an insert
-- with an unknown column or a failed CHECK with a 400, the connector swallows
-- telemetry errors by design, and every tool call would then log nothing.
--
-- The table was created by hand (no migration in the repo), so the CHECK on
-- outcome, if there is one, has an unknown name: find and replace it rather
-- than assume.

alter table public.pms_mcp_telemetry
  add column if not exists project_arg text;

-- If outcome was declared as an enum rather than text, the new value has to be
-- added to the type; a CHECK alone would not let the insert through.
do $$
declare
  t record;
begin
  select pt.typname, pn.nspname into t
    from pg_attribute a
    join pg_type pt on pt.oid = a.atttypid
    join pg_namespace pn on pn.oid = pt.typnamespace
   where a.attrelid = 'public.pms_mcp_telemetry'::regclass
     and a.attname = 'outcome' and pt.typtype = 'e';
  if found then
    execute format('alter type %I.%I add value if not exists %L', t.nspname, t.typname, 'hidden');
  end if;
end $$;

do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.pms_mcp_telemetry'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%outcome%'
  loop
    execute format('alter table public.pms_mcp_telemetry drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.pms_mcp_telemetry
  add constraint pms_mcp_telemetry_outcome_check
  check (outcome is null or outcome in ('hit', 'empty', 'error', 'hidden'));

comment on column public.pms_mcp_telemetry.project_arg is
  'Which project parameter the call used: projectNumber | identifier (deprecated alias) | project. Null when the tool takes none. Retire the alias when no recent row says identifier.';

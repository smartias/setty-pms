-- Advisor lint 0011 (function_search_path_mutable): pin search_path on five
-- functions. Applied live 2026-09-30 via apply_migration.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('pms_append_milestone','pms_drawing_search','pms_projects_stamp_team',
                         'pms_filing_log_bind_author','pms_filing_log_freeze')
  loop
    execute format('alter function %s set search_path = public, pg_catalog', f.sig);
  end loop;
end $$;

-- Knowledge-layer cleanup (2026-10-05 audit).
-- 1. One canonical discipline vocabulary, enforced by trigger on the three
--    knowledge tables so mined/connector rows stay clean going forward.
-- 2. Backfill existing rows.
-- 3. pms_person_work: RFI rows fell back to pms_rfis.last_action ("Sent and
--    Closed") when response_date was empty, putting junk in work_date. Keep the
--    fallback only when it looks like a date. Also fold HVAC/Miscellaneous/
--    Other/Multi-Discipline into the canonical labels. The matview was never
--    defined in a migration, so it is rebuilt from its live definition with
--    guarded replacements (the block raises if the expected text is missing).

create or replace function public.pms_norm_discipline(d text)
returns text language sql immutable set search_path = public, pg_catalog as $$
  select case
    when d is null or btrim(d) = '' then null
    when lower(btrim(d)) in ('fire alarm','fire protection/fuel','fire/life safety') then 'Fire Protection'
    when lower(btrim(d)) in ('low voltage','technology','telecom','technology/telecom') then 'Technology/Telecom'
    when btrim(d) ~ '[,/]' or lower(btrim(d)) in ('multi','multi-discipline','multiple') then 'General'
    else btrim(d)
  end
$$;

create or replace function public.pms_norm_discipline_trg()
returns trigger language plpgsql set search_path = public, pg_catalog as $$
begin
  new.discipline := public.pms_norm_discipline(new.discipline);
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['pms_lessons','pms_best_practices','pms_agency_preferences'] loop
    execute format('drop trigger if exists pms_norm_discipline on public.%I', t);
    execute format('create trigger pms_norm_discipline before insert or update of discipline on public.%I
                    for each row execute function public.pms_norm_discipline_trg()', t);
    execute format('update public.%I set discipline = public.pms_norm_discipline(discipline)
                    where discipline is distinct from public.pms_norm_discipline(discipline)', t);
  end loop;
end $$;

do $$
declare d text; d0 text;
begin
  d0 := pg_get_viewdef('public.pms_person_work'::regclass);
  d := rtrim(rtrim(d0), ';');
  d0 := d;

  d := replace(d,
    $a$"left"(COALESCE((r.response_date)::text, r.last_action, ''::text), 10) AS work_date$a$,
    $b$(CASE WHEN "left"(COALESCE((r.response_date)::text, r.last_action, ''::text), 10) ~ '^\d{4}-\d{2}-\d{2}$' THEN "left"(COALESCE((r.response_date)::text, r.last_action, ''::text), 10) END) AS work_date$b$);
  if d = d0 then raise exception 'pms_person_work: RFI work_date expression not found'; end if;

  d0 := d;
  d := replace(d,
    $a$NULLIF(u.discipline, ''::text) AS discipline$a$,
    $b$(CASE lower(btrim(NULLIF(u.discipline, ''::text))) WHEN 'hvac' THEN 'Mechanical' WHEN 'miscellaneous' THEN 'General' WHEN 'other' THEN 'General' WHEN 'multi-discipline' THEN 'General' ELSE NULLIF(btrim(u.discipline), ''::text) END) AS discipline$b$);
  if d = d0 then raise exception 'pms_person_work: discipline expression not found'; end if;

  drop materialized view public.pms_person_work;
  execute 'create materialized view public.pms_person_work as ' || d;
  create unique index pms_person_work_id on public.pms_person_work (id);
  create index pms_person_work_person on public.pms_person_work (person);
  -- New objects in this project default-grant to anon; the original matview had no anon access.
  revoke all on public.pms_person_work from anon;
  grant all on public.pms_person_work to authenticated, service_role;
end $$;

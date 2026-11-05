-- Knowledge entries can belong to several disciplines (Dejan / Sara, 2026-11-05).
--
-- Applies to every knowledge table that carries a discipline:
--   pms_lessons (Project Knowledge), pms_best_practices,
--   pms_agency_preferences, pms_engineering_standards.
--
-- Why a new column instead of "Mechanical, Electrical" in `discipline`: the
-- pms_norm_discipline trigger (20261005120000) rewrites any discipline value
-- containing ',' or '/' to 'General', so a joined string is silently
-- collapsed. `disciplines text[]` holds the full set; `discipline` stays as the
-- PRIMARY (first) trade so every existing reader and writer keeps working.
--
-- Splitting rule (pms_split_disciplines): a legacy value naming several trades
-- ("Plumbing/Fire Protection", "Mechanical, Electrical") now becomes those
-- trades instead of 'General'. Names that legitimately contain a slash
-- (Technology/Telecom, Fire Protection/Fuel) are mapped first, exactly as
-- pms_norm_discipline maps them. Each part is normalized with
-- pms_norm_discipline.
--
-- Production data: the backfill below fills `disciplines` only. It runs
-- before the new trigger exists and does not touch `discipline`, so no
-- existing discipline value is rewritten by this migration.

-- 1. Split one discipline string into normalized trades.
create or replace function public.pms_split_disciplines(d text)
returns text[]
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case
    when d is null or btrim(d) = '' then '{}'::text[]
    -- Whole-value mappings first (some contain '/'): same list as pms_norm_discipline.
    when lower(btrim(d)) in ('fire alarm','fire protection/fuel','fire/life safety',
                             'low voltage','technology','telecom','technology/telecom',
                             'multi','multi-discipline','multiple')
      then array[public.pms_norm_discipline(d)]
    else coalesce((
      select array_agg(n order by first_pos)
      from (
        select public.pms_norm_discipline(p) as n, min(i) as first_pos
        from unnest(regexp_split_to_array(d, '\s*[,/]\s*')) with ordinality as s(p, i)
        where public.pms_norm_discipline(p) is not null
        group by 1
      ) t
    ), '{}'::text[])
  end
$$;

-- 2. The column, on each table.
alter table public.pms_lessons               add column if not exists disciplines text[] not null default '{}'::text[];
alter table public.pms_best_practices        add column if not exists disciplines text[] not null default '{}'::text[];
alter table public.pms_agency_preferences    add column if not exists disciplines text[] not null default '{}'::text[];
alter table public.pms_engineering_standards add column if not exists disciplines text[] not null default '{}'::text[];

-- 3. Backfill BEFORE the trigger exists: fills `disciplines`, leaves
--    `discipline` exactly as it is.
update public.pms_lessons               set disciplines = public.pms_split_disciplines(discipline)
 where coalesce(cardinality(disciplines), 0) = 0 and nullif(btrim(coalesce(discipline, '')), '') is not null;
update public.pms_best_practices        set disciplines = public.pms_split_disciplines(discipline)
 where coalesce(cardinality(disciplines), 0) = 0 and nullif(btrim(coalesce(discipline, '')), '') is not null;
update public.pms_agency_preferences    set disciplines = public.pms_split_disciplines(discipline)
 where coalesce(cardinality(disciplines), 0) = 0 and nullif(btrim(coalesce(discipline, '')), '') is not null;
update public.pms_engineering_standards set disciplines = public.pms_split_disciplines(discipline)
 where coalesce(cardinality(disciplines), 0) = 0 and nullif(btrim(coalesce(discipline, '')), '') is not null;

-- 4. Keep the two columns consistent on every write from now on.
--    `disciplines` is the source of truth; `discipline` ends up as its first
--    element.
--   * INSERT with only `discipline` (mining pipelines, the connector's
--     save_knowledge) -> disciplines := split(discipline).
--   * UPDATE that changed `disciplines` -> taken as given, even when emptied.
--   * UPDATE that changed only `discipline` (a writer that knows just the
--     single column) -> it replaces the PRIMARY trade; the other trades a
--     director added are kept, so an automated re-write cannot wipe them.
--   * Every element is normalized; blanks and duplicates drop, order kept.
create or replace function public.pms_knowledge_disciplines_trg()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  clean   text[];
  has_one boolean := nullif(btrim(coalesce(new.discipline, '')), '') is not null;
begin
  if tg_op = 'INSERT' then
    if coalesce(cardinality(new.disciplines), 0) = 0 and has_one then
      new.disciplines := public.pms_split_disciplines(new.discipline);
    end if;
  elsif new.disciplines is not distinct from old.disciplines then
    if new.discipline is distinct from old.discipline then
      new.disciplines := (case when has_one then public.pms_split_disciplines(new.discipline) else '{}'::text[] end)
                         || array_remove(coalesce(old.disciplines, '{}'::text[]), old.discipline);
    elsif coalesce(cardinality(new.disciplines), 0) = 0 and has_one then
      new.disciplines := public.pms_split_disciplines(new.discipline);   -- a row the backfill missed
    end if;
  end if;

  select coalesce(array_agg(d order by first_pos), '{}'::text[]) into clean
  from (
    select x.d, min(x.pos) as first_pos
    from (
      select s.d, (u.i * 100 + s.j) as pos
      from unnest(coalesce(new.disciplines, '{}'::text[])) with ordinality as u(v, i)
      cross join lateral unnest(public.pms_split_disciplines(u.v)) with ordinality as s(d, j)
    ) x
    group by x.d
  ) t;

  new.disciplines := clean;
  new.discipline  := clean[1];   -- null when the set is empty
  return new;
end
$$;

-- Trigger name sorts before "pms_norm_discipline", so it runs first; that
-- trigger then re-normalizes `discipline`, a no-op on an already clean value.
do $$
declare t text;
begin
  foreach t in array array['pms_lessons','pms_best_practices','pms_agency_preferences','pms_engineering_standards'] loop
    execute format('drop trigger if exists pms_knowledge_disciplines on public.%I', t);
    execute format('create trigger pms_knowledge_disciplines before insert or update on public.%I
                    for each row execute function public.pms_knowledge_disciplines_trg()', t);
    execute format('create index if not exists %I on public.%I using gin (disciplines)', t || '_disciplines_idx', t);
  end loop;
end $$;

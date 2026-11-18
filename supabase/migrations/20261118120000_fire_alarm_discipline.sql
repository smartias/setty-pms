-- Fire Alarm becomes its own discipline (tech directors, 2026-11-18).
--
-- Until now pms_norm_discipline folded 'Fire Alarm' into 'Fire Protection' on
-- every write to the knowledge tables, so Fire Alarm could never be stored.
-- This keeps every other mapping exactly as it was and only stops that one
-- collapse. 'Fire Protection/Fuel' and 'Fire/Life Safety' still map to
-- Fire Protection.
--
-- No data is rewritten here. Rows already filed under Fire Protection stay
-- there; the Intelligence page's "Possible Fire Alarm (not yet tagged)" filter
-- lists the ones whose text uses fire alarm terms so a director can retag them.
-- pms_split_disciplines and pms_knowledge_disciplines_trg call this function,
-- so 'disciplines' picks up the new value without further changes.

create or replace function public.pms_norm_discipline(d text)
returns text language sql immutable set search_path = public, pg_catalog as $$
  select case
    when d is null or btrim(d) = '' then null
    when lower(btrim(d)) = 'fire alarm' then 'Fire Alarm'
    when lower(btrim(d)) in ('fire protection/fuel','fire/life safety') then 'Fire Protection'
    when lower(btrim(d)) in ('low voltage','technology','telecom','technology/telecom') then 'Technology/Telecom'
    when btrim(d) ~ '[,/]' or lower(btrim(d)) in ('multi','multi-discipline','multiple') then 'General'
    else btrim(d)
  end
$$;

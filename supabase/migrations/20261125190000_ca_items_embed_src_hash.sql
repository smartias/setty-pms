-- Make the CA embed queue cheap to check (2026-11-25).
--
-- pms_ca_items_to_embed recomputed pms_ca_items_embed_text (two lookahead
-- regexes over each body) for every row on every call, only to compare its md5
-- with embedded_hash. With the queue empty that was ~1.1 s of database time per
-- call (EXPLAIN ANALYZE: 1,095 ms for 0 rows over 3,106 rows), once a minute.
--
-- The hash of the text to embed is now a stored generated column, computed when
-- a row is written (the projection upsert or the embedding store), so the queue
-- check compares two columns.
--
-- IF pms_ca_items_embed_text IS EVER CHANGED: Postgres does not recompute stored
-- generated columns when a function they call is replaced. After replacing it,
-- refresh the column (any UPDATE recomputes it) so changed texts re-embed:
--   update public.pms_ca_items set subject = subject;
--
-- Also: the pms-ca-items-embed cron goes from every minute to every 5 minutes
-- (minutes 3, 8, 13, ...). CA items change far less often than email, and the
-- two embed jobs no longer start in the same second every minute.

alter table public.pms_ca_items
  add column if not exists embed_src_hash text
  generated always as (md5(public.pms_ca_items_embed_text(subject, body_text))) stored;

comment on column public.pms_ca_items.embed_src_hash is
  'md5 of pms_ca_items_embed_text(subject, body_text); null when there is no text. '
  'Compared with embedded_hash by pms_ca_items_to_embed. Refresh after changing '
  'pms_ca_items_embed_text: update pms_ca_items set subject = subject.';

-- Same contract as 20261017150000: rows with no embedding, or embedded from
-- different text. The text itself is computed only for the rows returned.
create or replace function public.pms_ca_items_to_embed(p_limit integer default 200)
returns table (project_row_id text, item_type text, item_id text, embed_text text, embed_hash text)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select c.project_row_id, c.item_type, c.item_id,
         public.pms_ca_items_embed_text(c.subject, c.body_text) as embed_text,
         c.embed_src_hash as embed_hash
  from public.pms_ca_items c
  where c.embed_src_hash is not null
    and (c.embedding is null or c.embedded_hash is distinct from c.embed_src_hash)
  order by c.projected_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000))
$$;

-- Store only when the row's text still matches what was embedded (unchanged
-- rule), now read from the stored hash.
create or replace function public.pms_ca_items_store_embeddings(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_n integer := 0;
begin
  with incoming as (
    select r->>'project_row_id' as project_row_id, r->>'item_type' as item_type, r->>'item_id' as item_id,
           r->>'embed_hash' as embed_hash, (r->>'embedding')::extensions.vector(384) as embedding
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    where jsonb_typeof(r) = 'object' and r ? 'embedding'
  )
  update public.pms_ca_items c
  set embedding = i.embedding, embedded_hash = i.embed_hash, embedded_at = now()
  from incoming i
  where c.project_row_id = i.project_row_id and c.item_type = i.item_type and c.item_id = i.item_id
    and c.embed_src_hash = i.embed_hash;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

revoke all on function public.pms_ca_items_to_embed(integer) from public, anon, authenticated;
revoke all on function public.pms_ca_items_store_embeddings(jsonb) from public, anon, authenticated;
grant execute on function public.pms_ca_items_to_embed(integer) to service_role;
grant execute on function public.pms_ca_items_store_embeddings(jsonb) to service_role;

do $cron$
declare
  j bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed: schedule unchanged.';
    return;
  end if;
  select jobid into j from cron.job where jobname = 'pms-ca-items-embed';
  if j is not null then
    perform cron.alter_job(job_id := j, schedule := '3-59/5 * * * *');
  else
    raise notice 'pms-ca-items-embed not scheduled here: nothing to reschedule.';
  end if;
end
$cron$;

-- Email embeddings: put the sender and the attachment names in the text
-- that is embedded. Item 5 of the review in PROPOSAL-emails-embed-text.md.
--
-- Why: the keyword index (search_tsv) covers subject, sender, body and
-- attachment names; the vector covered only subject and body. "The cut
-- sheet Havtech sent for the chiller" has two of its three handles outside
-- the vector, and a submittal's file name ("236426-001-0 Air Cooled Scroll
-- Chiller CH-1 Quantech PD.pdf") often says more than its one-line body.
--
-- What changes:
--   pms_emails_embed_text(subject, body, from_name, from_address,
--                         attachment_names)        new 5-argument form:
--       <subject>                      as before (prefixes stripped)
--       From <name> (<organisation>)   organisation = the address's domain
--                                      minus its ending, left out for
--                                      gmail/outlook/… mailboxes
--       Attachments: <names>           extensions off, underscores to
--                                      spaces, image stubs (image001.png,
--                                      cid…) skipped, de-duplicated, the
--                                      line cut at 300 characters
--       <cleaned new text of the body> as before
--       whole thing cut at 1,500 characters, so the body is what gets cut;
--       a message with no subject and no body stays "nothing to embed"
--       whoever sent it and whatever it carried
--   pms_emails_embed_text(subject, body)  unchanged: it is what the search
--       snippet is cut from, and what the 5-argument form builds on.
--   pms_emails_to_embed / pms_emails_store_embeddings use the 5-argument
--       form, so the hash guard covers the sender and the names.
--
-- Cost: every row's text changes, so the one-off at the bottom marks EVERY
-- embedded row stale (embedded_at = null, vector kept: still searchable on
-- its old text). The job refreshes them newest first at its usual pace,
-- about 5 rows a minute, so 22,000 rows take about three days; the verify
-- script's coverage query shows `stale` falling.
--
-- Apply after 20261029150000; safe to run twice (the one-off re-marks
-- rows the job already refreshed, which just costs the job another pass
-- over them). No connector change.

-- ── The 5-argument text ──────────────────────────────────────────────────────
create or replace function public.pms_emails_embed_text(
  p_subject text, p_body text, p_from_name text, p_from_address text, p_attachments jsonb)
returns text
language sql immutable parallel safe
set search_path = ''
as $$
  with org as (
    select nullif(lower(regexp_replace(
             regexp_replace(coalesce(p_from_address, ''), '^.*@', ''),   -- the domain
             '\.[a-z0-9.-]*$', '', 'i')), '') as label                    -- minus its ending(s): southern-air.com → southern-air
  ),
  from_line as (
    select nullif(concat_ws(' ',
             'From',
             nullif(regexp_replace(coalesce(p_from_name, ''), '\s+', ' ', 'g'), ''),
             case when o.label is not null
                    and o.label !~ '^(gmail|googlemail|outlook|hotmail|live|msn|yahoo|icloud|me|aol|comcast|verizon|protonmail|proton|mail)$'
                  then '(' || o.label || ')' end), 'From') as line
    from org o
  ),
  names as (
    select distinct
           regexp_replace(regexp_replace(btrim(x), '\.[A-Za-z0-9]{1,5}$', ''), '_+', ' ', 'g') as name
    from jsonb_array_elements_text(case when jsonb_typeof(p_attachments) = 'array' then p_attachments else '[]'::jsonb end) x
    where length(btrim(x)) >= 4
      and x !~* '^(image|picture|cid|oledata|att|outlook-[a-z0-9]+)[0-9]*\.'
  ),
  attach_line as (
    select case when count(*) > 0
                then left('Attachments: ' || string_agg(name, ', ' order by name), 300) end as line
    from names
    where name <> ''
  )
  select case
           -- no subject and no body: nothing to embed, whoever sent it
           when public.pms_emails_embed_text(p_subject, p_body) is null then null
           else nullif(left(concat_ws(E'\n',
                  public.pms_emails_embed_text(p_subject, null),
                  (select line from from_line),
                  (select line from attach_line),
                  public.pms_emails_embed_text(null, p_body)), 1500), '')
         end
$$;

-- ── Queue and store on the 5-argument text ───────────────────────────────────
create or replace function public.pms_emails_to_embed(p_limit integer default 20)
returns table (record_id text, embed_text text, embed_hash text)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with lim as (select greatest(1, least(coalesce(p_limit, 20), 1000)) as n),
  fresh as (
    select e.record_id, e.email_date, t.embed_text
    from public.pms_project_emails e
    cross join lateral (select public.pms_emails_embed_text(e.subject, e.body_text, e.from_name, e.from_address, e.attachment_names) as embed_text) t
    where e.embedding is null
      and t.embed_text is not null
    order by e.email_date desc nulls last
    limit (select n from lim)
  ),
  stale as (
    select e.record_id, e.email_date, t.embed_text
    from public.pms_project_emails e
    cross join lateral (select public.pms_emails_embed_text(e.subject, e.body_text, e.from_name, e.from_address, e.attachment_names) as embed_text) t
    where e.embedded_at is null and e.embedding is not null
      and t.embed_text is not null
    order by e.email_date desc nulls last
    limit (select n from lim)
  )
  select q.record_id, q.embed_text, md5(q.embed_text) as embed_hash
  from (
    select 0 as pri, * from fresh
    union all
    select 1 as pri, * from stale
  ) q
  order by q.pri, q.email_date desc nulls last
  limit (select n from lim)
$$;

create or replace function public.pms_emails_store_embeddings(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_n integer := 0;
begin
  with incoming as (
    select r->>'record_id' as record_id, r->>'embed_hash' as embed_hash,
           (r->>'embedding')::extensions.vector(384) as embedding
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    where jsonb_typeof(r) = 'object' and r ? 'embedding'
  )
  update public.pms_project_emails e
  set embedding = i.embedding, embedded_hash = i.embed_hash, embedded_at = now()
  from incoming i
  where e.record_id = i.record_id
    and md5(coalesce(public.pms_emails_embed_text(e.subject, e.body_text, e.from_name, e.from_address, e.attachment_names), '')) = i.embed_hash;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

revoke all on function public.pms_emails_to_embed(integer) from public, anon, authenticated;
revoke all on function public.pms_emails_store_embeddings(jsonb) from public, anon, authenticated;
grant execute on function public.pms_emails_to_embed(integer) to service_role;
grant execute on function public.pms_emails_store_embeddings(jsonb) to service_role;

-- ── One-off: every embedded row is stale ─────────────────────────────────────
-- Vector kept, embedded_at cleared; the job refreshes them newest first.
update public.pms_project_emails
set embedded_at = null
where embedding is not null
  and embedded_at is not null;

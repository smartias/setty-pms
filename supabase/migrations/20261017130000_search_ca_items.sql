-- search_ca_items: the read side of pms_ca_items for the connector's
-- search_rfis_submittals (step 2 of PROPOSAL-ca-items-table.md). Replaces the
-- in-memory substring scan over every project blob with one indexed query.
--
-- VISIBILITY IS THE CALLER'S. This runs as definer and bypasses RLS, so it
-- never decides which projects a person may see: `p_row_ids` is the set of
-- pms_projects.id values the connector already resolved as visible for the
-- caller (getProjects() / getProjectById(), the same path every other tool
-- uses). Null or empty returns nothing (fail closed), and the function is
-- executable by service_role only.
--
-- Three query shapes, chosen by the connector (caItems.ts classifies the text):
--   p_number  an item-number token: 'RFI-012', '12', 'SUB-004'. Matches when the
--             digits agree ignoring leading zeros ('RFI-000' is '0', not absent),
--             or a token with a prefix or suffix is a substring of the number
--             (so 'SUB-004' still finds 'SUB-004.1'). Rank 10.
--   p_spec    a spec section as digits ('230923'). Matches on the digits of the
--             stored section, so '23 09 23', '23-09-23' and '230923' agree. Rank 5.
--   p_text    prose, via websearch_to_tsquery('english') against search_tsv:
--             "dampers" finds "damper". Rank ts_rank_cd, snippet from ts_headline.
--             A prose query also matches a discipline or status it is contained in
--             ("Mechanical", "Closed", "resub"), as the in-memory scan did. Rank 1.
-- With none of the three, the matching rows are listed newest received first,
-- exactly as the tool did before. The hard filters (type, status, discipline,
-- open only) apply in every shape and hit the indexes from the table migration.

create or replace function public.search_ca_items(
  p_row_ids    text[],
  p_text       text    default null,
  p_number     text    default null,
  p_spec       text    default null,
  p_type       text    default null,
  p_status     text    default null,
  p_discipline text    default null,
  p_open_only  boolean default false,
  p_limit      integer default 30
)
returns table (
  project_row_id text, project_number text, item_type text, item_id text, number text,
  subject text, discipline text, spec_section text, status text, is_open boolean,
  date_received date, due_date date, date_closed date, link_count integer,
  has_ai_review boolean, rank real, snippet text
)
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select
      case when nullif(btrim(p_text), '') is not null then websearch_to_tsquery('english', p_text) end as tsq,
      -- leading zeros dropped but the last digit kept, so 'RFI-000' stays '0'
      nullif(regexp_replace(regexp_replace(coalesce(p_number, ''), '\D', '', 'g'), '^0+(?=\d)', ''), '') as num_digits,
      nullif(btrim(p_number), '')                                                                   as num_token,
      nullif(btrim(p_text), '')                                                                     as text_token,
      nullif(regexp_replace(coalesce(p_spec, ''), '\D', '', 'g'), '')                               as spec_digits
  ),
  hits as (
    select c.*, q.tsq, q.num_token, q.spec_digits, q.text_token,
      -- digits agree ignoring leading zeros; a token with a prefix or suffix
      -- ('SUB-004', '002A') also matches as a substring, a bare digit string
      -- never does ('0' would otherwise match every number containing a 0)
      coalesce(q.num_token is not null
               and (regexp_replace(regexp_replace(coalesce(c.number, ''), '\D', '', 'g'), '^0+(?=\d)', '') = q.num_digits
                    or (q.num_token !~ '^\d+$' and c.number ilike '%' || q.num_token || '%')), false) as number_hit,
      coalesce(q.spec_digits is not null
               and regexp_replace(coalesce(c.spec_section, ''), '\D', '', 'g') = q.spec_digits, false) as spec_hit,
      coalesce(q.tsq is not null and c.search_tsv @@ q.tsq, false)                                   as text_hit,
      coalesce(q.text_token is not null
               and (c.discipline ilike '%' || q.text_token || '%' or c.status ilike '%' || q.text_token || '%'), false) as field_hit
    from public.pms_ca_items c
    cross join q
    where c.project_row_id = any (coalesce(p_row_ids, '{}'::text[]))
      and (p_type is null or c.item_type = p_type)
      and (p_status is null or c.status = p_status)
      and (p_discipline is null or lower(coalesce(c.discipline, '')) = lower(p_discipline))
      and (not coalesce(p_open_only, false) or c.is_open)
  )
  select
    h.project_row_id, h.project_number, h.item_type, h.item_id, h.number, h.subject, h.discipline,
    h.spec_section, h.status, h.is_open, h.date_received, h.due_date, h.date_closed,
    jsonb_array_length(h.links)::integer as link_count, h.has_ai_review,
    ( (case when h.number_hit then 10 else 0 end)
    + (case when h.spec_hit then 5 else 0 end)
    + (case when h.field_hit then 1 else 0 end)
    + (case when h.text_hit then ts_rank_cd(h.search_tsv, h.tsq) else 0 end) )::real as rank,
    case when h.text_hit
         then ts_headline('english', coalesce(h.body_text, ''), h.tsq,
                          'StartSel=[, StopSel=], MaxWords=35, MinWords=15, MaxFragments=2, FragmentDelimiter=" … "')
         else left(coalesce(h.response, h.description, h.subject, ''), 200) end as snippet
  from hits h
  where (h.num_token is null and h.spec_digits is null and h.text_token is null)
     or h.number_hit or h.spec_hit or h.text_hit or h.field_hit
  order by rank desc, h.date_received desc nulls last, h.number desc
  limit greatest(1, least(coalesce(p_limit, 30), 100))
$$;

revoke all on function public.search_ca_items(text[], text, text, text, text, text, text, boolean, integer)
  from public, anon, authenticated;
grant execute on function public.search_ca_items(text[], text, text, text, text, text, text, boolean, integer)
  to service_role;

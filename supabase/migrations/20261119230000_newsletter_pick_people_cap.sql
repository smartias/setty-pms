-- newsletter_pick_people: refuse more than 400 people in one pick. A hand-picked
-- batch is drafted as a single Outlook message, and Outlook caps recipients per
-- message; without a bound, a large pick could not be sent after its people had
-- already left their original batches. The page enforces the same limit.

do $$
begin
  if to_regclass('public.newsletter_campaign_batches') is null then
    raise notice 'newsletter_campaign_batches does not exist here; skipping';
    return;
  end if;

  execute $fn$
  create or replace function public.newsletter_pick_people(p_campaign uuid, p_emails text[])
  returns public.newsletter_campaign_batches
  language plpgsql
  security invoker            -- the caller's row-level security applies (pipeline.edit to write)
  set search_path = public, pg_catalog
  as $body$
  declare
    v_want  text[];
    v_found text[] := '{}';
    v_take  text[];
    v_keep  jsonb;
    v_new   public.newsletter_campaign_batches;
    v_who   text := nullif(coalesce(auth.jwt() ->> 'email', ''), '');
    r       record;
  begin
    select array_agg(distinct lower(e)) into v_want from unnest(p_emails) e where coalesce(e, '') <> '';
    if v_want is null then return null; end if;
    -- One hand-picked batch becomes one Outlook draft, which has a recipient ceiling.
    if array_length(v_want, 1) > 400 then
      raise exception 'Pick at most 400 people at a time (got %).', array_length(v_want, 1) using errcode = '22023';
    end if;

    -- One pick at a time per campaign.
    perform pg_advisory_xact_lock(hashtext('newsletter_pick:' || p_campaign::text));

    for r in
      select * from public.newsletter_campaign_batches
      where campaign_id = p_campaign and status = 'pending'
      order by idx
      for update
    loop
      select coalesce(array_agg(x), '{}') into v_take
        from jsonb_array_elements_text(r.recipients) x where lower(x) = any(v_want);
      if coalesce(array_length(v_take, 1), 0) = 0 then continue; end if;

      select coalesce(jsonb_agg(x), '[]'::jsonb) into v_keep
        from jsonb_array_elements_text(r.recipients) x where not (lower(x) = any(v_want));

      update public.newsletter_campaign_batches
         set recipients = v_keep,
             recipient_count = jsonb_array_length(v_keep),
             status = case when jsonb_array_length(v_keep) = 0 then 'skipped' else status end,
             updated_at = now()
       where id = r.id;

      v_found := v_found || v_take;
    end loop;

    -- Nobody asked for is still available (all taken or sent already).
    if coalesce(array_length(v_found, 1), 0) = 0 then return null; end if;

    insert into public.newsletter_campaign_batches (campaign_id, idx, recipients, recipient_count, picked_by)
    values (p_campaign,
            (select coalesce(max(idx), -1) + 1 from public.newsletter_campaign_batches where campaign_id = p_campaign),
            to_jsonb(v_found), array_length(v_found, 1), v_who)
    returning * into v_new;
    return v_new;
  end
  $body$;
  $fn$;
end
$$;

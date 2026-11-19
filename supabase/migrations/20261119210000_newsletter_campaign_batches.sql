-- Team sends for Newsletter.html: a campaign is split into batches up front,
-- and each batch is taken by one person, drafted in THEIR Outlook, and marked
-- sent once Outlook confirms it. This is the shared record of who has which
-- batch and who has actually been mailed.
--   pending -> drafted (claimed_by, message_id) -> sent
-- Same access rules as the other newsletter tables: any signed-in user may
-- read, only pipeline.edit may write.

do $$
begin
  -- newsletter_campaigns was created by hand in production and is not in these
  -- migrations; without it (a preview branch) there is nothing to attach to.
  if to_regclass('public.newsletter_campaigns') is null then
    raise notice 'newsletter_campaigns does not exist here; skipping newsletter_campaign_batches';
    return;
  end if;

  create table if not exists public.newsletter_campaign_batches (
    id              uuid primary key default gen_random_uuid(),
    campaign_id     uuid not null references public.newsletter_campaigns(id) on delete cascade,
    idx             integer not null,
    recipients      jsonb not null default '[]'::jsonb,
    recipient_count integer not null default 0,
    status          text not null default 'pending'
                    check (status in ('pending','drafted','sent','skipped')),
    claimed_by      text,
    drafted_at      timestamptz,
    message_id      text,
    web_link        text,
    sent_at         timestamptz,
    updated_at      timestamptz not null default now(),
    unique (campaign_id, idx)
  );

  alter table public.newsletter_campaign_batches enable row level security;

  if to_regprocedure('public.pms_has_cap(text,text)') is null then
    raise notice 'pms_has_cap missing; newsletter_campaign_batches left with RLS on and no policies';
    return;
  end if;

  drop policy if exists "newsletter batches read"   on public.newsletter_campaign_batches;
  drop policy if exists "newsletter batches insert" on public.newsletter_campaign_batches;
  drop policy if exists "newsletter batches update" on public.newsletter_campaign_batches;

  create policy "newsletter batches read" on public.newsletter_campaign_batches
    for select to authenticated using (true);
  create policy "newsletter batches insert" on public.newsletter_campaign_batches
    for insert to authenticated with check (public.pms_has_cap('pipeline.edit', null));
  create policy "newsletter batches update" on public.newsletter_campaign_batches
    for update to authenticated
    using (public.pms_has_cap('pipeline.edit', null))
    with check (public.pms_has_cap('pipeline.edit', null));

  grant select, insert, update on public.newsletter_campaign_batches to authenticated;
end
$$;

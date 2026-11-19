-- Saved compose drafts for Newsletter.html: the subject, type and body of an
-- email that is still being written, shared by everyone who can send
-- newsletters so a draft can be picked up later or by a colleague.
-- Same access rules as the other newsletter tables: any signed-in user may
-- read, only pipeline.edit may write.

create table if not exists public.newsletter_drafts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  subject       text not null default '',
  type          text not null default 'newsletter',
  body_html     text not null default '',
  created_by    text,
  updated_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.newsletter_drafts enable row level security;

do $$
begin
  -- pms_has_cap() exists in production; skip the policies where it does not
  -- (a preview branch built only from these migrations).
  if to_regprocedure('public.pms_has_cap(text,text)') is null then
    raise notice 'pms_has_cap missing; newsletter_drafts left with RLS on and no policies';
    return;
  end if;

  drop policy if exists "newsletter drafts read"   on public.newsletter_drafts;
  drop policy if exists "newsletter drafts insert" on public.newsletter_drafts;
  drop policy if exists "newsletter drafts update" on public.newsletter_drafts;
  drop policy if exists "newsletter drafts delete" on public.newsletter_drafts;

  create policy "newsletter drafts read" on public.newsletter_drafts
    for select to authenticated using (true);
  create policy "newsletter drafts insert" on public.newsletter_drafts
    for insert to authenticated with check (public.pms_has_cap('pipeline.edit', null));
  create policy "newsletter drafts update" on public.newsletter_drafts
    for update to authenticated
    using (public.pms_has_cap('pipeline.edit', null))
    with check (public.pms_has_cap('pipeline.edit', null));
  create policy "newsletter drafts delete" on public.newsletter_drafts
    for delete to authenticated using (public.pms_has_cap('pipeline.edit', null));
end
$$;

grant select, insert, update, delete on public.newsletter_drafts to authenticated;

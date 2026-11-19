-- Newsletter.html offers three campaign types (newsletter, event, campaign), but
-- newsletter_campaigns.type only allowed the first two. A "Targeted campaign"
-- run created its Outlook drafts and then failed to record the campaign with
-- 23514 (newsletter_campaigns_type_check). Allow 'campaign' as well.
-- Idempotent: safe to run where the constraint has already been widened.

alter table public.newsletter_campaigns
  drop constraint if exists newsletter_campaigns_type_check;

alter table public.newsletter_campaigns
  add constraint newsletter_campaigns_type_check
  check (type = any (array['newsletter'::text, 'event'::text, 'campaign'::text]));

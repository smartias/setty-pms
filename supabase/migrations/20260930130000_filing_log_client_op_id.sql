-- Filing-log retry de-duplication (add-in queue integrity, item 4 of
-- HANDOFF-STATUS-2026-09-20.md). Applied live 2026-09-30.
--
-- queue_key is a STORED GENERATED column (project_id || '|' || msg_id), so the
-- client cannot write it and it identifies "this email in this project", not
-- one save attempt. A unique index on it would fail on existing data and block
-- deliberate re-filing. Use a separate client-written column instead.
--
-- client_op_id: generated once per save attempt by the add-in and reused on
-- every retry of that insert. Insert with
--   POST /rest/v1/pms_filing_log?on_conflict=client_op_id
--   Prefer: resolution=ignore-duplicates
-- and a retried insert is a no-op. The index is deliberately NOT partial:
-- Postgres cannot infer a partial unique index from ON CONFLICT (client_op_id),
-- and PostgREST cannot pass the WHERE predicate. NULLs never collide, so
-- legacy rows and inserts without an id are unaffected. The freeze trigger
-- fires on UPDATE only, so the new column inserts cleanly.
alter table public.pms_filing_log add column if not exists client_op_id text;
drop index if exists public.pms_filing_log_client_op_id_uq;
create unique index pms_filing_log_client_op_id_uq on public.pms_filing_log (client_op_id);
comment on column public.pms_filing_log.client_op_id is
  'Client-generated id for one save attempt, reused on every retry of that insert. Plain unique index so on_conflict=client_op_id / Prefer: resolution=ignore-duplicates can infer it; NULLs never collide.';

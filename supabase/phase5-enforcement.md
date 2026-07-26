# Phase 5 — Matrix enforcement rollout (runbook)

Attaches `pms_has_cap()` terms to data **write** policies, table-by-table, so the
Admin-console matrix becomes database enforcement instead of app-UI gating.
Follows the Phase 4 flip (live 2026-07-24, see `phase4-rls-flip.md`). Reads stay
signed-in-only and are NOT role-scoped in this phase.

Pattern per slice: capture rollback into `pms_ops_snapshots` → migration swaps
the write policies → persona-simulation verify (`set_config('request.jwt.claims',…)`
for one user per role + an unregistered staff-baseline email + a no-email negative
control). Rollback = run the snapshot row's content in the SQL editor.

---

## Slice 1 — field.report ✅ LIVE 2026-07-25

Migration `phase5_enforce_field_report`; rollback row
`phase5-slice1-rollback-2026-07-25` (md5 f6aa3ae3…).

- `pms_site_reports` INSERT/UPDATE → `pms_has_cap('field.report', null)` —
  table stores `project_id` not `project_number`, so per-project overrides
  don't resolve here yet (matrix + global user overrides do).
- `pms_field_photo_sessions` INSERT/UPDATE → `pms_has_cap('field.report', project_number)`.
- `photo_catalog` blanket ALL split: SELECT stays open to authenticated
  (viewing photos must never depend on field.report); INSERT/UPDATE/DELETE gated.

Zero behavior change by design: the matrix allows field.report for **all 9 roles
including the staff baseline**. Verified: all roles + unregistered user = true;
no-email JWT = false.

## Gates before the remaining slices

- **Gate A — registry coverage.** `pms_user_roles` has 25 rows vs ~50 staff.
  Unregistered signed-in people resolve to the **staff** baseline, which the
  matrix DENIES for `emails.file` and `projects.edit` — enforcing those now
  would break daily saves for half the firm. Populate the registry first
  (console Users & Roles; adding someone also sends the welcome email + SP grant).
- **Gate B — Sara reviews the matrix defaults** in the console grid. The seeds
  were Claude's proposal. Cells that become load-bearing at enforcement time:
  staff/qaqc denied `emails.file` + `projects.edit`; engineer denied
  `fees.view/edit`; marketing denied `projects.edit`? (currently ALLOWED —
  confirm that's intended before slice 4 makes it a real write grant).

## Slice 2 — emails.file (after Gates A+B)

- `pms_project_emails` INSERT → `pms_has_cap('emails.file', null)` (rows carry
  `project_id` not number). Leave UPDATE/DELETE on projects.edit in slice 4? No —
  gate them with emails.file too (removal of a filed email is a filing action).
- `pms_email_thread_tags` INSERT/UPDATE → emails.file (tagging IS filing).
- Leave OPEN (deliberately): `pms_filing_log` (audit trail — every writer must
  always be able to log), `pms_email_watchlist` (personal triage, not filing),
  `pms_sweep_progress` (mechanism state).

## Slice 3 — pipeline.edit (after Gate B)

- `newsletter_campaigns` INSERT → pipeline.edit.
- `newsletter_subscribers` writes: the public unsubscribe path goes through the
  Edge Function (service role, flip-immune) — verify that before gating, then
  gate browser writes with pipeline.edit.
- Marketing directory edits live in `pms_clients`, which projects also use —
  handled in slice 5, not here.

## Slice 4 — contracts.edit

- `pms_settyfy_map` / `pms_settyfy_sov_map` are already admin-only. Term
  contracts + client agreements live INSIDE `pms_projects`/`pms_data` JSON, so
  contracts.edit has no dedicated table to gate — it stays app-level until/unless
  contract data gets its own rows. Document-only slice; nothing to run today.

## Slice 5 — projects.edit (LAST; after Gates A+B + a quiet week)

The big one: `pms_projects` (the ALL policy → split SELECT open / writes gated),
`pms_rfis`, `pms_submittals`, `pms_rfi_events`, `pms_submittal_events`,
`pms_clients`, `pms_meta` (loader upserts it — verify every role can still boot
the app after gating, see the v80 gate lesson), `pms_data` (legacy). Watch the
add-in and RFI Sync the next workday; both write these tables constantly.

## Not in the catalog (open decision)

Intelligence tables (`pms_agency_preferences`, `pms_lessons`,
`pms_best_practices`, profiles/standards/regulations) have no capability.
Either add a row to `pms_capability_catalog` (console is catalog-driven — a new
cap appears in the grid automatically) or leave them authenticated-wide.

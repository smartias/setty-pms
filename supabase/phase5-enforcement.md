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

## Gates — RESOLVED 2026-07-25

- **Gate A (registry coverage) — dissolved by design decision.** Sara flipped
  the **staff** row to ALLOW `emails.file` + `projects.edit`: unregistered
  signed-in people (staff baseline) keep today's behavior, and registration
  becomes gradual refinement instead of a rollout blocker. Tightening staff
  later is a checkbox, not a migration.
- **Gate B (matrix review) — done.** Sara reviewed the grid 7/25. The
  deliberate restriction that enforcement now makes real: **qaqc is read-only**
  (denied filing + project edits).

## Slice 2 — emails.file ✅ LIVE 2026-07-25

Migration `phase5_enforce_emails_file`; rollback row
`phase5-slice2-rollback-2026-07-25` (md5 b7e0cea3…).

- `pms_project_emails` INSERT/UPDATE/DELETE → `pms_has_cap('emails.file', null)`
  (rows carry `project_id` not number → matrix + global overrides only; DELETE
  gated too — removing a filed email is a filing action).
- `pms_email_thread_tags` INSERT/UPDATE → emails.file (tagging IS filing).
- Left OPEN (deliberately): `pms_filing_log` (audit trail — every writer must
  always be able to log), `pms_email_watchlist` (personal triage, not filing),
  `pms_sweep_progress` (mechanism state).

Verified: all roles + staff baseline = allowed; qaqc = denied (intended);
no-email JWT = denied.

## Slice 3 — pipeline.edit ✅ LIVE 2026-07-25

Migration `phase5_enforce_pipeline_edit`; rollback row
`phase5-slice3-rollback-2026-07-25` (md5 6ce6b856…).

- `newsletter_campaigns` INSERT → pipeline.edit.
- `newsletter_subscribers` INSERT/UPDATE → pipeline.edit. Safe because public
  unsubscribes ride the service-role Edge Function (verified flip-immune in
  phase4-rls-flip.md) — browser writes here are only signed-in BD users.
- Marketing directory edits live in `pms_clients`, which projects also use —
  handled in slice 5, not here.

Verified: admin/contracts/marketing/operations/project_manager = allowed;
engineer/qaqc/staff = denied (matches matrix; unregistered users don't run
campaigns — Sara confirmed).

## Slice 4 — contracts.edit

- `pms_settyfy_map` / `pms_settyfy_sov_map` are already admin-only. Term
  contracts + client agreements live INSIDE `pms_projects`/`pms_data` JSON, so
  contracts.edit has no dedicated table to gate — it stays app-level until/unless
  contract data gets its own rows. Document-only slice; nothing to run today.

## Slice 5 — projects.edit ✅ LIVE 2026-08-05

Migration `phase5_enforce_projects_edit`; rollback row
`phase5-slice5-rollback-2026-08-05` (md5 184ba7c3…, 19 policies captured).
Full SQL + persona script: `phase5-slice5-projects-edit.sql` / `-verify.sql`.

- All 8 tables (`pms_projects`, `pms_rfis`, `pms_submittals`, `pms_rfi_events`,
  `pms_submittal_events`, `pms_clients`, `pms_meta`, `pms_data`): SELECT open
  to authenticated, every write → `pms_has_cap('projects.edit', …)`.
- **Option B (Sara)**: `pms_projects` scopes through `project->>'projectNumber'`
  (USING + WITH CHECK both — renumbering must not be an escape hatch), so
  per-project overrides now actually resolve on project rows. The RFI/submittal
  tables scope through their real `project_number` column.
- **UI shipped FIRST** (PR #117, PMS v96): mutation choke points guarded +
  read-only nav pill, so the denied role saw a deliberate read-only app before
  the database started refusing it.
- Blast radius at flip time: qaqc only (one user). Staff baseline allowed.
- RFI Sync + MCP connector are service-role → unaffected (verified, health 200).
  The add-in runs under the user's own JWT → it IS in scope; watch the Filing
  Log the next workday.

Verified: 9-persona sweep (all match; qaqc + no-email denied, staff baseline
allowed; no accounting user exists to test), fabricated per-project lock
denies inside scope / allows outside (rolled back), real UPDATEs as qaqc → 0
rows with reads intact, real UPDATEs as engineer → 1 row on projects, meta
and clients (rolled back).

Leftover cosmetics: the three surviving SELECT policies on the register tables
still carry `_anon` names (`pms_rfis_select_anon` etc.) — scoped TO
authenticated, name only. Rename next time those tables are touched.

## Not in the catalog (open decision)

Intelligence tables (`pms_agency_preferences`, `pms_lessons`,
`pms_best_practices`, profiles/standards/regulations) have no capability.
Either add a row to `pms_capability_catalog` (console is catalog-driven — a new
cap appears in the grid automatically) or leave them authenticated-wide.

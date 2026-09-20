# Handoff status: filing-log integrity (add-in queue + audit trail)

**Read this first in any Claude session, on either computer or account.**
Last updated 2026-09-20 03:30 UTC from a cloud session on the account that
also holds Sheetsa. **PMS work moves to the other Claude account from here.**
Everything below is on GitHub or in the live database; nothing lives only in
this session, and the Sheetsa account is not needed to continue.

This file is committed to the repo on purpose, same reason as
`HANDOFF-STATUS-2026-09-16.md`: the repo is the only place every computer and
every Claude account can see.

## What landed, all merged and live

| Where | Change | PR | Live? |
|---|---|---|---|
| `smartias/setty-pms-addin` | Filing queue: audit-log insert is awaited and the crash-recovery entry is dequeued only once the row lands; a save whose row failed to log is kept with `pendingLog` and re-sent on next pane open; entries keyed by `(msg_id, operation)` so a retry no longer leaves a ghost banner. `__appVersion` = `2026-09-20-filing-queue-integrity`. | [#47](https://github.com/smartias/setty-pms-addin/pull/47) | Yes, via GitHub Pages on merge |
| `smartias/setty-pms` | Migration `20260920000000_filing_log_author_binding.sql`: `user_email` stamped from the writer's JWT on insert; every column except `files` frozen after insert; INSERT/UPDATE policies require a JWT with an email; rollback captured in `pms_ops_snapshots` as `filing-log-author-binding-rollback-2026-09-20`. Runbook note added to `supabase/phase5-enforcement.md`. | [#298](https://github.com/smartias/setty-pms/pull/298) | **Yes, applied by Sara in the SQL editor** |
| `smartias/setty-pms` | Follow-up `20260920010000_filing_log_freeze_diagnostic.sql`: freeze trigger ignores generated columns (the live table has a stored generated `queue_key` that no migration in the repo declares) and names the changed columns in its error. `supabase/filing-log-author-verify.sql` fixed (results-table grant). | [#299](https://github.com/smartias/setty-pms/pull/299) | **Yes, applied; verify script returned 8/8 ✓ on 2026-09-20** |

## Live state of `pms_filing_log`, Supabase `ProjectManagement` (`khxmgjilwhdguuepbhne`)

| Item | State |
|---|---|
| Triggers | `pms_filing_log_bind_author` (BEFORE INSERT), `pms_filing_log_freeze` (BEFORE UPDATE). Confirmed by Sara via `pg_trigger` on 2026-09-20. |
| Policies | `filing_log_anon_select` (SELECT, authenticated, unchanged misnomer), `filing_log_insert`, `filing_log_update` (both `to authenticated`, `with check` JWT email present). No DELETE policy. |
| Verify | `supabase/filing-log-author-verify.sql` → 8 rows, all ✓ |
| Rollback | Run the `content` of `pms_ops_snapshots` row `filing-log-author-binding-rollback-2026-09-20` in the SQL editor. Restores the three original policies and drops both triggers and functions. |
| Known table fact not in migrations | `queue_key` is a STORED GENERATED column. Any future BEFORE trigger on this table must skip generated columns (see the follow-up migration for the pattern). |

## Corrections to the review that started this

The add-in review (in the Sheetsa-account session) said the audit log accepted
anonymous writes. That was overstated: the Phase 4 flip had already made all
three policies `TO authenticated`. What was true, and is now fixed: any
signed-in user could write any `user_email` (transmittal.html wrote none, so
all 101 of its rows were authorless), and UPDATE was open on every column.

## Still open from the same review, not started

1. **Filing Health sweep in PMS is unbuilt.** `SettyPMS.html` has the
   comment header (`FILING INTEGRITY: RECONCILE SWEEP (Phase 4)`, ~line 3136)
   and an empty modal placeholder (~line 33773), but nothing walks
   `pms_filing_log` for `status = 'failed'` rows or verifies SharePoint
   folders. The add-in's comments promise this sweep exists. Smallest useful
   version: a panel listing failed rows with no later success row for the
   same `msg_id` + `operation`.
2. **Add-in banner: per-entry dismiss and a multi-pane guard.** "Dismiss all"
   wipes every queue entry, including one in flight in another open pane; a
   save over 60 s in pane A shows as orphaned in pane B. Tag entries with a
   session token, skip entries whose owner answers a `BroadcastChannel` ping,
   make dismiss per entry.
3. **Add-in: Save-to-SharePoint still carries its own copy** of the
   enqueue/log/dequeue choreography (`taskpane.js` ~7638–7860) instead of
   going through `withFilingScaffold`. Two copies will drift.
4. **Audit-log inserts retried on network error can duplicate rows.** Use the
   queue id as a client-generated unique column with ignore-duplicates on
   conflict. Needs a column + unique index migration first.
5. **One manual check never done:** in a real Outlook, file an email and
   confirm one `pms_filing_log` row and an empty `settyPms:filingQueue`;
   then file with the network cut, restore it, reopen the pane, confirm the
   row appears and the queue clears.

## How to pick this up on the other account

- Repos: `smartias/setty-pms` (main at #299 merged) and
  `smartias/setty-pms-addin` (main at #47 merged). Nothing unmerged, no
  scratch branches worth keeping.
- The Supabase MCP connector on the Sheetsa account was read-only and then
  refused reads entirely; migrations were applied by hand in the SQL editor.
  If the other account's connector has write access, `apply_migration` works
  for future ones. The persona-verify pattern (`set local role authenticated`
  + `set_config('request.jwt.claims', …)`) needs a grant on any temp results
  table, see the fixed verify script.
- An embedded-Postgres harness (pglite) was used to test migrations offline.
  It is not in the repo. If you want it, the shape is: create roles
  `anon`/`authenticated`, stub `auth.jwt()` as
  `current_setting('request.jwt.claims', true)::jsonb`, create
  `pms_ops_snapshots` and `pms_filing_log` with the live columns **including
  `queue_key` as a stored generated column**, apply the migration, run the
  verify script, run the rollback snapshot and confirm the original policies
  return.
- Sheetsa (the plan-archive product) stays on the Sheetsa account. Its
  architecture doc is under that account and is not PMS work.

## Checklist

- [x] Add-in filing queue fix merged (#47)
- [x] Filing-log author binding migration merged (#298) and applied
- [x] Generated-column follow-up + verify fix merged (#299) and applied
- [x] Verify script 8/8 on the live database
- [ ] Filing Health sweep in PMS (open item 1)
- [ ] Add-in banner per-entry dismiss + multi-pane guard (open item 2)
- [ ] Manual Outlook check (open item 5)

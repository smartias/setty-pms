# Handoff status: review-comment responses (P1.4)

**Read this first in any Claude session, on either computer or account.**
Last updated 2026-09-16 15:10 UTC from the work-computer cloud session.

This file is committed to the repo on purpose. The repo is the only place both
computers and both Claude accounts can see. Anything that lives only on one
machine's disk or in one account's memory is invisible to the other three
combinations, which is how the plot got lost.

Update the checklist at the bottom whenever a step is done, commit, push.
Delete this file in the same commit that finishes the last step.

## The two-machine map

| Where | What it has | What it cannot see |
|---|---|---|
| Home laptop, clone at `~/repos/setty-pms`, Claude account A | The built and tested 1.19.0 slice, **uncommitted**, plus the full `HANDOFF-2026-09-16-comment-responses.md` in the clone root | Nothing done from the work computer until it is pushed |
| Work computer, OneDrive `PMS` folder, Claude account B (cloud sessions) | Only what is on GitHub | Anything on the laptop disk, the OneDrive `.claude-memory` notes |
| GitHub `smartias/setty-pms` | `main` at 1.18.1 (PR #269 merged) | The 1.19.0 slice, until step 0 |
| Supabase `ProjectManagement` (`khxmgjilwhdguuepbhne`) | Live connector 1.17.0 | Nothing after 1.17.0 has been deployed |

Rule going forward: **never end a session with uncommitted work.** Push to any
branch, even a scratch one, before switching machines or accounts. A handoff
note goes in the repo, not on disk.

## What was built on the laptop (uncommitted, per the memory note)

- Connector 1.19.0 with the `save_comment_responses` tool
- Migration `supabase/migrations/20260916000000_qa_comment_responses.sql`
- Skill `.claude/skills/review-comment-responses`
- SettyPMS v152: QA Reviews UI for comment responses
- Un-ingested comment-log detection
- The `proposal-draft` Edge Function also has an undeployed change
- Six skill zips for IT, dated 2026-09-16, in OneDrive `PMS\Skill Uploads`

## Live state, verified 2026-09-16 15:00 UTC

| Item | State |
|---|---|
| Live connector build | `2026-09-15-drive-discovery` = 1.17.0 (from `pms_mcp_telemetry`, last call 13:49 UTC today) |
| `origin/main` connector source | 1.18.1, build `2026-09-15-drop-legacy-share-columns` |
| Comment-response columns on `pms_qa_findings` | **Already applied** (`ai_response`, `response`, `response_disposition`, `response_by`, `response_at`) |
| `azure_share_url`, `azure_sas_env` on `pms_regions` | **Still present.** The drop migration has NOT run. Good. |
| Edge Function `pms-mcp` | version 118 on Supabase |

The ordering constraint is intact: the connector must reach at least 1.18.1
before `20260915130000_drop_legacy_share_columns.sql` runs, or `regionMap()`
selects missing columns and every region routes to the default site.

## Steps, in order

### Step 0. Home laptop: get the code onto GitHub (the only blocking step)

From `~/repos/setty-pms`:

```
git status                      # confirm the files listed above are there
git add -A
git commit -m "Review-comment responses: connector 1.19.0, migration, skill, PMS v152"
git push origin HEAD:claude/affectionate-brahmagupta-7cpt7l
```

If `git status` shows the local `HANDOFF-2026-09-16-comment-responses.md`,
commit it too. It does not collide with this file (different name).

After this push, every later step can be done from either computer.

### Step 1. Verify before deploying

From the repo root, run the connector tests that touch the changed code, at
minimum:

```
node supabase/functions/pms-mcp/qaFindingsLedger.test.mjs
node supabase/functions/pms-mcp/qaChecklist.test.mjs
```

Read the diff of `supabase/functions/pms-mcp/index.ts` against `origin/main`
and confirm `version` reads `1.19.0` and `BUILD` is a fresh 2026-09-16 string.

### Step 2. Deploy the connector (ships 1.17.1 through 1.19.0 in one go)

Per `supabase/functions/pms-mcp/README.md`, from the repo root:

```
npx supabase functions deploy pms-mcp --project-ref khxmgjilwhdguuepbhne --no-verify-jwt
```

Then deploy `proposal-draft` the same way.

Confirm with the health link: `/functions/v1/pms-mcp/health` must echo the new
`BUILD` string. Do not go to step 3 until it does.

### Step 3. Apply the column-drop migration (only after step 2 is confirmed)

Apply `supabase/migrations/20260915130000_drop_legacy_share_columns.sql` to
`ProjectManagement` (Supabase MCP `apply_migration`, or the dashboard SQL
editor). Verify: `pms_regions` no longer has `azure_share_url` or
`azure_sas_env`, and the Regions tab in SettyAdmin still lists every share.

The 2026-09-16 comment-responses migration is already applied. Do not re-run it
unless the file is idempotent.

### Step 4. Land it

Merge the branch to `main` via the draft PR. Update the "Live" row in
`SettyAdmin.html` (currently says 1.18.0) to the new build. Reconnect Claude
clients so they pick up the new tool list.

### Step 5. IT hand-off

Send IT the six skill zips from `PMS\Skill Uploads` dated 2026-09-16.

## Checklist

- [ ] 0. Laptop: commit and push the 1.19.0 slice to `claude/affectionate-brahmagupta-7cpt7l`
- [ ] 1. Tests pass; version and BUILD confirmed in the diff
- [ ] 2a. `pms-mcp` deployed; health link shows the new build
- [ ] 2b. `proposal-draft` deployed
- [ ] 3. Drop-legacy-share-columns migration applied; columns gone; Regions tab OK
- [ ] 4. PR merged to `main`; SettyAdmin "Live" row updated; clients reconnected
- [ ] 5. Skill zips sent to IT
- [ ] Delete this file

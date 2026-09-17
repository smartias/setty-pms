# Handoff status: review-comment responses (P1.4)

**Read this first in any Claude session, on either computer or account.**
Last updated 2026-09-17 13:20 UTC from the work-computer cloud session.

This file is committed to the repo on purpose. The repo is the only place both
computers and both Claude accounts can see. Anything that lives only on one
machine's disk or in one account's memory is invisible to the other three
combinations, which is how the plot got lost.

Update the checklist at the bottom whenever a step is done, commit, push.
Delete this file in the same commit that finishes the last step.

## What changed on 2026-09-17 (read this before the laptop push)

Overnight, another session merged 13 commits to `main` (PRs up to #280) and
deployed them. Two consequences:

1. **The column-drop migration has been applied.** Live connector is now
   1.19.0 build `2026-09-16-review-feedback`, which does not select the
   legacy columns, so the ordering constraint was satisfied and
   `20260915130000_drop_legacy_share_columns.sql` was run at 13:15 UTC.
   Verified: `azure_share_url` and `azure_sas_env` are gone from
   `pms_regions`, `pms_region_save` no longer writes them, and all four
   `pms_region_shares` rows (BT, DC x2, NY) are intact. That step is done.

2. **Version collision.** `main` already carries a connector **1.19.0**
   (`search_review_feedback`, PR #280) and SettyPMS **v154**. The laptop's
   uncommitted slice is also numbered 1.19.0 and v152. They are different
   changes. The laptop slice must be renumbered before it lands:
   - connector `version` → **1.20.0**, `BUILD` → a fresh 2026-09-xx string
   - `window.__appVersion` in `SettyPMS.html` → **v155** (see `CLAUDE.md`
     rule 1; the file is CRLF, rule 2)
   - do not let the laptop's `index.ts` overwrite main's: main's 1.19.0
     added `search_review_feedback`, `reviewFeedback.test.mjs`, the
     `20260916120000_ca_review_feedback.sql` migration, and the 1.18.2
     `view_drawing` PDFium fix. Merge, do not replace.

## The two-machine map

| Where | What it has | What it cannot see |
|---|---|---|
| Home laptop, clone at `~/repos/setty-pms`, Claude account A | The built and tested comment-responses slice, **uncommitted**, plus the full `HANDOFF-2026-09-16-comment-responses.md` in the clone root | Nothing done from the work computer until it is pushed |
| Work computer, OneDrive `PMS` folder, Claude account B (cloud sessions) | Only what is on GitHub | Anything on the laptop disk, the OneDrive `.claude-memory` notes |
| GitHub `smartias/setty-pms` | `main` at connector 1.19.0 / PMS v154; this branch = main + this file | The comment-responses slice, until step 0 |
| Supabase `ProjectManagement` (`khxmgjilwhdguuepbhne`) | Live connector 1.19.0 `2026-09-16-review-feedback`; legacy columns dropped | Nothing from the laptop |

Rule going forward: **never end a session with uncommitted work.** Push to any
branch, even a scratch one, before switching machines or accounts. A handoff
note goes in the repo, not on disk.

## What was built on the laptop (uncommitted, per the memory note)

- Connector with the `save_comment_responses` tool (renumber to 1.20.0)
- Migration `supabase/migrations/20260916000000_qa_comment_responses.sql`
  (its columns are **already applied** in the database)
- Skill `.claude/skills/review-comment-responses`
- SettyPMS QA Reviews UI for comment responses (renumber to v155)
- Un-ingested comment-log detection
- The `proposal-draft` Edge Function also has an undeployed change
- Six skill zips for IT, dated 2026-09-16, in OneDrive `PMS\Skill Uploads`

## Live state, verified 2026-09-17 13:20 UTC

| Item | State |
|---|---|
| Live connector build | `2026-09-16-review-feedback` = 1.19.0 (telemetry, last call 11:49 UTC today) |
| `origin/main` connector source | 1.19.0, same build string |
| Comment-response columns on `pms_qa_findings` | Applied (`ai_response`, `response`, `response_disposition`, `response_by`, `response_at`) |
| `azure_share_url`, `azure_sas_env` on `pms_regions` | **Dropped 2026-09-17.** Done. |
| `proposal-draft` Edge Function | Version 5 on Supabase; laptop change not deployed |
| SettyAdmin "Live" row | Stale: still says build `2026-09-15-ca-on-drives` (1.18.0) |

## Steps, in order

### Step 0. Home laptop: get the code onto GitHub (the only blocking step)

From `~/repos/setty-pms`. Commit first so nothing can be lost, then bring in
main before pushing, because `index.ts` and `SettyPMS.html` will conflict:

```
git status                      # confirm the files listed above are there
git add -A
git commit -m "Review-comment responses: connector save_comment_responses, migration, skill, PMS QA Reviews UI"
git fetch origin
git merge origin/claude/affectionate-brahmagupta-7cpt7l
```

Resolve the conflicts keeping BOTH sides: in `index.ts` keep main's
`search_review_feedback` and add `save_comment_responses`; set `version` to
`1.20.0` and a fresh `BUILD`. In `SettyPMS.html` keep main's v154 changes and
set `window.__appVersion` to v155 (binary mode, CRLF). Then:

```
node --test *.test.mjs
node --test supabase/functions/pms-mcp/*.test.mjs
git push origin HEAD:claude/affectionate-brahmagupta-7cpt7l
```

If the merge is more than you want to do on the laptop, push the commit to a
scratch branch instead (`git push origin HEAD:laptop/comment-responses`) and
a cloud session will do the merge.

### Step 1. Verify before deploying

All connector tests pass. The diff against `origin/main` shows `version`
`1.20.0`, a fresh `BUILD`, and both `search_review_feedback` and
`save_comment_responses` registered. Parse both JSX blocks of
`SettyPMS.html` with `@babel/parser` (CLAUDE.md rule 4).

### Step 2. Deploy the connector and proposal-draft

Per `supabase/functions/pms-mcp/README.md`, from the repo root:

```
npx supabase functions deploy pms-mcp --project-ref khxmgjilwhdguuepbhne --no-verify-jwt
```

Then `proposal-draft` the same way. Confirm the health link
`/functions/v1/pms-mcp/health` echoes the new `BUILD`.

### Step 3. Column-drop migration

**Done 2026-09-17.** Nothing to do. Rollback, if ever needed, is in the
header comment of `20260915130000_drop_legacy_share_columns.sql`.

### Step 4. Land it

Merge the branch to `main` via the draft PR (merge commit, no squash).
Update the "Live" row in `SettyAdmin.html` to the new build. Reconnect Claude
clients so they pick up the new tool list.

### Step 5. IT hand-off

Send IT the six skill zips from `PMS\Skill Uploads` dated 2026-09-16.

## Checklist

- [ ] 0. Laptop: commit, merge this branch, renumber to 1.20.0 / v155, push
- [ ] 1. Tests pass; version, BUILD, and both new tools confirmed in the diff
- [ ] 2a. `pms-mcp` deployed; health link shows the new build
- [ ] 2b. `proposal-draft` deployed
- [x] 3. Drop-legacy-share-columns migration applied (2026-09-17)
- [ ] 4. PR merged to `main`; SettyAdmin "Live" row updated; clients reconnected
- [ ] 5. Skill zips sent to IT
- [ ] Delete this file

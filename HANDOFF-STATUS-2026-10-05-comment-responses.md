# Handoff status: review-comment responses, rollout checklist

**Read this first in any Claude session, on either computer or account.**
Last updated 2026-10-05 from a cloud session.

The comment-response code is merged to `main` (PR #308): the
`save_comment_responses` connector tool, the `20260916000000_qa_comment_responses`
migration, the `review-comment-responses` skill, and the QA Reviews tab UI.
The earlier `HANDOFF-STATUS-2026-09-16.md` was deleted in PR #328 while some of
its rollout steps were still open. This file keeps those steps in the repo.

Delete this file in the same commit that finishes the last step.

## Not verified from the cloud session

The cloud session could not reach Supabase or the live health endpoint, so the
live state below is unknown, not assumed. Check it first:

- `https://khxmgjilwhdguuepbhne.supabase.co/functions/v1/pms-mcp/health` shows
  the live build. Repo `main` is at `2026-10-02-documents-drive-folders`
  (connector 1.21.0, 48 tools) at the time of writing.
- `select proname from pg_proc where proname = 'pms_qa_finding_set_response';`
  should return one row. The columns were applied in September; the RPC was
  never confirmed. If it returns 0 rows, re-run the function part of
  `supabase/migrations/20260916000000_qa_comment_responses.sql`.

## Checklist

- [ ] Deploy `pms-mcp` (also tracked in `HANDOFF-STATUS-2026-09-24.md`). From
      the repo root:
      `npx supabase functions deploy pms-mcp --project-ref khxmgjilwhdguuepbhne --no-verify-jwt`
      Needs a personal access token (supabase.com > Account > Access Tokens;
      revoke after). Confirm the health link echoes the new `BUILD`.
- [ ] Deploy `proposal-draft` the same way. Its drafting rules changed on
      2026-09-15 and it needs its own deploy; whether that has happened is
      unknown.
- [ ] Confirm the `pms_qa_finding_set_response` RPC exists (query above).
- [ ] Reconnect Claude clients (disconnect and reconnect the Setty PMS
      connector) so `save_comment_responses` shows in the tool list.
- [ ] Live run on a real project (Tabler suggested): QA Reviews >
      "Draft comment responses (N)". Check that a draft saves and Accept works.
- [ ] Send IT the skill zips for the firm-wide library: `qa-coordination-review`,
      `submittal-rfi-review`, `review-comment-responses`, `design-narrative`
      (source of truth: `.claude/skills/<name>/SKILL.md`), plus the
      dependencies called by name, `engineering-judgment` and
      `pdf-highlighted-selections` (from Sara's personal claude.ai library).
- [ ] Update the "Server (pms-mcp)" row in `SettyAdmin.html` once the deploy
      is confirmed (it currently says the build is current in the repo only).
- [ ] Delete this file.

## Not built, not blockers

- Register returned in the reviewer's own format (DrChecks answers are typed
  into DrChecks by the engineer).
- Unattended comment-log watcher: blocked because routine-fired sessions get
  no connectors. On-demand detection covers a log sitting in the inbox.
- OCR fallback (P3.10): undecided, Azure AI Document Intelligence behind an env
  var is the recommendation.
- Add-in "file as review comments" action: blocked on the add-in's SharePoint
  permission work.

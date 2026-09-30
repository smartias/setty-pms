# Handoff: review comment responses (P1.4) and deploy state, 2026-09-16

Written for whoever picks this up next (Sara on her other Claude account).
Everything below is verified as of 2026-09-16 ~10:45 ET. Nothing has been
committed; the clone at `C:\Users\sara.arias\repos\setty-pms` is on `main`,
even with `origin/main` (e2a0b6d), with the working tree changes listed here.

## What was built (uncommitted, in the clone)

| File | Change |
|---|---|
| `supabase/migrations/20260916000000_qa_comment_responses.sql` | NEW. Adds `ai_response`, `response`, `response_disposition`, `response_by`, `response_at` to `pms_qa_findings`; RPC `pms_qa_finding_set_response` (authenticated, JWT-stamped, refuses internal rows). **Already run in Supabase** (columns exist; confirm the RPC with the query below). |
| `supabase/functions/pms-mcp/index.ts` | New tool `save_comment_responses` (writes only `ai_response`, external rows only, https-only links, never moves status). `list_qa_findings` gains the response columns, `needsResponse:true`, and `commentLogsNotIngested` (comment registers in `pms_project_emails.attachment_names` not named as any review's `source_doc`). `record_qa_findings` comment-log note points at drafting. BUILD `2026-09-16-comment-responses`, version 1.19.0. |
| `supabase/functions/pms-mcp/commentResponses.test.mjs` | NEW. 37 assertions incl. drift checks. All 27 test files pass (`node <file>`). |
| `.claude/skills/review-comment-responses/SKILL.md` | NEW skill: work list, verify vs newest revision, 7 dispositions, prime/sub + post-bid rules, voice (engineering-judgment), persist, xlsx register filed with `file_qa_report`. |
| `SettyPMS.html` | v152. QA Reviews rows: draft response block with Accept / Edit & accept, Write response when no draft, accepted response under the person's name, chips (awaiting response / draft response / responded). Header: "Draft comment responses (N)" seat link. Banner: "Not yet in the ledger" listing un-ingested comment logs with "Ingest with Claude" link. JSX validated with @babel/parser. File is CRLF throughout; keep it that way. |
| `SettyAdmin.html` | Tool list + matrix row for `save_comment_responses`, 43 -> 44 tools, build/version text. |
| `supabase/functions/pms-mcp/README.md` | New section "Review comment responses (1.19.0)". |
| `supabase/functions/pms-mcp/ROADMAP.md` | New "Open items (consolidated 2026-09-16)" section near the top; P1.4 moved to Delivered; watcher item reworded (on-demand half shipped). |

## Live state (probed 2026-09-16)

- Connector live build: `2026-09-15-drive-discovery` (1.17.0). Repo is 1.18.1 + this work. One deploy ships 1.17.1, 1.17.2, 1.18.0, 1.18.1, 1.19.0.
- App live: SettyPMS/SettyAdmin on GitHub Pages == repo HEAD byte-for-byte (v151). Yesterday's proposal generator work (PR #270) is already live.
- `proposal-draft` edge function: 6 prompt-rule lines changed 2026-09-15 (M/E/FP wording, entity names, prime-only clauses). Needs its own deploy; unknown if done.
- Migrations: `20260915110000_project_candidates_matches` APPLIED. `20260915130000_drop_legacy_share_columns` NOT applied (legacy columns still exist). `20260916000000_qa_comment_responses` columns APPLIED.

## Go-live steps, in order

1. Deploy the connector (PowerShell, from the REPO ROOT, personal access token from supabase.com > Account > Access Tokens; revoke after):
   ```powershell
   cd C:\Users\sara.arias\repos\setty-pms; $env:SUPABASE_ACCESS_TOKEN = "sbp_..."; npx supabase functions deploy pms-mcp --project-ref khxmgjilwhdguuepbhne --no-verify-jwt
   ```
   Verify: `curl -s https://khxmgjilwhdguuepbhne.supabase.co/functions/v1/pms-mcp/health` shows `2026-09-16-comment-responses`.
2. Also deploy `proposal-draft` (same command, `proposal-draft` instead of `pms-mcp`).
3. THEN run `supabase/migrations/20260915130000_drop_legacy_share_columns.sql` in the SQL editor (its header says connector 1.18.1 must be live first or region routing breaks).
4. Confirm today's RPC exists: `select proname from pg_proc where proname = 'pms_qa_finding_set_response';` (1 row). If 0 rows, re-run the function part of `20260916000000_qa_comment_responses.sql`.
5. Commit + push (push to main = live deploy of the app):
   ```bash
   cd ~/repos/setty-pms && git checkout -b claude/review-comment-responses && git add -A && git commit -m "Review comment responses: save_comment_responses, QA tab drafts, un-ingested log detection (1.19.0, app v152)"
   cd ~/repos/setty-pms && git checkout main && git merge --ff-only claude/review-comment-responses && git push origin main
   ```
   Clone pushes as solson82 (collaborator). PR creation fails if the browser is on the sara.arias GitHub account. Verify: `curl -s https://smartias.github.io/setty-pms/SettyPMS.html | grep -o '__appVersion = "[^"]*"'` shows v152.
6. New claude.ai chat: confirm `save_comment_responses` appears; if not, disconnect/reconnect the Setty PMS connector.
7. Try it on Tabler: QA Reviews > "Draft comment responses (N)".

## Skills for IT (firmwide upload)

Staged as folder + zip each in `C:\Users\sara.arias\ONE DRIVE NEW\OneDrive - Setty and Associates\PMS\Skill Uploads` (same layout as the Aug 20 uploads):

- New 2026-09-16, behind PMS buttons: `qa-coordination-review`, `submittal-rfi-review`, `review-comment-responses`, `design-narrative`. Source of truth: repo `.claude/skills/<name>/SKILL.md`.
- New 2026-09-16, dependencies called by name: `engineering-judgment`, `pdf-highlighted-selections`. Source: Sara's personal claude.ai library (local cache under `%APPDATA%\Claude\local-agent-mode-sessions\skills-plugin\...\skills\`).
- Staged 2026-08-20, confirm with IT whether already firmwide: `email-response`, `meeting-prep`, `open-items-log`, `proposal-draft`.
- Not needed: Anthropic built-ins xlsx, pdf, docx.

## Still open from this arc (decisions for Sara)

- **OCR fallback (P3.10)**: not built. Options: tesseract WASM in the edge function (free, slow, weak on drawings) vs Azure AI Document Intelligence (better, new Azure resource + key + cost). Recommendation: Azure, behind an env var so nothing changes until the key exists.
- **Add-in "file as review comments" / backload actions**: not built; live in `smartias/setty-pms-addin`, blocked behind the Sites.Selected rewire + IT grant (see memory `addin-files-scope-never-consented`).
- **Unattended comment-log watcher / back-check trigger / P3.11**: still blocked (routine-fired sessions get no connectors). On-demand detection now covers the "log sitting in the inbox" case.

## Gotchas hit today

- Bash tool: `$TMPDIR` is empty; `"$TMPDIR/x"` lands in `/` or the OneDrive cwd. Use the literal scratchpad path or the Write tool. A stray `tools/` folder in the OneDrive PMS dir and `/open-items.md` were created and removed.
- SettyPMS.html is CRLF on every line; edit via a script that preserves `\r\n`.

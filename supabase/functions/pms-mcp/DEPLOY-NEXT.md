# Pending deploy: connector 1.19.1 (raw file links + SharePoint reminder)

Written 15 Sep 2026 for Sara to run from the computer that has the Supabase CLI.
Delete this file once `/health` shows the build below.

## What is waiting

PR #271 (`claude/charming-clarke-0nzfqc`), two connector changes in one deploy:

- **1.19.0** `download_document` / `upload_document`: a signed link to a file's
  original bytes (edit an xlsx with formulas and dropdowns intact) and a write
  back to SharePoint as a new version or a new file. README → "Raw file access".
- **1.19.1** SharePoint adoption reminder on drive-sourced results.

Expected `/health` build after the deploy: **`2026-09-15-sharepoint-nudge`**.

## The short version

1. Merge PR #271.
2. In PowerShell, from the repo root:
   ```powershell
   $env:SUPABASE_ACCESS_TOKEN = "sbp_..."     # supabase.com → Account → Access Tokens
   .\supabase\functions\pms-mcp\deploy.ps1
   ```
   The script pulls main, checks the BUILD string on disk, deploys, and polls
   `/health` until the new build answers. It stops with a message if any step
   is off.
3. Start a fresh Claude conversation (the tool list is cached per connection).
4. Revoke the access token when done.

## If you would rather do it by hand

```powershell
cd C:\path\to\setty-pms          # the REPO ROOT — the folder that contains supabase\
git checkout main; git pull origin main
$env:SUPABASE_ACCESS_TOKEN = "sbp_..."
npx supabase functions deploy pms-mcp --project-ref khxmgjilwhdguuepbhne --no-verify-jwt
curl https://khxmgjilwhdguuepbhne.supabase.co/functions/v1/pms-mcp/health
```

Known traps (all in README → Deploying): run from the repo root, never from
`supabase\`; no `--import-map` flag; `--no-verify-jwt` is required; "Docker is
not running" is harmless; the first health call after a deploy can be slow.

## Optional, any time after

- Edge Functions → Secrets → `FILE_LINK_SECRET` = any long random string.
  Without it the link key derives from the service key, which is fine.
  Redeploy after adding it.

## Smoke test, in a new Claude conversation

- `download_document` on the CCB comment log's itemId → a link; opening it in a
  browser downloads the xlsx intact.
- `upload_document` a small test file into a scratch folder → appears in
  SharePoint. A Graph 403 means the app registration lacks write consent (the
  same IT ask as `file_qa_report`).
- `list_project_documents` on a DC project → the response carries `reminder`.

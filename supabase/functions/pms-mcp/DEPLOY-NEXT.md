# Pending deploy: 401 attribution + offline_access scope

Written 2026-10-08. Delete this file once `/health` shows the build below.

## What is waiting

Branch `claude/awesome-maxwell-4n9qyj` (merge to `main` first):

- Every 401 from the `/mcp` auth middleware now logs `[auth-401]` with the
  refusal reason (jose error code such as `ERR_JWT_EXPIRED`, a failed claim,
  `tenant-mismatch`, `no-authorization-header`), the client user-agent and
  whether a session id was present. No token or header value is logged.
  Pairs with the `[mcp-400]` logging from the previous deploy.
- The protected-resource metadata now advertises `offline_access` next to
  `MCP.Access`, so clients that honor `scopes_supported` ask Entra for a
  refresh token instead of re-running sign-in when the ~1h access token
  expires (the paired 401s seen from Claude clients on 2026-10-08).

Expected `/health` build after the deploy: **`2026-10-08-auth401-logging-offline-access`**.

## How to deploy

In PowerShell, from the repo root:
```powershell
$env:SUPABASE_ACCESS_TOKEN = "sbp_..."     # supabase.com -> Account -> Access Tokens
.\supabase\functions\pms-mcp\deploy.ps1
```
Known traps are in README -> Deploying (run from the repo root, no
`--import-map`, `--no-verify-jwt` required).

## After the deploy

1. Disconnect and reconnect the Setty PMS connector in claude.ai once, so the
   new scope list is picked up at the next sign-in. If Entra prompts for
   consent on `offline_access`, accept it (an admin may need to grant it
   tenant-wide in the app registration's API permissions).
2. Over the next day, query `function_logs` for `[auth-401]`. `ERR_JWT_EXPIRED`
   on a client that then keeps working means refresh is now happening;
   `ERR_JWT_EXPIRED` followed by a fresh sign-in means the client did not
   request `offline_access` and the refresh path needs another look.

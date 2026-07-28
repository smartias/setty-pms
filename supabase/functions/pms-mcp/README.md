# pms-mcp

The read-only MCP server that exposes PMS data to the firm's enterprise Claude accounts. Runs as a Supabase Edge Function (Deno) using the Streamable-HTTP MCP transport.

- Endpoint: `https://khxmgjilwhdguuepbhne.supabase.co/functions/v1/pms-mcp/mcp`
- Health: `/functions/v1/pms-mcp/health` (unauthenticated, returns `{"ok":true}`)
- Full runbook: the **Claude / MCP** tab of `SettyAdmin.html`

## This directory is now the source of truth

**It did not used to be.** For most of this function's life the only current copy was the live deployment, because deploys were done by pasting the whole file into a dashboard or an API call. On-disk copies drifted stale, and deploying one would silently regress features. The standing rule was "always pull the live function before editing".

That is no longer necessary. This directory was seeded from the deployed **v32** source, byte-for-byte verified, and the CLI can deploy straight from here.

**The rule going forward: edit here, deploy from here, and disk stays equal to live.**

If you have any doubt about whether that still holds, verify rather than assume. See below.

## Deploying

Needs a Supabase personal access token, generated at **supabase.com → Account → Access Tokens**. It is account-wide, so revoke it when you are done.

```bash
$env:SUPABASE_ACCESS_TOKEN = "sbp_..."
npx supabase functions deploy pms-mcp `
  --project-ref khxmgjilwhdguuepbhne `
  --no-verify-jwt `
  --import-map supabase/functions/pms-mcp/deno.json
```

Run it from the repo root. `--no-verify-jwt` is required: the function does its own auth, and dropping the flag would put Supabase's JWT gate in front of the MCP endpoint and break every client.

## After every deploy

1. **Health check.** `curl .../pms-mcp/health` should return `{"ok":true}`. A 200 there proves it compiled and booted, which catches most mistakes immediately.
2. **Confirm the auth gate.** An unauthenticated `POST` to `/mcp` should return `401`.
3. **Verify the deploy is byte-exact** against this directory, using `get_edge_function` and comparing hashes. This is what keeps the promise above true.
4. **Reconnect any Claude client** if tools or their descriptions changed. Clients cache the tool list at connect time, so existing sessions will not see changes until they disconnect and reconnect.

## Gotchas

- **Pass `--import-map` explicitly.** When `deno.json` ships alongside the function, the platform can otherwise re-apply a stale absolute path from a previous deploy and fail with "import map path does not exist".
- **`imagescript` must be the deno.land build** if drawing rendering is ever added. `npm:imagescript` crashes the edge worker on an unsupported native codec.
- **Cold starts run 1.5 to 8 seconds.** A `pms-mcp-keepwarm` pg_cron job pings `/health` every two minutes, but the first call right after a deploy can still be slow. One retry is normal.

## Configuration

No secrets live in this source. Everything sensitive is read from Edge Function secrets at runtime:

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MCP_SHARED_SECRET`, `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_SITE_ID`, `GRAPH_DOC_LIBRARY`

The tenant and client IDs appearing as literals in the code are public identifiers used as defaults, and are overridable by the environment.

## Auth model, worth knowing before changing anything

The Microsoft sign-in is an **authentication gate, not an identity**. `verifyEntraToken()` validates signature, issuer, audience and tenant, then returns a boolean and discards the payload. No user claim reaches any query, and every read uses the service-role key, which bypasses RLS by design.

So the Phase 5 role capabilities enforced in the database do **not** narrow what this connector returns. That is deliberate: it is read-only and surfaces what staff already see in PMS. But it means per-role visibility would be a build, not a configuration change, and it is not one line away.

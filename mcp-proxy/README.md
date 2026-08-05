# MCP discovery proxy

A ~100 line Cloudflare Worker that sits in front of the `pms-mcp` Edge Function so
Claude can complete OAuth sign-in. It adds no features and stores no secrets.

## The problem it solves

Claude derives OAuth discovery from the **origin** of the MCP server URL and
discards the path. Our server lives at a path on the Supabase gateway, so Claude
probes `khxmgjilwhdguuepbhne.supabase.co/.well-known/...`, which is Supabase's
Kong gateway and not ours to answer. Entra makes it worse by publishing only
`openid-configuration`, never the RFC 8414 `oauth-authorization-server` document
that Claude looks for. Finding no metadata anywhere, Claude guesses
`<origin>/authorize`, and Supabase replies `{"error":"requested path is invalid"}`.

A Supabase custom domain does **not** fix this. It white-labels the same gateway,
so the root still belongs to Kong.

## How it works

The worker owns a root we control and answers three things:

| route | behaviour |
| --- | --- |
| `/.well-known/oauth-protected-resource` | Names **the proxy itself** as the authorization server |
| `/.well-known/oauth-authorization-server` | RFC 8414 metadata whose `issuer` is the proxy and whose endpoints are Entra |
| everything else | Streams through to the Edge Function unchanged |

Naming ourselves as the authorization server is the load-bearing trick. The
client fetches metadata from us and finds a matching `issuer`, so strict issuer
validation passes, and it never asks Entra for a document Entra does not publish.
Sign-in still happens directly against Entra: no token ever passes through here.

Two details that are easy to get wrong and fail silently:

- The Edge Function's 401 advertises its own supabase.co metadata URL. The worker
  rewrites `WWW-Authenticate` so the client is not walked back into the broken path.
- `resource` stays `api://b49e795c-...`, the Entra Application ID URI. It looks
  like it should be the MCP URL, but the client hands it to Entra as the requested
  resource and Entra only knows this value.

## Deploy

Needs a free Cloudflare account. No DNS record and no IT ticket: the free
`*.workers.dev` subdomain gives us a root we control, which is the whole point.

```bash
cd mcp-proxy && npx wrangler login && npx wrangler deploy
```

Then verify the full discovery chain, in the same order Claude walks it:

```bash
node mcp-proxy/verify.mjs https://setty-pms-mcp.<account>.workers.dev
```

All checks must pass before handing the URL to anyone. Every broken link in this
chain makes clients guess rather than error, which is exactly how the original
failure hid.

## Handing it over

The connector URL becomes `https://setty-pms-mcp.<account>.workers.dev/mcp`.
Nothing else changes: same client id, same Entra app registration, same scopes,
same 23 tools. No admin consent and no new Graph scopes are involved.

## Moving to a real hostname later

Add a CNAME for `mcp.<domain>` and a custom domain route in `wrangler.toml`. The
worker code does not change, since every URL it emits is derived from the origin
of the incoming request. Redeploy and re-run `verify.mjs` against the new host.

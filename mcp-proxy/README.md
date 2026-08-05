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

## Runaway-client ceiling

A colleague's proxy burned its entire free-tier quota on a client stuck in an
OAuth retry loop, so this worker carries a ceiling: 25 proxied requests per
client per 10 seconds, after which it answers 429 with a Retry-After and
nothing is forwarded upstream. Only proxied traffic counts, because only
proxied traffic costs a metered Supabase invocation; discovery documents and
preflights stay unlimited. Unauthenticated clients share one bucket per IP,
which is the retry-loop case since a looping client never obtained a token.
Authenticated sessions get a bucket per token hash, so people sharing an
egress IP never starve each other. If the limiter itself fails the request is
allowed through: the ceiling is protection, not a dependency.

What the ceiling does and does not give, measured on this account 2026-08-05:

- period must stay 10. With period = 60 the per-machine counters never
  converge, so every new connection gets a fresh allowance and the ceiling
  never engages at any volume. Verified with 400 requests in 18 seconds and
  600 over 52 seconds, zero rejections, then re-verified at period = 10.
- Cloudflare's counters are per machine and sync within roughly the window
  length, so a client that reuses connections hits the ceiling exactly, while
  a maximally spread storm (new connection per request) is only clipped, not
  capped. In a 1,000-request soak at 15 a second, rejections began at 16
  seconds. Treat the ceiling as damage limiting for Supabase, not accounting.
- The ceiling cannot protect this worker's own free-plan quota of 100k
  requests per day. Rejected requests still count. A large enough storm takes
  the connector down for the day for everyone, and the only real fixes are
  the Workers Paid plan (5 dollars a month, removes the daily cap) or a real
  hostname behind zone-level protection. Worth doing before wide rollout.

## Handing it over

The connector URL becomes `https://setty-pms-mcp.<account>.workers.dev/mcp`.
Nothing else changes: same client id, same Entra app registration, same scopes,
same 23 tools. No admin consent and no new Graph scopes are involved.

## Moving to a real hostname later

Add a CNAME for `mcp.<domain>` and a custom domain route in `wrangler.toml`. The
worker code does not change, since every URL it emits is derived from the origin
of the incoming request. Redeploy and re-run `verify.mjs` against the new host.

# PROPOSAL: Auto-connect the PMS connector (Enterprise Managed Auth)

Written 2026-11-06 in response to Nikhil's note that Claude can now auto-connect
members to a connector without each person clicking Connect, and that the
connector's server has to support it. Status: **proposal, nothing built**.

## Short answer

The PMS connector does **not** support auto-connect today, and no setting on
Claude's side or ours turns it on. The reason is structural, not a missing flag:
auto-connect needs the connector's *authorization server* to accept a signed
"this person is a member of Setty's Claude organization" token from Claude and
hand back an access token. Our authorization server is Microsoft Entra ID, and
Entra does not accept tokens issued by Claude. Microsoft's own write-up says
Entra does not take part in this exchange yet.

Supporting it means giving the PMS connector a small token endpoint of its own,
next to the Entra sign-in that exists today. That is a build of a few days plus
testing, not a configuration change. The sections below say exactly what, and
what the trade-off is.

## What Claude actually does (from Anthropic's connector-builder doc)

Source: https://claude.com/docs/connectors/building/enterprise-managed-auth
(the MCP extension it implements is
https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization).

1. An admin opens the connector in **Organization settings > Connectors**,
   Configuration tab, **Managed authorization > Set up**, and picks
   **Claude-issued** as the identity source (the other option, IdP-managed,
   needs Okta; Setty signs in with Microsoft, so Claude-issued is the only
   path for us). Claude shows an **Issuer URL** of the form
   `https://identity.anthropic.com/issuers/<id>`, unique to the Setty org.
2. When a member uses the connector, Claude signs a short-lived JWT (the
   "identity assertion") under that issuer. It carries the member's Claude
   email (lowercase), an opaque `sub`, `aud` = our authorization server's
   issuer value, `client_id`, `exp` (under a minute), and a one-time `jti`.
3. Claude POSTs it to our **token endpoint** with
   `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`, expecting a
   normal OAuth access token back. It never shows the user a sign-in screen.
4. Claude then calls `/mcp` with that access token, the same as today.
5. If our token endpoint rejects the assertion (for example, the email is not
   a PMS user), Claude falls back to the normal Connect card. Browser sign-in
   and managed authorization can both be on; Claude tries managed first.

Custom connectors (ours is one) are supported: Anthropic's own test procedure
adds the server as a custom connector and uses the same Managed authorization
row. There is a **Run test** button that shows each step, what Claude sent,
and the decoded assertion, which makes development much less blind.

## What the connector has today

- Sign-in is Microsoft Entra ID. The Cloudflare worker in `mcp-proxy/`
  publishes the OAuth discovery documents (it names itself the issuer) but
  its `authorization_endpoint` and `token_endpoint` point at Entra, and it
  advertises only the `authorization_code` and `refresh_token` grants.
- The Edge Function (`supabase/functions/pms-mcp/index.ts`,
  `verifyEntraToken`) accepts only Entra-signed tokens for our app
  registration, and reads the caller's email from the token to resolve
  capabilities through `pms_caps_for`.
- `pms_user_roles` is keyed by email and constrained to `@setty.com`.

Two of Anthropic's conditions for sending assertions fail right now:
the token endpoint must be on the same registrable domain as the issuer
(ours is `login.microsoftonline.com`, the issuer is `workers.dev`), and
`grant_types_supported` must list the jwt-bearer grant.

## The build

Everything below is additive. Entra sign-in keeps working unchanged for
anyone the new path refuses.

### 1. Worker (`mcp-proxy/worker.js`), about 30 lines

- `token_endpoint` becomes `<origin>/token` (our own), and the worker
  forwards `/token` to the Edge Function's new `/pms-mcp/oauth/token`.
- `grant_types_supported` adds `urn:ietf:params:oauth:grant-type:jwt-bearer`;
  add `authorization_grant_profiles_supported: ["urn:ietf:params:oauth:grant-profile:id-jag"]`.
- Advertise `client_id_metadata_document_supported: true` and add `none` to
  `token_endpoint_auth_methods_supported`, so Claude can identify itself with
  its hosted Client ID Metadata Document on the exchange. (Anthropic says the
  exchange does not use a client id and secret typed into a connector
  dialog; which `client_id` Claude sends on our custom connector is the first
  thing the Run test will tell us. See "Open questions".)

### 2. Edge Function: a token endpoint, about 250 lines plus tests

`POST /pms-mcp/oauth/token`:

- `grant_type=authorization_code` or `refresh_token`: forward the form body
  to Entra's token endpoint unchanged and return its response. This keeps the
  interactive sign-in working once the token endpoint moves to our domain.
- `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`: validate the
  assertion in Anthropic's prescribed order, then mint a PMS access token.

Validation (each failure answers `invalid_grant`):

1. `iss` equals, as an exact string, the issuer URL stored for Setty
   (new Edge Function secret `CLAUDE_EMA_ISSUER`, pasted from the Claude admin
   screen). No prefix or host matching.
2. Fetch `<iss>/.well-known/openid-configuration`, confirm its `issuer`
   equals `iss`, take `jwks_uri` from it. Claude's document has no
   authorize or token endpoints, so read the two fields by hand. Cache keys
   per response headers; refetch on an unknown `kid`.
3. Verify with `jose` (already imported) allowing only ES256 and RS256.
4. `typ` header is `oauth-id-jag+jwt`.
5. `aud` is our issuer value (the worker origin), exactly as published.
6. `client_id` claim equals the request's `client_id`.
7. `sub` present; `exp`, `iat`, `nbf` with at most 60 seconds skew.
8. `jti` seen once: new table `pms_ema_jti (jti text, iss text, exp timestamptz)`,
   insert-or-reject, rows pruned past `exp` plus skew. If the table is
   unreachable, reject (Anthropic's rule: if you cannot check replay, refuse).
9. Look the user up by `email` in `pms_user_roles` (whole address, case
   folded). Not found means `invalid_grant`, so Claude shows the Connect card
   and nothing changes for that person. This is also the access control: the
   `@setty.com` constraint on that table is what stands in for "verified
   domain" in Anthropic's warning about trusting an email claim.

Minting: a JWT signed with a new `PMS_TOKEN_SECRET`, `iss` = our issuer,
`aud` = `api://<ENTRA_CLIENT_ID>` (the resource Claude sends), `email`,
`name` from `pms_user_roles`, one-hour `exp`. Return `access_token`,
`token_type`, `expires_in`, no refresh token (Anthropic: Claude does not use
one on this grant and will simply exchange a fresh assertion).

### 3. Edge Function: the `/mcp` gate

In the auth middleware, when `verifyEntraToken` fails, try the PMS-issued
token with the same secret. On success build the same `Caller` shape
(`kind: "user"`, email, name, `oid: null`) so every downstream capability
check works unchanged. Everything else in the function is untouched.

### 4. Claude admin side (Sara, as org Owner)

Organization settings > Connectors > Setty PMS > Configuration > Managed
authorization > Set up > Claude-issued. Copy the Issuer URL into the
`CLAUDE_EMA_ISSUER` secret, redeploy, click Run test, then Save & turn on.

### 5. Docs

Update `docs/PMS-CONNECTOR-GUIDE.md` (the "Connect once" step goes away for
most people), the Admin Console's Claude/MCP tab, `mcp-proxy/README.md`
(the "no token ever passes through here" sentence stops being true), and
the function README's auth-model section.

## The trade-off to decide before building

Today, getting into PMS through Claude requires a Microsoft sign-in, with
whatever Conditional Access and MFA IT enforces on that. With Claude-issued
auto-connect the proof is weaker: Anthropic's assertion says only that the
person is a current member of Setty's Claude organization with that email.
It says nothing about MFA or an Entra sign-in. Access then rests on two
lists: membership of the Claude org, and a row in `pms_user_roles`.

Mitigations in the design: the email must already be a PMS user, tokens live
one hour so removal from either list takes effect within the hour, and the
Entra path stays available. The process change is that off-boarding must
remove the person from the Claude organization, not only from Entra.

This is a call for Sara and IT, not for the build. If the answer is no, the
alternative is the status quo plus nudging, which is what the live-lessons
check already does.

## Open questions, answered by a half-day spike

1. **Which `client_id` Claude sends** on the exchange for a custom connector
   registered with our own Entra app. Build steps 1 and 2 with the mint
   disabled, run Claude's connection test, read the request it shows.
   Accept that value (plus Claude's metadata-document URL) on the grant.
2. **Discovery through `workers.dev`.** Claude already walks our discovery
   chain for the browser flow, so the same documents should serve the
   exchange; the connection test confirms it. The pending move to a custom
   domain changes the issuer string, and Anthropic warns a changed issuer
   stops Claude-issued sign-ins until the admin re-runs setup, so do the
   domain move first or plan to re-run setup after it.
3. **Existing connections.** Nikhil's question about whether an already
   connected person is picked up is not answered in Anthropic's docs. The
   docs say Claude tries managed authorization first when both are on; the
   test organization will show whether a prior connection has to be removed.

## Effort

Spike (steps 1 and 2 without minting, run the connection test): half a day.
Full build with unit tests on the validator (jose can generate ES256 keys in
tests, so every refusal case in Anthropic's launch checklist is testable
offline), migration, docs and an end-to-end test in Claude: two to three
days. Edge Function deploys do not ride with repo merges, so the change ships
on a `supabase functions deploy`, with a worker `wrangler deploy` alongside.

## Sources

- Anthropic, Enterprise Managed Auth for connectors:
  https://claude.com/docs/connectors/building/enterprise-managed-auth
- Anthropic, Authentication for connectors (discovery, CIMD, client ids):
  https://claude.com/docs/connectors/building/authentication
- Anthropic help, Auto-connect your organization's apps to Claude:
  https://support.claude.com/en/articles/15537633-auto-connect-your-organization-s-apps-to-claude
- MCP extension, Enterprise-Managed Authorization (revision 2026-07-28):
  https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization
- Microsoft, MCP enterprise authorization: what Entra and App Service can do today:
  https://techcommunity.microsoft.com/blog/appsonazureblog/mcp-enterprise-authorization-is-here-%E2%80%94-what-entra-and-app-service-can-do-today/4537433

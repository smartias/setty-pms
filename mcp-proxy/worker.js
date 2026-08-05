/**
 * Setty PMS MCP discovery proxy.
 *
 * Why this exists
 * ---------------
 * Claude derives OAuth discovery from the ORIGIN of the MCP server URL, throwing
 * away the path. Our server lives at a path on the Supabase gateway, so Claude
 * probes khxmgjilwhdguuepbhne.supabase.co/.well-known/... which is Kong, not us.
 * Entra compounds it: it publishes only openid-configuration, never the RFC 8414
 * document. With no metadata found anywhere, Claude falls back to guessing
 * <origin>/authorize and Supabase answers "requested path is invalid".
 *
 * This worker owns a root we control. It names ITSELF as the authorization
 * server, serves valid RFC 8414 metadata whose endpoints point at Entra, and
 * streams everything else through to the Edge Function untouched. Naming
 * ourselves is the part that matters: issuer then matches the URL the document
 * was fetched from, so strict clients validate cleanly, and the client never has
 * to ask Entra for a document Entra does not publish.
 */

const UPSTREAM = 'https://khxmgjilwhdguuepbhne.supabase.co/functions/v1/pms-mcp';
const TENANT = 'f374c024-71c2-48b6-8420-076fff97327c';
const ENTRA = `https://login.microsoftonline.com/${TENANT}`;

// The Entra Application ID URI of the connector app registration. This is the
// token audience, NOT a URL we host. Do not "correct" it to the MCP URL: the
// client passes it to Entra as the resource, and Entra only knows this value.
const APP_ID_URI = 'api://b49e795c-2af3-4ab9-aa39-52539d4a7a99';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-expose-headers': 'www-authenticate, mcp-session-id',
};

const json = (body) =>
  new Response(JSON.stringify(body, null, 2), {
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300', ...CORS },
  });

const authorizationServerMetadata = (origin) => ({
  issuer: origin,
  authorization_endpoint: `${ENTRA}/oauth2/v2.0/authorize`,
  token_endpoint: `${ENTRA}/oauth2/v2.0/token`,
  jwks_uri: `${ENTRA}/discovery/v2.0/keys`,
  response_types_supported: ['code'],
  response_modes_supported: ['query'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
  scopes_supported: [`${APP_ID_URI}/MCP.Access`, 'openid', 'profile', 'offline_access'],
});

// No registration_endpoint on purpose. Entra has no dynamic client registration,
// and advertising one would send the client chasing an endpoint that cannot
// exist. The connector is configured with a client id and secret by hand.

const protectedResourceMetadata = (origin) => ({
  resource: APP_ID_URI,
  authorization_servers: [origin],
  scopes_supported: [`${APP_ID_URI}/MCP.Access`],
  bearer_methods_supported: ['header'],
});

async function proxy(request, origin) {
  const url = new URL(request.url);
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';

  // Observability: MCP bodies are tiny JSON-RPC envelopes, so buffering to log
  // the method name costs nothing and turns "the client sent two requests"
  // into "the client sent initialize then tools/list". Method names only,
  // never params: params can carry real project data.
  let bodyText;
  if (hasBody) {
    bodyText = await request.text();
    try {
      const rpc = JSON.parse(bodyText);
      console.log('[mcp]', rpc.method || '(response/no method)', 'id:' + (rpc.id ?? '-'));
    } catch {
      console.log('[mcp] non-JSON body,', bodyText.length, 'bytes');
    }
  }

  const upstream = await fetch(UPSTREAM + url.pathname + url.search, {
    method: request.method,
    headers: request.headers,
    body: hasBody ? bodyText : undefined,
    redirect: 'manual',
  });
  console.log('[mcp] upstream', upstream.status, upstream.headers.get('content-type') || '-');

  const headers = new Headers(upstream.headers);

  // The Edge Function advertises its own supabase.co metadata URL. Passed
  // through unchanged, that walks the client straight back into the broken path.
  const challenge = headers.get('www-authenticate');
  if (challenge) {
    headers.set(
      'www-authenticate',
      challenge.replace(
        /resource_metadata="[^"]*"/,
        `resource_metadata="${origin}/.well-known/oauth-protected-resource"`
      )
    );
  }
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

// ─── RUNAWAY-CLIENT CEILING ──────────────────────────────────────────────────
// Guards only the proxied path: every request that reaches proxy() costs a
// metered Supabase invocation, while discovery documents and CORS preflights
// are served from this worker for free. A client stuck in an OAuth retry loop
// is precisely the client that never obtained a token, so unauthenticated
// traffic shares one bucket per IP and hits the ceiling fast. Authenticated
// sessions are keyed by a hash of their token as well, so several people
// working behind one shared egress IP do not eat each other's budget.
async function rateLimitKey(request) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const auth = request.headers.get('authorization');
  if (!auth) return ip;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(auth));
  const hash = [...new Uint8Array(digest.slice(0, 8))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${ip}:${hash}`;
}

const rateLimited = () =>
  new Response(
    JSON.stringify({ error: 'rate_limited', detail: 'Too many requests. Retry in a minute.' }),
    { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '60', ...CORS } }
  );

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = url.origin;
    const path = url.pathname;

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    // Clients probe both the bare well-known path and a resource-suffixed form
    // (/.well-known/oauth-protected-resource/mcp). Match the prefix, serve both.
    if (path.startsWith('/.well-known/oauth-protected-resource')) {
      return json(protectedResourceMetadata(origin));
    }
    if (
      path.startsWith('/.well-known/oauth-authorization-server') ||
      path.startsWith('/.well-known/openid-configuration')
    ) {
      return json(authorizationServerMetadata(origin));
    }

    // Everything past this point is forwarded upstream and costs money.
    try {
      const { success } = await env.PROXY_LIMITER.limit({ key: await rateLimitKey(request) });
      if (!success) return rateLimited();
    } catch (e) {
      // Limiter unavailable (missing binding, transient platform error): let
      // the request through. The ceiling is protection, not a dependency, and
      // a broken limiter must never be the thing that takes the connector down.
      console.warn('[ratelimit] check failed, allowing request:', e.message);
    }

    return proxy(request, origin);
  },
};

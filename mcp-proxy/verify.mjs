/**
 * Walks the exact discovery chain Claude walks, in the same order, against a
 * deployed proxy. Run it after every deploy.
 *
 *   node verify.mjs https://setty-pms-mcp.<account>.workers.dev
 *
 * The failure this guards against is silent: every broken link in the chain
 * makes a client GUESS rather than error, which is how we ended up staring at
 * "requested path is invalid" instead of a useful message.
 */

const base = (process.argv[2] || '').replace(/\/+$/, '');
if (!base) {
  console.error('usage: node verify.mjs <proxy-base-url>');
  process.exit(2);
}

let ran = 0;
let failed = 0;
const check = (label, ok, detail) => {
  ran++;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `\n        ${detail}` : ''}`);
};

const getJson = async (url) => {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  const text = await res.text();
  try {
    return { res, body: JSON.parse(text) };
  } catch {
    return { res, body: null, text };
  }
};

// Step 1: the unauthenticated probe must challenge, and must point at US.
const probe = await fetch(`${base}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
});
check('POST /mcp returns 401', probe.status === 401, `got ${probe.status}`);

const challenge = probe.headers.get('www-authenticate') || '';
const metaUrl = (challenge.match(/resource_metadata="([^"]+)"/) || [])[1];
check('challenge carries resource_metadata', Boolean(metaUrl), challenge || '(no header)');
check(
  'resource_metadata points at the proxy, not supabase.co',
  Boolean(metaUrl && metaUrl.startsWith(base)),
  metaUrl
);

// Step 2: the resource metadata must name an authorization server we can reach.
const { res: prRes, body: pr } = await getJson(
  metaUrl || `${base}/.well-known/oauth-protected-resource`
);
check('protected-resource metadata is 200 JSON', prRes.status === 200 && Boolean(pr), `${prRes.status}`);
check(
  'resource is the Entra app id URI',
  pr?.resource === 'api://b49e795c-2af3-4ab9-aa39-52539d4a7a99',
  pr?.resource
);

const as = pr?.authorization_servers?.[0];
check('authorization_servers names the proxy', as === base, as);

// Step 3: the authorization server metadata. This is the document Entra does
// not publish and the whole reason the proxy exists.
const { res: asRes, body: asMeta } = await getJson(`${as || base}/.well-known/oauth-authorization-server`);
check('authorization-server metadata is 200 JSON', asRes.status === 200 && Boolean(asMeta), `${asRes.status}`);
check('issuer matches where it was served from', asMeta?.issuer === (as || base), asMeta?.issuer);
check(
  'authorization_endpoint is Entra',
  /^https:\/\/login\.microsoftonline\.com\/.+\/oauth2\/v2\.0\/authorize$/.test(asMeta?.authorization_endpoint || ''),
  asMeta?.authorization_endpoint
);
check(
  'token_endpoint is Entra',
  /^https:\/\/login\.microsoftonline\.com\/.+\/oauth2\/v2\.0\/token$/.test(asMeta?.token_endpoint || ''),
  asMeta?.token_endpoint
);
check('PKCE S256 advertised', asMeta?.code_challenge_methods_supported?.includes('S256'));
check(
  'MCP.Access scope advertised',
  asMeta?.scopes_supported?.some((s) => s.endsWith('/MCP.Access')),
  JSON.stringify(asMeta?.scopes_supported)
);

// Step 4: the endpoint has to actually answer. A 404 here is the original bug
// wearing a different hat.
if (asMeta?.authorization_endpoint) {
  const authRes = await fetch(asMeta.authorization_endpoint, { method: 'GET', redirect: 'manual' });
  check('authorization_endpoint responds (not 404)', authRes.status !== 404, `got ${authRes.status}`);
}

// Step 5: the fallback that broke us must no longer be reachable as a surprise.
const strayRes = await fetch(`${base}/authorize`, { redirect: 'manual' });
check(
  '/authorize is not silently a Supabase error page',
  !(await strayRes.clone().text()).includes('requested path is invalid'),
  `status ${strayRes.status}`
);

console.log(`\n${ran - failed}/${ran} passed`);
process.exit(failed ? 1 : 0);

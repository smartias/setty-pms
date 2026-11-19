// Newsletter unsubscribe endpoint.
// Public (verify_jwt=false): recipients click this from an email; they have no JWT.
//
// This function is an API only. Supabase serves every edge-function response on
// the project domain as text/plain inside a CSP sandbox, so HTML returned from
// here shows up as raw source in the browser. The page people see is
// Unsubscribe.html on the PMS site; it POSTs JSON here.
//
//   GET                      -> 302 to Unsubscribe.html (keeps links in emails
//                               that were sent before the page moved working)
//   POST {"email": "..."}    -> unsubscribe by address (today's BCC newsletter)
//   POST {"token": "<uuid>"} -> unsubscribe by token (future personalized sends)
//
// Nothing changes on GET, so link pre-fetching can't unsubscribe anyone.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const BUILD = "2026-11-19-unsubscribe-v2-json-api";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PAGE_URL = Deno.env.get("UNSUBSCRIBE_PAGE_URL") ||
  "https://smartias.github.io/setty-pms/Unsubscribe.html";

// Public endpoint with no cookies or credentials, so any origin may call it.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
  });
}

const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function findOne(filter: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/newsletter_subscribers?${filter}&select=email,status`, { headers });
  if (!res.ok) throw new Error("lookup failed: " + res.status);
  const rows = await res.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function doUnsubscribe(filter: string): Promise<boolean> {
  const now = new Date().toISOString();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/newsletter_subscribers?${filter}`, {
    method: "PATCH",
    headers: { ...headers, "content-type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ status: "unsubscribed", unsubscribed_at: now, updated_at: now }),
  });
  return res.ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (req.method === "GET" || req.method === "HEAD") {
    const url = new URL(req.url);
    if (url.searchParams.get("health")) return json({ ok: true, build: BUILD });
    const dest = new URL(PAGE_URL);
    const token = url.searchParams.get("token");
    if (token) dest.searchParams.set("token", token);
    return new Response(null, { status: 302, headers: { ...CORS, Location: dest.href } });
  }

  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

  try {
    if (token) {
      // Tokens are uuids; anything else can't match and must not reach the filter.
      if (!/^[0-9a-f-]{36}$/i.test(token)) return json({ ok: false, error: "not_found" }, 404);
      const filter = `unsubscribe_token=eq.${encodeURIComponent(token)}`;
      const sub = await findOne(filter);
      if (!sub) return json({ ok: false, error: "not_found" }, 404);
      if (sub.status !== "unsubscribed" && !(await doUnsubscribe(filter))) {
        return json({ ok: false, error: "failed" }, 500);
      }
      return json({ ok: true, email: sub.email });
    }

    if (email) {
      if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json({ ok: false, error: "invalid_email" }, 400);
      }
      // Idempotent and privacy-preserving: the same answer whether or not the
      // address was on the list (don't reveal who is or isn't a subscriber).
      const filter = `email=eq.${encodeURIComponent(email)}`;
      const sub = await findOne(filter);
      if (sub && sub.status !== "unsubscribed" && !(await doUnsubscribe(filter))) {
        return json({ ok: false, error: "failed" }, 500);
      }
      return json({ ok: true });
    }
  } catch (e) {
    console.error("unsubscribe failed", e);
    return json({ ok: false, error: "failed" }, 500);
  }

  return json({ ok: false, error: "missing_email" }, 400);
});

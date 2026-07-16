/* ─────────────────────────────────────────────────────────────────────────────
   setty-auth.js — shared Supabase session layer for the Setty suite (Phase 1).

   Sign-in goes through Supabase Auth's already-configured Azure provider (the
   same c4739c11 app registration staff sign into for the PMS), with an email
   one-time-code fallback. No MSAL, no new Azure redirect URIs, no secrets —
   the browser only ever sees the user's own short-lived JWT.

   Non-breaking by design: while RLS still allows anon (Phase 1), token()
   falls back to the anon key for signed-out users, so every app keeps working
   exactly as before. When Phase 2 flips policies to `TO authenticated`,
   signed-out users lose data access and nothing else changes.

   All suite pages share the smartias.github.io origin, so one sign-in in any
   app signs the user into all of them (session lives in localStorage).

   Usage:
     <script src="setty-auth.js"></script>
     await settyAuth.init();                       // before first data call
     headers.Authorization = "Bearer " + settyAuth.token();
     settyAuth.onChange(sess => { ...update UI, refresh headers... });
     settyAuth.signInWithMicrosoft();              // redirects and returns here
   ───────────────────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  const SUPABASE_URL = "https://khxmgjilwhdguuepbhne.supabase.co";
  const ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtoeG1namlsd2hkZ3V1ZXBiaG5lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNjg2MDYsImV4cCI6MjA4ODY0NDYwNn0.vtHt2eydU2iQ426iYOzLrqpH2WLXdRnicq-3sNfoNq8";
  const STORE_KEY = "settyAuth:session:v1";
  const REFRESH_SKEW_S = 120;   // refresh this many seconds before expiry

  let session = null;           // { access_token, refresh_token, expires_at, user }
  let refreshTimer = null;
  let refreshing = null;        // single-flight promise
  const listeners = [];

  // ── storage ────────────────────────────────────────────────────────────────
  function loadStored() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "null"); }
    catch (_) { return null; }
  }
  function store(sess) {
    session = sess;
    try {
      if (sess) localStorage.setItem(STORE_KEY, JSON.stringify(sess));
      else localStorage.removeItem(STORE_KEY);
    } catch (_) { /* private mode — session lives for this tab only */ }
    scheduleRefresh();
    listeners.forEach(fn => { try { fn(session); } catch (_) {} });
  }

  // Another tab signed in/out — adopt its session without a reload.
  window.addEventListener("storage", (e) => {
    if (e.key !== STORE_KEY) return;
    session = loadStored();
    scheduleRefresh();
    listeners.forEach(fn => { try { fn(session); } catch (_) {} });
  });

  // ── auth REST helpers ──────────────────────────────────────────────────────
  async function authFetch(path, body, bearer) {
    const res = await fetch(SUPABASE_URL + "/auth/v1" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "apikey": ANON_KEY,
        "Content-Type": "application/json",
        ...(bearer ? { "Authorization": "Bearer " + bearer } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const msg = (json && (json.error_description || json.msg || json.message || json.error)) || ("HTTP " + res.status);
      throw new Error(msg);
    }
    return json;
  }

  function sessionFromTokenResponse(j) {
    return {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (Number(j.expires_in) || 3600),
      user: j.user || (session && session.user) || null,
    };
  }

  // ── refresh loop ───────────────────────────────────────────────────────────
  function scheduleRefresh() {
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
    if (!session || !session.refresh_token) return;
    const ms = Math.max(5000, (session.expires_at - REFRESH_SKEW_S) * 1000 - Date.now());
    refreshTimer = setTimeout(() => { refresh().catch(() => {}); }, ms);
  }

  async function refresh() {
    if (!session || !session.refresh_token) return null;
    if (refreshing) return refreshing;            // single-flight across callers
    refreshing = (async () => {
      try {
        const j = await authFetch("/token?grant_type=refresh_token", { refresh_token: session.refresh_token });
        store(sessionFromTokenResponse(j));
        return session;
      } catch (e) {
        // Refresh token consumed by another tab is normal — re-read storage
        // before declaring the session dead.
        const other = loadStored();
        if (other && other.access_token !== (session && session.access_token)) { store(other); return session; }
        store(null);
        return null;
      } finally { refreshing = null; }
    })();
    return refreshing;
  }

  // ── sign-in flows ──────────────────────────────────────────────────────────
  // Azure via Supabase (implicit flow → tokens come back in the URL fragment).
  // redirect_to must be allow-listed in Supabase Auth → URL Configuration.
  function signInWithMicrosoft() {
    const back = location.origin + location.pathname + location.search;
    location.href = SUPABASE_URL + "/auth/v1/authorize?provider=azure&redirect_to=" + encodeURIComponent(back);
  }

  async function sendEmailCode(email) {
    await authFetch("/otp", { email: String(email || "").trim(), create_user: true });
  }
  async function verifyEmailCode(email, code) {
    const j = await authFetch("/verify", { type: "email", email: String(email || "").trim(), token: String(code || "").trim() });
    store(sessionFromTokenResponse(j));
    return session;
  }

  async function signOut() {
    const t = session && session.access_token;
    store(null);
    if (t) { try { await authFetch("/logout", {}, t); } catch (_) {} }
  }

  // ── boot ───────────────────────────────────────────────────────────────────
  async function init() {
    // 1) Returning from the Azure redirect? Tokens arrive in the hash.
    if (/access_token=/.test(location.hash)) {
      const h = new URLSearchParams(location.hash.slice(1));
      const sess = {
        access_token: h.get("access_token"),
        refresh_token: h.get("refresh_token"),
        expires_at: Number(h.get("expires_at")) || Math.floor(Date.now() / 1000) + (Number(h.get("expires_in")) || 3600),
        user: null,
      };
      history.replaceState(null, "", location.pathname + location.search); // scrub tokens from the URL
      try { sess.user = await authFetch("/user", undefined, sess.access_token); } catch (_) {}
      store(sess);
      return session;
    }
    if (/error_description=/.test(location.hash)) {
      const h = new URLSearchParams(location.hash.slice(1));
      history.replaceState(null, "", location.pathname + location.search);
      throw new Error(h.get("error_description") || "Sign-in failed");
    }

    // 2) Stored session: use it, refreshing first if it's stale.
    session = loadStored();
    if (session) {
      if (session.expires_at * 1000 - Date.now() < REFRESH_SKEW_S * 1000) await refresh();
      else scheduleRefresh();
    }
    return session;
  }

  // ── shared sign-in pill ────────────────────────────────────────────────────
  // A small fixed pill (bottom-right) shown while signed out, so every app in
  // the suite gets a sign-in affordance without touching its own header. Hides
  // itself on sign-in and reappears on sign-out — driven by onChange.
  function mountPill(opts) {
    const o = opts || {};
    if (document.getElementById("settyAuthPill")) return;
    const pill = document.createElement("div");
    pill.id = "settyAuthPill";
    pill.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:99999;display:none;" +
      "align-items:center;gap:8px;padding:9px 14px;border-radius:999px;" +
      "background:#1d4ed8;color:#fff;font:600 13px/1 system-ui,Segoe UI,sans-serif;" +
      "box-shadow:0 4px 14px rgba(0,0,0,.35);cursor:pointer;user-select:none";
    pill.textContent = o.label || "🔐 Sign in — one click with Microsoft";
    pill.title = o.title || "The PMS suite is moving to signed-in access. Sign in once and every Setty app is covered.";
    pill.onclick = signInWithMicrosoft;
    const sync = () => { pill.style.display = window.settyAuth.isSignedIn() ? "none" : "flex"; };
    listeners.push(sync);
    const attach = () => { document.body.appendChild(pill); sync(); };
    if (document.body) attach(); else document.addEventListener("DOMContentLoaded", attach);
  }

  // ── public surface ─────────────────────────────────────────────────────────
  window.settyAuth = {
    mountPill,
    init,
    signInWithMicrosoft,
    sendEmailCode,
    verifyEmailCode,
    signOut,
    refresh,
    onChange(fn) { listeners.push(fn); },
    // The Bearer for every Supabase data call. Anon fallback keeps signed-out
    // users working until Phase 2 tightens RLS.
    token() {
      if (session && session.access_token && session.expires_at * 1000 > Date.now()) return session.access_token;
      return ANON_KEY;
    },
    anonKey() { return ANON_KEY; },
    supabaseUrl() { return SUPABASE_URL; },
    user() { return (session && session.user) || null; },
    email() { const u = this.user(); return (u && u.email) || ""; },
    isSignedIn() { return !!(session && session.access_token && session.expires_at * 1000 > Date.now()); },
    displayName() {
      const u = this.user();
      if (!u) return "";
      const m = u.user_metadata || {};
      return m.full_name || m.name || m.preferred_username || (u.email ? u.email.split("@")[0].replace(/[._]/g, " ") : "");
    },
  };
})();

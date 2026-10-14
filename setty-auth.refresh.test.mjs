// Two tabs sharing one stored Supabase session both try to refresh it at the
// same moment (their timers were set from the same expiry). Supabase rotates
// the refresh token on every use, so the tab that loses the race holds a
// consumed token. The test loads the real setty-auth.js into two sandboxed
// "tabs" that share one localStorage and (optionally) one navigator.locks.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const SRC = fs.readFileSync(new URL("./setty-auth.js", import.meta.url), "utf8");
const STORE_KEY = "settyAuth:session:v1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Minimal Web Locks: exclusive, FIFO, shared across tabs.
function makeLocks() {
  const tails = new Map();
  return {
    request(name, opts, cb) {
      if (typeof opts === "function") { cb = opts; opts = {}; }
      const prev = tails.get(name) || Promise.resolve();
      const run = prev.then(() => cb());
      tails.set(name, run.catch(() => {}));
      return run;
    },
  };
}

// Strict single-use rotation, no reuse window. The token that wins gets a
// SLOW response; the loser is rejected FAST, so the loser sees the failure
// before the winner has written anything back to storage.
function makeServer() {
  let current = "rt0";
  let n = 0;
  const calls = [];
  return {
    calls,
    async fetch(url, init) {
      const body = JSON.parse(init.body);
      calls.push(body.refresh_token);
      if (body.refresh_token !== current) {
        await sleep(5);
        return { ok: false, status: 400, text: async () => JSON.stringify({ error_description: "Invalid Refresh Token: Already Used" }) };
      }
      n += 1;
      current = "rt" + n;
      const issued = { access_token: "at" + n, refresh_token: current, expires_in: 3600, user: { email: "sara.arias@setty.com" } };
      await sleep(40);
      return { ok: true, status: 200, text: async () => JSON.stringify(issued) };
    },
  };
}

// Long timers (the 15s lock cap, the hour-long refresh schedule) are shrunk 100x
// and unref'd so the suite stays fast and never hangs the process.
const fastSetTimeout = (fn, ms) => {
  const t = setTimeout(fn, ms >= 10000 ? ms / 100 : ms);
  if (t && t.unref) t.unref();
  return t;
};

function makeTab({ storage, locks, server }) {
  const listeners = {};
  const sandbox = {
    console, setTimeout: fastSetTimeout, clearTimeout, URLSearchParams, AbortController, JSON, Date, Math, Promise,
    localStorage: storage,
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { hash: "", pathname: "/setty-pms/SettyPMS.html", search: "", origin: "https://smartias.github.io", href: "" },
    history: { replaceState() {} },
    document: { currentScript: null, getElementById: () => null, createElement: () => ({ style: {} }), body: null, addEventListener() {} },
    navigator: locks ? { locks } : {},
    fetch: (u, i) => server.fetch(u, i),
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = (type, fn) => { (listeners[type] ||= []).push(fn); };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox.settyAuth;
}

function seedStorage() {
  const data = new Map();
  const storage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
  // Expires in 30s: inside the 120s refresh skew, so init() refreshes at once.
  storage.setItem(STORE_KEY, JSON.stringify({
    access_token: "at0", refresh_token: "rt0",
    expires_at: Math.floor(Date.now() / 1000) + 30, user: { email: "sara.arias@setty.com" },
  }));
  return storage;
}

test("without a lock, the losing tab is signed out (the bug this guards)", async () => {
  const storage = seedStorage();
  const server = makeServer();
  const a = makeTab({ storage, locks: null, server });
  const b = makeTab({ storage, locks: null, server });
  const [sa, sb] = await Promise.all([a.init(), b.init()]);
  const signedIn = [sa, sb].filter(Boolean).length;
  assert.equal(signedIn, 1, "one tab loses its session when two refresh with the same token");
});

test("with the browser-wide lock, both tabs stay signed in and one token is spent", async () => {
  const storage = seedStorage();
  const server = makeServer();
  const locks = makeLocks();
  const a = makeTab({ storage, locks, server });
  const b = makeTab({ storage, locks, server });
  const [sa, sb] = await Promise.all([a.init(), b.init()]);
  assert.ok(sa && sb, "both tabs are still signed in");
  assert.equal(sa.access_token, sb.access_token, "both tabs hold the same fresh session");
  assert.equal(sa.access_token, "at1");
  assert.deepEqual(server.calls, ["rt0"], "the refresh token is spent exactly once");
});

test("a tab that already holds a fresh session does not refresh again", async () => {
  const storage = seedStorage();
  const server = makeServer();
  const locks = makeLocks();
  const a = makeTab({ storage, locks, server });
  await a.init();
  const b = makeTab({ storage, locks, server });
  const sb = await b.init();
  assert.equal(sb.access_token, "at1");
  assert.equal(server.calls.length, 1);
});

test("a stuck lock holder cannot block refresh forever", async () => {
  const storage = seedStorage();
  const server = makeServer();
  // A lock manager that never grants: the capped wait must let refresh go ahead.
  const stuck = {
    request(_name, opts) {
      return new Promise((_res, rej) => {
        opts.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; rej(e); });
      });
    },
  };
  const tab = makeTab({ storage, locks: stuck, server });
  const result = await Promise.race([tab.init(), sleep(2000).then(() => "timeout")]);
  assert.notEqual(result, "timeout");
  assert.equal(result.access_token, "at1");
});

// search_emails: the sender and direction filters run inside the search
// (migration 20261124100000), with a fallback that filters afterwards and
// says so when the database function does not take them yet.
//
// The helpers are COPIES (index.ts boots a server at import); the anchors at
// the bottom fail when the shipped code or the migration moves away from them.
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

function emailFilterArgs(sender, direction) {
  const out = {};
  const s = String(sender ?? "").trim();
  if (s) out.p_sender = s;
  if (direction === "outgoing" || direction === "incoming") out.p_direction = direction;
  return out;
}
function isMissingFunctionError(e) {
  return /PGRST202|Could not find the function/i.test(String(e?.message ?? e));
}
function filterEmailRows(rows, sender, direction) {
  const s = String(sender ?? "").trim().toLowerCase();
  let out = rows;
  if (s) out = out.filter((r) => String(r.from_address ?? "").toLowerCase().includes(s));
  if (direction) out = out.filter((r) => r.direction === direction);
  return out;
}

test("no filter sends no extra parameters", () => {
  assert.deepEqual(emailFilterArgs(undefined, undefined), {});
  assert.deepEqual(emailFilterArgs("   ", null), {});
});

test("filters become search parameters", () => {
  assert.deepEqual(emailFilterArgs(" jane@acme.com ", "incoming"), { p_sender: "jane@acme.com", p_direction: "incoming" });
  assert.deepEqual(emailFilterArgs(null, "outgoing"), { p_direction: "outgoing" });
  assert.deepEqual(emailFilterArgs("acme", "sideways"), { p_sender: "acme" });
});

test("only a missing-function answer triggers the fallback", () => {
  assert.ok(isMissingFunctionError(new Error('Supabase rpc 404: {"code":"PGRST202","message":"Could not find the function public.search_project_emails(lim, p_sender, proj, q) in the schema cache"}')));
  assert.ok(!isMissingFunctionError(new Error('Supabase rpc 500: {"message":"canceling statement due to statement timeout"}')));
});

test("the fallback filter matches what the database does", () => {
  const rows = [
    { from_address: "Jane@Acme.com", direction: "incoming" },
    { from_address: "bob@setty.com", direction: "outgoing" },
    { from_address: null, direction: "incoming" },
  ];
  assert.equal(filterEmailRows(rows, "acme", undefined).length, 1);
  assert.equal(filterEmailRows(rows, undefined, "incoming").length, 2);
  assert.equal(filterEmailRows(rows, "ACME", "outgoing").length, 0);
  assert.equal(filterEmailRows(rows, "", undefined).length, 3);
});

test("the shipped code and the migration still match these copies", () => {
  const shipped = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const norm = (t) => t.replace(/: [A-Za-z<>, |\[\]]+(?=[,)=;{ ])/g, "").replace(/\(e as any\)/g, "e").replace(/\s+/g, "");
  const body = (src, fn) => {
    const i = src.indexOf(`function ${fn}(`); assert.ok(i >= 0, fn + " not found");
    const open = src.indexOf("{\n", i); let d = 0;
    for (let j = open; j < src.length; j++) {
      if (src[j] === "{") d++; else if (src[j] === "}" && --d === 0) return src.slice(open, j + 1);
    }
  };
  const here = readFileSync(new URL(import.meta.url), "utf8");
  for (const fn of ["emailFilterArgs", "isMissingFunctionError", "filterEmailRows"]) {
    assert.equal(norm(body(shipped, fn)), norm(body(here, fn)), fn + " has drifted from index.ts");
  }
  assert.ok(shipped.includes('return await sbRpc("search_project_emails", { ...args, ...filterArgs });'), "filters ride on the search call");
  assert.ok(shipped.includes("if (wantsFilter && !filteredInDb) {"), "rows are filtered here only on the fallback path");
  const mig = readFileSync(new URL("../../migrations/20261124100000_emails_search_sender_direction.sql", import.meta.url), "utf8");
  assert.ok(mig.includes("p_sender         text    default null,") && mig.includes("p_direction      text    default null"), "the function takes both filters, defaulting to none");
  assert.equal(mig.split("position(lower(btrim(").length - 1, 2, "the sender filter is in both candidate steps");
  assert.ok(!mig.includes("\r"), "migrations are LF");
});

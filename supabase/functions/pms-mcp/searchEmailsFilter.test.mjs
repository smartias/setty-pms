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

// The keyword candidates come through the GIN index and only the newest 2,000
// are ranked (migration 20261124120000): a sequential scan decompressed every
// email's word index and took 22 s for a common word.
test("the keyword step finds matches through the index and caps what it ranks", () => {
  const mig = readFileSync(new URL("../../migrations/20261124120000_emails_search_lexical_index_scan.sql", import.meta.url), "utf8");
  const fn = mig.slice(mig.indexOf("create or replace function public.pms_emails_search_lexical("));
  assert.ok(fn.includes("set enable_seqscan = off"), "the planner cannot fall back to the sequential scan");
  assert.ok(/hits as materialized \([\s\S]*?search_tsv @@ tq\.tsq[\s\S]*?limit 2000\s*\)/.test(fn), "matches are capped before ranking");
  const hits = fn.slice(fn.indexOf("hits as materialized"), fn.indexOf("limit 2000"));
  assert.ok(!hits.includes("ts_rank"), "nothing is ranked until the cap has been applied");
  assert.ok(hits.includes("p_sender") && hits.includes("p_direction") && hits.includes("proj is null or"), "project, sender and direction narrow the matches before the cap");
  assert.ok(fn.includes("p_sender    text    default null,") && fn.includes("p_direction text    default null"), "the signature search_project_emails calls is unchanged");
  assert.ok(!/drop function/i.test(mig), "replaced in place, so its grants stay");
  assert.ok(!mig.includes("\r"), "migrations are LF");
});

// The snippet is cut from the first 20,000 characters of a body (migration
// 20261124130000): cleaning and highlighting 25 threads of ~124,000 characters
// each took most of an 8-second search.
test("the snippet step works on a capped body, and nothing else changes", () => {
  const body = (file, start) => {
    const s = readFileSync(new URL("../../migrations/" + file, import.meta.url), "utf8");
    const a = s.indexOf(start);
    return s.slice(a, s.indexOf("$$;", a) + 3);
  };
  const before = body("20261124100000_emails_search_sender_direction.sql", "create function public.search_project_emails(");
  const after = body("20261124130000_emails_search_snippet_cap.sql", "create or replace function public.search_project_emails(");
  const undo = after
    .replace("create or replace function public.search_project_emails(", "create function public.search_project_emails(")
    .replace("           -- Snippet source only. Capped: see the header of 20261124130000.\n", "")
    .replace("left(e.body_text, 20000) as body_text,", "e.body_text,");
  assert.equal(undo, before, "the cap is the only difference from the function it replaces");
  assert.equal(after.split("body_text").length - 1, before.split("body_text").length - 1 + 1, "body_text is read in one place");
  // body_text feeds the snippet only: every other use is the alias from `scored`.
  assert.ok(!/e\.body_text(?!, 20000)/.test(after), "no step reads the uncapped body");
});

// How close an email must be to come back by meaning alone, and which emails
// are never searched by meaning (2026-11-24). Scores are from seven live
// searches: the best rows of four off-topic questions, and the expected
// threads of five real ones.
test("the similarity floor sits between unrelated questions and right answers", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const floor = Number((/const EMAIL_MIN_SIMILARITY = ([0-9.]+);/.exec(src) || [])[1]);
  const offTopicBest = [0.777, 0.762, 0.802, 0.769];
  const expectedThreads = [0.854, 0.858, 0.864, 0.852, 0.872];
  assert.ok(offTopicBest.every((s) => s < floor), "no off-topic question clears the floor");
  assert.ok(expectedThreads.every((s) => s >= floor + 0.02), "every expected thread clears it with room");
  assert.ok(src.includes("if (embedding !== undefined) { args.p_embedding = embedding; args.p_min_similarity = EMAIL_MIN_SIMILARITY; }"), "the floor rides with the embedding");
  assert.ok(src.includes("delete args.p_embedding;\n          delete args.p_min_similarity;"), "the keyword-only retry sends neither");
});

test("calendar replies and subject-less records are kept out of meaning-based search", () => {
  const mig = readFileSync(new URL("../../migrations/20261124160000_emails_meaning_skip_calendar_replies.sql", import.meta.url), "utf8");
  // The rule as the migration writes it, run here on real subject shapes.
  const skip = (subject) => ["", "{}"].includes(String(subject ?? "").trim())
    || /^\s*(accepted|declined|tentative|tentatively accepted|canceled|cancelled)\s*:/i.test(String(subject ?? ""));
  assert.ok(mig.includes("'^\\s*(accepted|declined|tentative|tentatively accepted|canceled|cancelled)\\s*:'"), "the pattern tested here is the one shipped");
  assert.ok(mig.includes("btrim(coalesce(p_subject, '')) in ('', '{}')"));
  for (const s of ["Declined: SAPX256018: 280 Broadway - Site Visit", "Accepted: Park View HS Thermal Imaging", "Canceled: Design Team meeting", "Tentatively Accepted: OAC", " declined: x", "{}", "", null]) {
    assert.ok(skip(s), "skipped: " + s);
  }
  for (const s of ["RE: Declined: the substitution request", "Submittal accepted as noted", "Canceled order for AHU-2", "Accepted Alternates - Bid Form", "Re: 665 New Lots Ave - BPL - Filing Update"]) {
    assert.ok(!skip(s), "kept: " + s);
  }
  assert.equal(mig.split("and not public.pms_emails_skip_meaning(e.subject)").length - 1, 2, "both branches of the queue leave them out");
  assert.ok(/update public\.pms_project_emails e\s+set embedding = null, embedded_hash = null, embedded_at = null\s+where e\.embedding is not null\s+and public\.pms_emails_skip_meaning\(e\.subject\);/.test(mig), "their existing vectors are cleared, and nothing else is touched");
  assert.ok(!/delete from/i.test(mig), "no email is removed from the log");
  assert.ok(!mig.includes("\r"), "migrations are LF");
});

test("automatic replies are kept out of meaning-based search too", () => {
  const mig = readFileSync(new URL("../../migrations/20261124170000_emails_meaning_skip_automatic_replies.sql", import.meta.url), "utf8");
  const skip = (subject) => ["", "{}"].includes(String(subject ?? "").trim())
    || /^\s*(accepted|declined|tentative|tentatively accepted|canceled|cancelled|automatic reply)\s*:/i.test(String(subject ?? ""));
  assert.ok(mig.includes("'^\\s*(accepted|declined|tentative|tentatively accepted|canceled|cancelled|automatic reply)\\s*:'"), "the pattern tested here is the one shipped");
  assert.ok(mig.includes("btrim(coalesce(p_subject, '')) in ('', '{}')"), "the earlier rules are kept");
  for (const s of ["Automatic reply: Bunker Hill ES - Exhaust Fans", "Automatic reply:  Request for Peer Review", " automatic reply: x", "Declined: Site Visit", "{}"]) {
    assert.ok(skip(s), "skipped: " + s);
  }
  for (const s of ["RE: Automatic reply: Bunker Hill ES", "Automatic reply settings for the shared mailbox", "FW: out of office coverage", "Re: 665 New Lots Ave - BPL - Filing Update"]) {
    assert.ok(!skip(s), "kept: " + s);
  }
  assert.ok(/update public\.pms_project_emails e\s+set embedding = null, embedded_hash = null, embedded_at = null\s+where e\.embedding is not null\s+and public\.pms_emails_skip_meaning\(e\.subject\);/.test(mig), "their existing vectors are cleared, and nothing else is touched");
  assert.ok(/grant execute on function public\.pms_emails_skip_meaning\(text\) to service_role;/.test(mig), "the grants are repeated");
  assert.ok(!/delete from/i.test(mig), "no email is removed from the log");
  assert.ok(!mig.includes("\r"), "migrations are LF");
});

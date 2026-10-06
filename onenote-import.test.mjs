// Run: node --test onenote-import.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeEntities, oneNoteHtmlToText, getWithRetry, resolveNotebook, findSection,
  listSectionPages, fetchPageContent, buildNoteFromPage, runSpike,
  listSections, guessCategory, classifyScan, mergeImport,
} from "./onenote-import.js";

// Shaped like real OneNote page content: head/title, outline divs, spans with
// inline styles, nested lists, a table, an image and an attachment.
const PAGE_HTML = `<html lang="en-US"><head><title>2026-05-14 Weekly Meeting</title>
<meta name="created" content="2026-05-14T14:00:00.0000000"/></head>
<body data-absolute-enabled="true" style="font-family:Calibri;font-size:11pt">
<div style="position:absolute;left:48px;top:115px;width:624px">
<p style="margin-top:0pt" lang="en-US"><span style="font-weight:bold">Station 1:</span> DP300&#39;s</p>
<p>Station 3: DP500&rsquo;s &amp; Rail&nbsp;Link: DP600&apos;s</p>
<ul>
  <li><p>Rail Link model pending SOO confirmation</p>
    <ul><li><p>need more time for simulation results</p></li></ul>
  </li>
  <li><p>Strollers are not modeled</p></li>
</ul>
<ol><li>first</li><li>second</li></ol>
<table border="1"><tr><td><p>Domain</p></td><td><p>Large</p></td></tr><tr><td><p>Pressure</p></td><td><p>Positive</p></td></tr></table>
<img src="https://graph.microsoft.com/v1.0/x/resources/abc/$value" data-src-type="image/png" alt="video still"/>
<object data-attachment="Exhibit 5.pdf" data="name:x" type="application/pdf"></object>
</div></body></html>`;

test("decodeEntities handles named, decimal and hex, and leaves unknown alone", () => {
  assert.equal(decodeEntities("a&amp;b &#39;c&#x27; &rsquo;d&rsquo; &nope;"), "a&b 'c' ’d’ &nope;");
  assert.equal(decodeEntities("&#0; &#1114112;"), "&#0; &#1114112;");
});

test("oneNoteHtmlToText keeps title, lines, nested bullets, numbering, tables", () => {
  const r = oneNoteHtmlToText(PAGE_HTML);
  assert.equal(r.title, "2026-05-14 Weekly Meeting");
  assert.match(r.text, /^Station 1: DP300's$/m);
  assert.match(r.text, /^Station 3: DP500’s & Rail Link: DP600's$/m);
  assert.match(r.text, /^- Rail Link model pending SOO confirmation$/m);
  assert.match(r.text, /^  - need more time for simulation results$/m); // nested one level
  assert.match(r.text, /^- Strollers are not modeled$/m);
  assert.match(r.text, /^1\. first$/m);
  assert.match(r.text, /^2\. second$/m);
  assert.match(r.text, /^Domain \| Large$/m);
  assert.match(r.text, /^Pressure \| Positive$/m);
  assert.equal(r.images, 1);
  assert.deepEqual(r.attachments, ["Exhibit 5.pdf"]);
  assert.match(r.text, /\[image\]/);
  assert.match(r.text, /\[attachment: Exhibit 5\.pdf\]/);
  assert.ok(!/\n{3,}/.test(r.text));
  assert.ok(!/<|style=|position:/.test(r.text));
});

test("oneNoteHtmlToText tolerates empty, plain and malformed input", () => {
  assert.deepEqual(oneNoteHtmlToText(""), { title: "", text: "", images: 0, attachments: [] });
  assert.equal(oneNoteHtmlToText(null).text, "");
  assert.equal(oneNoteHtmlToText("just words").text, "just words");
  assert.equal(oneNoteHtmlToText("<p>unclosed <b>bold").text, "unclosed bold");
  // script/style bodies never leak into the note
  assert.equal(oneNoteHtmlToText("<body><script>alert(1)</script><style>p{}</style><p>ok</p></body>").text, "ok");
});

test("getWithRetry retries 429 honoring Retry-After then returns", async () => {
  let calls = 0;
  const graph = async () => (++calls < 3 ? { status: 429, retryAfter: 0.001 } : { status: 200, json: { ok: 1 } });
  const r = await getWithRetry(graph, "/x");
  assert.equal(r.status, 200);
  assert.equal(calls, 3);
});

test("getWithRetry does not retry 403/404", async () => {
  let calls = 0;
  const graph = async () => (calls++, { status: 403 });
  assert.equal((await getWithRetry(graph, "/x")).status, 403);
  assert.equal(calls, 1);
});

// A fake Graph that serves one site notebook with one section of 3 pages,
// paged 2 + 1 to exercise @odata.nextLink.
function fakeGraph({ blockResolve = false, failContentFor = null } = {}) {
  const calls = [];
  const SITE = "https://graph.microsoft.com/v1.0/sites/s/onenote";
  const nb = { id: "nb1", displayName: "SAPX256014.00 — PANYNJ EWR AirTrain CFD", sectionsUrl: SITE + "/notebooks/nb1/sections" };
  const sec = { id: "s1", displayName: "SAPX256014.00 - PANYNJ Newark AirTrain Replacement", pagesUrl: SITE + "/sections/s1/pages" };
  const pg = (n) => ({
    id: "p" + n, title: "Page " + n, createdDateTime: `2026-05-0${n}T10:00:00Z`, lastModifiedDateTime: `2026-05-0${n}T11:00:00Z`,
    links: { oneNoteWebUrl: { href: "https://onenote/p" + n } },
    contentUrl: SITE + "/pages/p" + n + "/content",
  });
  const g = async (path, opts = {}) => {
    calls.push({ path, ...opts });
    if (path.includes("getNotebookFromWebUrl")) {
      return blockResolve ? { status: 403, json: { error: { message: "denied" } } } : { status: 201, json: nb };
    }
    if (/\/sites\/[^/]+\/onenote\/notebooks\?/.test(path)) return { status: 200, json: { value: [nb] } };
    // A notebook on a SharePoint site is NOT reachable via the /me-style /onenote/... paths.
    if (/^\/onenote\//.test(path)) return { status: 400, json: { error: { message: "wrong path for a site notebook: " + path } } };
    if (path.includes("/notebooks/nb1/sections")) return { status: 200, json: { value: [sec] } };
    if (path.includes("/sections/s1/pages")) {
      return path.includes("skip=2")
        ? { status: 200, json: { value: [pg(3)] } }
        : { status: 200, json: { value: [pg(1), pg(2)], "@odata.nextLink": SITE + "/sections/s1/pages?skip=2" } };
    }
    const m = /\/onenote\/pages\/(p\d)\/content/.exec(path);
    if (m) {
      if (m[1] === failContentFor) return { status: 404, text: "gone" };
      return { status: 200, text: PAGE_HTML };
    }
    return { status: 404, json: { error: { message: "no route " + path } } };
  };
  g.calls = calls;
  return g;
}

test("resolveNotebook uses getNotebookFromWebUrl, falls back to name match", async () => {
  const g = fakeGraph();
  const a = await resolveNotebook(g, { siteId: "site,1,2", notebookWebUrl: "https://x/y" });
  assert.equal(a.notebook.id, "nb1");
  const b = await resolveNotebook(fakeGraph({ blockResolve: true }), { siteId: "s", notebookWebUrl: "https://x/y", notebookName: "AirTrain CFD" });
  assert.equal(b.notebook.id, "nb1");
  assert.equal(b.tried[0].status, 403);
  assert.equal(b.tried[1].via, "list notebooks");
  const c = await resolveNotebook(fakeGraph({ blockResolve: true }), { siteId: "s", notebookWebUrl: "https://x/y" });
  assert.equal(c.notebook, null);
});

test("findSection matches exact then partial; reports available names", async () => {
  const g = fakeGraph();
  const NB = { id: "nb1", sectionsUrl: "https://graph.microsoft.com/v1.0/sites/s/onenote/notebooks/nb1/sections" };
  assert.equal((await findSection(g, NB, "sapx256014.00 - panynj newark airtrain replacement")).section.id, "s1");
  assert.equal((await findSection(g, NB, "AirTrain")).section.id, "s1");
  const miss = await findSection(g, NB, "nope");
  assert.equal(miss.section, null);
  assert.deepEqual(miss.sections, ["SAPX256014.00 - PANYNJ Newark AirTrain Replacement"]);
});

test("findSection regression: without sectionsUrl it uses the site-scoped path, never /onenote/...", async () => {
  const g = fakeGraph();
  const bare = await findSection(g, { id: "nb1" }, "AirTrain"); // no siteId -> /me path -> 400
  assert.equal(bare.status, 400);
  assert.equal(bare.section, null);
  const scoped = await findSection(g, { id: "nb1" }, "AirTrain", { siteId: "s" });
  assert.equal(scoped.section.id, "s1");
});

test("listSectionPages follows pagesUrl and nextLink and honors maxPages", async () => {
  const g = fakeGraph();
  const SEC = { id: "s1", pagesUrl: "https://graph.microsoft.com/v1.0/sites/s/onenote/sections/s1/pages" };
  assert.equal((await listSectionPages(g, SEC)).pages.length, 3);
  assert.equal((await listSectionPages(g, SEC, { maxPages: 2 })).pages.length, 2);
  assert.equal((await listSectionPages(g, { id: "s1" }, { siteId: "s" })).pages.length, 3); // fallback path
  assert.equal((await listSectionPages(g, { id: "s1" })).status, 400);
});

test("fetchPageContent asks for HTML and returns it", async () => {
  const g = fakeGraph();
  const P1 = { id: "p1", contentUrl: "https://graph.microsoft.com/v1.0/sites/s/onenote/pages/p1/content" };
  const r = await fetchPageContent(g, P1);
  assert.equal(r.status, 200);
  assert.equal(g.calls.at(-1).accept, "text/html");
  assert.equal((await fetchPageContent(fakeGraph({ failContentFor: "p1" }), P1)).status, 404);
  assert.equal((await fetchPageContent(g, { id: "p1" }, { siteId: "s" })).status, 200); // fallback path
});

test("buildNoteFromPage: PMS note shape, provenance, not attributed to the importer", () => {
  const parsed = oneNoteHtmlToText(PAGE_HTML);
  const n = buildNoteFromPage(
    { id: "p1", title: "x", createdDateTime: "2026-05-14T14:00:00Z", lastModifiedDateTime: "2026-05-14T18:22:46Z", links: { oneNoteWebUrl: { href: "https://onenote/p1" } } },
    parsed, { importedBy: "Sara Arias", originalAuthor: "Don (copied by Varun)" },
  );
  assert.equal(n.importedFrom, "onenote");
  assert.equal(n.oneNotePageId, "p1");
  assert.equal(n.author, "Don (copied by Varun) via OneNote import");
  assert.equal(n.importedBy, "Sara Arias");
  assert.equal(n.originalAuthor, "Don (copied by Varun)");
  assert.equal(n.createdAt, "2026-05-14T14:00:00Z"); // meeting date, not import date
  assert.equal(n.oneNoteUrl, "https://onenote/p1");
  assert.ok(n.body.startsWith("2026-05-14 Weekly Meeting\n\n"));
  assert.match(n.body, /1 image\(s\) not imported; 1 attachment\(s\) not imported: Exhibit 5\.pdf/);
  for (const k of ["actionItem", "actionStatus", "category", "links", "updatedAt"]) assert.ok(k in n, k);
});

test("buildNoteFromPage truncates long pages and says so", () => {
  const n = buildNoteFromPage({ id: "p", title: "t" }, { title: "t", text: "x".repeat(50), images: 0, attachments: [] }, { maxChars: 10 });
  assert.match(n.body, /xxxxxxxxxx\n\n\[truncated; see the OneNote page\]/);
  assert.ok(!n.body.includes("x".repeat(11)));
});

test("runSpike: GO path reads every page and previews text", async () => {
  const rep = await runSpike(fakeGraph(), { siteId: "s", notebookWebUrl: "https://x", sectionName: "AirTrain", maxPages: 5 });
  assert.match(rep.verdict, /^GO:/);
  assert.equal(rep.pages.length, 3);
  assert.ok(rep.pages.every((p) => p.status === 200 && p.textChars > 0 && p.preview.length <= 300));
});

test("runSpike: resolve failure is NO-GO with status codes, no throw", async () => {
  const rep = await runSpike(fakeGraph({ blockResolve: true }), { siteId: "s", notebookWebUrl: "https://x" });
  assert.match(rep.verdict, /^NO-GO \(resolve\)/);
  assert.equal(rep.resolve.tried[0].status, 403);
});

test("runSpike: unknown section is PARTIAL and lists real section names", async () => {
  const rep = await runSpike(fakeGraph(), { siteId: "s", notebookWebUrl: "https://x", sectionName: "Nope" });
  assert.match(rep.verdict, /^PARTIAL: notebook resolved but section not found/);
  assert.deepEqual(rep.section.available, ["SAPX256014.00 - PANYNJ Newark AirTrain Replacement"]);
});

test("runSpike: one unreadable page makes it PARTIAL, others still read", async () => {
  const rep = await runSpike(fakeGraph({ failContentFor: "p2" }), { siteId: "s", notebookWebUrl: "https://x", sectionName: "AirTrain" });
  assert.match(rep.verdict, /^PARTIAL: read 2\/3/);
  assert.equal(rep.pages.find((p) => p.title === "Page 2").status, 404);
});

test("listSections returns the notebook's sections, or the Graph status on failure", async () => {
  const g = fakeGraph();
  const ok = await listSections(g, { id: "nb1", sectionsUrl: "https://graph.microsoft.com/v1.0/sites/s/onenote/notebooks/nb1/sections" });
  assert.equal(ok.status, 200);
  assert.equal(ok.sections[0].id, "s1");
  assert.equal(ok.sections[0].pagesUrl.endsWith("/sections/s1/pages"), true);
  const bad = await listSections(g, { id: "nb1" }); // /me-style path -> 400
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.sections, []);
});

test("buildNoteFromPage puts the original author in the author line", () => {
  const parsed = { title: "t", text: "body", images: 0, attachments: [] };
  assert.equal(buildNoteFromPage({ id: "p" }, parsed, { originalAuthor: "Don" }).author, "Don via OneNote import");
  assert.equal(buildNoteFromPage({ id: "p" }, parsed, {}).author, "Imported from OneNote");
});

test("guessCategory", () => {
  assert.equal(guessCategory("2025-08-27 - Internal Meeting"), "Internal Meeting");
  assert.equal(guessCategory("2025-09-04 Meeting w/ Parsons"), "Client Meeting");
  assert.equal(guessCategory("8/19/2025 - Intro Call with Parsons"), "Client Meeting");
  assert.equal(guessCategory("2026-05-20 Status Update"), "Client Meeting");
  assert.equal(guessCategory("Background"), "General");
  assert.equal(guessCategory(""), "General");
  assert.equal(guessCategory(undefined), "General");
});

const P = (id, title, modified = "2026-05-01T00:00:00Z") => ({ id, title, lastModifiedDateTime: modified, createdDateTime: "2026-05-01T00:00:00Z" });
const T = (text, images = 0, attachments = []) => ({ title: "", text, images, attachments });

test("classifyScan: new, duplicate, low-text, empty, imported, updated", () => {
  const long = "x".repeat(300);
  const existing = [
    { id: "n-old", oneNotePageId: "p5", oneNoteModified: "2026-05-01T00:00:00Z" },   // unchanged since import
    { id: "n-chg", oneNotePageId: "p6", oneNoteModified: "2026-04-01T00:00:00Z" },   // edited in OneNote since
  ];
  const rows = classifyScan([
    { page: P("p1", "Model"), parsed: T(long) },
    { page: P("p2", "Model"), parsed: T(long) },                               // same title+content as p1
    { page: P("p3", "Exhibit 8"), parsed: T("[image] short", 2, ["a.pdf"]) },  // mostly images
    { page: P("p4", "Blank"), parsed: T("") },
    { page: P("p5", "Seen"), parsed: T(long + "a") },
    { page: P("p6", "Edited"), parsed: T(long + "b") },
    { page: P("p7", "Short note"), parsed: T("just a short note") },           // short but no images: still new
  ], existing);
  const by = Object.fromEntries(rows.map((r) => [r.page.id, r]));
  assert.equal(by.p1.state, "new");
  assert.equal(by.p2.state, "duplicate");
  assert.equal(by.p2.dupOf, "Model");
  assert.equal(by.p3.state, "low");
  assert.equal(by.p4.state, "empty");
  assert.equal(by.p5.state, "imported");
  assert.equal(by.p5.existingId, "n-old");
  assert.equal(by.p6.state, "updated");
  assert.equal(by.p6.existingId, "n-chg");
  assert.equal(by.p7.state, "new");
  // only brand-new pages are selected by default
  assert.deepEqual(rows.filter((r) => r.selected).map((r) => r.page.id), ["p1", "p7"]);
});

test("classifyScan: a page already imported suppresses a later duplicate only by content, never by id", () => {
  const long = "y".repeat(300);
  const rows = classifyScan([
    { page: P("a", "Same"), parsed: T(long) },
    { page: P("b", "Same"), parsed: T(long) },
    { page: P("c", "Same"), parsed: T(long) },
  ], []);
  assert.deepEqual(rows.map((r) => r.state), ["new", "duplicate", "duplicate"]);
});

test("mergeImport appends new notes with fresh ids and updates re-imported pages in place", () => {
  const notes = [
    { id: "keep", body: "mine", category: "Decision" },
    { id: "n-chg", body: "old text", category: "Issue", links: [{ x: 1 }], oneNotePageId: "p6", oneNoteModified: "old", oneNoteUrl: "https://old", updatedAt: "u0", createdAt: "c0" },
  ];
  let n = 0;
  const out = mergeImport(notes, [
    { note: { body: "fresh", oneNotePageId: "p1", category: "Client Meeting" }, existingId: null },
    { note: { body: "new text", oneNoteModified: "new", oneNoteUrl: "", updatedAt: "u1", category: "General" }, existingId: "n-chg" },
  ], () => "id" + ++n);
  assert.equal(out.length, 3);
  assert.equal(out[0], notes[0]);                                   // untouched
  assert.equal(out[1].id, "n-chg");                                 // updated in place, same id
  assert.equal(out[1].body, "new text");
  assert.equal(out[1].category, "Issue");                           // PMS-side category survives
  assert.deepEqual(out[1].links, [{ x: 1 }]);
  assert.equal(out[1].oneNoteUrl, "https://old");                   // empty new url does not blank it
  assert.equal(out[1].createdAt, "c0");
  assert.equal(out[2].id, "id1");                                   // new note appended with generated id
  assert.equal(out[2].body, "fresh");
  assert.equal(notes.length, 2);                                    // input not mutated
});

test("mergeImport: existingId that no longer exists is imported as a new note, not dropped", () => {
  const out = mergeImport([], [{ note: { body: "b", oneNotePageId: "p9" }, existingId: "gone" }], () => "nid");
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "nid");
});

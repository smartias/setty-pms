// onenote-import.js — OneNote page import for PMS notes (SPIKE).
//
// Design: supabase/functions/pms-mcp/PROPOSAL-onenote-import.md
//
// Reads OneNote pages through Microsoft Graph as the SIGNED-IN USER (delegated
// Notes.ReadWrite.All, already in SettyPMS.html GRAPH_SCOPES). The connector's
// app-only token cannot read OneNote, so this runs in the browser.
//
// NO DEPENDENCIES and no DOM: every function takes an injected `graph` adapter
// and works the same in the browser and under `node --test`.
//
//   graph(path, { accept }) -> Promise<{ status, json?, text?, retryAfter? }>
//     path is relative to https://graph.microsoft.com/v1.0 (or an absolute
//     @odata.nextLink). 404/403 must be RETURNED as a status, not thrown, so
//     the spike can report them instead of dying on the first page.
//
// RUNNING THE SPIKE (needs a signed-in SettyPMS tab; ~1 minute):
//   1. Open SettyPMS.html, sign in, open DevTools console.
//   2. Load this file. Either import it from a deployed copy:
//        const m = await import("/onenote-import.js");
//      or paste the file contents with every leading `export ` removed
//      (then call runSpike directly instead of m.runSpike):
//        sed 's/^export //' onenote-import.js
//   3. Run:
//        const graph = m.makeAppGraph();            // reuses the tab's token
//        const rep = await m.runSpike(graph, {
//          siteId: SP_SITE_ID_HARDCODED,
//          notebookWebUrl: "https://setty.sharepoint.com/sites/NYCProjects/Shared Documents/Notebooks/SAPX256014.00 — PANYNJ EWR AirTrain CFD",
//          sectionName: "SAPX256014.00 - PANYNJ Newark AirTrain Replacement",
//          maxPages: 5,                              // keep the first run small
//        });
//   4. Paste `JSON.stringify(rep, null, 1)` back. It contains page titles and a
//      300-char preview per page, so redact if the notes are sensitive.
//
// GO / NO-GO the spike answers:
//   - does the site notebook resolve with a delegated token? (rep.resolve)
//   - are pages listable and is page content readable? (rep.pages[].status)
//   - how slow is it? (rep.timings) and does HTML->text look right? (preview)

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// ── HTML -> text ────────────────────────────────────────────────────────────

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "\u2013", mdash: "\u2014", lsquo: "\u2018", rsquo: "\u2019",
  ldquo: "\u201C", rdquo: "\u201D", hellip: "\u2026", bull: "\u2022",
  deg: "\u00B0", plusmn: "\u00B1", times: "\u00D7", frac12: "\u00BD",
};

export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e) => {
    if (e[0] === "#") {
      const cp = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10FFFF) return m;
      try { return String.fromCodePoint(cp); } catch { return m; }
    }
    const v = NAMED_ENTITIES[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

function attr(tag, name) {
  const m = new RegExp("\\b" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')", "i").exec(tag);
  return m ? decodeEntities(m[1] ?? m[2] ?? "") : "";
}

const BLOCK_TAGS = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "tr", "table", "ul", "ol", "li"]);

// OneNote page HTML -> { title, text, images, attachments }.
// Pasted-in pages often arrive as one outline of <p> runs; the goal is to keep
// line breaks, bullets (with nesting) and table rows so the note reads like the
// page, not to reproduce formatting.
export function oneNoteHtmlToText(html) {
  const src = String(html ?? "");
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(src);
  const title = titleMatch ? decodeEntities(titleMatch[1].replace(/<[^>]*>/g, "")).trim() : "";

  const body = (/<body[^>]*>([\s\S]*)<\/body>/i.exec(src)?.[1] ?? src)
    .replace(/<(script|style|head)[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  let out = "";
  let images = 0;
  const attachments = [];
  const listStack = []; // "ul" | "ol" with running counter for ol
  let cellDepth = 0;
  let cellsInRow = 0;
  let atItemStart = false; // just wrote a bullet: swallow the <p> newline OneNote wraps li text in

  // Start a new line unless we're already at one, mid-bullet, or inside a table
  // cell (OneNote wraps every cell's text in <p>; a newline there splits the row).
  const nl = () => {
    if (atItemStart || cellDepth > 0) return;
    out = out.replace(/[ \t]+$/, "");
    if (out && !out.endsWith("\n")) out += "\n";
  };

  const tokens = body.split(/(<[^>]+>)/);
  for (const tok of tokens) {
    if (!tok) continue;
    if (tok[0] !== "<") {
      const t = decodeEntities(tok).replace(/\s+/g, " ");
      if (t.trim()) atItemStart = false;
      out += t;
      continue;
    }

    const m = /^<\s*(\/)?\s*([a-z0-9]+)/i.exec(tok);
    if (!m) continue;
    const closing = !!m[1];
    const name = m[2].toLowerCase();

    if (name === "br") { out += cellDepth > 0 ? " " : "\n"; continue; }
    if (name === "img") { images++; atItemStart = false; out += " [image] "; continue; }
    if (name === "object" && !closing) {
      const fn = attr(tok, "data-attachment");
      if (fn) { attachments.push(fn); atItemStart = false; out += ` [attachment: ${fn}] `; }
      continue;
    }
    if (name === "td" || name === "th") {
      if (!closing) { if (cellsInRow++ > 0) out += " | "; cellDepth++; }
      else cellDepth = Math.max(0, cellDepth - 1);
      continue;
    }
    if (name === "tr") {
      if (!closing) { cellsInRow = 0; cellDepth = 0; nl(); } else { cellDepth = 0; nl(); }
      continue;
    }
    if (name === "ul" || name === "ol") {
      if (!closing) listStack.push({ type: name, n: 0 }); else listStack.pop();
      atItemStart = false;
      nl();
      continue;
    }
    if (name === "li") {
      if (!closing) {
        atItemStart = false;
        nl();
        const top = listStack[listStack.length - 1];
        // \u0001 marks one indent level so whitespace collapsing below cannot eat it.
        const indent = "\u0001".repeat(Math.max(0, listStack.length - 1));
        out += indent + (top && top.type === "ol" ? `${++top.n}. ` : "- ");
        atItemStart = true;
      } else {
        atItemStart = false;
        nl();
      }
      continue;
    }
    if (BLOCK_TAGS.has(name)) { nl(); continue; }
  }

  const text = out
    .split("\n")
    .map((l) => {
      const lead = /^\u0001*/.exec(l)[0].length;
      const rest = l.slice(lead).replace(/[ \t\u00A0]+/g, " ").replace(/^ /, "").replace(/\s+$/, "");
      return rest ? "  ".repeat(lead) + rest : "";
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { title, text, images, attachments };
}

// ── Graph helpers ───────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// GET with 429/503 backoff honoring Retry-After. Returns the adapter's result
// (never throws on HTTP status), so callers can record 403/404 per item.
export async function getWithRetry(graph, path, opts = {}, { maxAttempts = 5 } = {}) {
  let last;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = await graph(path, opts);
    if (last.status !== 429 && last.status !== 503) return last;
    const wait = Math.min(30000, (last.retryAfter ? last.retryAfter * 1000 : 1000 * 2 ** attempt));
    await sleep(wait);
  }
  return last;
}

const siteRoot = (siteId) => `/sites/${encodeURIComponent(siteId)}/onenote`;

// Resolve a notebook from a link. getNotebookFromWebUrl is the documented way
// to open a notebook the PMS did not create; fall back to a name match over the
// site's notebooks list.
export async function resolveNotebook(graph, { siteId, notebookWebUrl, notebookName }) {
  const tried = [];
  if (notebookWebUrl) {
    const r = await graph(`${siteRoot(siteId)}/notebooks/getNotebookFromWebUrl`, {
      method: "POST", body: { webUrl: notebookWebUrl },
    });
    tried.push({ via: "getNotebookFromWebUrl", status: r.status, error: r.json?.error?.message });
    if (r.status >= 200 && r.status < 300 && r.json?.id) return { notebook: r.json, tried };
  }
  const r = await getWithRetry(graph, `${siteRoot(siteId)}/notebooks?$select=id,displayName,links`);
  tried.push({ via: "list notebooks", status: r.status, count: r.json?.value?.length, error: r.json?.error?.message });
  if (r.status === 200 && Array.isArray(r.json?.value)) {
    const want = (notebookName || "").toLowerCase();
    const hit = want && r.json.value.find((n) => (n.displayName || "").toLowerCase().includes(want));
    if (hit) return { notebook: hit, tried };
  }
  return { notebook: null, tried };
}

// Graph's notebook/section objects carry their own sectionsUrl / pagesUrl /
// contentUrl. A notebook that lives on a SharePoint site is NOT reachable
// through the /me-style /onenote/... paths (Graph answers 400), so follow the
// URLs Graph hands back and only fall back to the site-scoped path.
const withQuery = (url, q) => url + (url.includes("?") ? "&" : "?") + q;

export async function findSection(graph, notebook, sectionName, { siteId } = {}) {
  const base = notebook.sectionsUrl ||
    (siteId ? `${siteRoot(siteId)}/notebooks/${encodeURIComponent(notebook.id)}/sections` : `/onenote/notebooks/${encodeURIComponent(notebook.id)}/sections`);
  const r = await getWithRetry(graph, withQuery(base, "$select=id,displayName,lastModifiedDateTime,pagesUrl"));
  if (r.status !== 200) return { section: null, status: r.status, error: r.json?.error?.message, url: base, sections: [] };
  const sections = r.json?.value ?? [];
  const want = (sectionName || "").toLowerCase();
  const section = want
    ? sections.find((s) => (s.displayName || "").toLowerCase() === want) ||
      sections.find((s) => (s.displayName || "").toLowerCase().includes(want))
    : null;
  return { section: section || null, status: 200, url: base, sections: sections.map((s) => s.displayName) };
}

// Lists pages with paging (@odata.nextLink). $top=100 is the Graph maximum.
export async function listSectionPages(graph, section, { maxPages = Infinity, siteId } = {}) {
  const base = section.pagesUrl ||
    (siteId ? `${siteRoot(siteId)}/sections/${encodeURIComponent(section.id)}/pages` : `/onenote/sections/${encodeURIComponent(section.id)}/pages`);
  const pages = [];
  let path = withQuery(base, "$select=id,title,createdDateTime,lastModifiedDateTime,contentUrl,links&$top=100&$orderby=createdDateTime");
  while (path && pages.length < maxPages) {
    const r = await getWithRetry(graph, path);
    if (r.status !== 200) return { pages, status: r.status, error: r.json?.error?.message, url: base };
    pages.push(...(r.json?.value ?? []));
    path = r.json?.["@odata.nextLink"] || null;
  }
  return { pages: pages.slice(0, maxPages), status: 200, url: base };
}

export async function fetchPageContent(graph, page, { siteId } = {}) {
  const url = page.contentUrl ||
    (siteId ? `${siteRoot(siteId)}/pages/${encodeURIComponent(page.id)}/content` : `/onenote/pages/${encodeURIComponent(page.id)}/content`);
  const r = await getWithRetry(graph, url, { accept: "text/html" });
  if (r.status !== 200) return { status: r.status, error: r.json?.error?.message || r.text?.slice(0, 200) };
  return { status: 200, html: r.text ?? "" };
}

// PMS note from one OneNote page. Shape matches SettyPMS.html addNote(), plus
// provenance fields (see PROPOSAL: imported notes must say where they came from
// and must NOT be attributed to whoever ran the import).
export function buildNoteFromPage(page, parsed, { importedBy = "", originalAuthor = "", category = "Meeting", now = new Date(), maxChars = 20000 } = {}) {
  const url = page.links?.oneNoteWebUrl?.href || "";
  const full = parsed.text || "";
  const clipped = full.length > maxChars;
  const notes = [];
  if (parsed.images) notes.push(`${parsed.images} image(s) not imported`);
  if (parsed.attachments?.length) notes.push(`${parsed.attachments.length} attachment(s) not imported: ${parsed.attachments.join(", ")}`);
  const body = (parsed.title || page.title || "Untitled") + "\n\n" +
    (clipped ? full.slice(0, maxChars) + "\n\n[truncated; see the OneNote page]" : full) +
    (notes.length ? "\n\n[" + notes.join("; ") + "]" : "");
  return {
    body, category, actionItem: false, actionOwner: "", actionDueDate: "", actionStatus: "open",
    author: "Imported from OneNote", importedBy, originalAuthor,
    importedFrom: "onenote", oneNotePageId: page.id, oneNoteModified: page.lastModifiedDateTime || "",
    createdAt: page.createdDateTime || now.toISOString(), updatedAt: now.toISOString(),
    oneNoteUrl: url, links: [],
  };
}

// ── The spike ───────────────────────────────────────────────────────────────

export async function runSpike(graph, { siteId, notebookWebUrl, notebookName, sectionName, maxPages = 5, previewChars = 300 } = {}) {
  const rep = { startedAt: new Date().toISOString(), resolve: null, section: null, pages: [], timings: {}, verdict: "" };
  const t0 = Date.now();

  const { notebook, tried } = await resolveNotebook(graph, { siteId, notebookWebUrl, notebookName });
  rep.resolve = { found: !!notebook, notebook: notebook ? { id: notebook.id, displayName: notebook.displayName } : null, tried };
  rep.timings.resolveMs = Date.now() - t0;
  if (!notebook) {
    rep.verdict = "NO-GO (resolve): notebook not reachable with the delegated token. See resolve.tried for status codes.";
    return rep;
  }

  const t1 = Date.now();
  const sec = await findSection(graph, notebook, sectionName, { siteId });
  rep.section = { found: !!sec.section, status: sec.status, error: sec.error, url: sec.url, available: sec.sections, picked: sec.section?.displayName };
  rep.timings.sectionMs = Date.now() - t1;
  if (!sec.section) {
    rep.verdict = "PARTIAL: notebook resolved but section not found. See section.available for the names Graph returned.";
    return rep;
  }

  const t2 = Date.now();
  const listed = await listSectionPages(graph, sec.section, { maxPages, siteId });
  rep.timings.listMs = Date.now() - t2;
  rep.listStatus = listed.status;
  if (listed.status !== 200) {
    rep.verdict = `NO-GO (list pages): Graph ${listed.status} ${listed.error || ""} (${listed.url})`;
    return rep;
  }

  for (const p of listed.pages) {
    const t = Date.now();
    const c = await fetchPageContent(graph, p, { siteId });
    const row = {
      title: p.title, created: p.createdDateTime, modified: p.lastModifiedDateTime,
      status: c.status, ms: Date.now() - t,
    };
    if (c.status === 200) {
      const parsed = oneNoteHtmlToText(c.html);
      Object.assign(row, {
        htmlChars: c.html.length, textChars: parsed.text.length,
        images: parsed.images, attachments: parsed.attachments.length,
        preview: parsed.text.slice(0, previewChars),
      });
    } else {
      row.error = c.error;
    }
    rep.pages.push(row);
  }

  const ok = rep.pages.filter((p) => p.status === 200).length;
  rep.timings.totalMs = Date.now() - t0;
  rep.timings.avgContentMs = rep.pages.length ? Math.round(rep.pages.reduce((a, p) => a + p.ms, 0) / rep.pages.length) : 0;
  rep.verdict = ok === rep.pages.length && ok > 0
    ? `GO: resolved, listed ${listed.pages.length} page(s), read ${ok}/${rep.pages.length}. Check previews for text fidelity.`
    : `PARTIAL: read ${ok}/${rep.pages.length} page(s). See pages[].status/error.`;
  return rep;
}

// ── Browser adapter (only used inside a signed-in SettyPMS tab) ─────────────
// Reuses the tab's MSAL session via getTokenForScopes/GRAPH_SCOPES, which are
// global in SettyPMS.html. Not exercised by tests.
export function makeAppGraph() {
  /* global getTokenForScopes, GRAPH_SCOPES */
  return async function graph(path, { method = "GET", body, accept } = {}) {
    const token = await getTokenForScopes(GRAPH_SCOPES);
    const url = path.startsWith("http") ? path : GRAPH_BASE + path;
    const headers = { Authorization: "Bearer " + token };
    if (accept) headers.Accept = accept;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const resp = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const retryAfter = Number(resp.headers.get("Retry-After")) || 0;
    const ct = resp.headers.get("Content-Type") || "";
    if (ct.includes("application/json")) {
      return { status: resp.status, json: await resp.json().catch(() => null), retryAfter };
    }
    return { status: resp.status, text: await resp.text(), retryAfter };
  };
}

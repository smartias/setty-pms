// Source checks run by .github/workflows/tests.yml on every pull request.
//
//   1. Every JSX <script> block in the pages below parses (CLAUDE.md rule 4;
//      `node --check` cannot read JSX). A syntax error here is a blank page
//      for every user, and nothing else catches it before the deploy.
//   2. Line endings are what CLAUDE.md rule 2 says they are. A text-mode
//      rewrite of a CRLF file turns a 20-line change into a 33,000-line diff.
//   3. Every <script> loaded from a public CDN names an exact version and
//      carries an integrity hash, so the browser refuses a library file that
//      is not byte-for-byte the one that was tested.
//
// Needs @babel/parser (the workflow installs it; there is no package.json):
//   npm install --no-save @babel/parser@7 && node .github/scripts/check-source.mjs
import { readFileSync, readdirSync } from "node:fs";
import { parse } from "@babel/parser";

const JSX_PAGES = ["SettyPMS.html", "ContractExtractor.html"];
const CRLF_FILES = ["SettyPMS.html", "SettyFieldPhotos.html", "SiteReport.html", "transmittal.html"];
const LF_FILES = ["SettyAdmin.html", "Accolades.html", "taskpane.html"];

const problems = [];

// ── 1. JSX blocks parse ──────────────────────────────────────────────────────
const BLOCK = /<script\b[^>]*type=["']text\/(?:x-pms-jsx|babel)["'][^>]*>([\s\S]*?)<\/script>/g;
for (const file of JSX_PAGES) {
  const html = readFileSync(file, "latin1"); // byte-for-byte; offsets = file offsets
  let found = 0;
  for (const m of html.matchAll(BLOCK)) {
    found++;
    const bodyStart = m.index + m[0].indexOf(">") + 1;
    // Line of the block's first character, so errors name the line in the file.
    const startLine = html.slice(0, bodyStart).split("\n").length;
    try {
      parse(m[1], { sourceType: "script", plugins: ["jsx"], startLine });
    } catch (e) {
      problems.push(`${file}: JSX block ${found} does not parse: ${e.message}`);
    }
  }
  if (!found) problems.push(`${file}: no JSX <script> block found (did the script type change?)`);
  else console.log(`ok  ${file}: ${found} JSX block${found === 1 ? "" : "s"} parse`);
}

// ── 2. Line endings ──────────────────────────────────────────────────────────
function lineEndings(file) {
  const s = readFileSync(file, "latin1");
  const crlf = (s.match(/\r\n/g) || []).length;
  const lf = (s.match(/\n/g) || []).length - crlf;
  return { crlf, lf };
}
for (const file of CRLF_FILES) {
  const { crlf, lf } = lineEndings(file);
  if (lf > 0) problems.push(`${file}: must be CRLF, but ${lf} line(s) end in a bare LF (${crlf} are CRLF). Rewrite it in binary mode.`);
  else console.log(`ok  ${file}: CRLF`);
}
for (const file of LF_FILES) {
  const { crlf } = lineEndings(file);
  if (crlf > 0) problems.push(`${file}: must be LF, but ${crlf} line(s) end in CRLF.`);
  else console.log(`ok  ${file}: LF`);
}

// ── 3. CDN scripts are pinned and carry an integrity hash ────────────────────
const CDN_TAG = /<script\b[^>]*?\bsrc=["'](https:\/\/(?:cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com)\/[^"']+)["'][^>]*>/g;
let cdnTags = 0;
for (const file of readdirSync(".").filter((f) => f.endsWith(".html"))) {
  const html = readFileSync(file, "latin1");
  for (const m of html.matchAll(CDN_TAG)) {
    cdnTags++;
    const [tag, url] = m;
    if (!/\bintegrity=["']sha(256|384|512)-[A-Za-z0-9+/=]+["']/.test(tag)) problems.push(`${file}: ${url} has no integrity="sha384-..." attribute (see CLAUDE.md, "CDN libraries").`);
    if (!/\bcrossorigin\b/.test(tag)) problems.push(`${file}: ${url} needs crossorigin="anonymous" or the integrity check cannot run.`);
    // An exact version: @1.2.3 (jsdelivr/unpkg) or /1.2.3/ (cdnjs).
    if (!/@\d+\.\d+\.\d+[^/]*\/|\/\d+\.\d+\.\d+[^/]*\//.test(url)) problems.push(`${file}: ${url} does not name an exact version.`);
  }
}
console.log(`ok  ${cdnTags} CDN <script> tags checked for version + integrity`);

if (problems.length) {
  console.error("\n" + problems.map((p) => "FAIL  " + p).join("\n"));
  process.exit(1);
}

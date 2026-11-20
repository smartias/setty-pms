# Platform roadmap (how the PMS is built and run)

Items about the platform itself, not features. The connector has its own
roadmap in `supabase/functions/pms-mcp/ROADMAP.md`.

## Open

### Compile the JSX at deploy time instead of in every browser (added 2026-11-19)

**Today.** `SettyPMS.html` is one 2.2 MB file. Each browser downloads Babel
(2.8 MB) and compiles the two `text/x-pms-jsx` blocks itself, then caches the
result in `localStorage` keyed by `window.__appVersion` plus a source hash.
`ContractExtractor.html` does the same with `text/babel`.

**Why change it.** First load after every release pays the download and the
compile; a syntax error is only found in the browser (the Tests workflow now
parses the blocks, which covers the worst of that); and the app depends on a
compiler fetched from a public CDN at run time.

**Why it is not small.** The repo deliberately has no build step: Vercel serves
the files as they are, and every PR is reviewed and tested that way. A build
step means a `package.json`, a build command in Vercel, source files separate
from what is served, and a new answer to "which version is the user running"
(the `__appVersion` banner and the compile cache both assume the page is its
own source). The two-blocks-one-global-scope rule in `CLAUDE.md` exists
because of the in-browser compile and would need rethinking, not just porting.

**Shape of the work.**
1. Move the two JSX blocks to source files; keep one global scope at first so
   nothing else has to change.
2. Compile with esbuild or Babel in a Vercel build step; the served page loads
   the compiled file and drops Babel.
3. Keep `__appVersion` and the update banner; retire the `localStorage`
   compile cache.
4. Run the old and new pages side by side on a preview before switching.

**When.** When first-load time becomes a complaint, or when the single file
becomes the thing slowing changes down. Not before: it changes how every PR is
tested and deployed.

### Integrity hashes on lazily loaded scripts (added 2026-11-19)

Static `<script>` tags are pinned and hashed. Scripts created from JavaScript
are not: canvas-confetti, the pdf.js worker and its jsdelivr fallback, and
xlsx in `SettyIntelligence.html`. Each needs `integrity` and `crossOrigin` set
on the element (a worker needs a different approach). Small, page by page.

## Done

- 2026-11-19: tests and source checks on every pull request; email alert when
  a scheduled job is failing; CDN scripts pinned with integrity hashes.

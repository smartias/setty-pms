// deferredDecisions.js — where do the documents leave a decision to someone
// else? (tool check_deferred_decisions, checklist item qa-637)
//
// qa-637 asks that the documents state a decision wherever they defer to the
// owner, the authority or a code edition. "MC cable as allowed by owner" was
// asked nine times at bid on one project. Finding the phrases is a text
// search; it is done here, over every sheet of a set and over specification
// PDFs, so a reviewer starts from the list and not from a blank search box.
//
// Whether a phrase is a real gap (is the answer stated somewhere else?) is
// still the reviewer's call. Every hit is a place to look, not a finding.
//
// The patterns are written once and used twice: in Postgres over the drawing
// text index (pgPattern) and in JS over specification pages (scanText). They
// keep to what both regex engines read the same way: non-capturing groups,
// alternation, \s, \w, bounded repeats, and \b, which pgPattern turns into
// Postgres's \y. Pure.

const WHO = "(?:THE\\s+)?(?:OWNER|ARCHITECT|ENGINEER|AUTHORIT(?:Y|IES)(?:\\s+HAVING\\s+JURISDICTION)?|A\\.?H\\.?J\\.?|UNIVERSITY|CAMPUS|CLIENT|AGENCY|UTILITY(?:\\s+COMPANY)?|FIRE\\s+(?:MARSHAL|DEPARTMENT)|INSPECTOR|CONSTRUCTION\\s+MANAGER)";

// Order matters only for the label a hit gets: the first that matches wins.
export const PHRASES = [
  { key: "owner-decides", label: "Left to the owner or the authority",
    why: "A bidder cannot price 'as allowed by owner'. State what is allowed.",
    re: `\\bAS\\s+(?:ALLOWED|PERMITTED|APPROVED|ACCEPTED|ACCEPTABLE|DIRECTED|SELECTED|DETERMINED|REQUESTED)\\s+(?:BY|TO)\\s+${WHO}\\b` },
  { key: "owner-decides", label: "Left to the owner or the authority",
    why: "An option or approval that is not stated is a question at bid.",
    re: `\\b(?:OWNER'?S?\\s+(?:OPTION|DISCRETION|PREFERENCE|SELECTION)|AT\\s+THE\\s+(?:OPTION|DISCRETION)\\s+OF\\s+${WHO}|(?:SUBJECT\\s+TO|PENDING)\\s+(?:THE\\s+)?(?:OWNER'?S?|ARCHITECT'?S?|AHJ)\\s+APPROVAL)\\b` },
  { key: "confirm-with-owner", label: "To be confirmed or coordinated with the owner",
    why: "If the answer is known, state it; if not, say who decides and when.",
    re: `\\b(?:VERIFY|CONFIRM|COORDINATE)\\s+(?:\\w+\\s+){0,5}WITH\\s+(?:THE\\s+)?(?:OWNER|UNIVERSITY|CAMPUS|CLIENT|AGENCY)\\b` },
  { key: "conditional", label: "Conditional with no condition stated",
    why: "'If applicable' leaves the bidder to decide whether it applies.",
    re: "\\b(?:IF|WHERE|WHEN|AS)\\s+(?:APPLICABLE|ALLOWED|PERMITTED)\\b|\\bIF\\s+(?:REQUIRED|NEEDED|NECESSARY)\\b" },
  { key: "undecided", label: "Not decided yet",
    why: "A value marked to be determined cannot be priced.",
    re: "\\b(?:TBD|T\\.B\\.D\\.?|TO\\s+BE\\s+(?:DETERMINED|CONFIRMED|SELECTED|DECIDED|ADVISED))\\b" },
  { key: "code-edition", label: "Code or standard with no edition named",
    why: "Where two editions ask for different work, the documents name the one that governs.",
    re: "\\b(?:LATEST|CURRENT|MOST\\s+RECENT)\\s+(?:ADOPTED\\s+)?(?:EDITION|VERSION|REVISION)S?\\b|\\bCODES?\\s+IN\\s+EFFECT\\b" },
];
export const CATEGORY_KEYS = [...new Set(PHRASES.map((p) => p.key))];
const HITS_MAX = 400;

const jsRe = (flags) => new RegExp(PHRASES.map((p) => `(?:${p.re})`).join("|"), flags);
// The same alternation for Postgres ARE: \b is \y there.
export function pgPattern() {
  return PHRASES.map((p) => `(?:${p.re})`).join("|").replace(/\\b/g, "\\y");
}
export function categoryOf(phrase) {
  const s = String(phrase || "");
  return PHRASES.find((p) => new RegExp(p.re, "i").test(s)) || null;
}
const clean = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

// Scan one text (a specification page). Returns [{ phrase, text }] with the
// phrase in its sentence, about 110 characters either side.
export function scanText(text) {
  const s = clean(text), out = [];
  const re = jsRe("gi");
  let m;
  while ((m = re.exec(s)) && out.length < HITS_MAX) {
    const a = Math.max(0, m.index - 110), b = Math.min(s.length, m.index + m[0].length + 110);
    out.push({ phrase: m[0], text: (a > 0 ? "…" : "") + s.slice(a, b) + (b < s.length ? "…" : "") });
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

// hits: [{ where, phrase, text }]  where = a sheet number, or "name p.12"
// The same note printed on thirty sheets is one entry listing the sheets.
export function groupHits(hits) {
  const groups = new Map();
  let total = 0;
  for (const h of Array.isArray(hits) ? hits : []) {
    const cat = categoryOf(h && h.phrase);
    if (!cat) continue;
    total++;
    const text = clean(h.text).slice(0, 320);
    // Same words around the phrase, whatever the sheet: one entry.
    const k = cat.key + "|" + text.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().slice(0, 160);
    const g = groups.get(k) || { category: cat.key, phrase: clean(h.phrase).toUpperCase(), text, where: [] };
    const w = clean(h.where);
    if (w && !g.where.includes(w)) g.where.push(w);
    groups.set(k, g);
  }
  const byCategory = CATEGORY_KEYS.map((key) => {
    const p = PHRASES.find((x) => x.key === key);
    const items = [...groups.values()].filter((g) => g.category === key)
      .sort((a, b) => b.where.length - a.where.length || a.text.localeCompare(b.text))
      .map((g) => ({ phrase: g.phrase, text: g.text, where: g.where.slice(0, 20), ...(g.where.length > 20 ? { whereCount: g.where.length } : {}) }));
    return { category: key, label: p.label, why: p.why, count: items.length, places: items.slice(0, 60), ...(items.length > 60 ? { truncated: true } : {}) };
  }).filter((c) => c.count);
  return { hits: total, places: byCategory.reduce((n, c) => n + c.count, 0), categories: byCategory };
}

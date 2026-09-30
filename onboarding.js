// onboarding.js — the pure half of the Admin console's bulk onboarding:
// parsing what an admin pastes from Excel (staff lists, project lists),
// mapping the sheet's words onto PMS roles and statuses, and finding the
// project number a typo was meant to be.
//
// Loaded by SettyAdmin.html as a <script type="module"> and hung on
// window.Onboarding (the console's own script is a classic script). The
// writes happen server-side in the RPCs of
// supabase/migrations/20260930140000_bulk_onboarding_and_renumber.sql;
// onboarding.test.mjs pins this module and the drift between the SQL
// project blob and candidateProjectBlob() in SettyAdmin.html.

export const PMS_ROLES = ["admin", "project_manager", "engineer", "operations", "accounting", "contracts", "marketing", "qaqc", "staff"];
export const PMS_STATUSES = ["Not Started", "In Progress", "In for Review", "On Hold", "Top Priority", "In Construction Administration", "Completed"];
export const DISCIPLINES = ["Mechanical", "Electrical", "Plumbing", "Fire Protection"];

// ── pasted tables ───────────────────────────────────────────────────────────
// Excel copies as tab-separated rows; a CSV export uses commas (with quotes
// around cells that hold one). Either works. Blank lines are dropped.
export function parseTable(text) {
  const src = String(text || "").replace(/\r\n?/g, "\n");
  const lines = src.split("\n").filter((l) => l.trim().length);
  if (!lines.length) return [];
  const tab = lines.some((l) => l.includes("\t"));
  return lines.map((l) => (tab ? l.split("\t") : splitCsvLine(l)).map((c) => c.trim()));
}
function splitCsvLine(line) {
  const out = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// Spreadsheet column letter (A, K, AA) to a 0-based index, or null.
export function colIndex(letter) {
  const s = String(letter || "").trim().toUpperCase();
  if (!/^[A-Z]{1,2}$/.test(s)) return null;
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Which column holds what, from the header row. Each field takes the first
// header that matches one of its words; a column letter given by the admin
// (Nikhil's list keeps the email in K) wins over the guess.
const HEADER_WORDS = {
  email: ["email", "e mail", "mail", "email address", "work email"],
  name: ["name", "full name", "employee", "employee name", "display name"],
  first: ["first", "first name", "given name"],
  last: ["last", "last name", "surname", "family name"],
  category: ["role", "category", "access", "access level", "pms role", "role category"],
  title: ["title", "job title", "position", "designation"],
  team: ["office", "team", "region", "location", "branch"],
  department: ["department", "discipline", "dept", "group", "practice"],
  number: ["project number", "job number", "project no", "job no", "project", "job", "number", "project id", "job id"],
  status: ["status", "project status", "state", "phase"],
  pname: ["project name", "job name", "name", "title", "description"],
};
export function guessColumns(header, fields, overrides) {
  const h = (header || []).map(norm);
  const used = new Set();
  const out = {};
  for (const f of fields) {
    const forced = overrides && overrides[f] != null && overrides[f] !== "" ? colIndex(overrides[f]) : null;
    if (forced != null) { out[f] = forced; used.add(forced); continue; }
    const words = HEADER_WORDS[f] || [f];
    let idx = -1;
    for (const w of words) { idx = h.findIndex((x, i) => !used.has(i) && x === w); if (idx >= 0) break; }
    if (idx < 0) for (const w of words) { idx = h.findIndex((x, i) => !used.has(i) && x.includes(w)); if (idx >= 0) break; }
    if (idx >= 0) { out[f] = idx; used.add(idx); }
  }
  return out;
}
// A table whose first row names its columns, or a bare list (no header).
export function hasHeader(rows, field) {
  if (!rows.length) return false;
  const first = rows[0].join(" ");
  if (field === "email") return !/@/.test(first);
  if (field === "number") return !rows[0].some((c) => looksLikeProjectNumber(c));
  return true;
}

// ── roles ───────────────────────────────────────────────────────────────────
// The sheet's own words for access level, mapped to a PMS role. Anything not
// matched is left for the admin to pick (the preview asks, never guesses
// admin).
const ROLE_RULES = [
  [/\bqa\s*\/?\s*qc\b|quality/, "qaqc"],
  [/deputy|dpm|project\s*manager|\bpm\b|principal|director|associate\s*partner|partner|\bvp\b|vice\s*president|department\s*head|dept\.?\s*head|\bhead\b/, "project_manager"],
  [/account|finance|billing|payroll|invoice/, "accounting"],
  [/contract/, "contracts"],
  [/marketing|business\s*dev|\bbd\b|proposal/, "marketing"],
  [/operation|office\s*manager|\bhr\b|human\s*res|\bit\b|information\s*tech|admin(istrat)?(ive|or)?\s*(assistant|staff|support)|coordinator/, "operations"],
  [/engineer|designer|drafter|draftsman|\bcad\b|\bbim\b|modeler|technician|\beit\b|\bpe\b|intern|analyst|specialist|inspector|field/, "engineer"],
  [/^staff$|general|viewer|read\s*only|basic/, "staff"],
];
export function mapRole(word) {
  const w = String(word || "").trim().toLowerCase();
  if (!w) return null;
  const direct = w.replace(/[\s/-]+/g, "_");
  if (PMS_ROLES.includes(direct) && direct !== "admin") return direct;
  if (direct === "qa_qc") return "qaqc";
  for (const [re, role] of ROLE_RULES) if (re.test(w)) return role;
  return null;
}
export function disciplinesFrom(...words) {
  const w = words.map((x) => String(x || "").toLowerCase()).join(" ");
  const out = [];
  if (/mechanical|\bmech\b|hvac/.test(w)) out.push("Mechanical");
  if (/electrical|\belec\b|power|lighting/.test(w)) out.push("Electrical");
  if (/plumbing|\bplumb\b/.test(w)) out.push("Plumbing");
  if (/fire\s*protection|\bfp\b|sprinkler|fire\s*alarm/.test(w)) out.push("Fire Protection");
  return out;
}
export function teamFrom(word, knownTeams) {
  const w = String(word || "").trim();
  if (!w) return "";
  const up = w.toUpperCase();
  const teams = (knownTeams || []).map((t) => String(t).toUpperCase());
  if (teams.includes(up)) return up;
  const l = w.toLowerCase();
  if (/new\s*york|\bnyc?\b|manhattan/.test(l)) return "NY";
  if (/washington|\bdc\b|fairfax|virginia|\bva\b/.test(l)) return "DC";
  if (/baltimore|maryland|\bmd\b|\bbt\b|\bbwi\b/.test(l)) return "BT";
  return teams.find((t) => l.includes(t.toLowerCase())) || up.replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

// Rows of a pasted staff sheet to RPC rows, plus the category words that
// need a role picked. roleMap overrides the guess per category word.
export function staffRowsFrom(text, opts) {
  const o = opts || {};
  const rows = parseTable(text);
  if (!rows.length) return { rows: [], unmapped: [], columns: {}, header: [] };
  const header = hasHeader(rows, "email") ? rows[0] : [];
  const body = header.length ? rows.slice(1) : rows;
  const cols = guessColumns(header, ["email", "first", "last", "name", "category", "title", "team", "department"], o.columns);
  if (cols.email == null) {
    const probe = body[0] || [];
    const i = probe.findIndex((c) => /@/.test(c));
    if (i >= 0) cols.email = i;
  }
  const at = (r, f) => (cols[f] != null ? String(r[cols[f]] || "").trim() : "");
  const unmapped = new Map();
  const out = [];
  for (const r of body) {
    const email = at(r, "email").toLowerCase().replace(/^mailto:/, "");
    if (!email) continue;
    const name = at(r, "name") || [at(r, "first"), at(r, "last")].filter(Boolean).join(" ");
    const category = at(r, "category") || at(r, "title");
    const key = category.toLowerCase();
    const role = (o.roleMap && o.roleMap[key]) || mapRole(category) || "";
    if (!role) unmapped.set(key, (unmapped.get(key) || 0) + 1);
    out.push({
      email, name, category, role,
      team: teamFrom(at(r, "team") || o.defaultTeam || "", o.knownTeams),
      title: at(r, "title") || category,
      disciplines: disciplinesFrom(at(r, "department"), at(r, "title"), category),
    });
  }
  return { rows: out, unmapped: [...unmapped.entries()].map(([word, n]) => ({ word, n })), columns: cols, header };
}

// ── projects ────────────────────────────────────────────────────────────────
const NUM_RE = /^[A-Z]{2,6}\d{5,7}\.\d{2}(\.\d{2})?$/;
export function cleanProjectNumber(s) {
  return String(s || "").toUpperCase().replace(/\s+/g, "").replace(/[‐-―]/g, "-");
}
export function looksLikeProjectNumber(s) { return NUM_RE.test(cleanProjectNumber(s)); }

// The sheet's status words onto PMS statuses. Unknown words come back
// unmapped so the preview can ask.
export function mapStatus(word) {
  const w = String(word || "").trim().toLowerCase();
  if (!w) return "In Progress";
  const exact = PMS_STATUSES.find((s) => s.toLowerCase() === w);
  if (exact) return exact;
  if (/construction\s*admin|\bca\b|\bcca\b|under\s*construction|bidding|\bbid\b/.test(w)) return "In Construction Administration";
  if (/hold|paused|suspend|inactive|dormant/.test(w)) return "On Hold";
  if (/review|submitted|pending\s*approval/.test(w)) return "In for Review";
  if (/closed|complete|done|finished|close\s*out|closeout|archiv/.test(w)) return "Completed";
  if (/not\s*started|awarded|ntp|kick\s*off|upcoming|new/.test(w)) return "Not Started";
  if (/priority|urgent|hot/.test(w)) return "Top Priority";
  if (/active|progress|ongoing|open|design|\bsd\b|\bdd\b|\bcd\b|current|running|wip/.test(w)) return "In Progress";
  return null;
}
export function projectRowsFrom(text, opts) {
  const o = opts || {};
  const rows = parseTable(text);
  if (!rows.length) return { rows: [], unmapped: [], columns: {} };
  const header = hasHeader(rows, "number") ? rows[0] : [];
  const body = header.length ? rows.slice(1) : rows;
  const cols = guessColumns(header, ["number", "status", "pname"], o.columns);
  if (cols.number == null) {
    const probe = body.find((r) => r.some(looksLikeProjectNumber)) || [];
    const i = probe.findIndex(looksLikeProjectNumber);
    if (i >= 0) cols.number = i;
  }
  if (cols.number != null && cols.pname === cols.number) delete cols.pname;
  // No header: the status column is the one whose cells read as statuses,
  // the name column the other one with the most text.
  if (!header.length && cols.number != null) {
    const width = Math.max(...body.map((r) => r.length));
    const others = [...Array(width).keys()].filter((i) => i !== cols.number && (!o.columns || o.columns.status == null || i !== colIndex(o.columns.status)));
    const score = (i, f) => body.reduce((n, r) => n + f(String(r[i] || "").trim()), 0);
    if (cols.status == null) {
      const best = others.map((i) => [i, score(i, (v) => (v && mapStatus(v) ? 1 : 0))]).sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] > 0) cols.status = best[0];
    }
    if (cols.pname == null) {
      const best = others.filter((i) => i !== cols.status).map((i) => [i, score(i, (v) => v.length)]).sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] > 0) cols.pname = best[0];
    }
  }
  const at = (r, f) => (cols[f] != null ? String(r[cols[f]] || "").trim() : "");
  const unmapped = new Map();
  const out = [];
  for (const r of body) {
    const number = cleanProjectNumber(at(r, "number"));
    if (!number) continue;
    const raw = at(r, "status");
    const status = (o.statusMap && o.statusMap[raw.toLowerCase()]) || mapStatus(raw);
    if (!status) unmapped.set(raw.toLowerCase(), (unmapped.get(raw.toLowerCase()) || 0) + 1);
    out.push({ number, status: status || "", rawStatus: raw, name: at(r, "pname"), valid: looksLikeProjectNumber(number) });
  }
  return { rows: out, unmapped: [...unmapped.entries()].map(([word, n]) => ({ word, n })), columns: cols };
}

// ── typo matching ───────────────────────────────────────────────────────────
// Damerau-Levenshtein (optimal string alignment): a swapped pair of digits
// is one edit, which is the typo people actually make in job numbers.
export function editDistance(a, b) {
  a = String(a || ""); b = String(b || "");
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => { const r = new Array(n + 1).fill(0); r[0] = i; return r; });
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}
// Candidates (numbers) closest to `num`, best first: edit distance up to
// maxDist, ignoring blanks (pipeline jobs have no number yet) and the number
// itself. A match that differs only in the .NN task suffix ranks after a
// true one-character typo of the same distance, since sibling task orders
// are real, different jobs.
export function nearestNumbers(num, pool, opts) {
  const o = opts || {};
  const max = o.maxDist == null ? 2 : o.maxDist;
  const target = cleanProjectNumber(num);
  if (!target) return [];
  const base = (s) => s.replace(/(\.\d{2})+$/, "");
  const seen = new Set();
  const out = [];
  for (const item of pool || []) {
    const n = cleanProjectNumber(typeof item === "string" ? item : item && item.number);
    if (!n || n === target || seen.has(n)) continue;
    seen.add(n);
    if (Math.abs(n.length - target.length) > max) continue;
    const dist = editDistance(target, n);
    if (dist > max) continue;
    const sibling = base(n) === base(target);
    out.push({ number: n, dist, sibling, item });
  }
  out.sort((x, y) => x.dist - y.dist || Number(x.sibling) - Number(y.sibling) || x.number.localeCompare(y.number));
  return out.slice(0, o.limit || 5);
}

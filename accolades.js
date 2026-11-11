// accolades.js — the counting rules behind Accolades.html (the Accolade-O-Meter).
//
// accolade = { id, kind: "client"|"internal", quote, recipients: [name],
//              recipient_emails: [email], from_name, from_company,
//              project_number, project_name, received_on: "YYYY-MM-DD",
//              source: "manual"|"email", created_by, created_by_name, created_at }
//
// Rows come from public.pms_accolades (see the pms_accolades migration).
// Pure: no DOM, no fetch. Dates are YYYY-MM-DD strings read as local days.

export function parseDay(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(str || ""));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

export function dayStr(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// Monday of the week a day falls in, as YYYY-MM-DD.
export function weekKey(day) {
  const d = day instanceof Date ? new Date(day.getFullYear(), day.getMonth(), day.getDate()) : parseDay(day);
  if (!d) return "";
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dayStr(d);
}

// Start of the period that contains `today`: "month", "quarter" or "all".
export function periodStart(period, today) {
  const t = today instanceof Date ? today : parseDay(today);
  if (period === "month") return dayStr(new Date(t.getFullYear(), t.getMonth(), 1));
  if (period === "quarter") return dayStr(new Date(t.getFullYear(), Math.floor(t.getMonth() / 3) * 3, 1));
  return "0000-00-00";
}

export function inPeriod(rows, period, today) {
  const from = periodStart(period, today);
  const to = dayStr(today instanceof Date ? today : parseDay(today));
  return (rows || []).filter((r) => {
    const d = String(r.received_on || "").slice(0, 10);
    return d >= from && d <= to;
  });
}

// Consecutive weeks with at least one accolade, counting back from this week.
// A quiet current week does not break the run until it is over, so the streak
// is still alive on a Monday morning.
export function streakWeeks(rows, today) {
  const weeks = new Set((rows || []).map((r) => weekKey(r.received_on)).filter(Boolean));
  const cur = parseDay(weekKey(today));
  if (!cur) return 0;
  if (!weeks.has(dayStr(cur))) cur.setDate(cur.getDate() - 7);
  let n = 0;
  while (weeks.has(dayStr(cur))) { n++; cur.setDate(cur.getDate() - 7); }
  return n;
}

function bump(map, key, label) {
  const k = String(key || "").trim().toLowerCase();
  if (!k) return;
  const e = map.get(k) || { key: k, name: label, n: 0 };
  e.n++;
  map.set(k, e);
}
function ranked(map, limit) {
  return [...map.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, limit || 10);
}

// People named on accolades, most recognised first. Keyed by email when the
// name was picked from the staff list, by the typed name otherwise.
export function topRecipients(rows, limit) {
  const m = new Map();
  for (const r of rows || []) {
    const names = r.recipients || [], emails = r.recipient_emails || [];
    names.forEach((name, i) => bump(m, emails[i] || name, name));
  }
  return ranked(m, limit);
}

// People who logged accolades for someone else. Logging one that names only
// yourself earns no spotter credit.
export function topSpotters(rows, limit) {
  const m = new Map();
  for (const r of rows || []) {
    const by = String(r.created_by || "").toLowerCase();
    if (!by) continue;
    const emails = (r.recipient_emails || []).map((e) => String(e || "").toLowerCase());
    const onlySelf = (r.recipients || []).length > 0 && emails.length === (r.recipients || []).length && emails.every((e) => e === by);
    if (onlySelf) continue;
    bump(m, by, r.created_by_name || by.split("@")[0]);
  }
  return ranked(m, limit);
}

export function topProjects(rows, limit) {
  const m = new Map();
  for (const r of rows || []) {
    if (!r.project_number && !r.project_name) continue;
    bump(m, r.project_number || r.project_name, [r.project_number, r.project_name].filter(Boolean).join(" · "));
  }
  return ranked(m, limit);
}

// The accolade to feature: the most-cheered one received in the last 7 days,
// newest first on a tie; the newest overall when the week has been quiet.
export function spotlight(rows, cheerCounts, today) {
  const list = rows || [];
  if (!list.length) return null;
  const t = today instanceof Date ? today : parseDay(today);
  const from = dayStr(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 6));
  const newest = (a, b) => String(b.received_on).localeCompare(String(a.received_on)) || String(b.created_at || "").localeCompare(String(a.created_at || ""));
  const week = list.filter((r) => String(r.received_on || "") >= from);
  if (!week.length) return [...list].sort(newest)[0];
  const c = (r) => (cheerCounts && cheerCounts[r.id]) || 0;
  return [...week].sort((a, b) => c(b) - c(a) || newest(a, b))[0];
}

// Gauge reading against the monthly goal.
export function zoneFor(count, goal) {
  const g = Math.max(1, goal || 1), f = count / g;
  if (count > g) return "Off the scale";
  if (f >= 1) return "Goal hit";
  if (f >= 0.8) return "Full blast";
  if (f >= 0.5) return "At setpoint";
  if (f >= 0.25) return "Warming up";
  return "Cold start";
}

// The email search marks matched words as «word». Split a snippet into
// [{ text, hit }] so the page can highlight without building HTML from it.
export function snippetParts(snippet) {
  const out = [];
  const re = /«([^«»]*)»/g;
  const s = String(snippet || "");
  let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), hit: false });
    out.push({ text: m[1], hit: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), hit: false });
  return out;
}

export function snippetText(snippet) {
  return snippetParts(snippet).map((p) => p.text).join("").replace(/\s+/g, " ").trim();
}

export function isRecipient(row, email) {
  const me = String(email || "").toLowerCase();
  return !!me && (row.recipient_emails || []).some((e) => String(e || "").toLowerCase() === me);
}

// ── The daily game and season points ─────────────────────────────────────────
// Everyone gets the same accolade each day with the name hidden, and four
// names to choose from. One guess per person per day (pms_accolade_plays).

function seedFrom(str) {
  let h = 2166136261;
  for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(list, rand) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const GAME_CHOICES = 4;

// Names that can stand in as wrong answers: everyone ever named on the wall
// plus the staff list, minus the people the accolade actually names.
function decoyPool(row, rows, staffNames) {
  const taken = new Set((row.recipients || []).map((n) => String(n).trim().toLowerCase()));
  const seen = new Map();
  const add = (n) => {
    const name = String(n || "").trim(), k = name.toLowerCase();
    if (name && !taken.has(k) && !seen.has(k)) seen.set(k, name);
  };
  for (const r of rows || []) (r.recipients || []).forEach(add);
  (staffNames || []).forEach(add);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

// The day's puzzle, or null when the wall is too thin to make one. Prefers
// accolades from the last 60 days so the game stays about recent work. Today's
// own entries are left out so a new one cannot change a puzzle mid-day. A salt
// gives a different (practice) puzzle for the same day.
export function dailyPuzzle(rows, staffNames, today, salt) {
  const day = typeof today === "string" ? today.slice(0, 10) : dayStr(today);
  const t = parseDay(day);
  const all = (rows || []).filter((r) => (r.recipients || []).length && String(r.created_at || "").slice(0, 10) < day)
    .sort((a, b) => Number(a.id) - Number(b.id));
  if (!all.length) return null;
  const from = dayStr(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 60));
  const recent = all.filter((r) => String(r.received_on || "") >= from);
  const pool = recent.length >= 5 ? recent : all;
  const rand = rng(seedFrom("accolade-game:" + day + (salt ? ":" + salt : "")));
  const row = pool[Math.floor(rand() * pool.length)];
  const decoys = decoyPool(row, rows, staffNames);
  if (decoys.length < GAME_CHOICES - 1) return null;
  const answer = String(row.recipients[0]).trim();
  const choices = shuffled([answer, ...shuffled(decoys, rand).slice(0, GAME_CHOICES - 1)], rand);
  return { day, accolade: row, answer, choices, others: row.recipients.length - 1 };
}

// Consecutive days played, counting back from today (or yesterday when today
// has not been played yet).
export function playStreak(plays, email, today) {
  const me = String(email || "").toLowerCase();
  const days = new Set((plays || []).filter((p) => String(p.email || "").toLowerCase() === me).map((p) => String(p.play_date).slice(0, 10)));
  const cur = today instanceof Date ? new Date(today.getFullYear(), today.getMonth(), today.getDate()) : parseDay(today);
  if (!cur) return 0;
  if (!days.has(dayStr(cur))) cur.setDate(cur.getDate() - 1);
  let n = 0;
  while (days.has(dayStr(cur))) { n++; cur.setDate(cur.getDate() - 1); }
  return n;
}

export const POINTS = { recognized: 10, spotted: 5, guessRight: 3, guessWrong: 1, cheer: 1 };

// Season standings. rows, cheers ({accolade_id, email, created_at}) and plays
// ({email, play_date, correct}) are expected to be already cut to the season.
// names: email -> display name. People named without an email score under
// their typed name, so they still appear.
export function seasonPoints(rows, cheers, plays, names) {
  const m = new Map();
  const nameOf = (k, fallback) => (names && names[k]) || fallback || k.split("@")[0];
  const give = (key, label, pts, field) => {
    const k = String(key || "").trim().toLowerCase();
    if (!k) return;
    const e = m.get(k) || { key: k, name: nameOf(k, label), points: 0, recognized: 0, spotted: 0, guesses: 0, cheers: 0 };
    e.points += pts; e[field]++;
    m.set(k, e);
  };
  for (const r of rows || []) {
    const emails = r.recipient_emails || [];
    (r.recipients || []).forEach((name, i) => give(emails[i] || name, name, POINTS.recognized, "recognized"));
  }
  for (const s of topSpotters(rows, Infinity)) {
    for (let i = 0; i < s.n; i++) give(s.key, s.name, POINTS.spotted, "spotted");
  }
  for (const p of plays || []) give(p.email, "", p.correct ? POINTS.guessRight : POINTS.guessWrong, "guesses");
  for (const c of cheers || []) give(c.email, "", POINTS.cheer, "cheers");
  return [...m.values()].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

// The race: season points move a car round the track, LAP_POINTS to a lap.
// Shows the front of the field plus the viewer's own car wherever it sits.
export const LAP_POINTS = 50;
export function raceGrid(standings, meKey, max, lapPoints) {
  const lap = lapPoints || LAP_POINTS, me = String(meKey || "").toLowerCase();
  const all = (standings || []).map((e, i) => ({
    key: e.key, name: e.name, points: e.points, rank: i + 1,
    lap: Math.floor(e.points / lap), frac: (e.points % lap) / lap, me: e.key === me,
  }));
  const front = all.slice(0, max || 8);
  const mine = all.find((c) => c.me);
  if (mine && !front.includes(mine)) front.push(mine);
  return front;
}

// Hide the people an accolade names inside its own quote ("Thanks Ana, ...")
// so the game does not give the answer away. Full names and first names of
// three letters or more, whole words only.
export function redactNames(quote, recipients) {
  const words = new Set();
  for (const n of recipients || []) {
    const name = String(n || "").trim();
    if (!name) continue;
    words.add(name);
    const first = name.split(/\s+/)[0];
    if (first.length >= 3) words.add(first);
  }
  const list = [...words].sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!list.length) return String(quote || "");
  return String(quote || "").replace(new RegExp("(^|[^\\p{L}])(" + list.join("|") + ")(?![\\p{L}])", "giu"), "$1\u2588\u2588\u2588\u2588");
}

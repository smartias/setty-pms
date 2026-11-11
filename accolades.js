// accolades.js — the counting rules behind Accolades.html (the Accolade-O-Meter).
//
// accolade = { id, kind: "client"|"internal", quote, recipients: [name],
//              recipient_emails: [email], from_name, from_company,
//              project_number, project_name, received_on: "YYYY-MM-DD",
//              source: "manual"|"email", created_by, created_by_name, created_at }
//
// Rows come from public.pms_accolades (see the pms_accolades migration).
// Pure: no DOM, no fetch. Dates are YYYY-MM-DD strings read as local days.

// Bump this, and the ?v= on the import in Accolades.html, on every change to
// this file. The page compares the two to spot a stale cached copy.
export const VERSION = "2026-11-11-7";

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
function decoyPool(row, rows, staffNames, gone) {
  const taken = new Set((row.recipients || []).map((n) => String(n).trim().toLowerCase()));
  for (const g of gone || []) taken.add(g);
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
// gives a different (practice) puzzle for the same day. `gone` is a set of
// lower-cased names of people who have left: they are never the answer and
// never offered as a wrong one.
export function dailyPuzzle(rows, staffNames, today, salt, gone) {
  const day = typeof today === "string" ? today.slice(0, 10) : dayStr(today);
  const t = parseDay(day);
  const left = gone || new Set();
  const all = (rows || []).filter((r) => (r.recipients || []).length && String(r.created_at || "").slice(0, 10) < day && !left.has(String(r.recipients[0]).trim().toLowerCase()))
    .sort((a, b) => Number(a.id) - Number(b.id));
  if (!all.length) return null;
  const from = dayStr(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 60));
  const recent = all.filter((r) => String(r.received_on || "") >= from);
  const pool = recent.length >= 5 ? recent : all;
  const rand = rng(seedFrom("accolade-game:" + day + (salt ? ":" + salt : "")));
  const row = pool[Math.floor(rand() * pool.length)];
  const decoys = decoyPool(row, rows, staffNames, left);
  if (decoys.length < GAME_CHOICES - 1) return null;
  const answer = String(row.recipients[0]).trim();
  const choices = shuffled([answer, ...shuffled(decoys, rand).slice(0, GAME_CHOICES - 1)], rand);
  return { day, accolade: row, answer, choices, others: row.recipients.length - 1 };
}

// The working day before a given day: weekends are skipped, so playing Friday
// and then Monday keeps a streak alive.
function prevWorkday(d) {
  const p = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  while (p.getDay() === 0 || p.getDay() === 6) p.setDate(p.getDate() - 1);
  return p;
}

// Consecutive working days played, counting back from today (or from the last
// working day when today has not been played yet).
export function playStreak(plays, email, today) {
  const me = String(email || "").toLowerCase();
  const days = new Set((plays || []).filter((p) => String(p.email || "").toLowerCase() === me).map((p) => String(p.play_date).slice(0, 10)));
  let cur = today instanceof Date ? new Date(today.getFullYear(), today.getMonth(), today.getDate()) : parseDay(today);
  if (!cur) return 0;
  if (!days.has(dayStr(cur))) cur = prevWorkday(cur);
  let n = 0;
  while (days.has(dayStr(cur))) { n++; cur = prevWorkday(cur); }
  return n;
}

// Bonus for sticking with the daily round: STREAK_BONUS points for every
// STREAK_LENGTH working days played in a row. Returns the number of bonuses
// one person's play dates have earned.
export const STREAK_LENGTH = 5;
export function streakBonuses(playDates) {
  const days = [...new Set((playDates || []).map((d) => String(d).slice(0, 10)))].sort();
  let run = 0, bonuses = 0, prev = null;
  for (const d of days) {
    const day = parseDay(d);
    if (!day) continue;
    run = prev && dayStr(prevWorkday(day)) === prev ? run + 1 : 1;
    if (run % STREAK_LENGTH === 0) bonuses++;
    // a weekend play neither extends nor breaks the run that Friday started
    if (day.getDay() !== 0 && day.getDay() !== 6) prev = d; else run--;
  }
  return bonuses;
}

export const POINTS = { recognized: 10, spotted: 5, guessRight: 3, guessWrong: 1, cheer: 1, streak: 5 };

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
    const e = m.get(k) || { key: k, name: nameOf(k, label), points: 0, recognized: 0, spotted: 0, guesses: 0, cheers: 0, streaks: 0 };
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
  const playDays = new Map();
  for (const p of plays || []) {
    give(p.email, "", p.correct ? POINTS.guessRight : POINTS.guessWrong, "guesses");
    const k = String(p.email || "").trim().toLowerCase();
    if (k) playDays.set(k, [...(playDays.get(k) || []), p.play_date]);
  }
  for (const [k, days] of playDays) {
    const e = m.get(k), b = streakBonuses(days);
    if (e && b) { e.points += b * POINTS.streak; e.streaks = b; }
  }
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

// Team standings: season points summed by team. teamOf: email -> team name.
// People with no team on record are left out. `perHead` is the average over
// the team's members who scored, so a small office is not buried by a big one.
export function teamStandings(standings, teamOf) {
  const m = new Map();
  for (const e of standings || []) {
    const team = teamOf && teamOf[e.key];
    if (!team) continue;
    const t = m.get(team) || { key: team, name: team, points: 0, members: 0 };
    t.points += e.points; t.members++;
    m.set(team, t);
  }
  return [...m.values()].map((t) => ({ ...t, perHead: Math.round(t.points / t.members) }))
    .sort((a, b) => b.perHead - a.perHead || b.points - a.points || a.name.localeCompare(b.name));
}

// What changed for one person since their last visit. prev is what the page
// stored last time: { rank, ahead: [keys] }. Returns { moved, passedBy: [names] }
// where moved > 0 means places gained.
export function sinceLastVisit(standings, meKey, prev) {
  const me = String(meKey || "").toLowerCase();
  const i = (standings || []).findIndex((e) => e.key === me);
  if (i < 0) return { rank: 0, ahead: [], moved: 0, passedBy: [] };
  const ahead = standings.slice(0, i).map((e) => e.key);
  const out = { rank: i + 1, ahead, moved: 0, passedBy: [] };
  if (prev && prev.rank) {
    out.moved = prev.rank - out.rank;
    const was = new Set(prev.ahead || []);
    if (out.moved < 0) out.passedBy = standings.slice(0, i).filter((e) => !was.has(e.key)).map((e) => e.name);
  }
  return out;
}

// ── Trophy case and hall of champions ────────────────────────────────────────
// Badges are worked out from the record each time, so nothing extra is stored.
// seasonPts is the person's points in the current season (for the lap badge).
export function badgesFor(email, rows, cheers, plays, seasonPts) {
  const me = String(email || "").toLowerCase();
  const mine = (rows || []).filter((r) => isRecipient(r, me));
  const perMonth = new Map();
  for (const r of mine) { const k = String(r.received_on || "").slice(0, 7); perMonth.set(k, (perMonth.get(k) || 0) + 1); }
  const spotted = (topSpotters(rows, Infinity).find((s) => s.key === me) || { n: 0 }).n;
  const myPlays = (plays || []).filter((p) => String(p.email || "").toLowerCase() === me);
  const given = (cheers || []).filter((c) => String(c.email || "").toLowerCase() === me).length;
  const def = [
    ["wall", "On the wall", "Be named on your first accolade", mine.length >= 1],
    ["client3", "Client favorite", "Be named on 3 client accolades", mine.filter((r) => r.kind !== "internal").length >= 3],
    ["hattrick", "Hat trick", "Be named on 3 accolades in one month", [...perMonth.values()].some((n) => n >= 3)],
    ["scout", "Talent scout", "Log 5 accolades about other people", spotted >= 5],
    ["cheer25", "Cheerleader", "Give 25 cheers", given >= 25],
    ["eye10", "Sharp eye", "Get 10 daily guesses right", myPlays.filter((p) => p.correct).length >= 10],
    ["streak", "Iron streak", "Play " + STREAK_LENGTH + " working days in a row", streakBonuses(myPlays.map((p) => p.play_date)) >= 1],
    ["lap", "Full lap", "Score " + LAP_POINTS + " points in one season", (seasonPts || 0) >= LAP_POINTS],
  ];
  return def.map(([id, name, how, earned]) => ({ id, name, how, earned: !!earned }));
}

export function quarterKey(day) {
  const d = String(day || "").slice(0, 10), m = Number(d.slice(5, 7));
  return d.slice(0, 4) + "-Q" + (Math.floor((m - 1) / 3) + 1);
}

// The podium of every finished quarter that had any points, newest first.
export function champions(rows, cheers, plays, names, today) {
  const now = quarterKey(typeof today === "string" ? today : dayStr(today));
  const q = new Map();
  const slot = (k) => { if (!q.has(k)) q.set(k, { rows: [], cheers: [], plays: [] }); return q.get(k); };
  for (const r of rows || []) slot(quarterKey(r.received_on)).rows.push(r);
  for (const c of cheers || []) slot(quarterKey(c.created_at)).cheers.push(c);
  for (const p of plays || []) slot(quarterKey(p.play_date)).plays.push(p);
  return [...q.keys()].filter((k) => /^\d{4}-Q[1-4]$/.test(k) && k < now).sort().reverse().map((k) => {
    const s = q.get(k);
    return { key: k, label: k.slice(5) + " " + k.slice(0, 4), podium: seasonPoints(s.rows, s.cheers, s.plays, names).slice(0, 3) };
  }).filter((x) => x.podium.length);
}

// ── Rides ────────────────────────────────────────────────────────────────────
// A person's ride is stored as one short string in pms_accolade_cars.ride:
//   "<body>.<decal>.<topper>"   a car, e.g. "truck.s.l" (pickup, stripes, siren)
//   "<emoji>"                   a novelty ride, e.g. the duck
// "car" (what the first version saved) reads as the plain coupe. Anything
// unrecognised falls back to the stock car, so a bad value never breaks the track.
export const BODIES = [["car", "Coupe"], ["racer", "Race car"], ["truck", "Pickup"], ["van", "Van"], ["bug", "Bug"], ["limo", "Limo"]];
export const DECALS = [["0", "None"], ["s", "Racing stripes"], ["f", "Flames"], ["d", "Polka dots"], ["c", "Checkers"]];
export const TOPPERS = [["0", "None"], ["l", "Siren"], ["t", "Taxi sign"], ["w", "Spoiler"], ["a", "Antenna flag"]];
export const NOVELTY = [
  ["\u{1F986}", "Duck", "QUACK!"], ["\u{1F6D2}", "Shopping cart", "CLATTER!"], ["\u{1F6FC}", "Roller skate", "WHEEE!"],
  ["\u{1F996}", "Dinosaur", "RAWR!"], ["\u{1F680}", "Rocket", "PEW!"], ["\u{1F6CB}️", "Sofa", "COMFY!"],
  ["\u{1F6F8}", "Flying saucer", "ZAP!"], ["\u{1F69C}", "Tractor", "CHUG!"], ["\u{1F422}", "Turtle", "SLOW DOWN!"],
  ["\u{1F984}", "Unicorn", "NEIGH!"], ["\u{1F6C1}", "Bathtub", "SPLASH!"], ["\u{1F6F6}", "Canoe", "PADDLE!"],
];
const BODY_SHOUT = { car: "BEEP!", racer: "VROOM!", truck: "HONK!", van: "TOOT!", bug: "MEEP!", limo: "AHEM!" };
export const STOCK_RIDE = "car.0.0";

export function parseRide(str) {
  const v = String(str || "").trim();
  const nov = NOVELTY.find((n) => n[0] === v);
  if (nov) return { novelty: nov[0], label: nov[1], shout: nov[2] };
  const [b, d, t] = v.split(".");
  const body = (BODIES.find((x) => x[0] === b) || BODIES[0])[0];
  const decal = (DECALS.find((x) => x[0] === d) || DECALS[0])[0];
  const topper = (TOPPERS.find((x) => x[0] === t) || TOPPERS[0])[0];
  return { body, decal, topper, label: BODIES.find((x) => x[0] === body)[1], shout: BODY_SHOUT[body] };
}
export function encodeRide(spec) {
  if (spec && spec.novelty) return parseRide(spec.novelty).novelty || STOCK_RIDE;
  const p = parseRide([spec && spec.body, spec && spec.decal, spec && spec.topper].join("."));
  return [p.body, p.decal, p.topper].join(".");
}

// ── Email backfill ───────────────────────────────────────────────────────────
// Who an email's praise was probably for: the staff it was addressed to. A
// starting guess for the person approving it, never posted without them.
export function guessPeople(toAddresses, ccAddresses, fromAddress, staff) {
  const byEmail = new Map((staff || []).filter((p) => p.email).map((p) => [String(p.email).toLowerCase(), p]));
  const from = String(fromAddress || "").toLowerCase();
  const pick = (text) => (String(text || "").toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || []);
  const out = [], seen = new Set();
  const add = (list) => { for (const e of list) { const p = byEmail.get(e); if (p && e !== from && !seen.has(e)) { seen.add(e); out.push({ name: p.name, email: e }); } } };
  add(pick(toAddresses));
  if (!out.length) add(pick(ccAddresses));   // only fall back to cc when nobody on the to line is staff
  return out.slice(0, 8);
}

// ── Scaling to a big firm ────────────────────────────────────────────────────
// With 150 people the track cannot show everyone, and watching leaders who are
// far ahead is no fun. packGrid shows the podium plus the cars right around the
// viewer: `top` leaders, then `around` places either side of them. Someone who
// has not scored yet just sees the front of the field.
export function packGrid(standings, meKey, top, around, lapPoints) {
  const lap = lapPoints || LAP_POINTS, me = String(meKey || "").toLowerCase();
  const t = top == null ? 3 : top, a = around == null ? 2 : around;
  const all = (standings || []).map((e, i) => ({
    key: e.key, name: e.name, points: e.points, rank: i + 1,
    lap: Math.floor(e.points / lap), frac: (e.points % lap) / lap, me: e.key === me,
  }));
  const i = all.findIndex((c) => c.me);
  if (i < 0) return all.slice(0, t + 2 * a + 1);
  const keep = new Set();
  for (let k = 0; k < Math.min(t, all.length); k++) keep.add(k);
  for (let k = Math.max(0, i - a); k <= Math.min(all.length - 1, i + a); k++) keep.add(k);
  // near the front the two groups overlap, so top up to a full grid from the next places down
  for (let k = 0; keep.size < Math.min(all.length, t + 2 * a + 1); k++) keep.add(k);
  return [...keep].sort((x, y) => x - y).map((k) => all[k]);
}

// One car per team for the shared lobby screen, placed by the team's average
// points so a small office can lead. Takes teamStandings() output.
export function teamGrid(teams, lapPoints) {
  const lap = lapPoints || LAP_POINTS;
  return (teams || []).map((t, i) => ({
    key: "team:" + t.key, name: t.name, points: t.perHead, rank: i + 1,
    lap: Math.floor(t.perHead / lap), frac: (t.perHead % lap) / lap, me: false, team: true,
  }));
}

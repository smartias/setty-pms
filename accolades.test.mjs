// node --test accolades.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  weekKey, periodStart, inPeriod, streakWeeks, topRecipients, topSpotters, topProjects,
  spotlight, zoneFor, snippetParts, snippetText, isRecipient,
} from "./accolades.js";

const row = (o) => ({ recipients: [], recipient_emails: [], ...o });

test("weekKey is the Monday of the week", () => {
  assert.equal(weekKey("2026-11-11"), "2026-11-09"); // Wednesday
  assert.equal(weekKey("2026-11-09"), "2026-11-09"); // Monday
  assert.equal(weekKey("2026-11-15"), "2026-11-09"); // Sunday
  assert.equal(weekKey("nope"), "");
});

test("periods start on the first of the month or quarter", () => {
  assert.equal(periodStart("month", "2026-11-11"), "2026-11-01");
  assert.equal(periodStart("quarter", "2026-11-11"), "2026-10-01");
  assert.equal(periodStart("quarter", "2026-03-31"), "2026-01-01");
  const rows = [row({ received_on: "2026-11-02" }), row({ received_on: "2026-10-31" }), row({ received_on: "2026-06-30" }), row({ received_on: "2026-12-01" })];
  assert.equal(inPeriod(rows, "month", "2026-11-11").length, 1);
  assert.equal(inPeriod(rows, "quarter", "2026-11-11").length, 2);
  assert.equal(inPeriod(rows, "all", "2026-11-11").length, 3); // a future-dated row is not counted yet
});

test("streak counts consecutive weeks and survives a quiet current week", () => {
  const rows = [row({ received_on: "2026-11-03" }), row({ received_on: "2026-10-28" }), row({ received_on: "2026-10-20" }), row({ received_on: "2026-10-01" })];
  assert.equal(streakWeeks(rows, "2026-11-11"), 3);       // nothing yet this week: run still alive
  assert.equal(streakWeeks([...rows, row({ received_on: "2026-11-10" })], "2026-11-11"), 4);
  assert.equal(streakWeeks(rows, "2026-11-18"), 0);       // a whole week missed
  assert.equal(streakWeeks([], "2026-11-11"), 0);
});

test("recipients tally by email when known, by name otherwise", () => {
  const rows = [
    row({ recipients: ["Ana Diaz", "Bo Chen"], recipient_emails: ["ana@setty.com", ""] }),
    row({ recipients: ["Ana D."], recipient_emails: ["ANA@setty.com"] }),
    row({ recipients: ["bo chen"], recipient_emails: [] }),
  ];
  const top = topRecipients(rows);
  assert.deepEqual(top.map((t) => [t.name, t.n]), [["Ana Diaz", 2], ["Bo Chen", 2]]);
});

test("spotters get no credit for naming only themselves", () => {
  const rows = [
    row({ created_by: "ana@setty.com", created_by_name: "Ana Diaz", recipients: ["Ana Diaz"], recipient_emails: ["ana@setty.com"] }),
    row({ created_by: "ana@setty.com", created_by_name: "Ana Diaz", recipients: ["Bo Chen"], recipient_emails: ["bo@setty.com"] }),
    row({ created_by: "bo@setty.com", recipients: ["Ana Diaz", "Bo Chen"], recipient_emails: ["ana@setty.com", "bo@setty.com"] }),
    row({ created_by: "bo@setty.com", recipients: ["The whole team"], recipient_emails: [""] }),
  ];
  assert.deepEqual(topSpotters(rows).map((t) => [t.name, t.n]), [["bo", 2], ["Ana Diaz", 1]]);
});

test("projects tally by number", () => {
  const rows = [row({ project_number: "S1", project_name: "Library" }), row({ project_number: "s1", project_name: "Library" }), row({})];
  assert.deepEqual(topProjects(rows).map((t) => [t.name, t.n]), [["S1 · Library", 2]]);
});

test("spotlight prefers the most-cheered accolade of the last 7 days", () => {
  const rows = [
    row({ id: 1, received_on: "2026-11-10", created_at: "2026-11-10T10:00:00Z" }),
    row({ id: 2, received_on: "2026-11-06", created_at: "2026-11-06T10:00:00Z" }),
    row({ id: 3, received_on: "2026-10-01", created_at: "2026-10-01T10:00:00Z" }),
  ];
  assert.equal(spotlight(rows, { 2: 4, 3: 9 }, "2026-11-11").id, 2); // 3 has more cheers but is old
  assert.equal(spotlight(rows, {}, "2026-11-11").id, 1);             // tie: newest
  assert.equal(spotlight(rows, { 3: 9 }, "2026-12-25").id, 1);       // quiet week: newest overall
  assert.equal(spotlight([], {}, "2026-11-11"), null);
});

test("zones follow the share of the goal", () => {
  assert.equal(zoneFor(0, 20), "Cold start");
  assert.equal(zoneFor(5, 20), "Warming up");
  assert.equal(zoneFor(10, 20), "At setpoint");
  assert.equal(zoneFor(16, 20), "Full blast");
  assert.equal(zoneFor(20, 20), "Goal hit");
  assert.equal(zoneFor(21, 20), "Off the scale");
});

test("snippets split on the search markers and never carry markup through", () => {
  assert.deepEqual(snippetParts("you did a «great» «job» here"), [
    { text: "you did a ", hit: false }, { text: "great", hit: true }, { text: " ", hit: false },
    { text: "job", hit: true }, { text: " here", hit: false },
  ]);
  assert.equal(snippetText("  a «great»\n job  "), "a great job");
  assert.deepEqual(snippetParts("<b>x</b>"), [{ text: "<b>x</b>", hit: false }]); // stays text; the page uses textContent
});

test("isRecipient matches email case-insensitively", () => {
  assert.equal(isRecipient(row({ recipient_emails: ["Ana@Setty.com"] }), "ana@setty.com"), true);
  assert.equal(isRecipient(row({ recipient_emails: [""] }), ""), false);
});

import { streakBonuses, teamStandings, sinceLastVisit, badgesFor, champions, quarterKey, STREAK_LENGTH } from "./accolades.js";
import { redactNames, dailyPuzzle, playStreak, seasonPoints, raceGrid, POINTS, GAME_CHOICES } from "./accolades.js";

const wall = [
  row({ id: 1, recipients: ["Ana Diaz"], recipient_emails: ["ana@setty.com"], received_on: "2026-11-01", created_at: "2026-11-01T09:00:00Z", created_by: "bo@setty.com" }),
  row({ id: 2, recipients: ["Bo Chen", "Cy Roe"], recipient_emails: ["bo@setty.com", ""], received_on: "2026-11-03", created_at: "2026-11-03T09:00:00Z", created_by: "ana@setty.com" }),
];

test("the daily puzzle is the same for everyone and holds the answer once", () => {
  const staff = ["Dee Fox", "Eli Park", "Ana Diaz"];
  const a = dailyPuzzle(wall, staff, "2026-11-11"), b = dailyPuzzle([...wall].reverse(), staff, "2026-11-11");
  assert.deepEqual(a.choices, b.choices);
  assert.equal(a.accolade.id, b.accolade.id);
  assert.equal(a.choices.length, GAME_CHOICES);
  assert.equal(new Set(a.choices).size, GAME_CHOICES);
  assert.equal(a.choices.filter((c) => c === a.answer).length, 1);
  // nobody else named on the accolade is offered as a wrong answer
  for (const r of a.accolade.recipients.slice(1)) assert.ok(!a.choices.includes(r));
});

test("no puzzle without enough names, and today's entries wait a day", () => {
  assert.equal(dailyPuzzle(wall, [], "2026-11-11"), null);            // too few decoys
  assert.equal(dailyPuzzle([], ["A", "B", "C", "D"], "2026-11-11"), null);
  const fresh = [row({ id: 9, recipients: ["Ana Diaz"], received_on: "2026-11-11", created_at: "2026-11-11T08:00:00Z" })];
  assert.equal(dailyPuzzle(fresh, ["A", "B", "C"], "2026-11-11"), null);
  assert.equal(dailyPuzzle(fresh, ["A", "B", "C"], "2026-11-12").answer, "Ana Diaz");
});

test("play streak counts working days back from today or the last working day", () => {
  const plays = ["2026-11-11", "2026-11-10", "2026-11-09", "2026-11-06"].map((d) => ({ email: "Ana@setty.com", play_date: d }));
  assert.equal(playStreak(plays, "ana@setty.com", "2026-11-11"), 4);   // Fri 6th to Wed 11th, weekend skipped
  assert.equal(playStreak(plays, "ana@setty.com", "2026-11-12"), 4);
  assert.equal(playStreak(plays, "ana@setty.com", "2026-11-13"), 0);
  // Fri 6 Nov then Mon 9 Nov is unbroken: weekends do not count against you
  const wk = ["2026-11-09", "2026-11-06", "2026-11-05"].map((d) => ({ email: "bo@setty.com", play_date: d }));
  assert.equal(playStreak(wk, "bo@setty.com", "2026-11-09"), 3);
  assert.equal(playStreak(wk, "bo@setty.com", "2026-11-10"), 3);
});

test("season points add up across the four ways to score", () => {
  const cheers = [{ accolade_id: 1, email: "bo@setty.com" }];
  const plays = [{ email: "ana@setty.com", play_date: "2026-11-10", correct: true }, { email: "bo@setty.com", play_date: "2026-11-10", correct: false }];
  const s = seasonPoints(wall, cheers, plays, { "ana@setty.com": "Ana Diaz", "bo@setty.com": "Bo Chen" });
  const by = Object.fromEntries(s.map((e) => [e.name, e.points]));
  assert.equal(by["Ana Diaz"], POINTS.recognized + POINTS.spotted + POINTS.guessRight);
  assert.equal(by["Bo Chen"], POINTS.recognized + POINTS.spotted + POINTS.guessWrong + POINTS.cheer);
  assert.equal(by["Cy Roe"], POINTS.recognized);   // named without an email still scores
  assert.equal(s[0].name, "Ana Diaz");
  const grid = raceGrid(s, "cy roe", 2, 10);
  assert.deepEqual(grid.map((c) => [c.name, c.lap, c.frac, c.rank]), [["Ana Diaz", 1, 0.8, 1], ["Bo Chen", 1, 0.7, 2], ["Cy Roe", 1, 0, 3]]);
});

test("redaction hides the named people in the quote, whole words only", () => {
  const B = "\u2588\u2588\u2588\u2588";
  assert.equal(redactNames("Thanks Ana, and Ana Diaz's team. Banana stays.", ["Ana Diaz"]), `Thanks ${B}, and ${B}'s team. Banana stays.`);
  assert.equal(redactNames("Al (and Bo) did well", ["Al Jones", "Bo Chen (PE)"]), "Al (and Bo) did well"); // two-letter first names are left alone
  assert.equal(redactNames("no names here", []), "no names here");
});

test("a salt gives a practice puzzle without changing the daily one", () => {
  const staff = ["Dee Fox", "Eli Park", "Fay Lin"];
  assert.deepEqual(dailyPuzzle(wall, staff, "2026-11-11").choices, dailyPuzzle(wall, staff, "2026-11-11").choices);
  assert.ok(dailyPuzzle(wall, staff, "2026-11-11", "p1"));
});

test("a streak bonus lands every fifth working day in a row", () => {
  assert.equal(STREAK_LENGTH, 5);
  const week = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];           // Mon-Fri
  assert.equal(streakBonuses(week), 1);
  assert.equal(streakBonuses(week.slice(0, 4)), 0);
  assert.equal(streakBonuses([...week, "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]), 2); // two full weeks across a weekend
  assert.equal(streakBonuses(["2026-11-02", "2026-11-03", "2026-11-05", "2026-11-06", "2026-11-09"]), 0);          // Wednesday missed
  assert.equal(streakBonuses([...week, "2026-11-07"]), 1);                                                          // a Saturday play adds nothing
  const s = seasonPoints([], [], week.map((d) => ({ email: "ana@setty.com", play_date: d, correct: true })), {});
  assert.equal(s[0].points, 5 * POINTS.guessRight + POINTS.streak);
});

test("teams rank by average points of the members who scored", () => {
  const st = [{ key: "a", points: 30 }, { key: "b", points: 10 }, { key: "c", points: 25 }, { key: "d", points: 99 }];
  const t = teamStandings(st, { a: "NY", b: "NY", c: "India" });
  assert.deepEqual(t.map((x) => [x.name, x.points, x.members, x.perHead]), [["India", 25, 1, 25], ["NY", 40, 2, 20]]);
});

test("since last visit reports places moved and who passed you", () => {
  const st = [{ key: "a", name: "Ana" }, { key: "b", name: "Bo" }, { key: "c", name: "Cy" }];
  assert.deepEqual(sinceLastVisit(st, "c", { rank: 2, ahead: ["a"] }), { rank: 3, ahead: ["a", "b"], moved: -1, passedBy: ["Bo"] });
  assert.equal(sinceLastVisit(st, "a", { rank: 3, ahead: ["b", "c"] }).moved, 2);
  assert.equal(sinceLastVisit(st, "b", null).moved, 0);
  assert.equal(sinceLastVisit(st, "zz", { rank: 1 }).rank, 0);
});

test("badges are earned from the record", () => {
  const rows = [
    row({ kind: "client", recipients: ["Ana"], recipient_emails: ["ana@setty.com"], received_on: "2026-11-02", created_by: "bo@setty.com" }),
    row({ kind: "client", recipients: ["Ana"], recipient_emails: ["ana@setty.com"], received_on: "2026-11-05", created_by: "bo@setty.com" }),
    row({ kind: "client", recipients: ["Ana"], recipient_emails: ["ana@setty.com"], received_on: "2026-11-09", created_by: "bo@setty.com" }),
  ];
  const earned = (email) => badgesFor(email, rows, [], [], 0).filter((b) => b.earned).map((b) => b.id);
  assert.deepEqual(earned("ana@setty.com"), ["wall", "client3", "hattrick"]);
  assert.deepEqual(earned("bo@setty.com"), []);                       // 3 spotted, needs 5
  assert.ok(badgesFor("bo@setty.com", rows, [], [], 60).find((b) => b.id === "lap").earned);
  assert.ok(badgesFor("x", [], [], [], 0).every((b) => b.name && b.how && !b.earned));
});

test("champions lists finished quarters only, newest first", () => {
  assert.equal(quarterKey("2026-11-11"), "2026-Q4");
  const rows = [
    row({ recipients: ["Ana"], recipient_emails: ["ana@setty.com"], received_on: "2026-08-02", created_by: "bo@setty.com" }),
    row({ recipients: ["Bo"], recipient_emails: ["bo@setty.com"], received_on: "2026-05-02", created_by: "bo@setty.com" }),
    row({ recipients: ["Cy"], recipient_emails: ["cy@setty.com"], received_on: "2026-11-02", created_by: "bo@setty.com" }),
  ];
  const c = champions(rows, [], [], {}, "2026-11-11");
  assert.deepEqual(c.map((q) => [q.label, q.podium[0].name]), [["Q3 2026", "Ana"], ["Q2 2026", "Bo"]]);
});

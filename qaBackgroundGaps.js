/* qaBackgroundGaps.js — which other disciplines' drawings a QA review could
   not check against, read from its checklist results.

   A coordination review can only check MEPFP against architecture,
   structure, the life safety plan and the rest when those drawings are in the
   project folder. When they are not, the checklist rows say so in their notes
   ("No RCP on file.", "No structural set.", "Life safety plan not in hand.",
   "not checked against architecture"), scattered among dozens of rows, and a
   reader skimming the counts takes "not attempted" for "nothing to see". The
   QA Reviews tab puts what this returns at the top of the review card and of
   the checklist, so the missing sets are the first thing anyone reads.

   A row counts when its disposition is "not attempted" or "partial", its
   note names another discipline's drawings, and the note says they were
   missing, out of date, or needed and not had. The skill writes those notes
   starting "Missing background: <discipline>" or "Stale background: …";
   older reviews wrote them freely, and both are read.

   qaBackgroundGaps(checklistResults, coverage) returns, in a fixed order,
   [{ key, label, what, stale, items: [itemId…], notes: [note…] }].
   `stale` is true when every note for that discipline says out of date (the
   drawings are there but older than the set). `coverage` is the review's
   coverage line; a discipline it names as missing is listed even with no
   checklist row (items then empty).

   A plain script, not an ES module, so it is defined before page code runs:
   SettyPMS.html loads it with <script src="qaBackgroundGaps.js"></script>.
   Tests: qaBackgroundGaps.test.mjs. */
(function (root) {
  "use strict";

  // Disciplines, in the order the banner lists them. `what` is the reader's
  // hint of what to ask for.
  var DISCIPLINES = [
    { key: "arch", label: "Architectural", what: "plans, RCPs, elevations, sections, wall ratings",
      re: /architect|\bRCPs?\b|reflected ceiling|\bmillwork\b|door hardware|wall ratings?|\bA[- ]?sheets?\b/i },
    { key: "ls", label: "Life safety plan", what: "life safety / code plan with rated walls and egress",
      re: /life[- ]safety|code (plan|sheet)|egress plan/i },
    { key: "struct", label: "Structural", what: "framing and foundation plans",
      re: /structur|framing|foundation plan|\bS[- ]?sheets?\b/i },
    { key: "civil", label: "Civil / site", what: "civil and site utility plans",
      re: /\bcivil\b|site utilit|utility plan|site survey/i },
    { key: "specs", label: "Non-MEP specifications", what: "Divisions 08, 10, 11, 12, 14 (doors, hardware, equipment, elevators)",
      re: /\bdiv(ision)?s?\.?\s*0?(8|10|11|12|14)\b|hardware spec|elevator spec/i },
    { key: "other", label: "Other disciplines' backgrounds", what: "the other disciplines' current sets",
      re: /backgrounds?|other discipline|other side not on file|other side not in hand/i },
  ];

  // The note says the drawings were not had: missing, not on file, needed.
  var MISSING_RE = new RegExp([
    "missing background",
    "\\bno\\b[^.;]{0,60}",                         // "No RCP on file", "No structural set"
    "not (in hand|on file|in (the )?(folder|record|project|sharepoint)|available|provided|found|reachable|received)",
    "not (indexed|read|opened)\\b",               // "Architect backgrounds not indexed or read", "civil set not opened"
    "could not (be )?(found|find|open|read|obtain)",
    "\\bneeds?\\b[^.;]{0,60}",                      // "Needs RCP.", "needs architectural plan"
    "not (checked|compared|coordinated) (vs\\.?|against|to|with)",
    "without\\b",
    "\\bmissing\\b",
  ].join("|"), "i");
  var STALE_RE = /stale background|\bstale\b|out of date|outdated|older than (our|the|this)|superseded|predates/i;

  function qaBackgroundGaps(checklistResults, coverage) {
    var out = DISCIPLINES.map(function (d) {
      return { key: d.key, label: d.label, what: d.what, stale: true, items: [], notes: [], _any: false };
    });
    function take(note, itemId) {
      var text = String(note || "");
      if (!text) return;
      var stale = STALE_RE.test(text);
      if (!stale && !MISSING_RE.test(text)) return;
      var hit = false;
      DISCIPLINES.forEach(function (d, i) {
        // "other backgrounds" only when no named discipline matched.
        if (d.key === "other" && hit) return;
        if (!d.re.test(text)) return;
        hit = true;
        var g = out[i];
        g._any = true;
        if (!stale) g.stale = false;
        if (itemId && g.items.indexOf(itemId) < 0) { g.items.push(itemId); g.notes.push(text); }
      });
    }
    (Array.isArray(checklistResults) ? checklistResults : []).forEach(function (x) {
      if (!x || !x.itemId) return;
      if (x.disposition !== "not attempted" && x.disposition !== "partial") return;
      take(x.note, String(x.itemId));
    });
    // The coverage line names missing sets too ("no structural or architectural
    // backgrounds found"); split it so one clause cannot lend its "no" to another.
    String(coverage || "").split(/[.;\n]/).forEach(function (clause) { take(clause, null); });
    return out.filter(function (g) { return g._any; }).map(function (g) {
      return { key: g.key, label: g.label, what: g.what, stale: g.stale, items: g.items, notes: g.notes };
    });
  }

  root.qaBackgroundGaps = qaBackgroundGaps;
  if (typeof module !== "undefined" && module.exports) module.exports = { qaBackgroundGaps: qaBackgroundGaps };
})(typeof window !== "undefined" ? window : this);

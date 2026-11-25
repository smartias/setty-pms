/* greetingName.js — the first name for "Hi …," in every email the suite drafts.

   About a third of PMS contacts are stored last name first ("Rama, Monica";
   often with a space before the comma, "Bermudez , James"), and taking the
   first word greeted them by surname with a doubled comma ("Hi Rama,,").

   The rules:
     1. Comma parts that are credentials or suffixes ("John Smith, PE",
        "Kurt Bedore, Jr.", "P.E.", "AIA", "PhD") are not names: drop them.
     2. Two or more parts left means "Last, First": the given name is the
        second part. One part left is "First Last".
     3. Strip a leading title (Mr., Ms., Dr. …) and trailing punctuation, and
        take the first word.
     4. An email address is no name to greet (directories and SharePoint
        fall back to it when there is no display name): return "". In
        "Name <address>" form the address is dropped and the name used.

   Returns "" when there is no usable name; each caller picks its own fallback
   ("Hi,", "Hello,", "[Client Contact]").

   A plain script, not an ES module, so it is defined before any page code
   runs: SettyPMS.html (its JSX blocks), transmittal.html and Newsletter.html
   load it with <script src="greetingName.js"></script> and call
   greetingFirstName(name). Tests: greetingName.test.mjs. */
(function (root) {
  "use strict";
  var SUFFIX_RE = /^(jr|sr|ii|iii|iv|pe|p\.?e|ra|r\.?a|aia|leed( ap)?|pmp|esq|ph\.?d|mba|ncarb|cem|cxa|bcxa|cpd|ccm|fpe|se|s\.?e)\.?$/i;
  var TITLE_RE = /^(mr|mrs|ms|miss|mx|dr)\.?\s+/i;

  function greetingFirstName(name) {
    // "Monica Rama <monica@example.com>": keep the name, drop the address.
    var s = String(name == null ? "" : name).replace(/<[^>]*>/g, " ").trim();
    if (/@/.test(s)) return "";
    var parts = s.split(",")
      .map(function (x) { return x.trim(); })
      .filter(function (x) { return x && !SUFFIX_RE.test(x); });
    if (!parts.length) return "";
    var given = parts.length >= 2 ? parts[1] : parts[0];
    var words = given.replace(TITLE_RE, "").split(/\s+/);
    return (words[0] || "").replace(/[.,;:]+$/, "");
  }

  root.greetingFirstName = greetingFirstName;
})(typeof globalThis !== "undefined" ? globalThis : this);

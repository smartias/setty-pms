# Proposal clause-library edits (Admin Console)

These are the wording/tagging changes that live in the governed clause library
(`pms_proposal_clauses`), not in the code. Make them in the **Admin Console →
Clause Library**. They pair with the code changes shipped alongside this file
(discipline tokens, the new prime-only gate, owner-facing open items, and the
Additional-Services export warning).

Context: the clauses below rendered with hard-coded discipline wording, so an
Electrical-only proposal still read "MEP/FP" in several places. The PMS already
substitutes three reserved tokens from the project's discipline set. Use them
instead of literal text:

| token | Electrical-only renders | full MEP/FP renders |
|---|---|---|
| `{{DISCIPLINE_LIST}}` | electrical | mechanical, electrical, plumbing, and fire protection |
| `{{DISCIPLINE_ABBR}}` | E | M/E/P/FP |
| `{{DISCIPLINE_MEP}}` | E | MEP/FP |

Line items can also be tagged so they drop when they do not apply:
`data-discipline="mechanical plumbing"` (needs one of those on),
`data-discipline-not="lowVoltage"` (hidden when that is on), and, new,
`data-prime-only` (hidden when Setty is a subconsultant, not the prime).

---

## 1. Discipline tokens (fixes "it included MEP/FP even though I selected Electrical")

Replace the literal discipline wording in these clause bodies with the tokens.

- **`inc-design-support`**: "…regarding the mechanical, electrical, plumbing,
  and fire protection (MEP/FP) systems." → "…regarding the
  `{{DISCIPLINE_LIST}}` (`{{DISCIPLINE_MEP}}`) systems."
- **`inc-ca`** (Construction Administration Support): three spots read
  "M/E/P/FP": the CA assistance sentence, the Submittal Review sentence, and the
  Site Observations sentence. Change each "M/E/P/FP" → `{{DISCIPLINE_ABBR}}`.
- **`exc-bim-ca-modeling`**: "The MEP/FP model is delivered…" → "The
  `{{DISCIPLINE_MEP}}` model is delivered…".
- Sweep every remaining clause body for the literal strings `MEP/FP`,
  `M/E/P/FP`, and `mechanical, electrical, plumbing, and fire protection` and
  swap in the matching token. (The Word export now warns when a switched-off
  discipline is still named in the text, so anything missed gets flagged at
  export instead of shipping silently.)

## 2. Combine Included items 1 and 2 into one clause

`inc-design-support` (item 1) and `inc-predesign-visit` (item 2) read as one
idea. Merge them into a single clause so they render as one numbered item.
Recommended: keep `inc-predesign-visit` as the surviving key (it carries the
`VISIT_COUNT` param) and fold the design-support/decision-guidance sentence into
its body; retire `inc-design-support` (set status to `retired` so old drafts
that name it are flagged, not silently dropped).

## 3. Electrical testing exclusion (fixes "E system testing wouldn't include TAB / water flow / balancing")

In **`exc-menu`**, the testing line renders as
"E system testing (e.g., TAB, water flow, or system balancing)". TAB, water
flow, and balancing are mechanical/plumbing tests, not electrical. Split the
testing exclusions into discipline-tagged line items so each proposal shows only
what fits its scope, e.g.:

```html
<li data-discipline="electrical">Electrical testing services (load testing, circuit tracing, amp probing)</li>
<li data-discipline="mechanical plumbing">System testing, adjusting and balancing (TAB), water flow, and system balancing</li>
```

## 4. Hazmat exclusions only when Setty is the prime (fixes "don't include Haz mat exclusion if we're the sub")

The code now drops any clause tagged `params.primeOnly: true` and any line item
tagged `data-prime-only` whenever the project's **Prime** is not Setty. Tag the
hazmat items so they appear only on prime proposals:

- In **`exc-menu`**, tag the hazmat line item:
  `<li data-prime-only>Hazardous materials services (asbestos, USTs, hazmat investigations)</li>`
- The standalone "Determination of the presence, absence, extent, or location of
  asbestos or other hazardous materials…" exclusion (the paragraph that also
  says "Setty relies on the Owner's hazardous materials surveys…"): if it is its
  own clause, set `params.primeOnly: true` on it; if it is a line item inside a
  menu, tag that item `data-prime-only`.
- Same treatment for any other whole-project exclusion the prime carries, e.g.
  permit **applications**/expediting, if the firm wants those to be prime-only
  too. (Confirm before tagging; some owners expect the sub to carry them.)

## 5. Repetitive provisions b and c (fixes "provisions b and c seem repetitive")

Provision **`prov-owner-info`** (Owner-Provided Information) and
**`prov-predesign-limits`** (Pre-Design Site Observations) overlap on
"Setty relies on owner-provided information / is not responsible for concealed
conditions", and `prov-predesign-limits` also restates the predesign-visit
scope. Edit `prov-predesign-limits` down to the observation-limit terms only
(readily observable conditions, no demolition/invasive exploration, hidden
conditions may require additional services) and delete the reliance sentence
that duplicates `prov-owner-info`. Keep the reliance language in
`prov-owner-info` only.

## 6. Scope vs. provisions split (fixes "scope in the scope section, the rest in provisions")

This is mostly enforced now by the generator prompts (they tell the model to put
"what Setty will do" in the scope sections and reliance/terms language in the
provision clauses). No library change is strictly required, but while editing
the clauses above, make sure reliance wording ("Setty is entitled to rely on
Owner-provided record documents", "may rely on existing drawings") lives in the
`prov-*` provisions, not repeated inside `inc-*` scope clauses.

---

### Not a library edit: the standalone skill

The manual drafting path (`proposal-draft` skill run from a PM's own Claude
seat) is a third generator surface maintained outside this repo. Apply the same
rule updates there (entity naming, discipline-only language including no TAB on
an electrical scope, prime-only exclusions, owner-facing `openItems`,
scope-vs-provisions) so all three surfaces stay in sync.

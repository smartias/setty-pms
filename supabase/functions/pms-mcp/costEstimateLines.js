// costEstimateLines.js — the line-by-line detail of a reviewed cost estimate
// (table pms_cost_estimate_lines, tools save_cost_estimate_lines and
// get_cost_estimate_lines).
//
// The review summary (project.costEstimateReviews, constructionCost.js) holds
// totals. This holds every line. For a workbook the lines are read from the
// file HERE, cell by cell, from a layout the reviewer describes (which sheet,
// which row the headings are on, which column is which): no number passes
// through the model, so none can be mistyped. For a PDF the reviewer supplies
// the lines and they are stored marked 'transcribed'.
//
// Pure: no fetch, no workbook library. The caller hands in each sheet as an
// array of rows (arrays of cell values).

export const LINE_DISCIPLINES = ["mechanical", "electrical", "plumbing", "fireProtection", "technology"];
export const LINES_MAX = 20000;
export const COLUMN_KEYS = ["description", "amount", "quantity", "unit", "unitCost", "code"];

const text = (v, max) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

// A cell as a number: 1234.5, "$1,234.50", "(500)" = -500, "12%" is not money.
export function cellNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let t = String(v == null ? "" : v).trim();
  if (!t || /%$/.test(t)) return null;
  const neg = /^\(.*\)$/.test(t) || /^-/.test(t);
  t = t.replace(/[$,\s()]/g, "").replace(/^-/, "");
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(t)) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

// "A" -> 0, "AB" -> 27.
function letterIndex(s) {
  let n = 0;
  for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// A column given as a letter ("F"), a 1-based number, or the heading text on
// headerRow ("Total Cost", matched ignoring case; exact first, then contains).
// Returns the 0-based index, or null.
export function resolveColumn(ref, headerCells) {
  if (ref === undefined || ref === null || ref === "") return null;
  if (typeof ref === "number") return Number.isInteger(ref) && ref >= 1 ? ref - 1 : null;
  const s = String(ref).trim();
  if (/^[A-Za-z]{1,2}$/.test(s)) return letterIndex(s);
  if (/^\d+$/.test(s)) return parseInt(s, 10) - 1;
  const want = s.toLowerCase();
  const heads = (Array.isArray(headerCells) ? headerCells : []).map((h) => text(h, 200).toLowerCase());
  let i = heads.indexOf(want);
  if (i < 0) i = heads.findIndex((h) => h && h.includes(want));
  return i >= 0 ? i : null;
}

// The discipline a heading, CSI code or sheet name points to. Deliberately
// NOT run on a line's description: "electrical connection to AHU-1" is a
// mechanical line.
export function disciplineFromText(...parts) {
  const t = parts.map((p) => text(p, 300).toLowerCase()).filter(Boolean).join(" | ");
  if (!t) return null;
  const div = t.match(/(?:^|[^\d.])(?:div(?:ision)?\.?\s*)?(2[1-8])(?:\s*[-–:.]|\s+\d{2}\s+\d{2}|\s*00\s*00|\s|$)/);
  const byDiv = { 21: "fireProtection", 22: "plumbing", 23: "mechanical", 25: "mechanical", 26: "electrical", 27: "technology", 28: "technology" };
  if (div && byDiv[div[1]]) return byDiv[div[1]];
  if (/fire\s*(protection|suppression|sprinkler)|sprinkler/.test(t)) return "fireProtection";
  if (/plumb/.test(t)) return "plumbing";
  if (/hvac|mechanical|heating|ventilat|air\s*condition|building automation|\bbms\b|\bbas\b|controls/.test(t)) return "mechanical";
  if (/fire\s*alarm|communicat|telecom|low\s*voltage|security|audio|technology|\bav\b/.test(t)) return "technology";
  if (/electric|lighting|power/.test(t)) return "electrical";
  return null;
}

const SUBTOTAL = /\b(sub\s*-?\s*total|total|sum)\b/i;

// One sheet's lines.
//   rows  the sheet as arrays of cell values, row 1 first
//   spec  { sheet, headerRow, firstRow, lastRow, columns: { description, amount, quantity, unit, unitCost, code },
//           discipline, sections: [{ match, discipline }] }
//         headerRow/firstRow/lastRow are 1-based sheet rows. firstRow defaults
//         to the row after headerRow. columns.description and columns.amount
//         are required.
// A row with a description and no amount, quantity or unit cost is a section
// heading: it is not stored, it names the section of the lines under it. A row
// whose description reads as a total is stored with isSubtotal, so sums can
// leave it out.
// Returns { lines, warnings } or { error }.
export function extractSheetLines(rows, spec) {
  const sp = spec || {};
  const all = Array.isArray(rows) ? rows : [];
  const headerRow = Number.isInteger(sp.headerRow) && sp.headerRow >= 1 ? sp.headerRow : null;
  const headerCells = headerRow ? all[headerRow - 1] || [] : [];
  const cols = {};
  for (const k of COLUMN_KEYS) cols[k] = resolveColumn(sp.columns ? sp.columns[k] : null, headerCells);
  const named = (k) => sp.columns && sp.columns[k] !== undefined && sp.columns[k] !== null && sp.columns[k] !== "";
  for (const k of COLUMN_KEYS) {
    if (named(k) && cols[k] === null) {
      return { error: `Sheet "${sp.sheet}": no column "${sp.columns[k]}" for ${k}` + (headerRow ? ` on heading row ${headerRow}. Headings there: ${headerCells.map((h) => text(h, 40)).filter(Boolean).join(" | ") || "(empty row)"}.` : ". Give headerRow, or name the column by letter.") };
    }
  }
  if (cols.description === null || cols.amount === null) return { error: `Sheet "${sp.sheet}": columns.description and columns.amount are required.` };
  const first = Number.isInteger(sp.firstRow) && sp.firstRow >= 1 ? sp.firstRow : (headerRow ? headerRow + 1 : 1);
  const last = Number.isInteger(sp.lastRow) && sp.lastRow >= first ? Math.min(sp.lastRow, all.length) : all.length;
  const sheetDiscipline = LINE_DISCIPLINES.includes(sp.discipline) ? sp.discipline : null;
  const sectionRules = (Array.isArray(sp.sections) ? sp.sections : [])
    .filter((r) => r && r.match && LINE_DISCIPLINES.includes(r.discipline))
    .map((r) => ({ match: String(r.match).toLowerCase(), discipline: r.discipline }));
  const forSection = (section) => {
    const s = String(section || "").toLowerCase();
    const rule = s ? sectionRules.find((r) => s.includes(r.match)) : null;
    return rule ? rule.discipline : null;
  };

  const lines = [];
  const warnings = [];
  let section = null, sectionDiscipline = null, textAmounts = 0;
  for (let r = first; r <= last; r++) {
    const row = all[r - 1] || [];
    const description = text(row[cols.description], 500);
    const rawAmount = row[cols.amount];
    const amount = cellNumber(rawAmount);
    const quantity = cols.quantity !== null ? cellNumber(row[cols.quantity]) : null;
    const unitCost = cols.unitCost !== null ? cellNumber(row[cols.unitCost]) : null;
    const code = cols.code !== null ? text(row[cols.code], 60) : "";
    if (!description && amount === null) continue;
    if (amount === null && text(rawAmount, 40) && description) textAmounts++;
    if (description && amount === null && quantity === null && unitCost === null) {
      section = [code, description].filter(Boolean).join(" ").slice(0, 300);
      sectionDiscipline = forSection(section) || disciplineFromText(section);
      continue;
    }
    lines.push({
      sheet: text(sp.sheet, 120) || null,
      rowRef: (text(sp.sheet, 120) || "sheet") + "!R" + r,
      section,
      code: code || null,
      discipline: forSection(section) || sheetDiscipline || sectionDiscipline || disciplineFromText(code) || null,
      description: description || "(no description)",
      quantity,
      unit: cols.unit !== null ? text(row[cols.unit], 30) || null : null,
      unitCost,
      amount,
      isSubtotal: SUBTOTAL.test(description),
    });
  }
  if (!lines.length) warnings.push(`Sheet "${sp.sheet}": no lines found in rows ${first} to ${last}. Check headerRow, firstRow and the columns.`);
  if (textAmounts) warnings.push(`Sheet "${sp.sheet}": ${textAmounts} row(s) have text in the amount column that is not a number; they were stored with no amount.`);
  return { lines, warnings };
}

// Lines the reviewer typed out (a PDF estimate). Same shape as extracted lines.
export function normalizeSuppliedLines(input) {
  const out = [];
  for (const l of Array.isArray(input) ? input : []) {
    const description = text(l && l.description, 500);
    if (!description) continue;
    const amount = l.amount === undefined || l.amount === null ? null : cellNumber(l.amount);
    out.push({
      sheet: text(l.sheet, 120) || null,
      rowRef: text(l.page, 40) ? "p." + text(l.page, 40) : null,
      section: text(l.section, 300) || null,
      code: text(l.code, 60) || null,
      discipline: LINE_DISCIPLINES.includes(l.discipline) ? l.discipline : disciplineFromText(l.section, l.code),
      description,
      quantity: l.quantity === undefined || l.quantity === null ? null : cellNumber(l.quantity),
      unit: text(l.unit, 30) || null,
      unitCost: l.unitCost === undefined || l.unitCost === null ? null : cellNumber(l.unitCost),
      amount,
      isSubtotal: l.isSubtotal === true || SUBTOTAL.test(description),
    });
  }
  return out;
}

// ── Checking typed lines against the PDF's own text ──────────────────────────
// Most estimates arrive as PDFs, so their lines are typed out by the reviewer.
// A typed number can be wrong. The connector extracts the PDF's text and looks
// for each line's amount in it, the way the estimate would print it. Found:
// verified. Not found: flagged for a person to check. A PDF with no text layer
// (a scan) cannot be checked, and its lines are left unmarked.

// The ways an amount is printed: 1234567 / 1,234,567 / with .00 / with cents.
export function amountForms(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return [];
  const abs = Math.abs(n);
  const cents = Math.round(abs * 100);
  const whole = Math.floor(cents / 100), frac = String(cents % 100).padStart(2, "0");
  const plain = String(whole), commas = plain.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const forms = new Set([plain + "." + frac, commas + "." + frac]);
  if (frac === "00") { forms.add(plain); forms.add(commas); }
  return [...forms];
}

// Is the amount printed in this text, as a whole number (not inside a longer one)?
export function amountAppears(amount, haystack) {
  const t = String(haystack || "");
  if (!t) return false;
  return amountForms(amount).some((f) => {
    let from = 0;
    for (;;) {
      const i = t.indexOf(f, from);
      if (i < 0) return false;
      const before = t[i - 1] || " ", after = t[i + f.length] || " ", after2 = t[i + f.length + 1] || " ";
      const cutsNumber = /[\d]/.test(before) || (before === "," && /\d/.test(t[i - 2] || "")) || (before === "." && /\d/.test(t[i - 2] || "")) ||
        /\d/.test(after) || ((after === "," || after === ".") && /\d/.test(after2));
      if (!cutsNumber) return true;
      from = i + 1;
    }
  });
}

// pages: { [pageNumber]: text }. Marks each line `verified`: true when its
// amount is printed on the page it cites or anywhere in the document, false
// when it is printed nowhere, null when it has no amount or the document has
// no readable text. Returns { checked, verified, notFound: [...], readable }.
export function verifyLinesAgainstPages(lines, pages) {
  const texts = pages && typeof pages === "object" ? pages : {};
  const all = Object.values(texts).join("\n");
  const readable = all.replace(/\s/g, "").length > 200;
  const notFound = [];
  let checked = 0, verified = 0;
  for (const l of Array.isArray(lines) ? lines : []) {
    if (!readable || l.amount === null || l.amount === undefined) { l.verified = null; continue; }
    checked++;
    const m = /^p\.(\d+)/.exec(String(l.rowRef || ""));
    const ok = (m && amountAppears(l.amount, texts[+m[1]])) || amountAppears(l.amount, all);
    l.verified = !!ok;
    if (ok) verified++; else if (notFound.length < 40) notFound.push({ description: l.description, amount: l.amount, page: m ? +m[1] : undefined });
  }
  return { readable, checked, verified, notFoundCount: checked - verified, notFound };
}

// What was stored, so it can be checked against the review's totals: the sum
// of the lines that are not subtotals, per discipline and unassigned.
export function summarizeLines(lines) {
  const list = Array.isArray(lines) ? lines : [];
  const byDiscipline = {};
  let unassigned = 0, total = 0, subtotalRows = 0, noAmount = 0;
  for (const l of list) {
    if (l.isSubtotal) { subtotalRows++; continue; }
    if (l.amount === null || l.amount === undefined) { noAmount++; continue; }
    total += l.amount;
    if (l.discipline) byDiscipline[l.discipline] = (byDiscipline[l.discipline] || 0) + l.amount;
    else unassigned += l.amount;
  }
  const round = (n) => Math.round(n * 100) / 100;
  for (const k of Object.keys(byDiscipline)) byDiscipline[k] = round(byDiscipline[k]);
  return { lines: list.length, subtotalRows, linesWithoutAmount: noAmount, sumOfLines: round(total), sumByDiscipline: byDiscipline, sumUnassigned: round(unassigned) };
}

// Compare the stored lines' sums with the review's discipline amounts. A gap
// is expected when the review's amounts include markups the lines do not, or
// when lines carry no discipline; it is reported, never corrected.
export function checkAgainstReview(summary, review) {
  const out = [];
  for (const d of (review && Array.isArray(review.disciplines) ? review.disciplines : [])) {
    const lines = summary.sumByDiscipline[d.discipline];
    if (lines === undefined) { out.push({ discipline: d.discipline, review: d.amount, lines: null, note: "No stored line carries this discipline." }); continue; }
    const diffPct = d.amount > 0 ? Math.round(((lines - d.amount) / d.amount) * 1000) / 10 : null;
    out.push({ discipline: d.discipline, review: d.amount, lines, diffPct, ...(diffPct !== null && Math.abs(diffPct) > 2 ? { note: "The lines do not add up to the review's amount: markups, a subtotal counted as a line, or lines without a discipline." } : {}) });
  }
  return out;
}

// Database rows for one review.
export function toRows(lines, ctx) {
  const c = ctx || {};
  return (Array.isArray(lines) ? lines : []).slice(0, LINES_MAX).map((l, i) => ({
    project: c.project, review_id: c.reviewId, document_name: c.documentName || null, item_id: c.itemId || null,
    line_no: (c.startAt || 0) + i + 1,
    sheet: l.sheet, row_ref: l.rowRef, section: l.section, code: l.code, discipline: l.discipline,
    description: l.description, quantity: l.quantity, unit: l.unit, unit_cost: l.unitCost, amount: l.amount,
    is_subtotal: !!l.isSubtotal, source: c.source === "workbook" ? "workbook" : "transcribed",
    // Read from the cells: nothing to verify. Typed: what the check against the PDF found.
    verified: c.source === "workbook" ? true : (l.verified === true || l.verified === false ? l.verified : null),
    created_by: c.by || null,
  }));
}

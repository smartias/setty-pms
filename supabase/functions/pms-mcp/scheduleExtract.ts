// Schedule extraction for read_drawing_schedule: rebuilds the tables on a
// drawing page from the positions of its text runs. Pure (no I/O), so the
// tests import it directly.
//
// Three things a real sheet does that a naive reader gets wrong, each found on
// Tabler's 100% CD set (2026-11-16) where the reader returned nothing or
// garbage for M601, M602, P601 and every panel schedule:
//   - The page is stored rotated. A sheet plotted landscape is often a
//     portrait page with /Rotate 90, and its text runs carry that rotation in
//     their transform. Their raw x/y then run along the wrong axes, so "lines"
//     are columns. orientSheetItems turns the page upright first.
//   - Schedules sit side by side. Two panel schedules, or a grid of equipment
//     schedules, share the same rows of the page; a schedule's rows must stop
//     at the schedule to its right, and it ends at the next title BELOW IT,
//     not at the next title anywhere on the page.
//   - A panel schedule is not titled "... SCHEDULE". It is "Branch Panel:
//     RP1A" or "PANELBOARD: LP-2", followed by lines of ratings, then the
//     circuit table.

export const SCHEDULE_TITLE_RE = /\bSCHEDULES?\b/i;
// "Branch Panel: RP1A", "PANELBOARD: PXXXX", "Switchboard: MSB", "Distribution Panel: DP1A".
// The colon is required: "PANEL TOTALS" and "PANEL DP2B" in a notes list are not titles.
export const PANEL_TITLE_RE = /^\s*(?:(?:branch|distribution|power|lighting|emergency)\s+)?(?:panel(?:board)?|switchboard|switchgear|load\s*center|motor\s+control\s+center|mcc)\s*:\s*\S/i;
const SCHED_LINE_TOL = 3;      // pt of y-drift that still reads as one row
const SCHED_COL_TOL = 6;       // pt of x-drift that still reads as one column
const SCHED_GAP_LINES = 3;     // sparse lines that end the table
const SCHED_MAX_ROWS = 250;    // per schedule
const SCHED_HEADER_SEARCH = 6;        // lines below a schedule title to look for its header
const SCHED_PANEL_HEADER_SEARCH = 16; // a panel's ratings block sits between title and circuit table
const SCHED_SIDE_MARGIN = 20;  // pt kept clear of the schedule to the right
const SCHED_SPAN_LINES = 14;   // lines below a title used to find how wide its table is
const SCHED_GUTTER = 22;       // pt of clear paper that separates two tables side by side
const SCHED_INNER_GAP = 140;   // pt: the widest gap that can still be inside one table
const SCHED_RIVER_MIN = 2.5;   // pt of clear paper down the rows that separates two columns

// `w` is the run's printed width (pdf.js gives it). With widths the reader can
// see where a table's text actually sits; without them (older callers, simple
// fixtures) it falls back to start positions alone.
export type SheetTextItem = { str: string; x: number; y: number; w?: number };
export type SheetTable = { title: string; columns: number; rows: string[][]; truncatedRows: number; details?: string[]; notes?: string[] };

/**
 * Turn a page's text runs upright. `runs` are pdf.js text items: a string and
 * the 6-number transform whose a,b give the run's direction and e,f its origin.
 * The dominant direction (to the nearest quarter turn) is taken as "reading
 * left to right"; runs in any other direction (a vertical title-block stamp, a
 * rotated note) are dropped, because on the upright page they would land on
 * other rows. Returns coordinates where x grows along the text and y grows up
 * the page, which is what the rest of this module assumes.
 */
export function orientSheetItems(runs: Array<{ str?: unknown; transform?: unknown }>): SheetTextItem[] {
  const parsed: Array<{ str: string; e: number; f: number; q: number; w: number }> = [];
  for (const r of runs || []) {
    const str = String(r?.str ?? "").replace(/\u0000/g, " ").trim();
    if (!str) continue;
    const t = Array.isArray(r?.transform) ? (r!.transform as unknown[]).map(Number) : [];
    const a = Number.isFinite(t[0]) ? t[0] : 1, b = Number.isFinite(t[1]) ? t[1] : 0;
    // Quarter turn of the run's direction: 0 = left-to-right, 1 = bottom-to-top, ...
    const q = ((Math.round(Math.atan2(b, a) / (Math.PI / 2)) % 4) + 4) % 4;
    const w = Number((r as any)?.width);
    parsed.push({ str, e: Number(t[4]) || 0, f: Number(t[5]) || 0, q, w: Number.isFinite(w) && w > 0 ? w : str.length * 5 });
  }
  if (!parsed.length) return [];
  const votes = [0, 0, 0, 0];
  for (const p of parsed) votes[p.q] += p.str.length;
  const dom = votes.indexOf(Math.max(...votes));
  // Rotate by -dom quarter turns: the run direction becomes +x, its "up" becomes +y.
  const rot = (e: number, f: number): [number, number] =>
    dom === 0 ? [e, f] : dom === 1 ? [f, -e] : dom === 2 ? [-e, -f] : [-f, e];
  return parsed.filter((p) => p.q === dom).map((p) => { const [x, y] = rot(p.e, p.f); return { str: p.str, x, y, w: p.w }; });
}

export function clusterSheetLines(items: SheetTextItem[]): Array<{ y: number; cells: SheetTextItem[] }> {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Array<{ y: number; cells: SheetTextItem[] }> = [];
  for (const it of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line.y - it.y) <= SCHED_LINE_TOL) line.cells.push(it);
    else lines.push({ y: it.y, cells: [it] });
  }
  for (const l of lines) l.cells.sort((a, b) => a.x - b.x);
  return lines;
}

type TitleHit = { line: number; x: number; mid: number; title: string; panel: boolean };
const widthOf = (c: SheetTextItem) => (c.w !== undefined && c.w > 0 ? c.w : c.str.length * 5);

/** Every schedule or panel title on the page, as the cell it starts at. */
function findScheduleTitles(lines: Array<{ y: number; cells: SheetTextItem[] }>): TitleHit[] {
  const hits: TitleHit[] = [];
  lines.forEach((l, i) => {
    for (const c of l.cells) {
      if (c.str.length > 120) continue;
      const panel = PANEL_TITLE_RE.test(c.str);
      if (!panel && !SCHEDULE_TITLE_RE.test(c.str)) continue;
      hits.push({ line: i, x: c.x, mid: c.x + widthOf(c) / 2, title: c.str.trim(), panel });
    }
  });
  return hits;
}

const TAG_HEADING_RE = /^(unit\s+)?(tag|mark|symbol|designation|unit\s*(no\.?|id|#)?|equip(ment)?\.?\s*(tag|no\.?|id)?|item)$/i;
const PANEL_HEADER_CELL_RE = /^(ckt|cir(cuit)?\.?\s*(no\.?|#)?)\.?$/i;

/**
 * Where a title's table sits across the page. A schedule title is usually
 * CENTRED over its table, so the table starts well to the left of the title;
 * and the next table over starts after a gutter of clear paper. Lay the text
 * of the lines under the title along x, merge what is closer than a gutter,
 * and take the stretch under the title.
 */
function tableSpan(lines: Array<{ y: number; cells: SheetTextItem[] }>, t: TitleHit, titles: TitleHit[], gutter = SCHED_GUTTER): [number, number] | null {
  const iv: Array<[number, number]> = [];
  for (let i = t.line + 1; i < lines.length && i - t.line <= SCHED_SPAN_LINES; i++) {
    for (const c of lines[i].cells) {
      // Another title is not part of this table's body, whichever table it heads.
      if (titles.some((o) => o.line === i && o.x === c.x)) continue;
      iv.push([c.x, c.x + widthOf(c)]);
    }
  }
  if (!iv.length) return null;
  iv.sort((a, b) => a[0] - b[0]);
  const spans: Array<[number, number]> = [];
  for (const [a, b] of iv) {
    const last = spans[spans.length - 1];
    if (last && a - last[1] <= gutter) last[1] = Math.max(last[1], b);
    else spans.push([a, b]);
  }
  // The stretch under the title's middle; failing that (a title printed off to
  // one side), the one that starts nearest the title.
  let k = spans.findIndex(([a, b]) => t.mid >= a - 4 && t.mid <= b + 4);
  if (k < 0) k = spans.findIndex(([a, b]) => t.x >= a - 4 && t.x <= b + 4);
  if (k < 0) k = spans.indexOf([...spans].sort((p, q) => Math.abs(p[0] - t.x) - Math.abs(q[0] - t.x))[0]);
  // A table with a wide, lightly filled column (REMARKS, a description) has a
  // gap inside it wider than a gutter, so its text is several stretches. A
  // neighbouring stretch belongs to this table when it is close and no other
  // title sits over it; a stretch under another title is that title's table.
  // (Any title on the page counts, however far down: wrongly refusing a merge
  // only narrows a table, wrongly merging splices two tables together.)
  const claimed = (sp: [number, number]) => titles.some((o) => o !== t && o.mid >= sp[0] - 4 && o.mid <= sp[1] + 4);
  let lo = k, hi = k;
  while (lo > 0 && spans[lo][0] - spans[lo - 1][1] <= SCHED_INNER_GAP && !claimed(spans[lo - 1])) lo--;
  while (hi + 1 < spans.length && spans[hi + 1][0] - spans[hi][1] <= SCHED_INNER_GAP && !claimed(spans[hi + 1])) hi++;
  return [spans[lo][0], spans[hi][1]];
}

/** Columns from start positions that recur down the rows (no widths known). */
function columnsByStart(blockLines: SheetTextItem[][]): { bounds: number[]; place: (c: SheetTextItem) => number } | null {
  const clusters: Array<{ sum: number; n: number; lines: Set<number> }> = [];
  blockLines.forEach((cells, li) => {
    for (const c of cells) {
      const hit = clusters.find((cl) => Math.abs(cl.sum / cl.n - c.x) <= SCHED_COL_TOL);
      if (hit) { hit.sum += c.x; hit.n++; hit.lines.add(li); }
      else clusters.push({ sum: c.x, n: 1, lines: new Set([li]) });
    }
  });
  const minLines = Math.max(2, Math.ceil(blockLines.length * 0.3));
  const bounds = clusters.filter((cl) => cl.lines.size >= minLines).map((cl) => cl.sum / cl.n).sort((a, b) => a - b);
  if (bounds.length < 2) return null;
  return {
    bounds,
    place: (c) => { let k = 0; while (k + 1 < bounds.length && bounds[k + 1] <= c.x + SCHED_COL_TOL) k++; return k; },
  };
}

/**
 * Columns from the clear paper between them. Lay every row's text along x and
 * count, at each point, how many rows have ink there; a column is a stretch
 * most rows cover, and columns are separated by "rivers" almost no row
 * crosses. Unlike start positions this reads right-aligned numbers (whose
 * starts wander) and centred text. A heading that spans several columns
 * ("ELECTRICAL DATA") crosses rivers on its one line, which the "almost no
 * row" allowance absorbs; it is then placed in the column under its middle.
 */
function columnsByRivers(blockLines: SheetTextItem[][], xMin: number, xMax: number): { bounds: number[]; place: (c: SheetTextItem) => number } | null {
  const lo = Math.floor(xMin), n = Math.max(1, Math.ceil(xMax) - lo + 1);
  const cov = new Uint16Array(n);
  for (const cells of blockLines) {
    const seen = new Uint8Array(n);
    for (const c of cells) {
      const a = Math.max(0, Math.floor(c.x) - lo), b = Math.min(n - 1, Math.ceil(c.x + widthOf(c)) - lo);
      for (let k = a; k <= b; k++) seen[k] = 1;
    }
    for (let k = 0; k < n; k++) cov[k] += seen[k];
  }
  const allow = Math.max(1, Math.floor(blockLines.length * 0.12));
  const cols: Array<[number, number]> = [];
  let start = -1, river = 0;
  for (let k = 0; k <= n; k++) {
    const ink = k < n && cov[k] > allow;
    if (ink) { if (start < 0) start = k; river = 0; continue; }
    if (start < 0) continue;
    river++;
    if (river >= SCHED_RIVER_MIN || k === n) { cols.push([start + lo, k - river + lo]); start = -1; river = 0; }
  }
  if (cols.length < 2) return null;
  const mids = cols.map(([a, b]) => (a + b) / 2);
  return {
    bounds: cols.map(([a]) => a),
    place: (c) => {
      const m = c.x + widthOf(c) / 2;
      const inside = cols.findIndex(([a, b]) => m >= a - 1 && m <= b + 1);
      if (inside >= 0) return inside;
      let best = 0;
      for (let k = 1; k < mids.length; k++) if (Math.abs(mids[k] - m) < Math.abs(mids[best] - m)) best = k;
      return best;
    },
  };
}

export function extractSheetTables(items: SheetTextItem[], matchFilter?: string): SheetTable[] {
  const lines = clusterSheetLines(items);
  const titles = findScheduleTitles(lines);
  const haveWidths = items.some((c) => c.w !== undefined);
  const tables: SheetTable[] = [];
  const want = matchFilter?.trim().toLowerCase();
  for (const t of titles) {
    if (want && !t.title.toLowerCase().includes(want)) continue;
    const search = t.panel ? SCHED_PANEL_HEADER_SEARCH : SCHED_HEADER_SEARCH;

    // Horizontal extent of this title's table.
    let xMin: number, xMax: number;
    if (haveWidths && t.panel) {
      // Panel schedules are laid out in a row across the sheet at a fixed
      // pitch, each with its title a little inside its left edge. Their
      // ratings block and wide description columns leave gaps bigger than
      // any gutter, so the neighbours' titles mark the edges instead.
      const row = titles.filter((o) => o.panel && Math.abs(o.line - t.line) <= 2).sort((a, b) => a.x - b.x);
      const at = row.indexOf(t);
      let pitch = Infinity;
      for (let k = 1; k < row.length; k++) pitch = Math.min(pitch, row[k].x - row[k - 1].x);
      xMin = t.x - 80;
      if (at >= 0 && at + 1 < row.length) xMax = row[at + 1].x - 80;
      else if (Number.isFinite(pitch)) xMax = xMin + pitch;
      else { const span = tableSpan(lines, t, titles, 90); if (!span) continue; xMax = span[1] + 2; }
    } else if (haveWidths) {
      const span = tableSpan(lines, t, titles);
      if (!span) continue;
      xMin = span[0] - 2; xMax = span[1] + 2;
    } else {
      // No widths: the title's own start, to the nearest neighbouring title.
      let xLimit = Infinity;
      for (const o of titles) {
        if (o === t || o.x <= t.x + 40) continue;
        if (Math.abs(o.line - t.line) <= search) xLimit = Math.min(xLimit, o.x - SCHED_SIDE_MARGIN);
      }
      xMin = t.x - 60; xMax = xLimit;
    }
    const inSpan = (c: SheetTextItem) => c.x >= xMin && c.x <= xMax;

    // Header = the first line below the title with 3+ cells in the table (for a
    // panel: the line that starts the circuit table, which carries "CKT").
    let hIdx = -1;
    for (let i = t.line + 1; i < lines.length && i - t.line <= search; i++) {
      const cand = lines[i].cells.filter(inSpan);
      if (t.panel ? cand.some((c) => PANEL_HEADER_CELL_RE.test(c.str.trim())) : cand.length >= 3) { hIdx = i; break; }
    }
    if (hIdx < 0) continue;
    // The tag column can be cut off: tags are short, so the gap after them is
    // wider than the gutter to the table on the left, and the column is taken
    // for that table's. Its heading gives it away: a "UNIT TAG" / "MARK" /
    // "SYMBOL" heading just left of the table, on its header lines, is this
    // table's first column.
    if (haveWidths && !t.panel) {
      let reach = xMin;
      for (let i = Math.max(t.line + 1, hIdx - 1); i < lines.length && i <= hIdx + 4; i++) {
        for (const c of lines[i].cells) {
          const right = c.x + widthOf(c);
          if (right > xMin + 2 || xMin - right > SCHED_INNER_GAP) continue;
          if (TAG_HEADING_RE.test(c.str.trim()) && !titles.some((o) => o.line === i && o.x === c.x)) reach = Math.min(reach, c.x - 2);
        }
      }
      xMin = reach;
    }
    if (!haveWidths) {
      const head = lines[hIdx].cells.filter(inSpan);
      xMin = head[0].x - SCHED_SIDE_MARGIN;
      xMax = Math.min(head[head.length - 1].x + 400, xMax);
    }

    // The table ends at the next title below it that sits inside its width.
    let end = lines.length;
    for (const o of titles) {
      if (o.line > hIdx && o.mid >= xMin && o.x <= xMax) end = Math.min(end, o.line);
    }

    const blockLines: SheetTextItem[][] = [];
    let gap = 0;
    for (let i = hIdx; i < end; i++) {
      const cells = lines[i].cells.filter(inSpan);
      if (cells.length >= 2) { blockLines.push(cells); gap = 0; }
      else if (blockLines.length && ++gap >= SCHED_GAP_LINES) break;
    }
    if (blockLines.length < 2) continue;

    // Notes printed under a schedule ("1. PROVIDE ...") are one or two long
    // runs per line. Left in, they cross every column and hide the gaps
    // between them. The table's rows end at the last line that is as full as
    // a row of the table; what follows is returned as notes.
    const notes: string[] = [];
    if (haveWidths) {
      const most = Math.max(...blockLines.map((c) => c.length));
      const dense = Math.max(3, Math.ceil(most * 0.4));
      let lastDense = -1;
      blockLines.forEach((c, i) => { if (c.length >= dense) lastDense = i; });
      if (lastDense >= 1 && lastDense < blockLines.length - 1) {
        for (const c of blockLines.splice(lastDense + 1)) {
          const text = c.map((x) => x.str).join(" ").replace(/\s+/g, " ").trim();
          if (text && notes.length < 20) notes.push(text);
        }
      }
    }

    const cols = (haveWidths ? columnsByRivers(blockLines, xMin, xMax) : null) ?? columnsByStart(blockLines);
    if (!cols) continue;
    const rows = blockLines.map((cells) => {
      const row = new Array<string>(cols.bounds.length).fill("");
      for (const c of cells) {
        const k = cols.place(c);
        row[k] = row[k] ? row[k] + " " + c.str : c.str;
      }
      return row;
    });

    // What sits between the title and the header: a panel's ratings (supply,
    // mains, bus, AIC, voltage), or a schedule's subtitle. Returned as printed,
    // one string per line, so "Mains Rating: 400 A" is not lost.
    const details: string[] = [];
    for (let i = t.line + 1; i < hIdx; i++) {
      const cells = lines[i].cells.filter(inSpan);
      if (cells.length) details.push(cells.map((c) => c.str).join(" ").replace(/\s+/g, " ").trim());
    }

    tables.push({
      title: t.title, columns: cols.bounds.length,
      rows: rows.slice(0, SCHED_MAX_ROWS),
      truncatedRows: Math.max(0, rows.length - SCHED_MAX_ROWS),
      ...(details.length ? { details: details.slice(0, 20) } : {}),
      ...(notes.length ? { notes } : {}),
    });
  }
  return tables;
}

// The Accolade-O-Meter block in the Monday digest: what happened on the wall
// last week, for EVERYONE who gets the digest, not only the people named
// (those also get their own "Kudos" block). The point is participation: most
// staff have never logged an accolade or played, and nothing else reaches them.
//
// Pure: no fetch, no Deno. runDigest gathers the rows; wallDigest.test.mjs
// (repo root) checks the choices and the HTML.

export type WallRow = {
  id: number;
  quote: string;
  kind?: string;
  recipients?: string[];
  recipient_emails?: string[];
  from_name?: string | null;
  from_company?: string | null;
  created_by_name?: string | null;
  created_at?: string;
};

export type Wall = {
  rows: WallRow[];                  // accolades put on the wall in the last 7 days
  cheers: Record<string, number>;   // accolade id -> gifts sent
  players: number;                  // distinct people who played the daily guess in the last 7 days
  loggers: Set<string>;             // lower-cased emails of everyone who has ever logged one by hand
};

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const lc = (s: unknown) => String(s || "").trim().toLowerCase();

// The accolade to show: the most-cheered of the week, newest on a tie. One that
// names the reader is skipped when there is another, since their own Kudos block
// already quotes it.
export function pickFeatured(rows: WallRow[], cheers: Record<string, number>, email: string): WallRow | null {
  if (!rows.length) return null;
  const me = lc(email);
  const namesMe = (r: WallRow) => (r.recipient_emails || []).some((e) => lc(e) === me);
  const pool = rows.some((r) => !namesMe(r)) ? rows.filter((r) => !namesMe(r)) : rows;
  const n = (r: WallRow) => cheers[String(r.id)] || 0;
  return [...pool].sort((a, b) => n(b) - n(a) || String(b.created_at || "").localeCompare(String(a.created_at || "")) || b.id - a.id)[0];
}

function who(r: WallRow): string {
  if (r.kind === "internal") return r.created_by_name || "a teammate";
  return [r.from_name, r.from_company].filter(Boolean).join(", ") || "a client";
}

// Always returns a block: a quiet week is still worth a nudge.
export function wallBlock(w: Wall, email: string, url: string): string {
  const count = w.rows.length;
  const stats = count
    ? `${count} accolade${count !== 1 ? "s" : ""} last week` +
      (w.players ? ` · ${w.players} ${w.players !== 1 ? "people" : "person"} played the daily guess` : "")
    : "A quiet week on the wall.";
  const f = pickFeatured(w.rows, w.cheers, email);
  let featured = "";
  if (f) {
    const q = String(f.quote || "").trim();
    const names = (f.recipients || []).filter(Boolean).join(", ");
    featured = `
      <div style="padding:6px 0 2px;font-size:10pt;color:#222">
        <span style="font-family:Georgia,'Times New Roman',serif;font-style:italic">“${esc(q.length > 240 ? q.slice(0, 237).trimEnd() + "…" : q)}”</span>
        <div style="color:#888;font-size:8.5pt;margin-top:2px">${names ? `For ${esc(names)} — ` : "— "}from ${esc(who(f))}</div>
      </div>`;
  }
  const nudge = w.loggers.has(lc(email))
    ? "Who else deserves one this week?"
    : "Who helped you out this week? Thank them on the wall: it takes a minute, and they get an email.";
  return `
    <div style="margin-top:26px;padding:10px 14px;background:#f5f7fb;border-left:3px solid #1F3864;border-radius:3px">
      <div style="font-size:9pt;color:#1F3864;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:4px">🏁 On the Accolade-O-Meter</div>
      <div style="font-size:9.5pt;color:#555">${stats}</div>
      ${featured}
      <div style="font-size:9.5pt;color:#333;margin-top:6px">${esc(nudge)}</div>
      <div style="font-size:9pt;margin-top:6px"><a href="${esc(url)}" style="color:#1F3864;font-weight:700">Log one, play today's guess, see the race →</a></div>
    </div>`;
}

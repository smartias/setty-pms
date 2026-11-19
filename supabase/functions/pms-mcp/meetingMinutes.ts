// meetingMinutes.ts: the pure rules behind file_meeting_minutes, the tool that
// files minutes a person dictated or typed after a meeting (issue #291's
// tables, source 'manual'). The SharePoint sweep in index.ts covers minutes
// that arrive as a file; this covers the meeting nobody wrote up.
//
// Pure TypeScript with no Deno imports so meetingMinutes.test.mjs can drive it
// directly.

export const MEETING_ITEM_TYPES = ["decision", "action_item", "open_question"] as const;
export type MeetingItemType = typeof MEETING_ITEM_TYPES[number];

// The PMS's own note categories (NOTE_CATEGORIES in SettyPMS.html).
export const MEETING_KINDS = ["client", "internal", "site"] as const;
export type MeetingKind = typeof MEETING_KINDS[number];
export const MEETING_NOTE_CATEGORY: Record<MeetingKind, string> = {
  client: "Client Meeting",
  internal: "Internal Meeting",
  site: "Site Visit",
};

export const MINUTES_MAX_ITEMS = 60;
export const MINUTES_ITEM_TEXT_MAX = 1000;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written YYYY-MM-DD. */
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !ISO_DATE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export type MinutesItemInput = {
  type?: unknown; text?: unknown; owner?: unknown; ownerIsSetty?: unknown;
  dueDate?: unknown; itemNumber?: unknown;
};
export type MinutesItem = {
  type: MeetingItemType; text: string; owner: string | null;
  ownerIsSetty: boolean | null; dueDate: string | null; itemNumber: string | null;
};

/**
 * Validate the items a caller passed. Every problem is returned (not just the
 * first) so one retry can fix them all; nothing is filed while any remain.
 */
export function cleanMinutesItems(input: unknown): { items: MinutesItem[]; problems: string[] } {
  const problems: string[] = [];
  const items: MinutesItem[] = [];
  if (!Array.isArray(input)) return { items, problems: ["items must be a list"] };
  if (input.length > MINUTES_MAX_ITEMS) problems.push(`${input.length} items; the limit is ${MINUTES_MAX_ITEMS} per meeting`);
  input.slice(0, MINUTES_MAX_ITEMS).forEach((raw: MinutesItemInput, i) => {
    const at = `items[${i}]`;
    if (!raw || typeof raw !== "object") { problems.push(`${at} is not an object`); return; }
    const type = String(raw.type ?? "");
    if (!(MEETING_ITEM_TYPES as readonly string[]).includes(type)) {
      problems.push(`${at}.type must be one of ${MEETING_ITEM_TYPES.join(", ")}`);
      return;
    }
    const text = typeof raw.text === "string" ? raw.text.replace(/\s+/g, " ").trim() : "";
    if (!text) { problems.push(`${at}.text is empty`); return; }
    if (text.length > MINUTES_ITEM_TEXT_MAX) { problems.push(`${at}.text is over ${MINUTES_ITEM_TEXT_MAX} characters`); return; }
    const due = raw.dueDate == null || raw.dueDate === "" ? null : raw.dueDate;
    if (due !== null && !isIsoDate(due)) { problems.push(`${at}.dueDate must be YYYY-MM-DD`); return; }
    const owner = typeof raw.owner === "string" && raw.owner.trim() ? raw.owner.trim() : null;
    const itemNumber = raw.itemNumber == null || String(raw.itemNumber).trim() === "" ? null : String(raw.itemNumber).trim().slice(0, 20);
    items.push({
      type: type as MeetingItemType, text, owner,
      ownerIsSetty: typeof raw.ownerIsSetty === "boolean" ? raw.ownerIsSetty : null,
      dueDate: due as string | null, itemNumber,
    });
  });
  return { items, problems };
}

/**
 * pms_meetings is unique on (project_number, source_ref); for a filed-by-hand
 * meeting the ref is the date plus the title, so filing the same meeting twice
 * (a retry, or two attendees each dictating it) finds the first instead of
 * duplicating its items.
 */
export function minutesSourceRef(meetingDate: string, title: string): string {
  const slug = String(title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return `manual|${meetingDate}|${slug || "meeting"}`;
}

export type StaffEntry = { name: string; email: string };
export type OwnerResolution = { name: string | null; email: string | null; isSetty: boolean };

const SELF_WORDS = new Set(["me", "myself", "i"]);
const FIRM_WORDS = new Set(["setty", "setty team", "setty & associates", "setty and associates", "us", "we"]);

/**
 * Who owns an item. Dictated minutes say "Mike" or "me", not the directory's
 * full name, so beyond the exact match the sweep uses this accepts the caller
 * ("me"), the firm ("Setty", "us") and a first or last name that names exactly
 * ONE person on staff. An ambiguous or unknown name stays external unless the
 * caller said otherwise with ownerIsSetty.
 */
export function resolveOwner(
  owner: string | null, staff: StaffEntry[], caller: { name: string | null; email: string | null },
  ownerIsSetty: boolean | null = null,
): OwnerResolution {
  const raw = (owner ?? "").trim();
  if (!raw) return { name: null, email: null, isSetty: false };
  const key = raw.toLowerCase();
  if (SELF_WORDS.has(key)) {
    const me = staff.find((s) => caller.email && s.email.toLowerCase() === caller.email.toLowerCase());
    return { name: me?.name ?? caller.name ?? caller.email ?? raw, email: caller.email?.toLowerCase() ?? null, isSetty: true };
  }
  if (FIRM_WORDS.has(key)) return { name: raw, email: null, isSetty: true };
  const exact = staff.filter((s) => s.name.toLowerCase().trim() === key);
  if (exact.length === 1) return { name: exact[0].name, email: exact[0].email.toLowerCase(), isSetty: true };
  // A single word: match it as a whole first or last name, and only when unique.
  if (!/\s/.test(key)) {
    const part = staff.filter((s) => {
      const words = s.name.toLowerCase().trim().split(/\s+/);
      return words[0] === key || words[words.length - 1] === key;
    });
    if (part.length === 1) return { name: part[0].name, email: part[0].email.toLowerCase(), isSetty: true };
  }
  return { name: raw, email: null, isSetty: ownerIsSetty === true };
}

const ITEM_HEADINGS: Array<[MeetingItemType, string]> = [
  ["decision", "DECISIONS"],
  ["action_item", "ACTION ITEMS"],
  ["open_question", "OPEN ITEMS"],
];

/**
 * The note that lands in project.notes[]. PMS note bodies are plain text (the
 * Notes tab renders them as text), so this is text, not HTML.
 */
export function minutesNoteBody(m: {
  title: string; meetingDate: string; attendees: string[]; minutes: string; items: MinutesItem[];
}): string {
  const out: string[] = [`MEETING MINUTES: ${m.title} (${m.meetingDate})`];
  if (m.attendees.length) out.push(`Attendees: ${m.attendees.join(", ")}`);
  for (const [type, heading] of ITEM_HEADINGS) {
    const rows = m.items.filter((it) => it.type === type);
    if (!rows.length) continue;
    out.push("", heading);
    for (const it of rows) {
      const tail = [it.owner, it.dueDate ? `due ${it.dueDate}` : null].filter(Boolean).join(", ");
      out.push(`- ${it.itemNumber ? it.itemNumber + " " : ""}${it.text}${tail ? ` (${tail})` : ""}`);
    }
  }
  const body = m.minutes.trim();
  if (body) out.push("", "NOTES", body);
  return out.join("\n");
}

/** Midday UTC on a date, so the day does not shift in US time zones. */
export function dateAtNoonUtc(isoDate: string): string {
  return `${isoDate}T12:00:00.000Z`;
}

// followups.ts: the vocabulary and date rules for outgoing follow-ups
// ("we asked someone for something and need to know when it comes back").
//
// One table (pms_followups), many kinds. A kind is only a label plus a default
// cadence; nothing else in the schema differs per kind, so a new kind is an
// entry here, not a migration. Pure TypeScript with no Deno imports so
// followups.test.mjs can drive it directly.

export const FOLLOWUP_KINDS = ["signature", "payment", "info", "approval", "general"] as const;
export type FollowupKind = typeof FOLLOWUP_KINDS[number];

export const FOLLOWUP_STATUSES = ["open", "snoozed", "resolved", "dismissed"] as const;
export type FollowupStatus = typeof FOLLOWUP_STATUSES[number];

// Where the item came from. 'outlook_flag' is a sent message the sender flagged
// in Outlook; the flag's due date seeds next_followup_at.
export const FOLLOWUP_SOURCES = ["outlook_flag", "manual", "pms_generated", "suggested"] as const;
export type FollowupSource = typeof FOLLOWUP_SOURCES[number];

// Days between reminders, per kind. The Nth reminder uses the Nth entry; past
// the end it repeats the last one. Payment starts later because the clock is
// the invoice due date, not the send date.
export const FOLLOWUP_CADENCE_DAYS: Record<FollowupKind, number[]> = {
  signature: [5, 5, 5],
  payment: [3, 12, 15],
  info: [3, 4, 5],
  approval: [5, 7, 7],
  general: [5, 7, 7],
};

// Tone tier for the Nth reminder (0 = first nudge). The add-in picks wording
// from this; it is a hint, never auto-sent.
export type FollowupTone = "friendly" | "firm" | "escalate";
export function toneForReminder(reminderCount: number): FollowupTone {
  return reminderCount <= 0 ? "friendly" : reminderCount === 1 ? "firm" : "escalate";
}

const DAY_MS = 86_400_000;

/** ISO timestamp `days` after `from`. Throws on an unparseable `from`. */
export function addDays(from: string | Date, days: number): string {
  const t = from instanceof Date ? from.getTime() : Date.parse(from);
  if (!Number.isFinite(t)) throw new Error(`addDays: bad date ${String(from)}`);
  return new Date(t + days * DAY_MS).toISOString();
}

/** When the next reminder is due after `reminderCount` reminders have gone out. */
export function nextFollowupAfter(kind: FollowupKind, from: string | Date, reminderCount: number): string {
  const steps = FOLLOWUP_CADENCE_DAYS[kind] ?? FOLLOWUP_CADENCE_DAYS.general;
  const idx = Math.min(Math.max(reminderCount, 0), steps.length - 1);
  return addDays(from, steps[idx]);
}

/** Whole days since `sentAt`, floored at 0; null when sentAt is missing or bad. */
export function daysOutstanding(sentAt: string | null | undefined, now: string | Date = new Date()): number | null {
  if (!sentAt) return null;
  const s = Date.parse(sentAt);
  const n = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(s) || !Number.isFinite(n)) return null;
  return Math.max(0, Math.floor((n - s) / DAY_MS));
}

type DueRow = { status: string; next_followup_at?: string | null };

/** An item is due when it is open, or snoozed with the snooze elapsed. */
export function isDue(row: DueRow, now: string | Date = new Date()): boolean {
  if (row.status !== "open" && row.status !== "snoozed") return false;
  if (!row.next_followup_at) return row.status === "open";
  const t = Date.parse(row.next_followup_at);
  const n = now instanceof Date ? now.getTime() : Date.parse(now);
  return Number.isFinite(t) && Number.isFinite(n) && t <= n;
}

/**
 * Best-guess kind from a subject and attachment names, for the add-in's
 * "looks like a signature request" suggestion. A guess the person confirms,
 * never applied silently. Unknown falls back to 'general'.
 */
export function guessKind(subject: string | null | undefined, attachmentNames: string[] = []): FollowupKind {
  // Filenames use _ and - as separators, which \b does not treat as word breaks.
  const text = [subject ?? "", ...attachmentNames].join(" ").toLowerCase().replace(/[^a-z0-9]+/g, " ");
  if (/\binvoice\b|\bpayment\b|\bpast due\b|\bremittance\b|\bpay app\b/.test(text)) return "payment";
  if (/\bagreement\b|\bcontract\b|\badd(itional)? service\b|\bauthorization\b|\bsign(ed|ature)?\b|\bcarf\b/.test(text)) return "signature";
  if (/\bapproval\b|\bapprove\b|\bsubmittal\b/.test(text)) return "approval";
  if (/\bplease (confirm|send|provide)\b|\bneed(ed)?\b|\brequest(ing)?\b/.test(text)) return "info";
  return "general";
}

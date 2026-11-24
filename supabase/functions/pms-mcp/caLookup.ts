// Finding one RFI or submittal in a project's log by the number a person
// gives. People do not type the number the way the log stores it: "011" for
// "RFI-011", "19" for "019", "232216-1.0" for "23 22 16-1.0". An exact string
// compare turned each of those into "No rfi ... on project" (about half of the
// lookup errors in the 30 days to 2026-11-24; the rest were items never logged).
//
// Order: the exact number, then the item's id, then the number written another
// way. A format match is taken only when it fits ONE live item; several
// (the log holds "012" and "RFI-012" as two items) come back as candidates so
// the caller asks, and a miss lists the nearest numbers in the log.
import { rfiNumberKey } from "./primeCa.js";

export type CaType = "rfi" | "submittal";
export type CaMatch = {
  item: any | null;
  matchedBy: "number" | "id" | "format" | null;
  // Several items fit the number written another way (item is null).
  candidates: string[];
  // Nothing fit: the closest numbers in the log, for the error message.
  similar: string[];
};

const SIMILAR_MAX = 8;

// One comparable key per log number. RFIs use the PMS's own rule
// (primeCa.js rfiNumberKey: "RFI-012", "012", "#12" → "12"). Submittals are
// spec-section numbers: spaces and a SUB-/Submittal prefix are dropped and
// leading zeros inside a part are ignored ("23 05 23-001-0" → "230523-1-0").
export function caNumberKey(type: CaType, s: unknown): string {
  if (type === "rfi") return rfiNumberKey(s);
  let t = String(s == null ? "" : s).trim().toUpperCase().replace(/^#\s*/, "");
  t = t.replace(/\bSUB(?:MITTAL)?\b\s*[-#:]?\s*/g, "").replace(/\s+/g, "").replace(/^-+|-+$/g, "");
  return t.replace(/(^|[^\d.])0+(\d)/g, "$1$2");
}

const isVoid = (x: any) => x && x.status === "Void";

export function findCaItemLoose(arr: any[], number: unknown, type: CaType): CaMatch {
  const list = Array.isArray(arr) ? arr : [];
  const asked = String(number == null ? "" : number).trim();
  const none: CaMatch = { item: null, matchedBy: null, candidates: [], similar: [] };
  if (!asked) return none;
  const byNumber = list.find((x) => String(x?.number) === asked);
  if (byNumber) return { ...none, item: byNumber, matchedBy: "number" };
  const byId = list.find((x) => x?.id != null && String(x.id) === asked);
  if (byId) return { ...none, item: byId, matchedBy: "id" };

  const key = caNumberKey(type, asked);
  if (key && /\d/.test(key)) {
    const same = list.filter((x) => x?.number != null && caNumberKey(type, x.number) === key);
    // A voided twin is how a person clears a duplicate; it does not make the
    // live item ambiguous.
    const live = same.filter((x) => !isVoid(x));
    const pool = live.length ? live : same;
    if (pool.length === 1) return { ...none, item: pool[0], matchedBy: "format" };
    if (pool.length > 1) return { ...none, candidates: pool.map((x) => String(x.number)) };
  }
  // Nearest numbers: the asked digits appear in the logged number's digits.
  const digits = asked.replace(/\D/g, "").replace(/^0+/, "");
  const similar = digits
    ? list.filter((x) => String(x?.number ?? "").replace(/\D/g, "").includes(digits))
        .map((x) => String(x.number)).slice(0, SIMILAR_MAX)
    : [];
  return { ...none, similar };
}

// The message for a lookup that found no single item. `tail` is the tool's own
// next step ("run backload_ca_item first ...").
export function caMissMessage(m: CaMatch, type: CaType, number: unknown, where: string, total: number): string {
  if (m.candidates.length) {
    return `"${number}" fits ${m.candidates.length} ${type}s ${where}: ${m.candidates.join(", ")}. Pass the number exactly as one of these is written.`;
  }
  const near = m.similar.length ? ` Closest numbers in the log: ${m.similar.join(", ")}.` : "";
  const size = total === 0 ? ` The ${type} log ${where} is empty.` : "";
  return `No ${type} "${number}" ${where}.${size}${near}`;
}

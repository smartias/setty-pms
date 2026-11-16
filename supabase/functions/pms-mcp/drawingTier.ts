// Which indexed drawings are BACKGROUNDS: other disciplines' sheets that
// arrived from outside (the architect's, structural engineer's or civil
// engineer's set), as opposed to what Setty issued. Pure; see its tests.
//
// The QA review's cross-discipline pass needs the other disciplines' drawings
// searchable, and they live where they were received: the project's Emails
// folder, an Incoming folder, a Backgrounds or Reference folder. Indexing them
// is easy (search_drawings takes any subfolder). Keeping them from being
// mistaken for OUR issued set is the point of this module: the architect's
// compiled set usually carries a copy of our own sheets, and without a rule
// that copy would compete with the Outgoing one as "the current revision".
//
// A path is a background when any of its folders is a received-files folder.
// Outgoing, the QAQC folder and everything else are not.
const RECEIVED = "e-?mails?|incoming|received|backgrounds?|bkgds?|reference|ref|client[ _-]?uploads?|from[ _-](?:others|architect|arch|structural|civil|owner|client)";
const BACKGROUND_SEGMENT_RE = new RegExp(
  "^(?:\\d{1,2}\\s*[-_. ]\\s*)?(?:" + RECEIVED + ")(?:$|[ _.-])" +    // "Emails", "01-INCOMING", "02 Backgrounds - Arch"
  "|[ _-]incoming$", "i");                                             // "01-SAPX196006.00_INCOMING"

export function isBackgroundPath(folderPath: unknown): boolean {
  const segs = String(folderPath ?? "").split("/").map((s) => s.trim()).filter(Boolean);
  // An Outgoing set that happens to hold a "Reference" subfolder is still ours.
  if (segs.length && /(^|[ _-])outgoing$/i.test(segs[0])) return false;
  return segs.some((s) => BACKGROUND_SEGMENT_RE.test(s));
}

export const BACKGROUND_NOTE =
  "Sheets indexed from a received-files folder (Emails, Incoming, Backgrounds) are other disciplines' drawings or " +
  "copies of ours as someone else compiled them. They are left out of the current set, equipment lookups and " +
  "default drawing search; pass that folder as `subfolder` to search or read them.";

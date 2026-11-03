// portalForms.js — browser entry for the client portal submit convention
// (window.PortalForms). The convention itself (field lists, readme, workbook
// parts, reader) is portalFormSpec.js, which has no imports so the connector
// can run a byte-identical copy; this file adds the zip layer from
// setty-docx.js (an .xlsx IS a zip) and re-exports everything.

import { zip, unzip } from "./setty-docx.js";
import { buildFormParts, readFormParts } from "./portalFormSpec.js";

export * from "./portalFormSpec.js";

/** The form workbook for one kind, as .xlsx bytes. */
export async function buildFormWorkbook(kind, projectLabel) {
  return zip(buildFormParts(kind, projectLabel));
}

/** Read a (filled) form workbook from .xlsx bytes; see readFormParts. */
export async function readFormWorkbook(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
  return readFormParts(await unzip(buf));
}

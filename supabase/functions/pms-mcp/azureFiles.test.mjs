// Tests for azureFiles.ts — storage seam slice B, the Azure Files browse/read
// provider behind every region's network-drive annex.
//
//   node supabase/functions/pms-mcp/azureFiles.test.mjs
//
// The module is pure apart from fetch, which it takes injected, so this test
// imports the real Edge source (Node strips the types) and drives the REST
// calls with stub responses: no share, no secret, no network.

import {
  parseShareUrl, cleanRelPath, joinRel, encodeAzId, decodeAzId, isAzId, normalizeSas, azureUrl,
  sharePathOf, parseListXml, describeAzureError, listDirectory, fileProps, getFile,
  findProjectFolderName, projectForFolderName, extOf, AzureFilesError, AZ_API_VERSION, shareLabelClean,
  YEAR_SEG_RE, ENTITY_SEG_RE, isGroupingSegment, entityPrefixScore, yearOfProjectNumber, standardFolderName, resolveChildFolder,
} from "./azureFiles.ts";

let total = 0, failures = 0;
const check = (ok, label) => { total++; if (!ok) { failures++; console.error("✗ " + label); } };
const eq = (a, b, label) => check(JSON.stringify(a) === JSON.stringify(b), `${label}\n    got  ${JSON.stringify(a)}\n    want ${JSON.stringify(b)}`);

// ── 1. Share URLs (what the Admin console stores) ────────────────────────────
const NY = parseShareUrl("https://filestoragesetty.file.core.windows.net/newyorkstorage/SAP");
eq(NY, { account: "filestoragesetty", share: "newyorkstorage", prefix: "SAP", base: "https://filestoragesetty.file.core.windows.net/newyorkstorage" },
  "NY share URL: account, share, one-level prefix");
const FFX = parseShareUrl("https://ffxfilestorage.file.core.windows.net/ffxfileshare/SAi_Projects/Sub Dir/");
eq(FFX && [FFX.share, FFX.prefix], ["ffxfileshare", "SAi_Projects/Sub Dir"], "multi-level prefix keeps its segments; trailing slash trimmed");
check(parseShareUrl("https://Acct.file.core.windows.net/share")?.account === "acct", "account is lower-cased");
check(parseShareUrl("https://filestoragesetty.file.core.windows.net/")?.share === undefined, "a share URL without a share is rejected");
check(parseShareUrl("http://filestoragesetty.file.core.windows.net/s") === null, "http is rejected (SAS rides https only)");
check(parseShareUrl("https://filestoragesetty.file.core.windows.net/s?sv=1&sig=x") === null, "a URL carrying a query string (a pasted SAS) is rejected");
check(parseShareUrl("https://filestoragesetty.blob.core.windows.net/s") === null, "blob endpoints are not file shares");
check(parseShareUrl("") === null && parseShareUrl(null) === null, "empty/null share URL is null");
check(parseShareUrl("https://a.file.core.windows.net/s/../x")?.share === "x", "URL parsing resolves dot segments before the prefix is read, so no traversal survives");

// ── 2. Relative paths (ride inside ids: hostile by definition) ──────────────
eq(cleanRelPath(""), "", "empty is the root");
eq(cleanRelPath("/a//b/"), "a/b", "slashes are normalised");
eq(cleanRelPath("a\\b\\c.pdf"), "a/b/c.pdf", "backslashes become slashes");
check(cleanRelPath("a/../b") === null, "'..' is rejected");
check(cleanRelPath("./a") === null, "'.' is rejected");
check(cleanRelPath("a/ b") === null, "a segment with surrounding whitespace is rejected");
check(cleanRelPath("a/b\u0007") === null, "control characters are rejected");
eq(joinRel("SAP", "X/Y"), "SAP/X/Y", "joinRel joins");
eq(joinRel("", "X"), "X", "joinRel with empty prefix");
eq(joinRel("SAP", ""), "SAP", "joinRel with empty path");

// ── 3. Ids ──────────────────────────────────────────────────────────────────
const id = encodeAzId("ny", "SAPX256015.00 Tabler/Outgoing/file:1.pdf");
eq(id, "az:NY:SAPX256015.00 Tabler/Outgoing/file:1.pdf", "encode upper-cases the team (no label: the region's first share)");
eq(decodeAzId(id), { team: "NY", label: null, relPath: "SAPX256015.00 Tabler/Outgoing/file:1.pdf" }, "decode splits on the FIRST colon after the team (paths may contain colons)");
eq(decodeAzId("az:DC:"), { team: "DC", label: null, relPath: "" }, "an id with an empty path is the share root");
eq(encodeAzId("dc", "SIPX262012.00 RFK/Outgoing", "w"), "az:DC.W:SIPX262012.00 RFK/Outgoing", "a share label rides after the team, upper-cased");
eq(decodeAzId("az:DC.W:SIPX262012.00 RFK/Outgoing"), { team: "DC", label: "W", relPath: "SIPX262012.00 RFK/Outgoing" }, "decode returns the share label");
eq(decodeAzId("az:dc.sap:x"), { team: "DC", label: "SAP", relPath: "x" }, "team and label are case-insensitive");
check(decodeAzId("az:DC.:x") === null && decodeAzId("az:DC.W-1:x") === null && decodeAzId("az:DC.TOOLONGLABEL13:x") === null, "an empty, punctuated or over-long label is rejected");
eq(shareLabelClean("w:"), "W", "shareLabelClean strips punctuation (a drive letter becomes its label)");
eq(encodeAzId("DC", "x", ""), "az:DC:x", "an empty label is omitted");
check(isAzId("az:NY:x") && !isAzId("b!abc|123") && !isAzId(null), "isAzId tells az ids from Graph composites");
check(decodeAzId("az:I::x") === null, "a drive-letter team ('I:') is not a valid team");
check(decodeAzId("az:NY") === null, "an id without the second colon is malformed");
check(decodeAzId("az:NY:../etc") === null, "traversal in an id is rejected");
check(decodeAzId("b!abc|123") === null, "a Graph composite is not an az id");

// ── 4. SAS normalisation (whatever IT pasted into the secret) ───────────────
eq(normalizeSas("?sv=2024-05-04&ss=f&sp=rl&sig=abc%3D"), "sv=2024-05-04&ss=f&sp=rl&sig=abc%3D", "leading '?' is stripped");
eq(normalizeSas("sv=2024-05-04&sig=abc"), "sv=2024-05-04&sig=abc", "a bare query string passes through");
eq(normalizeSas("https://a.file.core.windows.net/share?sv=1&sig=zz"), "sv=1&sig=zz", "a full URL with the SAS attached reduces to its query");
check(normalizeSas("sv=1&ss=f") === null, "a token without sig= is not a SAS");
check(normalizeSas("") === null && normalizeSas(undefined) === null, "empty/undefined is null");

// ── 5. URLs and display paths ───────────────────────────────────────────────
eq(azureUrl(NY, "SAPX256015.00 Tabler/Outgoing/A#1 50%.pdf", "sv=1&sig=x", { restype: "directory", comp: "list" }),
  "https://filestoragesetty.file.core.windows.net/newyorkstorage/SAP/SAPX256015.00%20Tabler/Outgoing/A%231%2050%25.pdf?restype=directory&comp=list&sv=1&sig=x",
  "prefix + path, each segment encoded, request params before the SAS");
eq(azureUrl({ account: "a", share: "s", prefix: "", base: "https://a.file.core.windows.net/s" }, "", "sig=x"),
  "https://a.file.core.windows.net/s?sig=x", "root of a prefix-less share");
eq(sharePathOf(NY, "SAPX256015.00 Tabler/Outgoing"), "\\\\filestoragesetty.file.core.windows.net\\newyorkstorage\\SAP\\SAPX256015.00 Tabler\\Outgoing",
  "display path is the UNC form people recognise, never a credentialed URL");

// ── 6. Listing XML ──────────────────────────────────────────────────────────
const XML = `<?xml version="1.0" encoding="utf-8"?>
<EnumerationResults ServiceEndpoint="https://filestoragesetty.file.core.windows.net/" ShareName="newyorkstorage" DirectoryPath="SAP">
  <Entries>
    <Directory><Name>SAPX256015.00 Tabler &amp; Sons</Name><Properties><Last-Modified>Tue, 02 Sep 2026 14:03:11 GMT</Last-Modified></Properties></Directory>
    <File><Name Encoded="true">Spec%20%C2%A7%2015230.pdf</Name><Properties><Content-Length>123456</Content-Length><Last-Modified>Mon, 01 Sep 2026 10:00:00 GMT</Last-Modified></Properties></File>
    <File><Name>notes.txt</Name><Properties><Content-Length>12</Content-Length></Properties></File>
    <Directory><Name>Emails</Name></Directory>
  </Entries>
  <NextMarker>abc&amp;def</NextMarker>
</EnumerationResults>`;
const parsed = parseListXml(XML);
eq(parsed.entries.map((e) => [e.name, e.type, e.size ?? null]), [
  ["SAPX256015.00 Tabler & Sons", "folder", null],
  ["Spec § 15230.pdf", "file", 123456],
  ["notes.txt", "file", 12],
  ["Emails", "folder", null],
], "directories and files in order, XML-escaped and URL-encoded names decoded, sizes parsed");
eq(parsed.entries[0].modified, "2026-09-02T14:03:11.000Z", "Last-Modified becomes an ISO stamp");
check(parsed.entries[2].modified === undefined, "no Last-Modified, no modified field");
eq(parsed.nextMarker, "abc&def", "NextMarker is unescaped");
eq(parseListXml("<EnumerationResults><Entries/><NextMarker/></EnumerationResults>"), { entries: [], nextMarker: "" }, "empty listing");

// ── 7. Error wording (what the admin can fix) ───────────────────────────────
check(/SAS token is expired|firewall/.test(describeAzureError(403, "<Error><Code>AuthorizationFailure</Code></Error>")), "403 names the SAS and the firewall");
check(/AuthenticationFailed/.test(describeAzureError(403, "<Error><Code>AuthenticationFailed</Code></Error>")), "the service's error code is carried through");
check(/does not exist as spelled/.test(describeAzureError(404, "")), "404 is a spelling/path problem");
check(/malformed/.test(describeAzureError(400, "<Error><Code>InvalidUri</Code></Error>")), "400 is a malformed URL or token");
check(/HTTP 503/.test(describeAzureError(503, "")), "other statuses are reported plainly");

// ── 8. REST calls over a stub fetch ─────────────────────────────────────────
const calls = [];
const page = (entries, marker) => `<EnumerationResults><Entries>${entries.map((n) => `<Directory><Name>${n}</Name></Directory>`).join("")}</Entries><NextMarker>${marker}</NextMarker></EnumerationResults>`;
const stub = (routes) => async (url, init) => {
  calls.push({ url, method: init?.method || "GET", headers: init?.headers || {} });
  const u = new URL(url);
  const marker = u.searchParams.get("marker") || "";
  const r = routes(u, marker, init);
  return r instanceof Response ? r : new Response(r.body ?? "", { status: r.status ?? 200, headers: r.headers ?? {} });
};

const two = await listDirectory(NY, "", "sv=1&sig=x", { fetchImpl: stub((u, marker) => ({ body: marker ? page(["SAPX2", "SAPX3"], "") : page(["SAPX1"], "m2") })) });
eq(two.entries.map((e) => e.name), ["SAPX1", "SAPX2", "SAPX3"], "listDirectory follows the continuation marker");
check(two.truncated === false, "a listing that ends is not truncated");
check(calls.length === 2 && new URL(calls[1].url).searchParams.get("marker") === "m2", "the second request carries the marker");
check(new URL(calls[0].url).searchParams.get("restype") === "directory" && new URL(calls[0].url).searchParams.get("comp") === "list",
  "listing uses restype=directory&comp=list");
check(new URL(calls[0].url).searchParams.get("sig") === "x", "the SAS rides the query string");
check(calls[0].headers["x-ms-version"] === AZ_API_VERSION, "requests pin the service version");
check(!new URL(calls[0].url).searchParams.has("marker"), "the first page has no marker");

calls.length = 0;
const capped = await listDirectory(NY, "X", "sig=x", { fetchImpl: stub(() => ({ body: page(["a"], "again") })), maxPages: 3 });
check(capped.truncated === true && capped.entries.length === 3 && calls.length === 3, "a never-ending listing stops at maxPages and reports truncated");

let thrown = null;
try { await listDirectory(NY, "", "sig=x", { fetchImpl: stub(() => ({ status: 403, body: "<Error><Code>AuthenticationFailed</Code><Message>Signature expired</Message></Error>" })) }); }
catch (e) { thrown = e; }
check(thrown instanceof AzureFilesError && thrown.status === 403 && /AuthenticationFailed/.test(thrown.message), "a refused listing throws AzureFilesError with the honest message");

calls.length = 0;
const props = await fileProps(NY, "SAPX1/Outgoing/a.pdf", "sig=x", stub(() => ({ status: 200, headers: { "content-length": "4096", "last-modified": "Mon, 01 Sep 2026 10:00:00 GMT", "content-type": "application/pdf" } })));
eq(props, { size: 4096, modified: "2026-09-01T10:00:00.000Z", contentType: "application/pdf" }, "fileProps reads size/modified/type from the HEAD");
check(calls[0].method === "HEAD" && new URL(calls[0].url).pathname === "/newyorkstorage/SAP/SAPX1/Outgoing/a.pdf", "fileProps is a HEAD on the file path under the prefix");

calls.length = 0;
const res = await getFile(NY, "SAPX1/notes.txt", "sig=x", stub(() => ({ status: 200, body: "hello" })));
check((await res.text()) === "hello" && calls[0].method === "GET", "getFile returns the response for the shared extractors");
let notFound = null;
try { await getFile(NY, "SAPX1/missing.txt", "sig=x", stub(() => ({ status: 404, body: "<Error><Code>ResourceNotFound</Code></Error>" }))); } catch (e) { notFound = e; }
check(notFound instanceof AzureFilesError && notFound.status === 404, "a missing file throws a 404 AzureFilesError");

// ── 9. Project folder match mirrors SharePoint's rule ───────────────────────
const root = [
  { name: "sapx256015.00 Tabler", type: "folder" }, { name: "SAPX256015.00 notes.txt", type: "file" },
  { name: "SAPX256015.01 Tabler Ph2", type: "folder" },
];
eq(findProjectFolderName(root, "SAPX256015.00"), "sapx256015.00 Tabler", "case-insensitive startsWith, folders only");
eq(findProjectFolderName(root, "sapx256015.01"), "SAPX256015.01 Tabler Ph2", "the phase suffix picks the right folder");
check(findProjectFolderName(root, "SAPX9") === null && findProjectFolderName(root, "") === null, "no match / empty prefix yields null");
eq([extOf("A.PDF"), extOf("noext"), extOf(".hidden"), extOf("a.b.docx")], ["pdf", "", "", "docx"], "extOf");

// ── 11. DC layout: year folders and prefixed subfolders ─────────────────────
eq([yearOfProjectNumber("SIPX262012.00"), yearOfProjectNumber("sapx256015.01"), yearOfProjectNumber("nope"), yearOfProjectNumber("")],
  ["2026", "2025", null, null], "the year is read off digits 5-6 of the project number");
check(YEAR_SEG_RE.test("2026") && YEAR_SEG_RE.test("1999") && !YEAR_SEG_RE.test("2026 Projects") && !YEAR_SEG_RE.test("26"), "a year folder is exactly four digits");
check(ENTITY_SEG_RE.test("SAP") && ENTITY_SEG_RE.test("SAIG") && ENTITY_SEG_RE.test("sag") && !ENTITY_SEG_RE.test("SAPQ256919.01") && !ENTITY_SEG_RE.test("Outgoing"),
  "an entity folder is a short letter code; project folders and standard folders are not");
check(isGroupingSegment("2025") && isGroupingSegment("SAP") && !isGroupingSegment("SAPQ256919.01 Tabler") && !isGroupingSegment(""), "grouping = year or entity");
eq([entityPrefixScore("SAP", "SAPQ256919.01"), entityPrefixScore("SAIG", "SAPQ256919.01"), entityPrefixScore("SAG", "SAPQ256919.01"), entityPrefixScore("SAP", "SIPX262012.00")],
  [3, 2, 2, 1], "entities rank by common prefix with the number: SAP first for a SAPQ job");
eq(standardFolderName("99-SIPX262012.00_OUTGOING"), "OUTGOING", "the DC prefix is stripped to the plain name");
eq(standardFolderName("00-SIPX262012.00 DC RFK PMO Energy"), "DC RFK PMO Energy", "space-separated prefix too");
eq(standardFolderName("Outgoing"), "Outgoing", "a standard name passes through");
eq(standardFolderName("60-SIPX262012.00_QA-QC"), "QA-QC", "hyphenated names survive");
const DC = ["00-SIPX262012.00 DC RFK PMO Energy", "01-SIPX262012.00_INCOMING", "02-SIPX262012.00_PM", "05-SIPX262012.00_PHOTOS",
  "22-SIPX262012.00_P", "23-SIPX262012.00_M", "26-SIPX262012.00_E", "28-SIPX262012.00_FA", "30-SIPX262012.00_REPORTS",
  "60-SIPX262012.00_QA-QC", "99-SIPX262012.00_OUTGOING"].map((name) => ({ name, type: "folder" }));
DC.push({ name: "readme.txt", type: "file" });
eq(resolveChildFolder(DC, "Outgoing"), "99-SIPX262012.00_OUTGOING", "'Outgoing' resolves to the prefixed DC folder");
eq(resolveChildFolder(DC, "Emails"), "01-SIPX262012.00_INCOMING", "'Emails' (the SharePoint name) resolves to INCOMING via alias");
eq(resolveChildFolder(DC, "photos"), "05-SIPX262012.00_PHOTOS", "case-insensitive");
eq(resolveChildFolder(DC, "QA/QC"), "60-SIPX262012.00_QA-QC", "alias with punctuation");
eq(resolveChildFolder(DC, "99-SIPX262012.00_OUTGOING"), "99-SIPX262012.00_OUTGOING", "the literal drive name still works");
eq(resolveChildFolder(DC, "M"), "23-SIPX262012.00_M", "single-letter discipline folders resolve exactly, not by contains");
check(resolveChildFolder(DC, "readme.txt") === null, "a file is not a folder");
check(resolveChildFolder(DC, "nothing here") === null && resolveChildFolder(DC, "") === null, "no match / empty wanted is null");
const NYF = [{ name: "Outgoing", type: "folder" }, { name: "Emails", type: "folder" }, { name: "Photos", type: "folder" }];
eq(resolveChildFolder(NYF, "outgoing"), "Outgoing", "standard layout: exact case-insensitive match");
eq(resolveChildFolder(NYF, "incoming"), "Emails", "standard layout: 'incoming' means Emails");

// ── 10. Folder → project (the visibility gate's first step) ─────────────────
const PROJECTS = [
  { projectNumber: "SAPX256015", team: "NY" }, { projectNumber: "SAPX256015.00", team: "NY" },
  { projectNumber: "SAPX256015.01", team: "DC" }, { projectNumber: null, team: "NY" },
];
check(projectForFolderName("SAPX256015.00 Tabler", PROJECTS)?.projectNumber === "SAPX256015.00", "the LONGEST project number prefixing the folder wins");
check(projectForFolderName("sapx256015.01 tabler ph2", PROJECTS)?.projectNumber === "SAPX256015.01", "case-insensitive");
check(projectForFolderName("SAPX256015 misc", PROJECTS)?.projectNumber === "SAPX256015", "a bare-number folder resolves to the bare-number project");
check(projectForFolderName("Old Scans", PROJECTS) === null, "a folder no project claims resolves to nothing (and is not served)");
check(projectForFolderName("", PROJECTS) === null && projectForFolderName("x", []) === null, "empty name / no projects");

console.log(failures ? `\n${failures} of ${total} assertions FAILED` : `\nall ${total} assertions pass`);
process.exit(failures ? 1 : 0);

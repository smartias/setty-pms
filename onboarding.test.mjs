// Bulk onboarding helpers (onboarding.js) and the drift anchors between the
// Admin console and the RPCs in
// supabase/migrations/20260930140000_bulk_onboarding_and_renumber.sql.
//
//   node --test onboarding.test.mjs
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  parseTable, colIndex, guessColumns, mapRole, mapStatus, disciplinesFrom, teamFrom,
  staffRowsFrom, projectRowsFrom, editDistance, nearestNumbers, looksLikeProjectNumber, cleanProjectNumber,
  PMS_ROLES, PMS_STATUSES,
} from "./onboarding.js";

const ADMIN = readFileSync(new URL("./SettyAdmin.html", import.meta.url), "utf8");
const SQL = readFileSync(new URL("./supabase/migrations/20260930140000_bulk_onboarding_and_renumber.sql", import.meta.url), "utf8");

test("pasted tables: Excel tabs, CSV quotes, blank lines", () => {
  assert.deepEqual(parseTable("a\tb\r\n\r\nc\td\n"), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(parseTable('name,email\n"Arias, Sara",sara.arias@setty.com'), [["name", "email"], ["Arias, Sara", "sara.arias@setty.com"]]);
  assert.deepEqual(parseTable('x,"say ""hi""",y'), [["x", 'say "hi"', "y"]]);
  assert.deepEqual(parseTable("   \n"), []);
});

test("column letters and header guesses", () => {
  assert.equal(colIndex("A"), 0); assert.equal(colIndex("k"), 10); assert.equal(colIndex("AA"), 26); assert.equal(colIndex("1"), null);
  const h = ["S.No", "First Name", "Last Name", "Designation", "Department", "Office", "Access Level", "", "", "", "Email ID"];
  const c = guessColumns(h, ["email", "first", "last", "name", "category", "title", "team", "department"]);
  assert.equal(c.email, 10); assert.equal(c.first, 1); assert.equal(c.last, 2); assert.equal(c.title, 3);
  assert.equal(c.department, 4); assert.equal(c.team, 5); assert.equal(c.category, 6);
  assert.equal(guessColumns(["x", "y"], ["email"], { email: "B" }).email, 1, "an admin's column letter wins");
});

test("roles: sheet words onto PMS roles, never admin by guess", () => {
  assert.equal(mapRole("Project Manager"), "project_manager");
  assert.equal(mapRole("Deputy PM"), "project_manager");
  assert.equal(mapRole("Director of Operations"), "project_manager");
  assert.equal(mapRole("Sr. Mechanical Engineer"), "engineer");
  assert.equal(mapRole("BIM Modeler"), "engineer");
  assert.equal(mapRole("QA/QC"), "qaqc");
  assert.equal(mapRole("Accounts Payable"), "accounting");
  assert.equal(mapRole("Contracts Admin"), "contracts");
  assert.equal(mapRole("Marketing Coordinator"), "marketing");
  assert.equal(mapRole("Office Manager"), "operations");
  assert.equal(mapRole("engineer"), "engineer");
  assert.equal(mapRole("project_manager"), "project_manager");
  assert.equal(mapRole("admin"), null, "admin is always a deliberate pick");
  assert.equal(mapRole("Wizard"), null);
  assert.equal(mapRole(""), null);
  for (const r of PMS_ROLES) if (r !== "admin") assert.equal(mapRole(r), r, r + " maps to itself");
});

test("disciplines and offices", () => {
  assert.deepEqual(disciplinesFrom("MEP", "Mechanical Engineer"), ["Mechanical"]);
  assert.deepEqual(disciplinesFrom("Electrical / Fire Alarm"), ["Electrical", "Fire Protection"]);
  assert.deepEqual(disciplinesFrom("Accounting"), []);
  assert.equal(teamFrom("New York"), "NY"); assert.equal(teamFrom("Washington DC"), "DC"); assert.equal(teamFrom("Baltimore"), "BT");
  assert.equal(teamFrom("pune", ["NY", "PUNE"]), "PUNE"); assert.equal(teamFrom(""), "");
});

test("a staff sheet with the email in column K", () => {
  const sheet = [
    ["S.No", "First Name", "Last Name", "Designation", "Department", "Office", "Role", "", "", "", "Email"].join("\t"),
    ["1", "Sara", "Arias", "Director", "Operations", "New York", "Project Manager", "", "", "", "Sara.Arias@setty.com"].join("\t"),
    ["2", "Pat", "Lee", "Electrical Engineer", "Electrical", "Washington DC", "Engineer", "", "", "", "pat.lee@setty.com"].join("\t"),
    ["3", "Kim", "Roe", "Wizard", "", "Baltimore", "Wizard", "", "", "", "kim.roe@setty.com"].join("\t"),
    ["4", "No", "Email", "", "", "", "", "", "", "", ""].join("\t"),
  ].join("\n");
  const r = staffRowsFrom(sheet, { columns: { email: "K" } });
  assert.equal(r.rows.length, 3, "a row without an email is skipped");
  assert.deepEqual(r.rows[0], { email: "sara.arias@setty.com", name: "Sara Arias", category: "Project Manager", role: "project_manager", team: "NY", title: "Director", disciplines: [] });
  assert.deepEqual(r.rows[1].disciplines, ["Electrical"]); assert.equal(r.rows[1].team, "DC");
  assert.equal(r.rows[2].role, ""); assert.deepEqual(r.unmapped, [{ word: "wizard", n: 1 }]);
  const picked = staffRowsFrom(sheet, { columns: { email: "K" }, roleMap: { wizard: "staff" } });
  assert.equal(picked.rows[2].role, "staff"); assert.deepEqual(picked.unmapped, []);
});

test("statuses: sheet words onto PMS statuses", () => {
  assert.equal(mapStatus("Active"), "In Progress"); assert.equal(mapStatus(""), "In Progress");
  assert.equal(mapStatus("CA"), "In Construction Administration"); assert.equal(mapStatus("On hold"), "On Hold");
  assert.equal(mapStatus("Closed"), "Completed"); assert.equal(mapStatus("Top Priority"), "Top Priority");
  assert.equal(mapStatus("Martian"), null);
  for (const s of PMS_STATUSES) assert.equal(mapStatus(s), s);
});

test("a project list, with or without a header", () => {
  const withHeader = "Job Number\tProject Name\tStatus\nSIPX251008.00\tTivoly EcoVillage\tActive\n sipq251916.01 \t\tCA\nbogus\tx\tActive\nSAPX246001.00\t\tWeird";
  const r = projectRowsFrom(withHeader);
  assert.deepEqual(r.rows.map((x) => [x.number, x.status, x.valid]), [
    ["SIPX251008.00", "In Progress", true], ["SIPQ251916.01", "In Construction Administration", true], ["BOGUS", "In Progress", false], ["SAPX246001.00", "", true]]);
  assert.equal(r.rows[0].name, "Tivoly EcoVillage");
  assert.deepEqual(r.unmapped, [{ word: "weird", n: 1 }]);
  const bare = projectRowsFrom("SIPX251008.00\tActive\nSIPX251001.00\tOn Hold");
  assert.deepEqual(bare.rows.map((x) => [x.number, x.status]), [["SIPX251008.00", "In Progress"], ["SIPX251001.00", "On Hold"]]);
});

test("project numbers", () => {
  assert.ok(looksLikeProjectNumber("SAPQ226904.04.01")); assert.ok(looksLikeProjectNumber(" sapx246001.00 "));
  assert.ok(!looksLikeProjectNumber("SAPX26XXX")); assert.ok(!looksLikeProjectNumber("12345"));
  assert.equal(cleanProjectNumber(" sapx 246001.00"), "SAPX246001.00");
});

test("typo matching: swaps are one edit, siblings rank after true typos", () => {
  assert.equal(editDistance("SAPQ206905.00", "SAPQ206950.00"), 1, "swapped digits");
  assert.equal(editDistance("SAP186034.18", "SAPX186034.18"), 1, "a dropped letter");
  assert.equal(editDistance("abc", "abc"), 0); assert.equal(editDistance("", "ab"), 2);
  const pool = ["SAPQ206905.01", "SAPQ206950.00", "", "SAPX999999.00", { number: "SAPQ206905.00" }];
  const near = nearestNumbers("SAPQ206905.00", pool);
  assert.deepEqual(near.map((x) => [x.number, x.dist, x.sibling]), [["SAPQ206950.00", 1, false], ["SAPQ206905.01", 1, true]],
    "the number itself and blanks (pipeline jobs) are skipped; the swap beats the sibling task order");
  assert.deepEqual(nearestNumbers("SAP186034.18", ["SAPX186034.18"]).map((x) => x.number), ["SAPX186034.18"]);
  assert.deepEqual(nearestNumbers("", pool), []);
});

// ── drift anchors ───────────────────────────────────────────────────────────
function blobKeysJs() {
  const start = ADMIN.indexOf("function candidateProjectBlob(");
  const body = ADMIN.slice(start, ADMIN.indexOf("\n}\n", start));
  const ret = body.slice(body.indexOf("return {"));
  const keys = new Set();
  // Top-level keys only: track brace/bracket depth.
  let depth = 0, tok = "", inValue = false;
  for (let i = "return {".length; i < ret.length; i++) {
    const ch = ret[i];
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ")") { if (depth === 0) break; depth--; }
    if (depth === 0) {
      if (ch === ",") { const k = tok.trim(); if (!inValue && /^[A-Za-z]\w*$/.test(k)) keys.add(k); tok = ""; inValue = false; continue; }
      if (ch === ":" && !inValue) { const k = tok.trim(); if (/^[A-Za-z]\w*$/.test(k)) keys.add(k); tok = ""; inValue = true; continue; }
      if (ch === "\n") continue;
      tok += ch;
    }
  }
  return keys;
}
function blobKeysSql() {
  const start = SQL.indexOf("create or replace function public.pms_candidate_project_blob(");
  const body = SQL.slice(start, SQL.indexOf("$$;", start));
  const keys = new Set();
  // Top-level keys of the jsonb_build_object calls joined by ||: a quoted key
  // at depth 1 (inside the outer call) in key position.
  let depth = 0, argIdx = 0;
  for (let i = body.indexOf("select jsonb_build_object("); i < body.length; i++) {
    const ch = body[i];
    if (ch === "(") { depth++; if (depth === 1) argIdx = 0; continue; }
    if (ch === ")") { depth--; continue; }
    if (depth === 1 && ch === ",") { argIdx++; continue; }
    if (depth === 1 && ch === "'" && argIdx % 2 === 0) {
      const end = body.indexOf("'", i + 1);
      keys.add(body.slice(i + 1, end));
      i = end;
    } else if (ch === "'") { i = body.indexOf("'", i + 1); }
  }
  return keys;
}

test("drift: the SQL project blob has exactly the keys of candidateProjectBlob()", () => {
  const js = blobKeysJs(), sql = blobKeysSql();
  assert.ok(js.size > 60, "parsed the JS blob (" + js.size + " keys)");
  assert.deepEqual([...sql].sort(), [...js].sort());
});

test("drift: roles and statuses match the console and the RPCs", () => {
  const roles = /const ROLES = (\[[^\]]+\]);/.exec(ADMIN)[1];
  assert.deepEqual(JSON.parse(roles), PMS_ROLES);
  const statuses = /const CAND_STATUSES = (\[[^\]]+\]);/.exec(ADMIN)[1];
  assert.deepEqual(JSON.parse(statuses), PMS_STATUSES);
  const sqlRoles = /v_roles text\[\] := array\[([^\]]+)\]/.exec(SQL)[1].split(",").map((s) => s.trim().replace(/'/g, ""));
  assert.deepEqual(sqlRoles, PMS_ROLES);
  const sqlStatuses = /v_statuses text\[\] := array\[([^\]]+)\]/.exec(SQL)[1].split(",").map((s) => s.trim().replace(/'/g, ""));
  assert.deepEqual(sqlStatuses, PMS_STATUSES);
});

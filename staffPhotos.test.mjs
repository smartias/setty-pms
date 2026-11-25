// Staff photo lookup in SettyPMS.html: which directory photo a project team
// row (a copy with no photoPath of its own) resolves to.
//
//   node --test staffPhotos.test.mjs
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("./SettyPMS.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const a = html.indexOf("function staffPhotoUrl(");
const b = html.indexOf("// The directory the avatars look people up in.");
assert.ok(a > 0 && b > a, "could not slice the staff photo helpers out of SettyPMS.html");
const src = 'const SUPABASE_URL = "https://x.test"; const STAFF_PHOTO_BUCKET = "staff-photos";\n' + html.slice(a, b) +
  "\nexport { staffPhotoUrl, buildStaffPhotoIndex, staffPhotoPathFor, staffInitials };";
const { staffPhotoUrl, buildStaffPhotoIndex, staffPhotoPathFor, staffInitials } =
  await import("data:text/javascript;base64," + Buffer.from(src, "utf8").toString("base64"));

const index = buildStaffPhotoIndex([
  { id: "a1", name: "Jane Smith", email: "JSmith@setty.com", photoPath: "a1/x.jpg" },
  { id: "b2", name: "Sam Lee", email: "", photoPath: "b2/y.jpg" },
  { id: "c3", name: "No Photo", email: "np@setty.com" },
  null,
]);

test("a directory entry uses its own photo", () => {
  assert.equal(staffPhotoPathFor({ name: "Anyone", photoPath: "z/z.jpg" }, index), "z/z.jpg");
});
test("a team row matches by email, ignoring case and spaces", () => {
  assert.equal(staffPhotoPathFor({ name: "J. Smith", email: " jsmith@SETTY.com " }, index), "a1/x.jpg");
});
test("a team row with no email matches by name", () => {
  assert.equal(staffPhotoPathFor({ name: "  jane smith" }, index), "a1/x.jpg");
  assert.equal(staffPhotoPathFor({ name: "Sam Lee", email: "slee@setty.com" }, index), "b2/y.jpg");
});
test("a same-named person with a different email gets no photo", () => {
  assert.equal(staffPhotoPathFor({ name: "Jane Smith", email: "jane.smith@other.com" }, index), "");
});
test("no photo, no person, no index", () => {
  assert.equal(staffPhotoPathFor({ name: "No Photo", email: "np@setty.com" }, index), "");
  assert.equal(staffPhotoPathFor({ name: "", email: "" }, index), "");
  assert.equal(staffPhotoPathFor(null, index), "");
  assert.equal(staffPhotoPathFor({ name: "Jane Smith" }, null), "");
});
test("public address and initials", () => {
  assert.equal(staffPhotoUrl("a1/x y.jpg"), "https://x.test/storage/v1/object/public/staff-photos/a1/x%20y.jpg");
  assert.equal(staffPhotoUrl(""), "");
  assert.equal(staffInitials("  Jane  van Smith "), "Jv");
  assert.equal(staffInitials(""), "");
});

// Accolades.html has its own copy of the lookup (photoPathFor). Same cases.
const acc = readFileSync(new URL("./Accolades.html", import.meta.url), "utf8");
const c = acc.indexOf("const photoByEmail = new Map()");
const d = acc.indexOf("function initialsOf(", c);
assert.ok(c > 0 && d > c, "could not slice photoPathFor out of Accolades.html");
const accMod = await import("data:text/javascript;base64," +
  Buffer.from(acc.slice(c, d) + "\nexport { photoByEmail, photoByName, photoPathFor };", "utf8").toString("base64"));
accMod.photoByEmail.set("jsmith@setty.com", "a1/x.jpg");
accMod.photoByName.set("jane smith", { path: "a1/x.jpg", mail: "jsmith@setty.com" });
accMod.photoByName.set("sam lee", { path: "b2/y.jpg", mail: "" });

test("Accolades: same lookup rules as the PMS", () => {
  const f = accMod.photoPathFor;
  assert.equal(f(" JSmith@SETTY.com ", "J. Smith"), "a1/x.jpg");
  assert.equal(f("", "  jane smith"), "a1/x.jpg");
  assert.equal(f("slee@setty.com", "Sam Lee"), "b2/y.jpg");
  assert.equal(f("jane.smith@other.com", "Jane Smith"), "");
  assert.equal(f("np@setty.com", "No Photo"), "");
  assert.equal(f("", ""), "");
});

// Who "Import photos from Microsoft 365" tries: active, with an email, no photo.
const e = html.indexOf("function staffNeedingPhotoImport(");
const f = html.indexOf("\n}", e);
assert.ok(e > 0 && f > e, "could not slice staffNeedingPhotoImport out of SettyPMS.html");
const { staffNeedingPhotoImport } = await import("data:text/javascript;base64," +
  Buffer.from(html.slice(e, f + 2) + "\nexport { staffNeedingPhotoImport };", "utf8").toString("base64"));

test("the Microsoft 365 import never replaces a photo and skips inactive people", () => {
  const out = staffNeedingPhotoImport([
    { id: "1", name: "Has Photo", email: "a@setty.com", photoPath: "1/x.jpg" },
    { id: "2", name: "Left", email: "b@setty.com", inactive: true },
    { id: "3", name: "No Email", email: "" },
    { id: "4", name: "Wanted", email: "d@setty.com" },
    null,
  ]);
  assert.deepEqual(out.map(s => s.id), ["4"]);
  assert.deepEqual(staffNeedingPhotoImport(undefined), []);
});

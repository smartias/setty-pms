// Fire Alarm discipline, manual add and export wiring in SettyIntelligence.html
// (tech-director requests, Nov 2026).   node --test knowledgeFireAlarm.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("./SettyIntelligence.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const mig = readFileSync(new URL("./supabase/migrations/20261118120000_fire_alarm_discipline.sql", import.meta.url), "utf8");

// The shipped regex, pulled from the page so the test cannot drift from it.
const re = eval(page.match(/const FIRE_ALARM_RE = (\/.*\/i);/)[1]);

test("Fire Alarm terms from the directors' list are caught", () => {
  for (const t of ["Provide FACP with battery calculations", "Notification appliance circuit loading", "horn/strobe at corridors",
    "smoke detector spacing per NFPA 72", "NFPA-72 survivability", "manual pull station height", "addressable devices on the SLC",
    "initiating device circuit", "duct detector at AHU-1", "annunciator panel at main entry", "Fire alarm shop drawings", "28 31 00"])
    assert.ok(re.test(t), t);
});

test("sprinkler, standpipe and fire pump items are not flagged", () => {
  for (const t of ["Standpipe hose valve locations", "Fire pump churn test", "Sprinkler head spacing per NFPA 13", "Addressable lighting controls", "Speaker phone in conference room"])
    assert.ok(!re.test(t), t);
});

test("Fire Alarm is in the picker and the filters offer the untagged list", () => {
  assert.ok(page.includes('"Fire Protection","Fire Alarm","Structural"'));
  assert.ok(page.includes('sel === FA_CANDIDATES ? isFireAlarmCandidate(r) : knowledgeDisciplines(r).includes(sel)'));
  assert.ok(page.includes("!knowledgeDisciplines(r).includes(\"Fire Alarm\") && FIRE_ALARM_RE.test"), "already-tagged rows are not candidates");
});

test("Agency Preferences has a discipline filter", () => {
  assert.ok(page.includes('id="apDisc"') && page.includes('state.prefs.f.discipline=this.value'));
});

test("manual adds go to review, never straight to approved/active", () => {
  assert.ok(page.includes('const status = approve ? "approved" : (id ? $("bp_status").value : "draft");'));
  assert.ok(page.includes('const status = id ? $("sf_status").value : "suggested";'));
  assert.ok(page.includes('knowledgeToolsHTML("practices", "openPracticeForm")') && page.includes('knowledgeToolsHTML("standards", "openStandardForm")'));
  assert.ok(page.includes('${!isNew && p.status !== "approved" ? `<button class="btn btn-success"'), "approve button is hidden on a new entry");
});

test("every tab has Excel export and report", () => {
  for (const k of ["lessons", "practices", "agencies", "standards"]) {
    assert.ok(new RegExp(`knowledgeToolsHTML\\("${k}"`).test(page), `${k} toolbar`);
    assert.ok(new RegExp(`\\n  ${k}: \\{ title:`).test(page), `${k} export config`);
  }
});

test("migration only changes the Fire Alarm mapping", () => {
  assert.ok(mig.includes("when lower(btrim(d)) = 'fire alarm' then 'Fire Alarm'"));
  assert.ok(mig.includes("('fire protection/fuel','fire/life safety') then 'Fire Protection'"));
  assert.ok(!/update public\./i.test(mig) && !/delete from/i.test(mig), "no data is rewritten");
});

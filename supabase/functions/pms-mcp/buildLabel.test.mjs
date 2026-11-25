// The connector's build label comes from the deployment, not from a hand-edited
// constant (buildLabel.ts).
//
//   node --test supabase/functions/pms-mcp/buildLabel.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildLabel, deploymentIdFromEnv, LOCAL_BUILD } from "./buildLabel.ts";

test("the hosted deployment id gives deploy-<version>", () => {
  assert.equal(buildLabel("khxmgjilwhdguuepbhne_6c3f0e2a-91b4-4a5e-9d0f-1a2b3c4d5e6f_412"), "deploy-412");
  assert.equal(buildLabel(" abc_def_7 "), "deploy-7");
});

test("an id in another shape is still named, and no id is a local run", () => {
  assert.equal(buildLabel("some-other-format-without-version"), "deploy-hout-version");
  assert.equal(buildLabel(""), LOCAL_BUILD);
  assert.equal(buildLabel(undefined), LOCAL_BUILD);
  assert.equal(buildLabel(null), LOCAL_BUILD);
});

test("reading the environment never throws", () => {
  assert.equal(deploymentIdFromEnv(() => { throw new Error("PermissionDenied"); }), undefined);
  assert.equal(deploymentIdFromEnv((n) => (n === "DENO_DEPLOYMENT_ID" ? "x_y_3" : undefined)), "x_y_3");
});

test("nothing has to be edited by hand to tell which copy is live", () => {
  const here = new URL(".", import.meta.url);
  const src = readFileSync(new URL("./index.ts", here), "utf8");
  assert.ok(src.includes("const BUILD = buildLabel(deploymentIdFromEnv((n) => Deno.env.get(n)));"));
  assert.ok(!/const BUILD = "/.test(src), "no hand-written build string left to conflict on");
  const wf = readFileSync(new URL("../../../.github/workflows/deploy-pms-mcp.yml", here), "utf8");
  assert.ok(!wf.includes("const BUILD"), "the deploy workflow no longer reads a constant from the source");
  assert.ok(wf.includes('"build":"deploy-'), "it waits for a deploy- label different from the one before");
  const ps = readFileSync(new URL("./deploy.ps1", here), "utf8");
  assert.ok(!ps.includes("const BUILD"), "nor does deploy.ps1");
});

// Tests for lazyModule.ts: the shared load behind view_drawing / view_photos.
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { lazyModule } from "./lazyModule.ts";

// A module namespace whose export throws until `readyAfter` reads have been
// made: what a half-evaluated ES module looks like from outside.
function halfLoaded(readyAfter) {
  let reads = 0;
  class Image {}
  return { get Image() { if (reads++ < readyAfter) throw new ReferenceError("Cannot access 'Image' before initialization"); return Image; } };
}

test("concurrent callers share one import", async () => {
  let loads = 0;
  const mod = halfLoaded(0);
  const get = lazyModule(async () => { loads++; await new Promise((r) => setTimeout(r, 10)); return mod; }, (m) => m.Image);
  const got = await Promise.all([get(), get(), get(), get()]);
  assert.equal(loads, 1);
  assert.ok(got.every((g) => g === got[0] && typeof g === "function"));
  await get();
  assert.equal(loads, 1, "later calls reuse it too");
});

test("an export that is not initialised yet is waited for, not thrown", async () => {
  const get = lazyModule(async () => halfLoaded(3), (m) => m.Image, { waitMs: 1 });
  assert.equal(typeof await get(), "function");
});

test("it gives up after the allowed tries and the next call starts over", async () => {
  let loads = 0;
  const get = lazyModule(async () => { loads++; return loads === 1 ? halfLoaded(99) : halfLoaded(0); }, (m) => m.Image, { tries: 3, waitMs: 1 });
  await assert.rejects(get(), /before initialization/);
  assert.equal(typeof await get(), "function");
  assert.equal(loads, 2);
});

test("a failed import is not cached, and other errors are not retried", async () => {
  let loads = 0;
  const get = lazyModule(async () => { loads++; if (loads === 1) throw new Error("network"); return halfLoaded(0); }, (m) => m.Image);
  await assert.rejects(get(), /network/);
  assert.equal(typeof await get(), "function");
  let picks = 0;
  const bad = lazyModule(async () => ({}), () => { picks++; throw new TypeError("boom"); }, { waitMs: 1 });
  await assert.rejects(bad(), /boom/);
  assert.equal(picks, 1);
  await assert.rejects(lazyModule(async () => ({}), (m) => m.Image, { tries: 2, waitMs: 1 })(), /missing/);
});

test("index.ts loads imagescript only through the shared loader", () => {
  const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.equal(src.split('import("imagescript")').length - 1, 1, "one import site");
  assert.ok(src.includes('const imageClass = lazyModule(() => import("imagescript"), (m) => m.Image);'));
  assert.equal(src.split("await imageClass()").length - 1, 2, "view_drawing and view_photos both use it");
});

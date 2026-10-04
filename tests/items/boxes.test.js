import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeBoxList } from "../../src/items/itemWeights.js";

const goodBox = (over = {}) => ({
  id: 1,
  x: 10,
  y: 2,
  z: -30,
  s: 1,
  active: true,
  respawnAt: 0,
  ...over,
});

test("valid box lists pass through cleaned", () => {
  const out = normalizeBoxList([goodBox(), goodBox({ id: 2, active: false, respawnAt: 5000 })]);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, 1);
  assert.equal(out[1].active, false);
});

test("bad entries are dropped, bad lists rejected", () => {
  assert.equal(normalizeBoxList(null), null);
  assert.equal(normalizeBoxList("nope"), null);
  assert.equal(normalizeBoxList(new Array(11).fill(0).map((_, i) => goodBox({ id: i }))), null);
  // One bad entry drops only itself.
  const out = normalizeBoxList([goodBox(), { id: "x", x: NaN }]);
  assert.equal(out.length, 1);
  // Coordinates clamp to the same bounds as live transforms.
  const clamped = normalizeBoxList([goodBox({ x: 99999, y: -99999 })]);
  assert.ok(Math.abs(clamped[0].x) <= 2500);
  assert.ok(Math.abs(clamped[0].y) <= 500);
});

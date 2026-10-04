import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateSlot } from "../../src/items/itemWeights.js";
import { itemConfig } from "../../src/items/itemConfig.js";

test("v2 triple migrates to variant shape", () => {
  assert.deepEqual(migrateSlot({ type: "triple", charges: 3, expiresAt: 0 }), {
    type: "mushroom",
    variant: "triple",
    usesLeft: 3,
  });
});

test("v2 single items migrate to single variant", () => {
  assert.deepEqual(migrateSlot({ type: "red", charges: 1, expiresAt: 0 }), {
    type: "red",
    variant: "single",
    usesLeft: 1,
  });
  assert.equal(migrateSlot(null), null);
  assert.equal(migrateSlot(undefined), null);
});

test("config carries the prompt values", () => {
  assert.equal(itemConfig.roulette.durationMs, 2500);
  assert.equal(itemConfig.slots, 1);
  assert.equal(itemConfig.boxRespawnMs, 3000);
  assert.equal(itemConfig.unit, 1.21);
  assert.equal(itemConfig.golden.tint, 0xffd23f);
  assert.equal(itemConfig.usePositionWeights, false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { itemConfig } from "../../src/items/itemConfig.js";
import {
  boostTargetSpeed,
  nextBoostUntil,
  refireAllowed,
} from "../../src/items/itemWeights.js";

test("re-using a mushroom resets the timer, never stacks", () => {
  const d = itemConfig.mushroom.boostMs;
  // First use at t=0 ends at d; second use at t=d/2 ends at t=d/2+d (not 2d).
  assert.equal(nextBoostUntil(0, 0, d), d);
  assert.equal(nextBoostUntil(d, d / 2, d), d / 2 + d);
});

test("golden re-fire respects the minimum gap", () => {
  const gap = itemConfig.golden.minGapMs;
  assert.equal(refireAllowed(1000, 1000 + gap, gap), true);
  assert.equal(refireAllowed(1000, 1000 + gap - 1, gap), false);
  assert.equal(refireAllowed(0, 5000, gap), true);
});

test("boost target is 1.5x kart max, scaled", () => {
  assert.equal(boostTargetSpeed(30, 2), 90);
  assert.equal(
    boostTargetSpeed(30, 1),
    30 * itemConfig.mushroom.speedMult
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { itemConfig } from "../../src/items/itemConfig.js";
import { worldSize, targetSize } from "../../src/items/itemScale.js";
import { clampShellMul } from "../../src/items/homing.js";
import { redProjectileMul, redSingleMul, blueMul } from "../../src/items/itemScale.js";

// Single red is 0.7x current size; triple stays 0.22 (base). Projectile
// inherits the source size so launch has no size pop. Blue mul is a
// slider-only 1 (no value change).
test("red single multiplier is 0.7, blue multiplier is 1", () => {
  assert.equal(itemConfig.sizes.redShellSingleMul, 0.7);
  assert.equal(itemConfig.sizes.blueShellMul, 1);
  assert.equal(itemConfig.sizes.redShell, 0.22);
});

test("red projectile inherits source size (single 0.7x, triple 1x)", () => {
  assert.equal(redSingleMul(), 0.7);
  assert.equal(redProjectileMul(false), 0.7);
  assert.equal(redProjectileMul(true), 1);
  assert.equal(blueMul(), 1);
});

test("single red world size is 0.7x triple within 1%", () => {
  const single = worldSize("red", redSingleMul());
  const triple = targetSize("red");
  assert.ok(Math.abs(single - triple * 0.7) / (triple * 0.7) <= 0.01);
});

test("shell sizeMul clamps to 0.2..3 like bombs", () => {
  assert.equal(clampShellMul(0.7), 0.7);
  assert.equal(clampShellMul(1), 1);
  assert.equal(clampShellMul(99), 3);
  assert.equal(clampShellMul(-1), 0.2);
  assert.equal(clampShellMul(NaN), 1);
});

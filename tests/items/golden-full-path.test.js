import { test } from "node:test";
import assert from "node:assert/strict";
import { GOLDEN_MS, consumeUse, rowToSlot } from "../../src/items/itemWeights.js";
import { goldenScaleMul, goldenTimerFraction, visualFor } from "../../src/items/itemVisuals.js";
import { targetSize } from "../../src/items/itemScale.js";

// Full golden lifecycle through the REAL functions (no mocks):
// pickup → held (full size, visible) → first press opens the 7s window →
// re-uses boost → expiry clears. Regression pin: the held render scale is
// a pure FRACTION (the model already carries its base scale) — multiplying
// by base again shrank it 31x into invisibility.
test("golden full path: hold full-size, first press opens window, reuse boosts, expiry clears", () => {
  const t0 = 100000;
  // Pickup: window unopened.
  let held = rowToSlot("golden", t0);
  assert.equal(held.windowUntil, null);

  // (a) Held before first use: full size, visible.
  assert.equal(visualFor(held, {}, t0).timerFraction, 1);
  assert.equal(goldenTimerFraction(held.windowUntil, t0), 1);
  assert.equal(goldenScaleMul(held.windowUntil, t0), 1);
  const world = targetSize("golden") * goldenScaleMul(held.windowUntil, t0);
  assert.ok(
    Math.abs(world - targetSize("mushroom")) / targetSize("mushroom") <= 0.01,
    `held golden ${world} must equal normal mushroom ${targetSize("mushroom")}`
  );

  // (b) First press: boost + window opens for exactly 7s.
  let r = consumeUse({ item: held, now: t0 });
  assert.equal(r.boosted, true);
  assert.equal(r.item.windowUntil, t0 + GOLDEN_MS);
  held = r.item;

  // +2s in: still boosting, ~5/7 of the window left, still well visible.
  const t2 = t0 + 2000;
  r = consumeUse({ item: held, now: t2 });
  assert.equal(r.boosted, true);
  assert.equal(r.item, held);
  const frac2 = visualFor(held, {}, t2).timerFraction;
  assert.ok(Math.abs(frac2 - 5 / 7) < 0.01, `timerFraction ${frac2} ~= 5/7`);
  assert.ok(goldenScaleMul(held.windowUntil, t2) > 0.5, "still large mid-window");

  // (d) +8s: window over → no boost, slot clears.
  const t8 = t0 + 8000;
  r = consumeUse({ item: held, now: t8 });
  assert.equal(r.boosted, false);
  assert.equal(r.item, null);
  assert.equal(visualFor(r.item, {}, t8).held, "none");
});

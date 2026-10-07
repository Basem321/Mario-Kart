import { test } from "node:test";
import assert from "node:assert/strict";
import { GOLDEN_MS, consumeUse, makeCarriedItem, rowToSlot } from "../../src/items/itemWeights.js";
import { visualFor } from "../../src/items/itemVisuals.js";
import { worldSize } from "../../src/items/itemScale.js";

// §4.2: golden window opens on FIRST USE, not on pickup. While held
// (windowUntil null) the mushroom is full size, HUD/shrink/P2P idle.
test("golden pickup leaves windowUntil null (window starts at first use)", () => {
  const slot = rowToSlot("golden", 1000);
  assert.equal(slot.type, "golden");
  assert.equal(slot.windowUntil, null);
  const made = makeCarriedItem("golden", "single", 1000);
  assert.equal(made.windowUntil, null);
});

test("golden first consumeUse opens the 7s window", () => {
  const held = { type: "golden", variant: "single", usesLeft: -1, windowUntil: null };
  const r = consumeUse({ item: held, now: 5000 });
  assert.equal(r.boosted, true);
  assert.equal(r.item.windowUntil, 5000 + GOLDEN_MS);
});

test("golden held before first use has timerFraction 1", () => {
  const held = { type: "golden", variant: "single", usesLeft: -1, windowUntil: null };
  assert.equal(visualFor(held, {}, 6000).timerFraction, 1);
});

test("golden at timerFraction 1 matches normal mushroom size within 1%", () => {
  const golden = { type: "golden", variant: "single", usesLeft: -1, windowUntil: null };
  const vis = visualFor(golden, {}, 6000);
  assert.equal(vis.timerFraction, 1);
  const g = worldSize("golden");
  const m = worldSize("mushroom");
  assert.ok(Math.abs(g - m) / Math.abs(m) <= 0.01, `golden ${g} vs mushroom ${m}`);
});

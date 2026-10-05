import { test } from "node:test";
import assert from "node:assert/strict";
import { pickAnim, visualFor } from "../../src/items/itemVisuals.js";

test("visualFor covers every item and variant", () => {
  assert.deepEqual(visualFor(null, {}, 1000).held, "none");
  assert.deepEqual(visualFor({ type: "mushroom", variant: "single", usesLeft: 1 }, {}, 0), {
    held: "rack", count: 1, tint: null, timerFraction: 1,
  });
  assert.deepEqual(visualFor({ type: "mushroom", variant: "triple", usesLeft: 2 }, {}, 0).count, 2);
  assert.equal(visualFor({ type: "red", variant: "single", usesLeft: 1 }, {}, 0).held, "trail");
  const orbit = visualFor({ type: "red", variant: "triple", usesLeft: 2 }, {}, 0);
  assert.equal(orbit.held, "orbit");
  assert.equal(orbit.count, 2);
  assert.equal(visualFor({ type: "blue", variant: "single", usesLeft: 1 }, {}, 0).held, "trail");
  assert.equal(visualFor({ type: "bullet", variant: "single", usesLeft: 1 }, {}, 0).held, "rack");
  assert.equal(visualFor({ type: "blooper", variant: "single", usesLeft: 1 }, {}, 0).held, "float");
  assert.equal(visualFor({ type: "bomb" }, {}, 0).held, "rack");
});

test("golden shows the shrinking window timer", () => {
  const item = { type: "golden", variant: "single", usesLeft: -1, windowUntil: 8000 };
  assert.equal(visualFor(item, {}, 1000).timerFraction, 1);
  assert.equal(visualFor(item, {}, 4500).timerFraction, 0.5);
  assert.equal(visualFor(item, {}, 8000).timerFraction, 0);
  assert.equal(visualFor(item, {}, 1000).tint, "gold");
});

test("animation priority: hit over bullet over item-action over drive", () => {
  const now = 5000;
  const stack = [
    { name: "drive", until: Infinity },
    { name: "boost_lean", until: now + 1000 },
    { name: "bullet", until: now + 4000 },
    { name: "spin_hit_light", until: now + 1000 },
  ];
  assert.equal(pickAnim(stack, now), "spin_hit_light");
  assert.equal(
    pickAnim(stack.filter((s) => s.name !== "spin_hit_light"), now),
    "bullet"
  );
  assert.equal(pickAnim([{ name: "drive", until: Infinity }], now), "drive");
  assert.equal(pickAnim([], now), "drive");
});

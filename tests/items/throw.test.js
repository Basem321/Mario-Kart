import { test } from "node:test";
import assert from "node:assert/strict";
import { cruiseSettle } from "../../src/items/homing.js";

test("thrown shells settle from toss height to cruise height", () => {
  // Starts above cruise, converges downward, never overshoots.
  let y = 3.0;
  const cruise = 1.0;
  for (let i = 0; i < 120; i += 1) y = cruiseSettle(y, cruise, 1 / 60);
  assert.ok(Math.abs(y - cruise) < 0.01, `did not converge: ${y}`);
  const step = cruiseSettle(3.0, cruise, 1 / 60);
  assert.ok(step < 3.0 && step > cruise, "must move down without overshoot");
  assert.equal(cruiseSettle(cruise, cruise, 1 / 60), cruise);
});

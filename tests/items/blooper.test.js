import { test } from "node:test";
import assert from "node:assert/strict";
import { BLOOPER_INK_MS, inkUntil, targetsAhead } from "../../src/items/homing.js";

test("targetsAhead returns only racers ahead, never self or behind", () => {
  const self = { id: "me", x: 0, z: 0, laps: 1, fx: 0, fz: -1 };
  const racers = [
    { id: "me", x: 0, z: -5, laps: 1 },
    { id: "behind", x: 0, z: 5, laps: 1 },
    { id: "ahead", x: 1, z: -10, laps: 1 },
    { id: "leader", x: 0, z: 50, laps: 2 },
    { id: "lapped", x: 0, z: -50, laps: 0 },
  ];
  assert.deepEqual(targetsAhead(self, racers).sort(), ["ahead", "leader"]);
  assert.deepEqual(targetsAhead(self, []), []);
  assert.deepEqual(targetsAhead(null, racers), []);
});

test("ink lasts six seconds and re-fire extends, never stacks", () => {
  assert.equal(BLOOPER_INK_MS, 6000);
  const first = inkUntil(1000);
  assert.equal(first, 7000);
  const second = inkUntil(3000);
  assert.ok(second > first, "re-fire must extend the expiry");
  assert.equal(typeof second, "number");
});

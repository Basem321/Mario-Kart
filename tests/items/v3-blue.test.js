import { test } from "node:test";
import assert from "node:assert/strict";
import { itemConfig } from "../../src/items/itemConfig.js";
import {
  blueShouldDive,
  retargetBlue,
  spawnDue,
} from "../../src/items/homing.js";

test("re-target is stable on ties, switches on laps-greater", () => {
  const rows = [
    { id: "a", laps: 2, dist: 100 },
    { id: "b", laps: 2, dist: 102 }, // +2: tie, keep current
    { id: "c", laps: 1, dist: 900 },
  ];
  assert.equal(retargetBlue("a", rows), "a");
  assert.equal(
    retargetBlue("a", [
      { id: "a", laps: 2, dist: 100 },
      { id: "b", laps: 2, dist: 106 }, // +6: switch
    ]),
    "b"
  );
  assert.equal(
    retargetBlue("c", [
      { id: "a", laps: 2, dist: 100 },
      { id: "c", laps: 1, dist: 900 },
    ]),
    "a"
  );
  assert.equal(retargetBlue("a", []), "a");
});

test("dive needs proximity AND the minimum flight time", () => {
  const min = itemConfig.blueShell.minFlightMs;
  assert.equal(min, 2000);
  assert.equal(blueShouldDive({ distXZ: 3, flightMs: min }), true);
  assert.equal(blueShouldDive({ distXZ: 3, flightMs: min - 1 }), false);
  assert.equal(blueShouldDive({ distXZ: 10, flightMs: min + 5000 }), false);
});

test("committed press spawns even if the owner pauses before release", () => {
  // Release queue is fire-and-forget: due means spawn, no owner-state check.
  assert.equal(
    spawnDue({ pressAt: 1000, releaseMs: itemConfig.throwUp.releaseMs }, 1000 + itemConfig.throwUp.releaseMs),
    true
  );
});

test("blue config matches spec", () => {
  assert.equal(itemConfig.blueShell.altitude, 14);
  assert.equal(itemConfig.blueShell.speedMult, 2.2);
  assert.equal(itemConfig.blueShell.radius, 8);
  assert.equal(itemConfig.blueShell.spinMs, 2500);
});

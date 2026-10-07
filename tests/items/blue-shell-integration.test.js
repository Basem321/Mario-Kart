import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blueShouldDive,
  resolveBlueBlast,
  retargetBlue,
  canFireBlue,
  hydrateRemoteShell,
  spinWindows,
} from "../../src/items/homing.js";
import { leaderOf, compareRacers } from "../../src/items/itemWeights.js";

// Full integration test covering the complete Blue Shell path:
// 1. Leader identification with un-lapped racers (Bug 2 root cause fix)
// 2. Flight altitude and dive gate criteria
// 3. Dive tracking on target coordinates
// 4. Explosion blast resolution on the leader
// 5. Heavy spin application on the victim
test("blue shell full path: leader targeting, flight, dive gate, blast hit, and spin window", () => {
  const me = "shooter-B";
  const leaderId = "leader-A";

  // 1. Leader identification on Lap 1:
  // Both racers on lap 0, leader has driven 60m, shooter has driven 10m.
  const rows = [
    { id: me, laps: 0, finished: false, dist: 10 },
    { id: leaderId, laps: 0, finished: false, dist: 60 },
  ];
  assert.equal(compareRacers(rows[1], rows[0]) < 0, true, "Leader A ranks ahead of Shooter B");
  assert.equal(leaderOf(rows), leaderId, "leaderOf correctly returns leader A");
  assert.equal(canFireBlue({ isOnlineRace: true, leaderId }), true, "canFireBlue permits launch");

  // 2. Shell launch & flight hydration:
  const t0 = 10000;
  const rawShell = {
    id: "blue-test-1",
    kind: "blue",
    x: 0,
    y: 1,
    z: 0,
    targetId: leaderId,
    ownerId: me,
  };
  const hydrated = hydrateRemoteShell(rawShell, t0);
  assert.equal(hydrated.at, t0);
  assert.equal(hydrated.phase, "fly");
  assert.ok(hydrated.top > 10, "Shell top altitude is set above cruise height");

  // 3. Dive gate criteria:
  // Needs distXZ < 4 AND flightMs >= 2000
  assert.equal(blueShouldDive({ distXZ: 3, flightMs: 1500 }), false, "Flight too short (<2s)");
  assert.equal(blueShouldDive({ distXZ: 10, flightMs: 2500 }), false, "Distance too far (>4u)");
  assert.equal(blueShouldDive({ distXZ: 3.5, flightMs: 2100 }), true, "Proximity + flight time = dive!");

  // 4. Stable re-targeting doesn't flap on minor variations:
  assert.equal(
    retargetBlue(leaderId, [
      { id: leaderId, laps: 0, dist: 60 },
      { id: me, laps: 0, dist: 15 },
    ]),
    leaderId,
    "Target remains locked on leader A"
  );

  // 5. Explosion blast resolution:
  // During dive, shell lands at leader's coordinates (x: 100, z: 200)
  const targetPos = { x: 100, z: 200 };
  const blast = { x: targetPos.x, y: 0, z: targetPos.z };
  const racers = [
    { id: leaderId, x: 101, z: 199.5 }, // 1.5m away, well inside 8m blast radius
    { id: me, x: 20, z: 40 },          // 180m away, completely unaffected
  ];
  const victimsHit = resolveBlueBlast(racers, blast, 8);
  assert.deepEqual(victimsHit, [leaderId], "Leader A is caught in the blue blast; shooter B is unaffected");

  // 6. Heavy spin parameters on victim:
  const hitTime = t0 + 3000;
  const windows = spinWindows({ heavy: true, now: hitTime });
  assert.equal(windows.spinUntil, hitTime + 2500, "Heavy spin lasts 2500ms");
  assert.equal(windows.invulnUntil, hitTime + 4500, "Post-spin invulnerability lasts 2000ms");
});

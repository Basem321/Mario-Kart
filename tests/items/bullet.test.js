import { test } from "node:test";
import assert from "node:assert/strict";
import { kartSettings } from "../../src/constants.js";
import { itemConfig } from "../../src/items/itemConfig.js";
import {
  BULLET_KNOCK_RADIUS,
  BULLET_RIDE_MS,
  BULLET_SPEED,
  bulletActive,
  bulletPhase,
  resolveBlueBlast,
} from "../../src/items/homing.js";

test("bullet ride lasts five seconds on the performance clock", () => {
  assert.equal(BULLET_RIDE_MS, 5000);
  assert.equal(bulletActive({ until: 6000 }, 5999), true);
  assert.equal(bulletActive({ until: 6000 }, 6000), false);
  assert.equal(bulletActive(null, 1000), false);
});

test("ride phases: full ride, 600ms ramp, then done", () => {
  const ride = { until: 5000, endingUntil: 5600 };
  assert.equal(bulletPhase(ride, 4999), "ride");
  assert.equal(bulletPhase(ride, 5000), "ramp");
  assert.equal(bulletPhase(ride, 5599), "ramp");
  assert.equal(bulletPhase(ride, 5600), "done");
  assert.equal(bulletPhase(null, 1000), "done");
  assert.equal(itemConfig.bullet.rampOutMs, 600);
  assert.equal(itemConfig.bullet.endInvulnMs, 1000);
});

test("bullet speed is 1.6x kart max (spec value, tune in config)", () => {
  assert.equal(
    BULLET_SPEED,
    kartSettings.speed.max * itemConfig.bullet.speedMult
  );
});

test("bullet knocks only karts in contact radius", () => {
  assert.equal(BULLET_KNOCK_RADIUS, 3.5);
  const blast = { x: 0, z: 0 };
  const racers = [
    { id: "close", x: 2, z: 1 },
    { id: "far", x: 20, z: 0 },
  ];
  assert.deepEqual(
    resolveBlueBlast(racers, blast, BULLET_KNOCK_RADIUS),
    ["close"]
  );
});

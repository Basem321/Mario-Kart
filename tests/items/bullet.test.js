import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BULLET_KNOCK_RADIUS,
  BULLET_RIDE_MS,
  BULLET_SPEED,
  bulletActive,
  resolveBlueBlast,
} from "../../src/items/homing.js";

test("bullet ride lasts five seconds on the performance clock", () => {
  assert.equal(BULLET_RIDE_MS, 5000);
  assert.equal(bulletActive({ until: 6000 }, 5999), true);
  assert.equal(bulletActive({ until: 6000 }, 6000), false);
  assert.equal(bulletActive(null, 1000), false);
});

test("bullet speed is double pad boost", () => {
  assert.equal(BULLET_SPEED, 124);
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

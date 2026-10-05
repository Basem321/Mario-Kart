import { test } from "node:test";
import assert from "node:assert/strict";
import { itemConfig } from "../../src/items/itemConfig.js";
import {
  absorbedByOrbit,
  bounceShell,
  coneLock,
  orbitAngle,
  spawnDue,
  spinBlocked,
  spinWindows,
  wallHitNormal,
} from "../../src/items/homing.js";

test("cone lock picks nearest ahead inside 60u/50deg, else null", () => {
  const cfg = itemConfig.redShell;
  const self = { id: "me", x: 0, z: 0, fx: 0, fz: -1 };
  const racers = [
    { id: "side", x: 50, z: -10 }, // ~79° off — outside cone
    { id: "far", x: 0, z: -100 }, // in cone but out of range
    { id: "near", x: 3, z: -20 }, // in cone, nearest
    { id: "mid", x: -2, z: -40 }, // in cone, further
  ];
  assert.equal(coneLock(self, racers).id, "near");
  assert.equal(coneLock(self, [{ id: "s", x: 50, z: 0 }]), null);
  assert.equal(coneLock(self, []), null);
  assert.equal(cfg.lockRange, 60);
  assert.equal(cfg.lockConeDeg, 50);
});

test("wall bounce reflects heading, max 3 then drop", () => {
  // Heading +X into a -X normal wall → -X, one bounce spent.
  const b1 = bounceShell({ x: 1, z: 0 }, { x: -1, z: 0 }, 3);
  assert.deepEqual([b1.dx, b1.dz, b1.left], [-1, 0, 2]);
  const b0 = bounceShell({ x: 1, z: 0 }, { x: -1, z: 0 }, 1);
  assert.deepEqual([b0.dx, b0.dz, b0.left], [-1, 0, 0]);
  assert.equal(bounceShell({ x: 1, z: 0 }, { x: -1, z: 0 }, 0), null);
  assert.equal(itemConfig.redShell.maxBounces, 3);
});

test("orbit angles come from the shared race clock", () => {
  // 180 deg/s: 1000ms → 180deg; index adds 120deg phases; wraps at 360.
  assert.equal(orbitAngle(1000, 0), 180);
  assert.equal(orbitAngle(0, 1), 120);
  assert.equal(orbitAngle(2000, 2), 240);
  assert.equal(orbitAngle(500, 0), 90);
  assert.equal(orbitAngle(2000, 0), 0);
});

test("orbit absorbs red/bomb but not blue/bullet/blooper", () => {
  assert.equal(absorbedByOrbit("red"), true);
  assert.equal(absorbedByOrbit("bomb"), true);
  assert.equal(absorbedByOrbit("blue"), false);
  assert.equal(absorbedByOrbit("bullet"), false);
  assert.equal(absorbedByOrbit("blooper"), false);
});

test("press commits usesLeft, spawn happens at releaseMs not press", () => {
  assert.equal(spawnDue({ pressAt: 1000, releaseMs: 180 }, 1000), false);
  assert.equal(spawnDue({ pressAt: 1000, releaseMs: 180 }, 1179), false);
  assert.equal(spawnDue({ pressAt: 1000, releaseMs: 180 }, 1180), true);
});

test("spin windows: light 1500, heavy 2500, then 2000 invuln", () => {
  assert.deepEqual(spinWindows({ heavy: false, now: 1000 }), {
    spinUntil: 2500, invulnUntil: 4500,
  });
  assert.deepEqual(spinWindows({ heavy: true, now: 1000 }), {
    spinUntil: 3500, invulnUntil: 5500,
  });
  // Custom window (bullet touch = 1000ms spin, same 2000ms invuln tail).
  assert.deepEqual(spinWindows({ ms: 1000, now: 1000 }), {
    spinUntil: 2000, invulnUntil: 4000,
  });
});

test("no steering/use while spinning; mushrooms allowed while invuln", () => {
  assert.deepEqual(
    spinBlocked({ spinUntil: 2000, invulnUntil: 4000, now: 1000 }),
    { steer: false, use: false }
  );
  assert.deepEqual(
    spinBlocked({ spinUntil: 2000, invulnUntil: 4000, now: 3000 }),
    { steer: true, use: true }
  );
  assert.deepEqual(
    spinBlocked({ spinUntil: 0, invulnUntil: 0, now: 9999 }),
    { steer: true, use: true }
  );
});

test("wallHitNormal finds the wall face for near points", () => {
  const segs = [{ ax: 0, az: -5, bx: 10, bz: -5 }];
  const hit = wallHitNormal(5, -4.2, segs, 1);
  assert.ok(hit, "expected a wall hit");
  assert.ok(Math.abs(hit.z) > 0.9, `normal should face +Z, got ${hit.z}`);
  assert.equal(wallHitNormal(50, 50, segs, 1), null);
  assert.equal(wallHitNormal(5, -4.2, [], 1), null);
});

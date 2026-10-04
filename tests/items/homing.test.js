import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RED_HIT_RADIUS,
  RED_LIFE_MS,
  RED_MAX_TURN,
  nearestAhead,
  steerShell,
} from "../../src/items/homing.js";

const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test("shell turns toward target but never more than maxTurn*dt", () => {
  // Facing +Z, target due +X: needs a left turn of PI/2.
  const out = steerShell({
    dir: { x: 0, z: 1 },
    toTarget: { x: 1, z: 0 },
    maxTurn: RED_MAX_TURN,
    dt: 0.1,
  });
  const before = Math.atan2(0, 1);
  const after = Math.atan2(out.x, out.z);
  const turned = Math.abs(after - before);
  assert.ok(turned > 0, "shell did not turn");
  assert.ok(
    turned <= RED_MAX_TURN * 0.1 + 1e-9,
    `turned ${turned}, limit ${RED_MAX_TURN * 0.1}`
  );
  assert.ok(approx(Math.hypot(out.x, out.z), 1), "dir not unit length");
});

test("shell already aimed keeps its heading", () => {
  const out = steerShell({
    dir: { x: 0, z: 1 },
    toTarget: { x: 0, z: 5 },
    maxTurn: RED_MAX_TURN,
    dt: 0.016,
  });
  assert.ok(approx(out.x, 0) && approx(out.z, 1));
});

test("direct hit registers inside the trigger radius", () => {
  assert.equal(RED_HIT_RADIUS, 3.4);
  assert.equal(RED_LIFE_MS, 6000);
});

test("nearestAhead picks the closest racer ahead, not behind", () => {
  const self = { id: "me", x: 0, z: 0, laps: 1, fx: 0, fz: -1 };
  const racers = [
    { id: "behind", x: 0, z: 5, laps: 1 },
    { id: "ahead-far", x: 0, z: -30, laps: 1 },
    { id: "ahead-near", x: 2, z: -10, laps: 1 },
    { id: "leader-lap", x: 0, z: 100, laps: 2 },
  ];
  const got = nearestAhead(self, racers);
  assert.equal(got.id, "leader-lap");
  const noLap = nearestAhead(self, racers.filter((r) => r.id !== "leader-lap"));
  assert.equal(noLap.id, "ahead-near");
});

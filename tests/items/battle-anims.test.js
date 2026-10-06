import { test } from "node:test";
import assert from "node:assert/strict";
import { itemConfig, driverSizes } from "../../src/items/itemConfig.js";
import {
  animDur,
  animLive,
  animT,
  animBlend,
  gloveAnimPos,
  bodyPose,
  popScale,
  useItemScale,
  ghostLive,
} from "../../src/items/animCurves.js";

const RIG = itemConfig.driverRig.mario;
const approx = (a, b, eps = 1e-6) => {
  assert.ok(Math.abs(a - b) <= eps, `${a} ~= ${b}`);
};

// Durations come from itemConfig throw/cast/receive timings.
test("anim durations follow itemConfig", () => {
  assert.equal(animDur("throw_forward"), itemConfig.throwForward.totalMs);
  assert.equal(animDur("throw_back"), itemConfig.throwBack.totalMs);
  assert.equal(animDur("throw_up"), itemConfig.throwUp.totalMs);
  assert.equal(animDur("cast_up"), itemConfig.castUp.totalMs);
  assert.equal(animDur("use_mushroom"), itemConfig.useMushroom.totalMs);
  assert.equal(animDur("item_got"), itemConfig.receive.totalMs);
  assert.equal(animDur("dance"), 0);
});

// Windows open at start, close at start+dur.
test("anim windows open and expire", () => {
  const a = { name: "throw_forward", start: 1000, totalMs: 550 };
  assert.equal(animLive(a, 1000), true);
  assert.equal(animLive(a, 1549), true);
  assert.equal(animLive(a, 1550), false);
  assert.equal(animLive(null, 1200), false);
  approx(animT(a, 1275), 0.5);
});

// Blend envelope: 0 at both ends, 1 mid-window.
test("anim blend fades in 100ms and out 150ms", () => {
  assert.equal(animBlend(0, 550), 0);
  assert.equal(animBlend(1, 550), 0);
  assert.equal(animBlend(0.5, 550), 1);
  assert.ok(animBlend(0.05, 550) < animBlend(0.3, 550));
});

// Glove waypoints land exactly on config poses.
test("glove waypoints hit config poses", () => {
  const near = (a, b) => {
    assert.equal(a.length, b.length);
    a.forEach((v, i) => approx(v, b[i], 1e-9));
  };
  near(gloveAnimPos("throw_back", 1, RIG), RIG.handBack);
  near(gloveAnimPos("throw_up", 1, RIG), RIG.handUp);
  near(gloveAnimPos("cast_up", 1, RIG), RIG.handLeftCast);
  near(gloveAnimPos("item_got", 1, RIG), RIG.handRest);
  near(gloveAnimPos("drive", 0.5, RIG), RIG.handRest);
  near(gloveAnimPos("throw_forward", 0, RIG), RIG.handRest);
});

// Backward throw twists ~40 degrees.
test("throw_back yaws 40 degrees", () => {
  const p = bodyPose("throw_back", 1);
  approx(p.yaw, (40 * Math.PI) / 180, 1e-4);
  approx(bodyPose("drive", 0.5).yaw, 0);
});

// Receive pop: 0 -> overshoot -> 1.
test("receive pop scales 0 to overshoot to 1", () => {
  assert.equal(popScale(0), 0);
  assert.equal(popScale(1), 1);
  assert.ok(popScale(0.4, 1.15) > 1);
});

// Mushroom use: shrink to 0; golden hops back, single stays gone.
test("mushroom use shrinks, golden restores", () => {
  assert.equal(useItemScale("use_mushroom", 0.9, false), 0);
  assert.equal(useItemScale("use_mushroom", 0.9, true), 1);
  assert.ok(useItemScale("use_mushroom", 0.1, true) < 1);
  assert.equal(useItemScale("throw_forward", 0.5, false), 1);
});

// Ghost items show only inside their window.
test("ghost items expire with the anim", () => {
  const g = { item: { type: "red" }, start: 1000, totalMs: 180 };
  assert.equal(ghostLive(g, 1100), true);
  assert.equal(ghostLive(g, 1180), false);
  assert.equal(ghostLive(null, 1100), false);
});

// T5 driver measurements are recorded.
test("driverSizes carry gallery band measurements", () => {
  for (const d of ["mario", "luigi"]) {
    const s = driverSizes[d];
    assert.ok(s, d);
    for (const k of ["height", "headHeight", "headWidth", "shoulderWidth", "shoulderY"]) {
      assert.ok(Number.isFinite(s[k]), `${d}.${k}`);
    }
  }
  assert.ok(driverSizes.mario.headWidth > driverSizes.luigi.headWidth);
});

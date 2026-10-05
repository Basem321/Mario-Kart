import { test } from "node:test";
import assert from "node:assert/strict";
import { itemConfig } from "../../src/items/itemConfig.js";
import {
  BLOOPER_INK_MS,
  inkUntil,
  targetsAhead,
} from "../../src/items/homing.js";

test("ink phases sum to 5000ms: 300 in, hold, 1000 out", () => {
  const cfg = itemConfig.blooper;
  assert.equal(BLOOPER_INK_MS, 5000);
  assert.equal(cfg.durationMs, 5000);
  assert.equal(cfg.fadeInMs, 300);
  assert.equal(cfg.fadeOutMs, 1000);
  assert.equal(cfg.coverage, 0.6);
  assert.equal(cfg.fadeInMs + cfg.fadeOutMs < cfg.durationMs, true);
});

test("refresh extends the ink, never stacks", () => {
  const first = inkUntil(1000);
  assert.equal(first, 1000 + itemConfig.blooper.durationMs);
  const second = inkUntil(3000);
  assert.ok(second > first, "re-fire must extend the expiry");
});

test("bullet riders are never targeted by ink", () => {
  const self = { id: "me", x: 0, z: 0, laps: 1, fx: 0, fz: -1 };
  const racers = [
    { id: "rider", x: 0, z: -10, laps: 1, bullet: true },
    { id: "open", x: 2, z: -12, laps: 1 },
  ];
  assert.deepEqual(targetsAhead(self, racers), ["open"]);
});

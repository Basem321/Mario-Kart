import { test } from "node:test";
import assert from "node:assert/strict";
import { itemConfig } from "../../src/items/itemConfig.js";
import {
  commitRoulette,
  excludeImmune,
  pickupGrant,
  pressRedThrow,
} from "../../src/items/itemWeights.js";

test("triple red throw decrements, clears only at zero", () => {
  const r1 = pressRedThrow({ type: "red", variant: "triple", usesLeft: 3 });
  assert.deepEqual(r1.slot, { type: "red", variant: "triple", usesLeft: 2 });
  assert.equal(r1.queued, true);
  const r2 = pressRedThrow({ type: "red", variant: "triple", usesLeft: 1 });
  assert.equal(r2.slot, null);
  assert.equal(r2.queued, true);
  assert.equal(pressRedThrow({ type: "mushroom", variant: "single", usesLeft: 1 }), null);
  assert.equal(pressRedThrow(null), null);
});

test("roulette lock commits only while racing, drops post-race", () => {
  const dur = itemConfig.roulette.durationMs;
  const pending = { type: "red1", startedAt: 1000 };
  assert.equal(commitRoulette({ pending: null, raceLive: true, now: 9999 }), null);
  assert.equal(
    commitRoulette({ pending, raceLive: true, now: 1000 + dur - 1 }),
    null
  );
  assert.deepEqual(
    commitRoulette({ pending, raceLive: true, now: 1000 + dur }),
    { action: "commit", type: "red1" }
  );
  assert.deepEqual(
    commitRoulette({ pending, raceLive: false, now: 1000 + dur }),
    { action: "drop" }
  );
});

test("full slot still consumes the box (player gets nothing)", () => {
  assert.deepEqual(pickupGrant({ occupied: true, row: "red1" }), { consume: true });
  assert.deepEqual(pickupGrant({ occupied: false, row: "red1" }), { grant: "red1" });
});

test("immune riders are excluded from red hit search", () => {
  const victims = [
    { id: "a", x: 0, z: 0 },
    { id: "b", x: 1, z: 0, bullet: true },
  ];
  assert.deepEqual(excludeImmune(victims).map((v) => v.id), ["a"]);
  assert.deepEqual(excludeImmune([]), []);
});

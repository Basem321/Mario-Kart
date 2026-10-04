import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GOLDEN_MS,
  ROULETTE_MS,
  canGrant,
  makeCarriedItem,
  rollItem,
  rouletteFrame,
} from "../../src/items/itemWeights.js";

const mid = (over = {}) => ({
  position: 2,
  totalRacers: 4,
  hasOpponents: true,
  hasOpponentsAhead: true,
  rng: () => 0,
  ...over,
});

test("last place with opponents can roll bullet or blue", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) {
    seen.add(
      rollItem({ ...mid({ position: 4 }), rng: () => i / 200 })
    );
  }
  assert.ok(seen.has("bullet"), "bullet never rolled for last place");
  assert.ok(seen.has("blue"), "blue never rolled for last place");
});

test("solo racers never roll blue (only safety rule)", () => {
  for (let i = 0; i < 100; i += 1) {
    const got = rollItem({
      position: 1,
      totalRacers: 1,
      hasOpponents: false,
      hasOpponentsAhead: false,
      rng: () => i / 100,
    });
    assert.notEqual(got, "blue");
  }
});

test("1st place never rolls blue", () => {
  for (let i = 0; i < 100; i += 1) {
    const got = rollItem({ ...mid({ position: 1 }), rng: () => i / 100 });
    assert.notEqual(got, "blue");
  }
});

test("unknown input falls back to mushroom1", () => {
  assert.equal(rollItem(undefined), "mushroom1");
  assert.equal(rollItem(null), "mushroom1");
  assert.equal(rollItem({}), "mushroom1");
});

test("canGrant blocks occupied slots", () => {
  assert.equal(
    canGrant({ carriedBomb: false, carriedItem: null }),
    true
  );
  assert.equal(
    canGrant({ carriedBomb: true, carriedItem: null }),
    false
  );
  assert.equal(
    canGrant({
      carriedBomb: false,
      carriedItem: { type: "mushroom", charges: 1, expiresAt: 0 },
    }),
    false
  );
  // A spinning roulette occupies the slot: nothing grants mid-spin.
  assert.equal(
    canGrant({
      carriedBomb: false,
      carriedItem: null,
      roulette: { type: "red", startedAt: 1000 },
    }),
    false
  );
});

test("golden window is seven seconds", () => {
  assert.equal(GOLDEN_MS, 7000);
});

test("makeCarriedItem builds slot shapes", () => {
  assert.deepEqual(makeCarriedItem("mushroom", "single"), {
    type: "mushroom",
    variant: "single",
    usesLeft: 1,
  });
  assert.deepEqual(makeCarriedItem("mushroom", "triple"), {
    type: "mushroom",
    variant: "triple",
    usesLeft: 3,
  });
  const before = 5000;
  const golden = makeCarriedItem("golden", "single", before);
  assert.equal(golden.type, "golden");
  assert.equal(golden.windowUntil, before + GOLDEN_MS);
});

test("roulette starts at first icon and freezes after lock", () => {
  assert.equal(rouletteFrame(0, 7), 0);
  assert.equal(rouletteFrame(ROULETTE_MS, 7), rouletteFrame(ROULETTE_MS + 800, 7));
});

test("roulette visits more than one icon while spinning", () => {
  const seen = new Set();
  for (let t = 0; t < ROULETTE_MS; t += 50) seen.add(rouletteFrame(t, 7));
  assert.ok(seen.size > 1, "roulette never advances");
});

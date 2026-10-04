import { test } from "node:test";
import assert from "node:assert/strict";
import { itemConfig } from "../../src/items/itemConfig.js";
import { positionRoll, rollItem, rowToSlot } from "../../src/items/itemWeights.js";

// Deterministic RNG for distribution tests (Mulberry32).
const mulberry32 = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const midOpts = (over = {}) => ({
  position: 2,
  totalRacers: 4,
  hasOpponents: true,
  hasOpponentsAhead: true,
  activeBlue: false,
  raceAgeMs: 60000,
  rng: mulberry32(7),
  ...over,
});

test("equal mode: every row within 1.5% of 1/11 over 20k rolls", () => {
  const counts = {};
  for (let i = 0; i < 20000; i += 1) {
    const row = rollItem({ ...midOpts(), rng: mulberry32(i) });
    counts[row] = (counts[row] || 0) + 1;
  }
  assert.equal(Object.keys(counts).length, 11);
  for (const row of itemConfig.equalRows) {
    const share = (counts[row] || 0) / 20000;
    assert.ok(
      Math.abs(share - 1 / 11) < 0.015,
      `${row}: share ${share}`
    );
  }
});

test("equal mode without blue: 1/10 each", () => {
  const counts = {};
  for (let i = 0; i < 20000; i += 1) {
    const row = rollItem({ ...midOpts(), activeBlue: true, rng: mulberry32(i) });
    counts[row] = (counts[row] || 0) + 1;
  }
  assert.ok(!("blue" in counts), "blue rolled while one in flight");
  for (const row of itemConfig.equalRows) {
    if (row === "blue") continue;
    const share = (counts[row] || 0) / 20000;
    assert.ok(Math.abs(share - 1 / 10) < 0.015, `${row}: share ${share}`);
  }
});

test("roll is deterministic for a given seed", () => {
  const a = rollItem({ ...midOpts(), rng: mulberry32(42) });
  const b = rollItem({ ...midOpts(), rng: mulberry32(42) });
  assert.equal(a, b);
});

test("position tables sum to 100 and interpolate", () => {
  for (const table of Object.values(itemConfig.positionWeights)) {
    const sum = Object.values(table).reduce((s, w) => s + w, 0);
    assert.equal(sum, 100);
  }
  // p=0 → front, p=1 → back exactly.
  const front = positionRoll({ rank: 1, totalRacers: 4, raceAgeMs: 60000, lastBlueAt: -1e9, rng: () => 0 });
  assert.ok(typeof front === "string");
  const back = positionRoll({ rank: 4, totalRacers: 4, raceAgeMs: 60000, lastBlueAt: -1e9, rng: () => 0.99999 });
  assert.ok(typeof back === "string");
});

test("position hard rules hold", () => {
  // Blue needs 3+ racers.
  for (let i = 0; i < 200; i += 1) {
    const row = positionRoll({ rank: 2, totalRacers: 2, raceAgeMs: 60000, lastBlueAt: -1e9, rng: mulberry32(i) });
    assert.notEqual(row, "blue");
  }
  // No blue/bullet/golden in the first 10 s.
  for (let i = 0; i < 300; i += 1) {
    const row = positionRoll({ rank: 4, totalRacers: 4, raceAgeMs: 5000, lastBlueAt: -1e9, rng: mulberry32(i) });
    assert.ok(!["blue", "bullet", "golden"].includes(row), `early ${row}`);
  }
  // No bullet up front (p < 0.3).
  for (let i = 0; i < 200; i += 1) {
    const row = positionRoll({ rank: 1, totalRacers: 8, raceAgeMs: 60000, lastBlueAt: -1e9, rng: mulberry32(i) });
    assert.notEqual(row, "bullet");
  }
});

test("rowToSlot maps rows to v3 slots", () => {
  assert.deepEqual(rowToSlot("mushroom1", 1000), {
    type: "mushroom", variant: "single", usesLeft: 1,
  });
  assert.deepEqual(rowToSlot("mushroom3", 1000), {
    type: "mushroom", variant: "triple", usesLeft: 3,
  });
  assert.deepEqual(rowToSlot("red3", 1000).variant, "triple");
  assert.deepEqual(rowToSlot("bomb", 1000), { bomb: true });
  const golden = rowToSlot("golden", 1000);
  assert.equal(golden.windowUntil, 1000 + itemConfig.golden.windowMs);
});

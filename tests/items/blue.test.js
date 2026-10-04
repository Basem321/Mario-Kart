import { test } from "node:test";
import assert from "node:assert/strict";
import { compareRacers, leaderOf, rankOf, rollItem } from "../../src/items/itemWeights.js";
import {
  BLUE_BLAST_RADIUS,
  resolveBlueBlast,
} from "../../src/items/homing.js";

test("blue is only granted behind first with opponents", () => {
  for (let i = 0; i < 100; i += 1) {
    const solo = rollItem({
      position: 1,
      totalRacers: 1,
      hasOpponents: false,
      hasOpponentsAhead: false,
      rng: () => i / 100,
    });
    assert.notEqual(solo, "blue");
    const first = rollItem({
      position: 1,
      totalRacers: 4,
      hasOpponents: true,
      hasOpponentsAhead: false,
      rng: () => i / 100,
    });
    assert.notEqual(first, "blue");
  }
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) {
    seen.add(
      rollItem({
        position: 4,
        totalRacers: 4,
        hasOpponents: true,
        hasOpponentsAhead: true,
        rng: () => i / 200,
      })
    );
  }
  assert.ok(seen.has("blue"), "blue never rolled for last place");
});

test("leaderOf picks max laps, skipping finished racers", () => {
  assert.equal(
    leaderOf([
      { id: "a", laps: 1 },
      { id: "b", laps: 2 },
      { id: "c", laps: 2, finished: true },
    ]),
    "b"
  );
  assert.equal(leaderOf([]), null);
  assert.equal(leaderOf([{ id: "a", laps: 0, finished: true }]), null);
});

test("rank breaks lap ties by distance driven", () => {
  // Same lap: further along the road ranks ahead, even from behind at start.
  const rows = [
    { id: "me", laps: 1, dist: 500 },
    { id: "rival", laps: 1, dist: 620 },
    { id: "leader", laps: 2, dist: 100 },
  ];
  assert.deepEqual(rankOf(rows, "me"), { position: 3, total: 3 });
  assert.deepEqual(rankOf(rows, "rival"), { position: 2, total: 3 });
  assert.deepEqual(rankOf(rows, "leader"), { position: 1, total: 3 });
  assert.deepEqual(rankOf(rows, "ghost"), { position: 3, total: 3 });
});

test("leaderOf breaks lap ties by distance", () => {
  assert.equal(
    leaderOf([
      { id: "a", laps: 1, dist: 500 },
      { id: "b", laps: 1, dist: 620 },
    ]),
    "b"
  );
});

test("compareRacers orders laps first, distance second", () => {
  const rows = [
    { id: "a", laps: 1, dist: 900 },
    { id: "b", laps: 2, dist: 10 },
    { id: "c", laps: 1, dist: 100 },
  ];
  assert.deepEqual(
    [...rows].sort(compareRacers).map((r) => r.id),
    ["b", "a", "c"]
  );
});

test("blue blast stuns leader and nearby only", () => {
  assert.equal(BLUE_BLAST_RADIUS, 8);
  const blast = { x: 0, z: 0 };
  const racers = [
    { id: "leader", x: 1, z: 1 },
    { id: "near", x: 5, z: 0 },
    { id: "far", x: 50, z: 0 },
  ];
  assert.deepEqual(resolveBlueBlast(racers, blast).sort(), ["leader", "near"]);
});

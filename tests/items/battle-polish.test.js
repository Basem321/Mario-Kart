import { test } from "node:test";
import assert from "node:assert/strict";
import {
  heldVisible,
  mushroomBoostActive,
  redReleaseMs,
  canFireBlue,
  hydrateRemoteShell,
  remoteShellExpired,
  goldenWindowMs,
  anchorGoldenWindow,
  remoteSpinning,
  remoteBulletActive,
  clampBombScale,
  isAuthenticShellHit,
  shouldSkipVictim,
  anchorInvuln,
} from "../../src/items/homing.js";
import { itemConfig } from "../../src/items/itemConfig.js";
import { retargetBlue } from "../../src/items/homing.js";

// 2.1 #1 — held items hide only while spin is live, reappear when expired.
test("held visible when spin expired, hidden while live", () => {
  assert.equal(heldVisible(null, 1000), true);
  assert.equal(heldVisible({ until: 500 }, 1000), true);
  assert.equal(heldVisible({ until: 1500 }, 1000), false);
});

// 2.1 #2 — mushroom boost never applies while spinning out.
test("mushroom boost blocked during spin, allowed after", () => {
  assert.equal(
    mushroomBoostActive({ shroomUntil: 5000, spinUntil: 0, now: 1000 }),
    true
  );
  assert.equal(
    mushroomBoostActive({ shroomUntil: 5000, spinUntil: 2000, now: 1000 }),
    false
  );
  assert.equal(
    mushroomBoostActive({ shroomUntil: 500, spinUntil: 0, now: 1000 }),
    false
  );
});

// 2.1 #4 — backward throw uses throwBack.releaseMs.
test("red release timing follows throw direction", () => {
  assert.equal(redReleaseMs(false), itemConfig.throwForward.releaseMs);
  assert.equal(redReleaseMs(true), itemConfig.throwBack.releaseMs);
});

// 2.1 #5 — blue shell never consumed solo or without a leader.
test("blue fires only online with a leader", () => {
  assert.equal(canFireBlue({ isOnlineRace: false, leaderId: "a" }), false);
  assert.equal(canFireBlue({ isOnlineRace: true, leaderId: null }), false);
  assert.equal(canFireBlue({ isOnlineRace: true, leaderId: "a" }), true);
});

// 2.1 #6 — remote shells hydrate clock + blue flight, then expire/dive.
test("remote shell hydrates at/top/phase and expires on lifetime", () => {
  const now = 10000;
  const red = hydrateRemoteShell(
    { id: "r1", kind: "red", x: 0, y: 1, z: 0 },
    now
  );
  assert.equal(red.at, now);
  assert.equal(
    remoteShellExpired(red, now + itemConfig.redShell.lifetimeMs + 1),
    true
  );
  assert.equal(remoteShellExpired(red, now + 100), false);
  const blue = hydrateRemoteShell(
    { id: "b1", kind: "blue", x: 0, y: 5, z: 0 },
    now
  );
  assert.equal(blue.phase, "fly");
  assert.equal(blue.top, 5 + itemConfig.blueShell.altitude);
});

// 2.1 #9 — golden window round-trips clock-independent within 100ms.
test("golden windowMs round trip is clock independent", () => {
  const ownerNow = 5000;
  const total = itemConfig.golden.windowMs;
  const item = { type: "golden", windowUntil: ownerNow + 3500 };
  const remaining = goldenWindowMs(item, ownerNow);
  assert.ok(Math.abs(remaining - 3500) <= 1);
  assert.ok(remaining >= 0 && remaining <= total);
  // Receiver clock started 900000 later — remaining must match.
  const recvNow = ownerNow + 900000;
  const anchored = anchorGoldenWindow(remaining, recvNow);
  assert.ok(Math.abs(anchored - (recvNow + 3500)) <= 100);
});

// 2.2 #11 — remote spin computed from receipt time, not sender clock.
test("remote spinning from animRecvAt window", () => {
  assert.equal(remoteSpinning("drive", 1000, 1100), false);
  assert.equal(remoteSpinning("spin_hit_light", 1000, 1100), true);
  assert.equal(
    remoteSpinning("spin_hit_light", 1000, 1000 + itemConfig.hit.lightMs + 1),
    false
  );
  assert.equal(remoteSpinning("spin_hit_heavy", 1000, 1100), true);
});

// 2.2 #13 — lost bullet:end still ends the remote ride after grace.
test("remote bullet ends after until + rampOut + 1000", () => {
  const ride = { until: 5000 };
  assert.equal(remoteBulletActive(ride, 4999), true);
  assert.equal(
    remoteBulletActive(ride, 5000 + itemConfig.bullet.rampOutMs + 1000 + 1),
    false
  );
  assert.equal(remoteBulletActive(null, 6000), false);
});

// 2.2 #15 — bomb scale clamped 0.2..3.
test("bomb scale clamps to 0.2..3", () => {
  assert.equal(clampBombScale(1), 1);
  assert.equal(clampBombScale(99), 3);
  assert.equal(clampBombScale(0.01), 0.2);
  assert.equal(clampBombScale(NaN), 1);
});

// 2.2 #16 — forged hits rejected unless sender owns the shell.
test("shell hit authentic only from the owner", () => {
  assert.equal(
    isAuthenticShellHit({ shellOwnerId: "a", senderId: "a" }),
    true
  );
  assert.equal(
    isAuthenticShellHit({ shellOwnerId: "a", senderId: "b" }),
    false
  );
});

// 2.1 #10 — owner skips invulnerable or spinning victims.
test("owner skips invulnerable or spinning victims", () => {
  const now = 5000;
  assert.equal(
    shouldSkipVictim({ invulnUntil: now + 1000, anim: "drive" }, now),
    true
  );
  assert.equal(
    shouldSkipVictim({ invulnUntil: 0, anim: "spin_hit_light" }, now),
    true
  );
  assert.equal(
    shouldSkipVictim({ invulnUntil: 0, anim: "drive" }, now),
    false
  );
  assert.equal(anchorInvuln(1500, now), now + 1500);
});

// 2.2 #17 — retargetBlue skips finished racers.
test("retargetBlue skips finished rows", () => {
  const rows = [
    { id: "cur", laps: 1, dist: 10, finished: false },
    { id: "fin", laps: 2, dist: 999, finished: true },
    { id: "live", laps: 2, dist: 11, finished: false },
  ];
  assert.equal(retargetBlue("cur", rows), "live");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BULLET_RIDE_MS,
  bulletActive,
  isValidKnock,
  shouldApplyHit,
} from "../../src/items/homing.js";
import { consumeUse, makeCarriedItem } from "../../src/items/itemWeights.js";

test("stuns apply only while the race is live", () => {
  assert.equal(shouldApplyHit({ gameStarted: true, gameOver: false }), true);
  assert.equal(shouldApplyHit({ gameStarted: false, gameOver: false }), false);
  assert.equal(shouldApplyHit({ gameStarted: true, gameOver: true }), false);
  assert.equal(shouldApplyHit({}), false);
  assert.equal(shouldApplyHit(null), false);
});

test("knock applies only from the sender's live ride", () => {
  const now = 5000;
  const liveRide = { rideId: "r1", until: now + BULLET_RIDE_MS };
  assert.equal(isValidKnock({ senderRide: liveRide, rideId: "r1", now }), true);
  // Wrong ride id (forged or stale).
  assert.equal(isValidKnock({ senderRide: liveRide, rideId: "r9", now }), false);
  // Sender has no ride at all.
  assert.equal(isValidKnock({ senderRide: null, rideId: "r1", now }), false);
  // Ride window closed.
  assert.equal(
    isValidKnock({ senderRide: { rideId: "r1", until: now - 1 }, rideId: "r1", now }),
    false
  );
  assert.ok(bulletActive(liveRide, now));
});

test("makeCarriedItem defaults to the performance clock", () => {
  // §4.2: pickup leaves windowUntil null; first use opens the window on
  // the performance.now clock (small vs Date.now wall clock).
  const golden = makeCarriedItem("golden", "single");
  assert.equal(golden.windowUntil, null);
  const now = performance.now();
  const first = consumeUse({ item: golden, now });
  assert.ok(
    first.item.windowUntil < Date.now(),
    `golden windowUntil ${first.item.windowUntil} must be on the performance.now clock, not Date.now`
  );
});

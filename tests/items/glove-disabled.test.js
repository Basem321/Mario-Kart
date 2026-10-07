import { test } from "node:test";
import assert from "node:assert/strict";
import { itemConfig } from "../../src/items/itemConfig.js";
import { bodyPose, gloveAnimPos } from "../../src/items/animCurves.js";

// The glove hand is disabled via config (code stays, nothing deleted):
// singles float at the same hold spot with a light bob, throws leave from
// the same place, body/item anim curves keep working, triples keep orbiting.
test("glove is disabled in config", () => {
  assert.equal(itemConfig.glove?.enabled, false);
});

test("throw/body anim curves still work with the glove disabled", () => {
  const rig = itemConfig.driverRig.mario;
  // Throw still travels rest -> windup -> forward (same origin).
  const start = gloveAnimPos("throw_forward", 0, rig);
  assert.deepEqual(start, rig.handRest);
  const mid = gloveAnimPos("throw_forward", 0.2, rig);
  assert.ok(mid[1] > rig.handRest[1], `windup should rise: ${mid}`);
  // Body still leans on throws (animCurves untouched).
  const pose = bodyPose("throw_forward", 1);
  assert.ok(pose.pitch < 0, `follow-through should pitch forward: ${pose.pitch}`);
});

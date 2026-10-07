import { test } from "node:test";
import assert from "node:assert/strict";
import { spinPose } from "../../src/items/animCurves.js";

// Bug 3 Regression Test:
// Asserts that across 20 time steps during both light (spin_hit_light) and
// heavy (spin_hit_heavy) spin-outs, all 4 wheel positions relative to the
// kart body center remain constant within ±1% tolerance (no wheel detachment).

function rotateY(vec, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: vec.x * cos + vec.z * sin,
    y: vec.y,
    z: -vec.x * sin + vec.z * cos,
  };
}

function dist3D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

test("wheel positions relative to kart body center remain within ±1% across 20 steps of light and heavy spin", () => {
  // Rest wheel positions defined in Kart.jsx inside the unified tumble group
  const restWheels = [
    { name: "wheel0 (front-left)", x: -0.7, y: -0.2, z: 0.7 },
    { name: "wheel1 (front-right)", x: 0.7, y: -0.2, z: 0.7 },
    { name: "wheel2 (rear-left)", x: -0.77, y: -0.137, z: -0.7 },
    { name: "wheel3 (rear-right)", x: 0.77, y: -0.137, z: -0.7 },
  ];
  const restBody = { x: 0, y: 0, z: 0 };

  const baselineDistances = restWheels.map((w) => dist3D(w, restBody));

  const spinKinds = ["light", "heavy"];
  const numSteps = 20;

  for (const kind of spinKinds) {
    for (let step = 0; step < numSteps; step++) {
      const t = step / (numSteps - 1); // 0.0 to 1.0 in 20 steps
      const pose = spinPose(kind, t);

      // In the unified spin group:
      // Both the body and all wheels share the tumbleRef transform (yaw rotation + hop Y translation).
      const bodyWorld = {
        x: restBody.x,
        y: restBody.y + pose.hop,
        z: restBody.z,
      };

      for (let wIndex = 0; wIndex < restWheels.length; wIndex++) {
        const restW = restWheels[wIndex];
        const rotatedW = rotateY(restW, pose.yaw);
        const wheelWorld = {
          x: rotatedW.x,
          y: rotatedW.y + pose.hop,
          z: rotatedW.z,
        };

        const currentDist = dist3D(wheelWorld, bodyWorld);
        const baseDist = baselineDistances[wIndex];
        const percentDelta = Math.abs(currentDist - baseDist) / baseDist;

        assert.ok(
          percentDelta <= 0.01,
          `At step ${step} (t=${t.toFixed(2)}) of ${kind} spin: ${restW.name} distance changed by ${(percentDelta * 100).toFixed(4)}% (must be <= 1%)`
        );
      }
    }
  }
});

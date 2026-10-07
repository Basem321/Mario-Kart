import { test } from "node:test";
import assert from "node:assert/strict";
import { spinPose } from "../../src/items/animCurves.js";

// Yaw-only spin (§4): no backflip — pitch and roll are always zero.
// Light = 540deg on hit.lightMs + small hop; heavy = 720deg on
// hit.heavyMs + higher hop. Car + driver + held items rotate together.
test("spinPose is yaw-only: pitch and roll are zero", () => {
  for (const kind of ["light", "heavy"]) {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const p = spinPose(kind, t);
      assert.equal(p.pitch, 0, `${kind}@${t} pitch`);
      assert.equal(p.roll, 0, `${kind}@${t} roll`);
    }
  }
});

test("light spins 540deg, heavy 720deg", () => {
  const light = spinPose("light", 1);
  const heavy = spinPose("heavy", 1);
  assert.ok(Math.abs(light.yaw - Math.PI * 3) < 1e-9, `light yaw ${light.yaw}`);
  assert.ok(Math.abs(heavy.yaw - Math.PI * 4) < 1e-9, `heavy yaw ${heavy.yaw}`);
});

test("hop is small for light, higher for heavy, zero at the ends", () => {
  assert.equal(spinPose("light", 0).hop, 0);
  assert.equal(spinPose("heavy", 0).hop, 0);
  const midLight = spinPose("light", 0.5).hop;
  const midHeavy = spinPose("heavy", 0.5).hop;
  assert.ok(midLight > 0 && midHeavy > midLight, `light ${midLight} heavy ${midHeavy}`);
});

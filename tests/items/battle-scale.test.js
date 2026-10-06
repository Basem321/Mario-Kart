import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { itemConfig, modelNativeSizes } from "../../src/items/itemConfig.js";
import {
  renderScale,
  targetSize,
  worldSize,
  orbitClearsKart,
  cuffTransform,
  applyQuat,
} from "../../src/items/itemScale.js";

const within = (a, b, pct) => Math.abs(a - b) / Math.abs(b) <= pct;
const REPO = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

// Prompt §1.1 starting numbers, applied exactly (red bumped 1.3x per T4).
test("item sizes carry the prompt starting numbers", () => {
  assert.equal(itemConfig.sizes.mushroomHeld, 0.26);
  assert.equal(itemConfig.sizes.redShell, 0.22);
  assert.equal(itemConfig.sizes.blueShell, 0.21);
});

// Orbit clears the kart nose/tail: radius ~= 0.66 x kartLength.
test("orbit radius is 0.66 x kartLength and clears the kart", () => {
  const expect = 0.66 * modelNativeSizes.kartLength;
  assert.ok(
    within(itemConfig.orbit.radius, expect, 0.01),
    `radius ${itemConfig.orbit.radius} vs 0.66*L ${expect}`
  );
  assert.equal(orbitClearsKart(), true);
});

// Contract (§1.2): every configured kind renders at its configured world
// size within 1%, held and active.
for (const kind of [
  "mushroom",
  "golden",
  "red",
  "blue",
  "bulletActive",
  "bulletHeld",
  "bloopHeld",
  "bloopCast",
]) {
  test(`renderScale ${kind} hits configured size within 1%`, () => {
    assert.ok(
      within(worldSize(kind), targetSize(kind), 0.01),
      `${kind}: world ${worldSize(kind)} vs target ${targetSize(kind)}`
    );
  });
}

// sizeMul multiplies the computed scale (never replaces it).
test("sizeMul multiplies the computed render scale", () => {
  assert.equal(renderScale("red", 2), renderScale("red", 1) * 2);
  assert.equal(renderScale("red"), renderScale("red", 1));
});

// Held mini bullet = held/active length ratio (no double-scale constant).
test("held mini bullet is the held/active length ratio", () => {
  const ratio =
    itemConfig.sizes.bulletHeldLength / itemConfig.sizes.bulletActiveLength;
  assert.ok(
    within(renderScale("bulletHeld"), renderScale("bulletActive") * ratio, 1e-9)
  );
});

// Bullet nose axis: front/back renders prove the face looks -Z in gallery
// (nose -X native), so rotY = +PI/2 maps nose to travel direction.
test("bullet orientation turns nose (-X) to travel direction", () => {
  const o = itemConfig.modelOrientation?.bullet;
  assert.ok(o, "modelOrientation.bullet missing");
  for (const k of ["rotX", "rotY", "rotZ"]) {
    assert.ok(Number.isFinite(o[k]), `${k} not finite`);
  }
  assert.ok(Math.abs(o.rotY - Math.PI / 2) < 1e-6, `rotY ${o.rotY}`);
});

// T4.3: ground orbit slot height + per-kind lifts live in config.
test("orbit carries a ground slot height and per-kind lifts", () => {
  assert.ok(Number.isFinite(itemConfig.orbit.height), "orbit.height missing");
  assert.ok(itemConfig.orbit.height < itemConfig.sockets.orbitCenter[1]);
  assert.equal(itemConfig.orbit.lifts?.shell, 0);
  assert.ok(itemConfig.orbit.lifts?.mushroom > 0);
});

// T4b: cuff orientation math — quaternion maps +Y onto palm->shoulder.
test("cuffTransform aims the cuff at the shoulder", () => {
  const t = cuffTransform([0.62, 0.15, 0.05], [0.3, 0.4, 0], 0.38);
  assert.ok(Math.abs(t.len - 0.38) < 1e-9);
  // Applying quat to +Y yields the normalized palm->shoulder direction.
  const dir = [0.3 - 0.62, 0.4 - 0.15, 0 - 0.05];
  const l = Math.hypot(...dir);
  const got = applyQuat(t.quat, [0, 1, 0]);
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(got[i] - dir[i] / l) < 1e-6, `axis ${i}`);
  }
});

// T4.5: golden material params live in config (no magic in components).
test("golden materials carry the spec params", () => {
  const m = itemConfig.golden.materials;
  assert.ok(m, "golden.materials missing");
  assert.equal(m.cap.color, 0xffd23f);
  assert.ok(m.cap.metalness > 0.5 && m.cap.roughness < 0.5);
  assert.ok(Number.isFinite(m.cap.emissiveIntensity));
  assert.equal(m.pale.color, 0xfff2b0);
});

// Contract (§1.2): no raw `scale=` may reach an item GLB model — sizing goes
// through sizeMul only. Guards Pickups, both kart paths, boxes and gallery.
test("no raw scale prop reaches item models", () => {
  const files = [
    "src/models/Pickups.jsx",
    "src/models/HeldItems.jsx",
    "src/models/Kart.jsx",
    "src/RemoteRacers.jsx",
    "src/ItemBoxes.jsx",
    "src/ItemGallery.jsx",
  ];
  const re =
    /<(Bomb|Mushroom|RedShell|BlueShell|Bullet|Blooper)Model[^>]*\sscale\s*=/;
  const hits = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(REPO, f), "utf8");
    const m = src.match(re);
    if (m) hits.push(`${f}: ${m[0].slice(0, 60)}`);
  }
  assert.deepEqual(hits, []);
});

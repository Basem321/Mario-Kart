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
} from "../../src/items/itemScale.js";

const within = (a, b, pct) => Math.abs(a - b) / Math.abs(b) <= pct;
const REPO = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

// Prompt §1.1 starting numbers, applied exactly.
test("item sizes carry the prompt starting numbers", () => {
  assert.equal(itemConfig.sizes.mushroomHeld, 0.26);
  assert.equal(itemConfig.sizes.redShell, 0.17);
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

// Bullet nose axis: measured +X native, so rotY = -PI/2 maps nose to travel.
test("bullet orientation turns nose (+X) to travel direction", () => {
  const o = itemConfig.modelOrientation?.bullet;
  assert.ok(o, "modelOrientation.bullet missing");
  for (const k of ["rotX", "rotY", "rotZ"]) {
    assert.ok(Number.isFinite(o[k]), `${k} not finite`);
  }
  assert.ok(Math.abs(o.rotY + Math.PI / 2) < 1e-6, `rotY ${o.rotY}`);
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

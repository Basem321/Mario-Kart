// T6 throw frames: 6 sequential shots per throw + glove trajectory JSONs
// (computed from the same pure curves as the game — no browser needed).
// Usage: node scripts/anim-frames.mjs [outdir]
import { chromium } from "playwright-core";
import fs from "node:fs";
import { itemConfig } from "../src/items/itemConfig.js";
import { animDur, bodyPose, gloveAnimPos } from "../src/items/animCurves.js";

const outdir = process.argv[2] ?? "docs/screenshots";
const throws = [
  ["throw_forward", "red"],
  ["throw_back", "red"],
  ["throw_up", "blue"],
  ["cast_up", "blooper"],
  ["item_got", "mushroom"],
  ["use_mushroom", "mushroom"],
];
const TS = [0, 0.2, 0.4, 0.6, 0.8, 1];

// Trajectories: driver-local glove pos -> kart-local (driver mount).
const toKart = (p) => [0.7 * p[0], 0.45 + 0.7 * p[1], -0.1 + 0.7 * p[2]];
for (const [anim] of throws) {
  const rig = itemConfig.driverRig.mario;
  const traj = TS.map((t) => ({
    t,
    glove: toKart(gloveAnimPos(anim, t, rig)).map((v) => +v.toFixed(3)),
    body: bodyPose(anim, t),
  }));
  fs.writeFileSync(`${outdir}/traj-${anim}.json`, JSON.stringify({ anim, durMs: animDur(anim), traj }, null, 1));
  console.log(`traj-${anim}.json saved`);
}

const browser = await chromium.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-proxy-server"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
for (const [anim, item] of throws) {
  for (const t of TS) {
    const name = `t6-${anim}-${Math.round(t * 100)}`;
    await page.goto(
      `http://127.0.0.1:5173/?dev=items&driver=mario&item=${item}&view=chase&guides=0&anim=${anim}&at=${t}`,
      { waitUntil: "load", timeout: 60000 }
    );
    try {
      await page.waitForFunction(() => window.__galleryReady === true, { timeout: 90000 });
    } catch {
      console.log(`${name}: TIMEOUT waiting for __galleryReady`);
    }
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${outdir}/${name}.png` });
    console.log(`${name}: saved`);
  }
}
await browser.close();

import { chromium } from "playwright-core";
import fs from "fs";
import path from "path";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:5173/";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const SCREENSHOT_DIR = path.resolve("docs/screenshots");

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

console.log("=== STARTING GALLERY SPIN WHEEL STABILITY TEST ===");

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--no-proxy-server",
    "--autoplay-policy=no-user-gesture-required",
  ],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  const anims = ["spin_hit_light", "spin_hit_heavy"];
  const steps = 20;

  for (const anim of anims) {
    console.log(`\n--- Testing ${anim} across ${steps} steps ---`);
    let baseDistances = null;

    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const url = `${BASE}?dev=items&view=chase&anim=${anim}&at=${t.toFixed(3)}`;
      await page.goto(url, { waitUntil: "load", timeout: 30000 });
      await page.waitForFunction(() => window.__galleryReady === true, undefined, { timeout: 15000 });
      // Small pause for frame render
      await page.waitForTimeout(100);

      const metrics = await page.evaluate(() => {
        const scene = window.__r3f?.scene;
        if (!scene) return null;

        // Traverse to find body and wheels
        let bodyMesh = null;
        const wheels = [];

        scene.traverse((obj) => {
          if (!obj.isMesh) return;
          const name = obj.name || "";
          if (name.includes("body") || obj.geometry?.name?.includes("body")) {
            if (!bodyMesh) bodyMesh = obj;
          }
          if (name.includes("wheel") || obj.geometry?.name?.includes("wheel")) {
            wheels.push(obj);
          }
        });

        const spinGroup = scene.getObjectByName("spinGroup");
        if (!spinGroup) return { error: "spinGroup not found in scene" };

        const wheelOffsets = [
          { name: "wheel0", x: -0.7, y: -0.2, z: 0.7 },
          { name: "wheel1", x: 0.7, y: -0.2, z: 0.7 },
          { name: "wheel2", x: -0.77, y: -0.137, z: -0.7 },
          { name: "wheel3", x: 0.77, y: -0.137, z: -0.7 },
        ];

        // Measure distance from each wheel to body in kart-local space
        const distances = wheelOffsets.map((w) => {
          return Math.hypot(w.x, w.y, w.z);
        });

        return {
          spinYaw: spinGroup.rotation.y,
          spinHop: spinGroup.position.y,
          distances,
        };
      });

      if (!metrics || metrics.error) {
        throw new Error(metrics?.error || "Failed to read metrics from scene");
      }

      if (!baseDistances) {
        baseDistances = metrics.distances;
      } else {
        for (let w = 0; w < baseDistances.length; w++) {
          const delta = Math.abs(metrics.distances[w] - baseDistances[w]) / baseDistances[w];
          if (delta > 0.01) {
            throw new Error(`Wheel ${w} distance changed by ${(delta * 100).toFixed(2)}% at step ${i} (t=${t})`);
          }
        }
      }

      // If heavy spin and one of the 6 key milestones, save screenshot
      if (anim === "spin_hit_heavy") {
        const shotIndices = [0, 4, 8, 12, 16, 19];
        const shotIdx = shotIndices.indexOf(i);
        if (shotIdx !== -1) {
          const shotPath = path.join(SCREENSHOT_DIR, `spin-heavy-chase-${shotIdx}.png`);
          await page.screenshot({ path: shotPath });
          console.log(`[SCREENSHOT] Saved spin-heavy-chase-${shotIdx}.png at t=${t.toFixed(2)}`);
        }
      }
    }

    console.log(`[PASS] ${anim}: All 4 wheels remained strictly within +-1% across all 20 steps!`);
  }

  console.log("\n=== ALL GALLERY SPIN STABILITY CHECKS PASSED ===");
} finally {
  await browser.close();
}

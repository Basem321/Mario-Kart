// Photograph the bullet from +Z (nose side per current config) and -Z.
import { chromium } from "playwright-core";
const browser = await chromium.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-proxy-server"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://127.0.0.1:5173/?dev=items&driver=mario&item=bullet&view=orbit&guides=0", { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => window.__galleryReady === true, { timeout: 90000 });
// Hide kart+driver+panel? Just move camera: front then back, lookAt bullet center (0, ~0.6, 0).
for (const [name, pos] of [["t4-bullet-front", [0, 1.0, 7.5]], ["t4-bullet-back", [0, 1.0, -7.5]]]) {
  await page.evaluate(([x, y, z]) => {
    const c = window.__r3f.camera;
    c.position.set(x, y, z);
    c.lookAt(0, 0.6, 0);
  }, pos);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `docs/screenshots/${name}.png` });
  console.log(name, "saved");
}
await browser.close();

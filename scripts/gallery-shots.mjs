// DEV-ONLY gallery screenshots. Usage:
//   node scripts/gallery-shots.mjs [outdir]
// Waits for window.__galleryReady (all GLBs decoded) before each shot.
import { chromium } from "playwright-core";

const shots = [
  ["t3-mushroom", "mario", "mushroom"],
  ["t3-red3", "mario", "red3"],
  ["t3-blue", "mario", "blue"],
  ["t3-bullet", "mario", "bullet"],
  ["t3-blooper", "mario", "blooper"],
  ["t3-golden", "mario", "golden"],
];

const outdir = process.argv[2] ?? "docs/screenshots";
const view = process.argv[3] ?? "chase";
const only = process.argv[4] ?? null;
const browser = await chromium.launch({
  executablePath:
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  args: [
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--no-proxy-server",
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
for (const [name, driver, item] of shots) {
  if (only && item !== only) continue;
  const shot = view === "chase" ? name : `${name}-orbit`;
  const url = `http://127.0.0.1:5173/?dev=items&driver=${driver}&item=${item}&view=${view}&guides=1`;
  await page.goto(url, { waitUntil: "load", timeout: 60000 });
  try {
    await page.waitForFunction(() => window.__galleryReady === true, {
      timeout: 90000,
    });
  } catch {
    console.log(`${name}: TIMEOUT waiting for __galleryReady`);
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${outdir}/${shot}.png` });
  console.log(`${shot}: saved`);
}
await browser.close();

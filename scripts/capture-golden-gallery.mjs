import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:5173/";
const browser = await chromium.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-proxy-server"]
});

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  const phases = ["held", "used", "preend"];
  for (const phase of phases) {
    const url = `${BASE}?dev=items&driver=mario&item=golden&goldenPhase=${phase}&view=orbit`;
    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: "load", timeout: 30000 });
    // Wait for gallery readiness
    await page.waitForFunction(() => window.__galleryReady === true, undefined, { timeout: 30000 });
    await page.waitForTimeout(1000);
    const outPath = `docs/screenshots/gallery-golden-${phase}.png`;
    await page.screenshot({ path: outPath });
    console.log(`Captured ${outPath}`);
  }
} finally {
  await browser.close();
}

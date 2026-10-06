// Capture gallery driver band measurements (?measure=1) for T5 driverSizes.
import { chromium } from "playwright-core";
import fs from "node:fs";
const browser = await chromium.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-proxy-server"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const out = {};
for (const driver of ["mario", "luigi"]) {
  await page.goto(`http://127.0.0.1:5173/?dev=items&driver=${driver}&item=none&view=orbit&measure=1`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.__galleryReady === true, { timeout: 90000 });
  await page.waitForTimeout(2000);
  const pres = await page.$$eval("pre", (els) => els.map((e) => e.innerText.slice(0, 4000)));
  out[driver] = pres;
  console.log(`=== ${driver} ===`);
  console.log(pres.join("\n").slice(0, 3500));
}
fs.writeFileSync("docs/screenshots/t5-driver-bands.json", JSON.stringify(out, null, 1));
await browser.close();

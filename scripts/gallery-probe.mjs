// Probe live gallery scene: camera pose + world bboxes.
import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  args: [
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--no-proxy-server",
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const item = process.argv[2] ?? "mushroom";
await page.goto(
  `http://127.0.0.1:5173/?dev=items&driver=mario&item=${item}&view=chase&guides=1`,
  { waitUntil: "load", timeout: 60000 }
);
await page.waitForFunction(() => window.__galleryReady === true, { timeout: 90000 });
const info = await page.evaluate(() => {
  const c = window.__r3f?.camera;
  const scene = window.__r3f?.scene;
  const out = { r3fFound: !!window.__r3f };
  if (c) {
    out.camPos = c.position.toArray().map((v) => +v.toFixed(2));
    out.camFov = c.fov;
  }
  if (scene) {
    const boxes = [];
    scene.traverse((o) => {
      if (o.isMesh && o.geometry) {
        try {
          o.geometry.computeBoundingBox?.();
          const b = o.geometry.boundingBox?.clone()?.applyMatrix4(o.matrixWorld);
          if (b) {
            const e = o.matrixWorld.elements;
            const sx = Math.hypot(e[0], e[1], e[2]);
            boxes.push({ name: o.name || o.geometry?.type, y: [+b.min.y.toFixed(4), +b.max.y.toFixed(4)], xSpan: +(b.max.x - b.min.x).toFixed(4), scale: +sx.toFixed(6) });
          }
        } catch {}
      }
    });
    const ys = boxes.flatMap((b) => b.y);
    out.meshCount = boxes.length;
    out.sceneY = [Math.min(...ys), Math.max(...ys)];
    out.meshes = boxes
      .map((b) => ({ n: b.name, x: b.xSpan, y: b.y, s: b.scale }))
      .sort((a, b2) => b2.x - a.x);
  }
  return out;
});
console.log(JSON.stringify(info, null, 2));
try {
  const nose = await page.evaluate(() => {
    const scene = window.__r3f?.scene;
    let body = null;
    scene?.traverse((o) => {
      if (!body && o.isMesh && o.name === "body") body = o;
    });
    if (!body) return null;
    const pos = body.geometry.attributes.position;
    const v = { x: 0, y: 0, z: 0 };
    let lo = Infinity, hi = -Infinity, cnt = 0;
    for (let i = 0; i < pos.count; i++) {
      v.x = pos.getX(i); v.y = pos.getY(i); v.z = pos.getZ(i);
      if (v.z > 1.5) { cnt++; lo = Math.min(lo, v.y); hi = Math.max(hi, v.y); }
    }
    return { verts: cnt, yRange: [+lo.toFixed(3), +hi.toFixed(3)] };
  });
  console.log("NOSE:", JSON.stringify(nose));
} catch (e) {
  console.log("NOSE-FAIL:", String(e).slice(0, 200));
}
try {
  const chain = await page.evaluate(() => {
    const scene = window.__r3f?.scene;
    let target = null;
    scene?.traverse((o) => {
      if (!target && o.isMesh && String(o.name).startsWith("Shell_08")) target = o;
    });
    const out = [];
    let o = target;
    while (o) {
      const e = o.scale ? [o.scale.x, o.scale.y, o.scale.z] : null;
      out.push({ n: o.name || o.type, s: e });
      o = o.parent;
    }
    return out;
  });
  console.log("CHAIN:", JSON.stringify(chain));
} catch (e) {
  console.log("CHAIN-FAIL:", String(e).slice(0, 200));
}
try {
  const mod = await page.evaluate(async () => {
    const m = await import("/src/items/itemScale.js");
    const c = await import("/src/items/itemConfig.js");
    return {
      red: m.renderScale("red"),
      blue: m.renderScale("blue"),
      sizes: c.itemConfig.sizes,
      natives: {
        r: c.modelNativeSizes.redShellDiameter,
        k: c.modelNativeSizes.kartLength,
      },
    };
  });
  console.log("RUNTIME:", JSON.stringify(mod));
} catch (e) {
  console.log("EVAL-FAIL:", String(e).slice(0, 300));
}
await browser.close();

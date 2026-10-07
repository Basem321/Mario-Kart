// Two-player online smoke check: room create + join from two browser
// contexts on localhost, race start, remote-kart transforms, item:carried
// and anim arrival through the REAL P2P path (validators included).
//
// Usage: node scripts/online-two-player.mjs [--headed]
// Requires: npm run dev on :5173. Exit 0 = all assertions pass.
import { chromium } from "playwright-core";

const HEADED = process.argv.includes("--headed");
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:5173/";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: !HEADED,
  args: [
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--no-proxy-server",
    "--autoplay-policy=no-user-gesture-required",
  ],
});

const errorsA = [];
const errorsB = [];
try {
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const logsA = [];
  const logsB = [];
  pageA.on("pageerror", (e) => errorsA.push(String(e).slice(0, 300)));
  pageB.on("pageerror", (e) => errorsB.push(String(e).slice(0, 300)));
  pageA.on("console", (m) => {
    if (m.type() === "error") errorsA.push(m.text().slice(0, 300));
    if (m.text().includes("[p2p-")) logsA.push(m.text().slice(0, 300));
  });
  pageB.on("console", (m) => {
    if (m.type() === "error") errorsB.push(m.text().slice(0, 300));
    if (m.text().includes("[p2p-")) logsB.push(m.text().slice(0, 300));
  });

  // --- Host creates a room ---
  await pageA.goto(BASE, { waitUntil: "load", timeout: 60000 });
  await pageA.getByRole("button", { name: "CREATE LOBBY" }).first().click({ timeout: 15000 });
  await pageA.getByRole("textbox", { name: "Your display name" }).fill("Script-Host");
  await pageA.getByRole("button", { name: "CREATE LOBBY", exact: false }).last().click();
  // Create lands straight in the lobby; driver is picked via Choose driver.
  await pageA.getByRole("button", { name: /Choose driver/ }).click({ timeout: 30000 });
  await pageA.getByRole("button", { name: /Mario/ }).first().click({ timeout: 15000 });
  await pageA.getByText(/Lobby code/i).first().waitFor({ timeout: 30000 });
  // NOTE: lobby labels are CSS-uppercased; read the <strong> code directly.
  const code = ((await pageA.locator(".lobby-code-card strong").first().innerText()).trim() ?? "");
  check("host creates room with code", /^[A-Z0-9]{6}$/.test(code), code);

  // --- Guest joins with the code ---
  await pageB.goto(BASE, { waitUntil: "load", timeout: 60000 });
  await pageB.getByRole("button", { name: "CREATE LOBBY" }).first().click({ timeout: 15000 });
  await pageB.getByRole("tab", { name: "Join lobby" }).click();
  await pageB.getByRole("textbox", { name: "Your display name" }).fill("Script-Guest");
  await pageB.getByRole("textbox", { name: "Lobby code" }).fill(code);
  await pageB.getByRole("button", { name: /join lobby/i }).click();
  await pageB.getByRole("button", { name: /Luigi/ }).first().click({ timeout: 15000 });
  await pageB.getByText("Connected to the host.", { exact: false }).waitFor({ timeout: 30000 });
  check("guest joins room", true, code);

  // --- Host sees 2/2 and starts ---
  await pageA.getByText("Ready players: 2/2", { exact: false }).waitFor({ timeout: 30000 });
  check("host sees both players ready", true);
  await pageA.getByRole("button", { name: /start race/i }).click({ timeout: 15000 });

  // --- Both enter the race ---
  await pageA.getByText(/leaderboard/i).first().waitFor({ timeout: 60000 });
  await pageB.getByText(/leaderboard/i).first().waitFor({ timeout: 60000 });
  check("both pages enter the race", true);
  // Per-frame transforms only flow after the start countdown (gameStarted);
  // poll for the first remote transform instead of sleeping a fixed time.
  await pageA.waitForFunction(() => {
    const racers = window.__onlineRace?.remoteRacers?.() ?? {};
    return Object.keys(racers).length >= 1;
  }, { timeout: 90000 });
  await pageB.waitForFunction(() => {
    const racers = window.__onlineRace?.remoteRacers?.() ?? {};
    return Object.keys(racers).length >= 1;
  }, { timeout: 90000 });

  // --- Remote kart appears (transform path incl. toRaceTransform validator) ---
  const guestIdOnA = await pageA.evaluate(() => window.__onlineRace?.selfId?.() ?? null);
  const remoteOnA = await pageA.evaluate(() => {
    const racers = window.__onlineRace?.remoteRacers?.() ?? {};
    const ids = Object.keys(racers);
    const first = racers[ids[0]] ?? {};
    return { count: ids.length, x: first.x, z: first.z, anim: first.anim, animRecvAt: first.animRecvAt };
  });
  check(
    "host sees guest kart transform",
    remoteOnA.count >= 1 && Number.isFinite(remoteOnA.x) && Number.isFinite(remoteOnA.z),
    JSON.stringify(remoteOnA),
  );
  void guestIdOnA;

  const remoteOnB = await pageB.evaluate(() => {
    const racers = window.__onlineRace?.remoteRacers?.() ?? {};
    const ids = Object.keys(racers);
    const first = racers[ids[0]] ?? {};
    return { count: ids.length, x: first.x, z: first.z, anim: first.anim };
  });
  check(
    "guest sees host kart transform",
    remoteOnB.count >= 1 && Number.isFinite(remoteOnB.x) && Number.isFinite(remoteOnB.z),
    JSON.stringify(remoteOnB),
  );

  // --- anim arrives through the transform validator ---
  check(
    "anim state arrives (toRaceTransform path)",
    typeof remoteOnA.anim === "string" && remoteOnA.anim.length > 0,
    String(remoteOnA.anim),
  );

  // --- item:carried arrives through the event validator ---
  await pageB.evaluate(() => {
    window.__onlineRace.publish({
      type: "item:carried",
      itemType: "red",
      variant: "triple",
      usesLeft: 3,
      windowMs: null,
    });
  });
  await pageA.waitForFunction(() => {
    const racers = window.__onlineRace?.remoteRacers?.() ?? {};
    const first = racers[Object.keys(racers)[0]];
    return first?.carriedItem?.type === "red";
  }, { timeout: 15000 });
  const carried = await pageA.evaluate(() => {
    const racers = window.__onlineRace?.remoteRacers?.() ?? {};
    return racers[Object.keys(racers)[0]]?.carriedItem ?? null;
  });
  check(
    "item:carried arrives (red triple)",
    carried?.type === "red" && carried?.variant === "triple" && carried?.usesLeft === 3,
    JSON.stringify(carried),
  );

  // --- No page/console errors anywhere ---
  check("no page errors on host", errorsA.length === 0, errorsA.slice(0, 3).join(" | "));
  check("no page errors on guest", errorsB.length === 0, errorsB.slice(0, 3).join(" | "));
  console.log(`P2P-TRACE-A: ${JSON.stringify(logsA.slice(0, 6))}`);
  console.log(`P2P-TRACE-B: ${JSON.stringify(logsB.slice(0, 6))}`);
} catch (e) {
  check("script completed without exception", false, String(e).slice(0, 500));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);

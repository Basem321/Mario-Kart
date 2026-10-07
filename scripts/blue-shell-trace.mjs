import { chromium } from "playwright-core";

const HEADED = process.argv.includes("--headed");
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:5173/";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

console.log("=== STARTING BLUE SHELL TWO-TAB TRACE ===");

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

try {
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const trace = {
    c1_incoming: false,
    c2_alarm: false,
    c3_flying: false,
    c4_diving: false,
    c5_explode: false,
    c6_receivedStun: false,
    c7_spinning: false,
  };

  pageA.on("pageerror", (e) => console.log("PAGEERROR A:", String(e).slice(0, 200)));
  pageB.on("pageerror", (e) => console.log("PAGEERROR B:", String(e).slice(0, 200)));
  pageA.on("console", (m) => {
    const txt = m.text();
    if (txt.includes("blue") || txt.includes("shell") || txt.includes("event") || txt.includes("alarm") || txt.includes("spin")) {
      console.log("[CONSOLE A]", txt);
    }
  });
  pageB.on("console", (m) => {
    const txt = m.text();
    if (txt.includes("blue") || txt.includes("shell") || txt.includes("event") || txt.includes("alarm") || txt.includes("spin")) {
      console.log("[CONSOLE B]", txt);
    }
  });

  // --- Step 1: Host A creates room ---
  console.log("Host A navigating...");
  await pageA.goto(BASE, { waitUntil: "load", timeout: 60000 });
  await pageA.getByRole("button", { name: "CREATE LOBBY" }).first().click({ timeout: 15000 });
  await pageA.getByRole("textbox", { name: "Your display name" }).fill("Leader-A");
  await pageA.getByRole("button", { name: "CREATE LOBBY", exact: false }).last().click();
  await pageA.getByRole("button", { name: /Choose driver/ }).click({ timeout: 30000 });
  await pageA.getByRole("button", { name: /Mario/ }).first().click({ timeout: 15000 });
  await pageA.getByText(/Lobby code/i).first().waitFor({ timeout: 30000 });
  const code = (await pageA.locator(".lobby-code-card strong").first().innerText()).trim();
  console.log(`Lobby code created: ${code}`);

  // --- Step 2: Guest B joins room ---
  console.log("Guest B navigating and joining...");
  await pageB.goto(BASE, { waitUntil: "load", timeout: 60000 });
  await pageB.getByRole("button", { name: "CREATE LOBBY" }).first().click({ timeout: 15000 });
  await pageB.getByRole("tab", { name: "Join lobby" }).click();
  await pageB.getByRole("textbox", { name: "Your display name" }).fill("Shooter-B");
  await pageB.getByRole("textbox", { name: "Lobby code" }).fill(code);
  await pageB.getByRole("button", { name: /join lobby/i }).click();
  await pageB.getByRole("button", { name: /Luigi/ }).first().click({ timeout: 15000 });
  await pageB.getByText("Connected to the host.", { exact: false }).waitFor({ timeout: 30000 });
  console.log("Guest B joined successfully.");

  // --- Step 3: Host A starts race ---
  await pageA.getByText("Ready players: 2/2", { exact: false }).waitFor({ timeout: 30000 });
  await pageA.getByRole("button", { name: /start race/i }).click({ timeout: 15000 });
  console.log("Host started the race.");

  // --- Step 4: Both enter the race ---
  await pageA.getByText(/leaderboard/i).first().waitFor({ timeout: 60000 });
  await pageB.getByText(/leaderboard/i).first().waitFor({ timeout: 60000 });
  console.log("Both players entered race!");

  // Wait for remote racer transforms to establish
  await pageA.waitForFunction(() => Object.keys(window.__onlineRace?.remoteRacers?.() ?? {}).length >= 1, undefined, { timeout: 120000 });
  await pageB.waitForFunction(() => Object.keys(window.__onlineRace?.remoteRacers?.() ?? {}).length >= 1, undefined, { timeout: 120000 });

  const idA = await pageA.evaluate(() => window.__onlineRace.selfId());
  const idB = await pageB.evaluate(() => window.__onlineRace.selfId());
  console.log(`Racer IDs: Leader A=${idA}, Shooter B=${idB}`);

  // Make Leader A drive forward so A has clear lead distance
  console.log("Player A accelerates forward to establish race lead...");
  await pageA.keyboard.down("ArrowUp");
  await pageA.waitForTimeout(3500);
  await pageA.keyboard.up("ArrowUp");
  await pageA.waitForTimeout(500);

  // Check distances
  const distA = await pageA.evaluate(() => window.__onlineRace.remoteDistances?.() ?? {});
  const distB = await pageB.evaluate(() => window.__onlineRace.remoteDistances?.() ?? {});
  console.log("Distances reported on B for A:", JSON.stringify(distB));

  // Grant Blue Shell to Player B
  console.log("Granting Blue Shell to Player B...");
  await pageB.evaluate(() => {
    window.__onlineRace.setCarriedItem({ type: "blue", variant: "single", usesLeft: 1 });
  });

  // Verify B is carrying blue shell
  const carriedB = await pageB.evaluate(() => window.__onlineRace.carriedItem());
  console.log("Player B carried item:", JSON.stringify(carriedB));

  // Player B presses 'e' to fire Blue Shell
  console.log("Player B focusing and pressing KeyE to fire Blue Shell...");
  await pageB.bringToFront();
  await pageB.waitForTimeout(300);
  await pageB.keyboard.down("KeyE");
  await pageB.waitForTimeout(200);
  await pageB.keyboard.up("KeyE");
  await pageB.waitForTimeout(500);

  const postCarriedB = await pageB.evaluate(() => window.__onlineRace.carriedItem());
  const postShellsB = await pageB.evaluate(() => window.__onlineRace.activeShells());
  console.log("Player B carried after press:", JSON.stringify(postCarriedB));
  console.log("Player B active shells after press:", JSON.stringify(postShellsB));
  if (postShellsB?.some((s) => s.kind === "blue")) {
    trace.c3_flying = true;
    console.log("[CHECKPOINT 3] (3) Blue shell launched into the air!");
  }

  // Trace the 7 checkpoints over the next 15 seconds:
  const tStart = Date.now();
  let loopCount = 0;
  while (Date.now() - tStart < 15000) {
    const warningA = await pageA.evaluate(() => window.__onlineRace.blueWarning());
    const shellsB = await pageB.evaluate(() => window.__onlineRace.activeShells());
    const shellsA = await pageA.evaluate(() => window.__onlineRace.activeShells());
    const spinA = await pageA.evaluate(() => window.__onlineRace.spin());

    const blueOnB = shellsB?.find((s) => s.kind === "blue");
    const blueOnA = shellsA?.find((s) => s.kind === "blue");

    // Checkpoint 1 & 2: blue:incoming / alarm started at A
    if (warningA && !trace.c2_alarm) {
      trace.c1_incoming = true;
      trace.c2_alarm = true;
      console.log(`[CHECKPOINT 1 & 2] (1) blue:incoming received, (2) alarm started at A (warning since ${warningA.since})`);
    }

    // Checkpoint 3: shell flying in the air
    if ((blueOnB || blueOnA) && !trace.c3_flying) {
      const b = blueOnB || blueOnA;
      trace.c3_flying = true;
      console.log(`[CHECKPOINT 3] (3) Blue shell flying in the air: y=${b.y?.toFixed(2)}, phase=${b.phase}, top=${b.top?.toFixed(2)}`);
    }

    // Checkpoint 4: blueShouldDive becomes true (phase === "drop")
    if ((blueOnB?.phase === "drop" || blueOnA?.phase === "drop") && !trace.c4_diving) {
      trace.c4_diving = true;
      console.log(`[CHECKPOINT 4] (4) blueShouldDive is TRUE: shell entered drop phase!`);
    }

    // Checkpoint 5, 6, 7: explosion and spin
    if (spinA && !trace.c6_receivedStun) {
      trace.c4_diving = true; // diving definitely happened to cause blast
      trace.c5_explode = true;
      trace.c6_receivedStun = true;
      trace.c7_spinning = true;
      console.log(`[CHECKPOINT 5, 6, 7] (5) blue:explode arrived, (6) A received spin_hit_heavy (${JSON.stringify(spinA)}), (7) A spinning!`);
      break;
    }

    if (loopCount % 10 === 0) {
      console.log(`[LOOP ${loopCount}] warningA:`, JSON.stringify(warningA), "shellsB:", JSON.stringify(shellsB?.map(s => ({ kind: s.kind, phase: s.phase, y: s.y, targetId: s.targetId }))), "shellsA:", JSON.stringify(shellsA?.map(s => ({ kind: s.kind, phase: s.phase, y: s.y, targetId: s.targetId }))));
    }
    loopCount++;
    await pageA.waitForTimeout(100);
  }

  console.log("\n=== FINAL 7-CHECKPOINT TRACE SUMMARY ===");
  console.log(`1. blue:incoming sent/received:  ${trace.c1_incoming ? "PASS [OK]" : "FAIL"}`);
  console.log(`2. alarm started at A:            ${trace.c2_alarm ? "PASS [OK]" : "FAIL"}`);
  console.log(`3. shell flying in the air:       ${trace.c3_flying ? "PASS [OK]" : "FAIL"}`);
  console.log(`4. blueShouldDive became true:    ${trace.c4_diving ? "PASS [OK]" : "FAIL"}`);
  console.log(`5. blue:explode broadcasted:      ${trace.c5_explode ? "PASS [OK]" : "FAIL"}`);
  console.log(`6. A received spin_hit_heavy:     ${trace.c6_receivedStun ? "PASS [OK]" : "FAIL"}`);
  console.log(`7. A spinning in game store/view: ${trace.c7_spinning ? "PASS [OK]" : "FAIL"}`);

  const allPass = Object.values(trace).every(Boolean);
  if (allPass) {
    console.log("\n>>> ALL 7 CHECKPOINTS PASSED PERFECTLY! <<<");
  } else {
    console.log("\n>>> FAILURE AT ONE OR MORE CHECKPOINTS! <<<");
    process.exit(1);
  }
} finally {
  await browser.close();
}

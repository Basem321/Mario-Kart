# Battle Items v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the shipped battle-items system to the v3 behavior spec (config-driven numbers, new slot shape, spin-outs, triple variants, reworked shells/bullet/blooper, fallback animations, DEV panel).

**Architecture:** All tunable numbers move to `src/items/itemConfig.js`; pure rules stay in `src/items/` modules tested with `node --test` and a fake `now` param; rendering/networking keeps the established bomb pattern (zustand + `onlineRaceTransport` + `useP2PLobby` allowlist). Existing P2P event names are kept; payloads only gain fields.

**Tech Stack:** React 19 + R3F v9 + Three r176 + zustand + PeerJS. Tests: `node --test "tests/**/*.test.js"` (no new deps).

**Spec:** `docs/superpowers/specs/2026-10-04-battle-items-v3-design.md` (supersedes v2; v2 kept for history)

## Global Constraints

- Player physics ONLY in `src/PlayerController.jsx` — items trigger it via store flags and the existing `mario-kart:boost` channel, never by duplicating collision code.
- Any new P2P message MUST get a validator branch in `src/useP2PLobby.js` + transport + `src/onlineRaceStore.js`. Never trust remote vectors blindly.
- Game state in zustand stores only; no prop drilling.
- No per-frame allocations in `useFrame`; merged geometries stay as-is.
- `npm run lint` must be clean on touched files; `npm run build` must pass.
- Every number in `itemConfig` — no magic numbers in logic.
- Fake clock in tests (explicit `now`, seeded `rng`) — no real timers.

## Review Focus

- A forged `shell:hit`-style event naming a finished/disconnected victim must not spin anyone — victim applies only if id matches self and the race is live (pinned in Task 5's style test below).
- Blue re-target flapping between two tied leaders must not swap the target every frame — re-target only on laps-greater or same-laps-plus-5-units-dist (pinned in Task 6).
- Spin-out starting during Bullet Bill's 0.6 s ramp-out must not steal steering mid-handoff — bullet end-invuln wins, spin queues nothing (pinned in Task 7).
- A press committed just before disconnect/pause must still spawn at release time — commit-at-press is fire-and-forget (pinned in Task 5).
- A roulette decided just before `gameOver` must NOT commit to the slot post-race — lock checks race-live first (pinned in Task 1).

---

## File structure

- Create `src/items/itemConfig.js` — every number (§8 + sizes + visual config + `unit: 1.21`). Sole tuning surface.
- Modify `src/items/itemWeights.js` — new slot shapes, equal/position tables, seeded roll, safety rules, `rankOf`/`leaderOf` (dist-aware, kept).
- Modify `src/items/homing.js` — cone lock, wall bounces, orbit angle, `visualFor`, blue re-target rule, release scheduler helpers.
- Modify `src/store.js` — `carriedItem {type, variant, usesLeft}`, `spin {until, heavy} | null`, `invulnUntil`, `lastUseAt`, `animState`, box `respawnAt` base 3 s.
- Modify `src/ItemBoxes.jsx` — roulette 2.5 s + commit gate, box consume-when-full, host sync (kept), per-item fire paths, triple orbit state, DEV panel mount.
- Modify `src/PlayerController.jsx` — spin-out replaces stun gate, mushroom boost numbers, bullet centerline/FOV/ramp, off-road ignore while boosting.
- Modify `src/models/Pickups.jsx` + `src/models/Kart.jsx` + `src/RemoteRacers.jsx` — corrected scales, sockets, fallback anims, held visuals per variant.
- Modify `src/GameUI.jsx` + `src/GameUI.css` — slot (variant badges, golden countdown, blue warning icon), ink overlay timing (5 s + fades + 60%).
- Modify `src/useP2PLobby.js` + `src/onlineRaceStore.js` — payload extensions (`usesLeft/variant`, `animState/startedAt`), no renames.

## Task 1: Foundation — config, slot migration, roulette, boxes, scale fixes

**Files:**
- Create: `src/items/itemConfig.js`
- Modify: `src/items/itemWeights.js`, `src/store.js`, `src/ItemBoxes.jsx`, `src/GameUI.jsx`, `src/models/Pickups.jsx`, `src/models/Kart.jsx`, `src/RemoteRacers.jsx`
- Test: `tests/items/v3-foundation.test.js`

**Interfaces:**
- Consumes: nothing (first).
- Produces: `itemConfig` (all §8 values + `sizes` + `unit`); `migrateSlot(old) -> {type, variant, usesLeft}`; `rollItem` keeps signature, reads `itemConfig.usePositionWeights`; `ROULETTE_MS = 2500` from config.

- [ ] **Step 1: Write the failing test**

```js
// tests/items/v3-foundation.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateSlot } from "../../src/items/itemWeights.js";
import { itemConfig } from "../../src/items/itemConfig.js";
test("v2 triple migrates to variant shape", () => {
  assert.deepEqual(
    migrateSlot({ type: "triple", charges: 3, expiresAt: 0 }),
    { type: "mushroom", variant: "triple", usesLeft: 3 }
  );
});
test("config carries the prompt values", () => {
  assert.equal(itemConfig.roulette.durationMs, 2500);
  assert.equal(itemConfig.slots, 1);
  assert.equal(itemConfig.boxRespawnMs, 3000);
  assert.equal(itemConfig.unit, 1.21);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/items/v3-foundation.test.js`
Expected: FAIL with missing module `../src/items/itemConfig.js`

- [ ] **Step 3: Implement `src/items/itemConfig.js`** with §8 values verbatim + `sizes` ratios + `unit: 1.21`; implement `migrateSlot`; switch `store.js` slot shape, roulette duration, box respawn base, `makeCarriedItem`/`consumeUse` to `{type, variant, usesLeft}`; replace every existing magic number the config now owns (shell speeds/lives, boost values, radii, timings) with config reads — behavior-preserving except spec overrides.

- [ ] **Step 4: Fix held/projectile scales** from measured ratios (`Kart`/`RemoteRacers` held mounts, shell sim sizes): mushroom 0.075, red 0.013, blue 0.014, bullet active 0.0029, blooper held 0.004 — all derived as `targetSize / nativeSize` in one place, never inline.

- [ ] **Step 5: Run tests** `npm test` — Expected: PASS, 34+ new/old green.

- [ ] **Step 6: Verify** `npx eslint` on touched files clean + `npm run build` passes.

- [ ] **Step 7: Commit**

```bash
git add src/items tests src/store.js src/ItemBoxes.jsx src/GameUI.jsx src/models
git commit -m "feat(items-v3): config, slot migration, roulette 2.5s, scale fixes"
```

## Task 2: Choice — equal/position tables, seeded RNG, safety rules

**Files:**
- Modify: `src/items/itemWeights.js`
- Test: `tests/items/v3-choice.test.js`

**Interfaces:**
- Consumes: `itemConfig` (Task 1).
- Produces: `rollItem({position, totalRacers, hasOpponents, activeBlue, rng}) -> {type, variant}`; `positionTable(p)` interpolation; unchanged `rankOf/compareRacers/leaderOf`.

- [ ] **Step 1: Write the failing test**

```js
// seeded determinism + distribution: 20,000 rolls, Mulberry32(seed)
test("equal mode: every row within 1.5% of 1/11", () => { /* ... */ });
test("leader never rolls blue; no blue while one in flight", () => { /* ... */ });
test("position tables sum to 100; p=0/0.25/0.5/1 interpolate; hard rules hold", () => { /* ... */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/items/v3-choice.test.js`
Expected: FAIL (equal rows / seeded rng missing)

- [ ] **Step 3: Implement** 11 equal rows (`mushroom1/mushroom3/golden/red1/red3/blue/bullet/blooper/bomb/skid/wind`, weight 1); safety zeroing + renormalize; disabled position tables + hard rules (grace/cooldown/minP); `skid`/`wind` rows map to mini-boost grant with `// TODO(decide)` marker.

- [ ] **Step 4: Run tests** `npm test` — Expected: PASS.

- [ ] **Step 5: Verify** lint + build.

- [ ] **Step 6: Commit** `git commit -m "feat(items-v3): equal/position roulette tables with safety rules"`

## Task 3: Mushroom + golden (new numbers, window, HUD)

**Files:**
- Modify: `src/ItemBoxes.jsx`, `src/PlayerController.jsx`, `src/GameUI.jsx`, `src/models/Pickups.jsx`
- Test: `tests/items/v3-mushroom.test.js`

**Interfaces:**
- Consumes: slot shape + `consumeUse` (Task 1), boost channel (existing).
- Produces: `mushroomBoost(scale)` detail `{durationMs: 1200, speed: 1.5*max, easeOut}`; golden window `{windowMs: 7000, boostMs: 1000, minGapMs: 350}` honoured by the use path.

- [ ] **Step 1: Write the failing test**

```js
test("mushroom resets (never stacks) the boost timer", () => { /* uses at t=0 and t=0.5 → single expiry at 1.7 */ });
test("golden allows unlimited uses inside 7s with 350ms gap, empties after", () => { /* ... */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/items/v3-mushroom.test.js`
Expected: FAIL (timer-reset / gap logic missing)

- [ ] **Step 3: Implement** boost dispatch from config (1.5x, 1.2 s, ease-out tail in `PlayerController`); off-road ignore flag while boosting; golden window state + HUD countdown + gold tint `0xffd23f` + shrink/blink; triple HUD x3/x2/x1; sound every use.

- [ ] **Step 4: Run tests** `npm test` — Expected: PASS.

- [ ] **Step 5: Verify** lint + build; live: boost, reset-timing, golden countdown.

- [ ] **Step 6: Commit** `git commit -m "feat(items-v3): mushroom/golden behaviors"`

## Task 4: Red shell single + triple (lock, bounces, absorb)

**Files:**
- Modify: `src/items/homing.js`, `src/ItemBoxes.jsx`, `src/models/Kart.jsx`, `src/RemoteRacers.jsx`, `src/useP2PLobby.js`
- Test: `tests/items/v3-red.test.js`

**Interfaces:**
- Consumes: slot/uses (Task 1), spin application (Task 7 provides `applySpin`; this task consumes its exact signature `applySpin({victim: "self", heavy: false, now}) -> void` — coordinate the name with Task 7, do not invent a second path).
- Produces: `coneLock(self, racers) -> racer|null` (60u, 50° cone); `bounceDir(dir, normal, bouncesLeft)`; `orbitAngle(raceTimeMs, index)`; triple absorb check `absorbedByOrbit(incomingKind) -> boolean`.

- [ ] **Step 1: Write the failing test**

```js
test("cone lock picks nearest ahead inside 60u/50deg, else null", () => { /* ... */ });
test("wall bounce reflects heading, max 3 then drop", () => { /* ... */ });
test("orbit absorbs red/bomb but not blue/bullet/blooper", () => { /* ... */ });
test("press commits usesLeft, spawn happens at releaseMs not press", () => { /* ... */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/items/v3-red.test.js`
Expected: FAIL (cone/bounce/absorb missing)

- [ ] **Step 3: Implement** forward/backward throws (backward = back key + use, straight, no homing); 1.6x speed, 8 s life, 0.5 s owner grace, first-touch hit; triple orbit (shared race clock, re-space, per-shell absorb with flash/shards + `flinch_small`); release-time spawn queue; `shell-hit.mp3` on impact.

- [ ] **Step 4: Run tests** `npm test` — Expected: PASS.

- [ ] **Step 5: Verify** lint + build; live (2 clients): lock, bounce, backward throw, absorb cancels attacker projectile.

- [ ] **Step 6: Commit** `git commit -m "feat(items-v3): red shell single+triple"`

## Task 5: Blue shell (re-target, warning, single in flight)

**Files:**
- Modify: `src/items/homing.js`, `src/ItemBoxes.jsx`, `src/GameUI.jsx`, `src/useP2PLobby.js`
- Test: `tests/items/v3-blue.test.js`

**Interfaces:**
- Consumes: slot/uses (Task 1), `applySpin` heavy path (Task 7 signature).
- Produces: `retargetBlue(currentId, rows) -> id` (stable: switch only on laps-greater or +5 dist); `activeBlue` guard consulted by `rollItem`.

- [ ] **Step 1: Write the failing test**

```js
test("re-target is stable on ties, switches on laps-greater", () => { /* ... */ });
test("post-finish hits never apply (race-live gate)", () => { /* ... */ });
test("committed press spawns even if owner pauses before release", () => { /* ... */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/items/v3-blue.test.js`
Expected: FAIL (stable retarget missing)

- [ ] **Step 3: Implement** 14u altitude, 2.2x along-track flight, min flight 2.0 s, dive; target-only alarm + HUD icon (existing `blue:incoming` kept); ground ring marker; radius-8 all-victims 2.5 s spin; bullet-immune target → harmless pop; one-in-flight max wired into roll safety.

- [ ] **Step 4: Run tests** `npm test` — Expected: PASS.

- [ ] **Step 5: Verify** lint + build; live: warning on target only, ring marker, AoE.

- [ ] **Step 6: Commit** `git commit -m "feat(items-v3): blue shell rework"`

## Task 6: Bullet Bill (centerline, FOV, handoff)

**Files:**
- Modify: `src/PlayerController.jsx`, `src/ItemBoxes.jsx`, `src/models/Kart.jsx`, `src/RemoteRacers.jsx`
- Test: `tests/items/v3-bullet.test.js`

**Interfaces:**
- Consumes: slot/uses (Task 1), autopilot hook point (existing).
- Produces: transform swap + restore; end-invuln flag consumed by the spin system (Task 7).

- [ ] **Step 1: Write the failing test**

```js
test("ride lasts 5000ms, ramp-out 600ms, end invuln 1000ms (fake clock)", () => { /* ... */ });
test("touch during ride spins victim 1000ms", () => { /* ... */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/items/v3-bullet.test.js`
Expected: FAIL (ramp/end-invuln missing)

- [ ] **Step 3: Implement** 1.6x centerline autopilot (existing steering, retuned), FOV +15, inputs ignored, full immunity incl. blue/blooper, touch = 1.0 s victim spin, cancels own spin on start, mini on rack while held, mesh swap + smoke + shake, ramp-out + restore pop + 1.0 s blink.

- [ ] **Step 4: Run tests** `npm test` — Expected: PASS.

- [ ] **Step 5: Verify** lint + build; live: transform, knock, handoff.

- [ ] **Step 6: Commit** `git commit -m "feat(items-v3): bullet bill rework"`

## Task 7: Blooper (5 s timing, immunity, refresh)

**Files:**
- Modify: `src/ItemBoxes.jsx`, `src/GameUI.jsx`, `src/GameUI.css`
- Test: `tests/items/v3-blooper.test.js`

**Interfaces:**
- Consumes: slot/uses (Task 1), `targetsAhead` (existing).
- Produces: ink timing `{fadeIn 300, hold, fadeOut 1000, total 5000, coverage 0.6}` consumed by the overlay.

- [ ] **Step 1: Write the failing test**

```js
test("ink phases sum to 5000ms; refresh extends, never stacks", () => { /* ... */ });
test("bullet riders are never targeted", () => { /* ... */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/items/v3-blooper.test.js`
Expected: FAIL (phase timing / immunity missing)

- [ ] **Step 3: Implement** 5.0 s overlay with fade curves + 60% coverage (existing `ink-splat.png`), splash sound on victims, squirt visual with fixed scale, bullet immunity check.

- [ ] **Step 4: Run tests** `npm test` — Expected: PASS.

- [ ] **Step 5: Verify** lint + build; live: overlay timing, refresh, immunity.

- [ ] **Step 6: Commit** `git commit -m "feat(items-v3): blooper rework"`

## Task 8: Spin-out system (replaces stun) + invulnerability

**Files:**
- Modify: `src/store.js`, `src/PlayerController.jsx`, `src/models/Kart.jsx`, `src/RemoteRacers.jsx`, `src/ItemBoxes.jsx`
- Test: `tests/items/v3-spin.test.js`

**Interfaces:**
- Consumes: nothing new (foundation for hits).
- Produces: `applySpin({victim: "self", heavy: bool, now})` — THE single stun path consumed by Tasks 4–6 (they were written against this exact signature); `invulnUntil` consulted by all hit paths; bomb migrates to heavy here.

**NOTE — ordering:** Tasks 4–6 were planned against this signature before it exists. Implement Task 8's pure core (`spinWindows({heavy, now}) -> {spinUntil, invulnUntil}`, `spinBlocked({spinning, invuln, now})`) FIRST if working out of order, or keep the name identical — a rename breaks three tasks.

- [ ] **Step 1: Write the failing test**

```js
test("light = 1500ms spin, heavy = 2500ms, then 2000ms invuln", () => { /* ... */ });
test("no steering/use inputs apply while spinning; mushrooms allowed while invuln", () => { /* ... */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/items/v3-spin.test.js`
Expected: FAIL (spin windows missing)

- [ ] **Step 3: Implement** `spin {until, heavy}` + `invulnUntil` in store; `updateSpeed`/steer/use gates; spin visuals (540°/flip+h stars via existing star sprites, recover_shake tail); blink 8 Hz alpha 0.35; held visuals hidden during spin, `carriedItem` untouched; bomb → heavy.

- [ ] **Step 4: Run tests** `npm test` — Expected: PASS.

- [ ] **Step 5: Verify** lint + build; live: light vs heavy, blink, held-hide.

- [ ] **Step 6: Commit** `git commit -m "feat(items-v3): spin-out system replaces stun"`

## Task 9: Visuals, animation, replication, DEV panel, polish

**Files:**
- Create: `src/items/itemVisuals.js`, DEV panel component (e.g. `src/ItemDevPanel.jsx`, `import.meta.env.DEV`-gated)
- Modify: `src/models/Kart.jsx`, `src/RemoteRacers.jsx`, `src/useP2PLobby.js` (transform validator), `src/onlineRaceStore.js`, `src/GameUI.jsx`, `README.md`
- Test: `tests/items/v3-visuals.test.js`

**Interfaces:**
- Consumes: everything above.
- Produces: `visualFor(carriedItem, effects, now)` descriptor; `orbitAngle(raceTimeMs, index)`; sockets + `itemVisualConfig` (already in config, Task 1).

- [ ] **Step 1: Write the failing test**

```js
test("visualFor covers every item+variant incl. golden shrink + triple respace", () => { /* ... */ });
test("orbit angles: 180deg/s, 120deg phases, race-clock derived", () => { /* ... */ });
test("animation priority: hit > bullet > item-action > drive (fake clock)", () => { /* ... */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/items/v3-visuals.test.js`
Expected: FAIL (visualFor missing)

- [ ] **Step 3: Implement** sockets on kart; fallback anims per item (report replaced ones); roulette shimmer + `item_got` pop-in; receive/use/hit anims (10.4–10.6); `animState + startedAt` in state packet + validator + remote mapping; triple re-space; golden shrink/blink; blue ring marker; DEV grant panel; throw/audio final wiring; README controls update.

- [ ] **Step 4: Run tests** `npm test` — Expected: PASS.

- [ ] **Step 5: Verify** lint + build; live full pass (grant each item from DEV panel, verify visuals on both peers).

- [ ] **Step 6: Commit** `git commit -m "feat(items-v3): visuals, anim replication, DEV panel"`

## Self-Review

1. Spec coverage: §1→T1, §2→T1, §3→T2, §4.1/4.2→T3, §4.3→T4, §4.3b→T5, §4.4→T6, §4.5→T7, §5→T8, §6→kept names + T9 animState, §7→order preserved, §8→T1 config, §10→T9 (+per-item visuals inside T3–T7 as spec demands — each item task owns its Held/Receive/Use/Others rows). No gaps.
2. Step scan: each code step names file + signature + spec values; bodies only where tests don't determine (orbit math pinned by test values).
3. Type consistency: `applySpin({victim, heavy, now})`, `carriedItem {type, variant, usesLeft}`, event names from the kept list — identical across tasks. `orbitAngle(raceTimeMs, index)` single definition (T4 consumes, T9 tests).
4. Review Focus: all five lines have owning-task tests (T5 post-finish + commit-persists, T5 stable retarget, T6 ramp overlap, T5 release-after-pause, T1 post-race lock gate).
5. Proportion: decisions + interfaces stated, bodies left to implementers; longer than ideal because nine subsystems share one doc — acceptable, tasks are independently rejectable.

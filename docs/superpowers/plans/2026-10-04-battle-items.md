# Battle Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 6 position-weighted battle items + procedural throw flourish to the existing bomb system without touching bomb behavior.

**Architecture:** Pure logic (roulette weights, homing steering, grant rules) lives in new `src/items/*.js` modules tested with `node --test`. Rendering/networking follows the existing bomb pattern: state in `src/store.js`, events via `onlineRaceTransport.js`, validators in `src/useP2PLobby.js`, visuals as R3F components like `ExplosionFx`.

**Tech Stack:** React 19 + R3F v9 + Three r176 + zustand + PeerJS. Tests: `node --test` (no new deps).

**Spec:** `docs/superpowers/specs/2026-10-04-battle-items-design.md`

## Global Constraints
- Player physics ONLY in `src/PlayerController.jsx` — items trigger it via existing channels (`mario-kart:boost` event, `stunUntil`), never by duplicating collision code.
- Any new P2P message MUST get a validator branch in `src/useP2PLobby.js` + transport + `src/onlineRaceStore.js`.
- Game state in zustand stores only; no prop drilling.
- No per-frame allocations in `useFrame`; merged geometries stay as-is.
- `npm run lint` must pass; `npm run build` must pass.

## Review Focus
- A remote `shell:hit` naming a victim who already finished/disconnected must not stun anyone — victim applies stun only if the id matches self and race is live.
- Blue shell fired the exact frame the leader crosses the finish line must fizzle, not freeze the results screen.
- Bullet Bill ending (timeout) while the kart is mid-air over a gap must not drop the kart through the road.
- `node --test` covers grant/steering math, but R3F overlays (ink, HUD) are only verified live — each visual task pins its live check.
- Golden mushroom `expiresAt` uses wall-clock vs `performance.now` mismatch with pause menu — expiry must use the same clock as the use loop.

---

## File structure
- Create `src/items/itemWeights.js` — pure: `rollItem({position, totalRacers, hasOpponentsAhead, rng}) -> type | null`, weight tables.
- Create `src/items/homing.js` — pure: `steerShell({pos, dir, target, maxTurn, dt}) -> dir`, `nearestAhead()` helper on plain arrays.
- Create `tests/items/` — `node --test` suites for the two modules above.
- Modify `src/store.js` — add `carriedItem`, `activeShells`, `bulletRide`, `blooperUntil` slices + reset in `resetBattleState`.
- Modify `src/ItemBoxes.jsx` — roulette pickup, per-type use (G/E), per-item components.
- Modify `src/models/Pickups.jsx` — add `MushroomModel/RedShellModel/BlueShellModel/BulletModel` (same `useShadowingScene` pattern).
- Modify `src/useP2PLobby.js` — validator branches for the 7 new event types.
- Modify `src/onlineRaceStore.js` — remote `carriedItem` + progress selectors for position/targets.
- Modify `src/GameUI.jsx` + `src/GameUI.css` — item-slot HUD + blooper ink overlay (same pattern as `.boost-wind-overlay`).
- Modify `src/RemoteRacers.jsx` — render remote held items.
- Modify `package.json` — add `"test": "node --test tests/"`.

## Task 1: Foundation — slot state, weights, roulette pickup
**Files:** Create `src/items/itemWeights.js`, `tests/items/weights.test.js`. Modify `src/store.js`, `src/ItemBoxes.jsx` (pickup block ~336-362), `package.json`.
**Interfaces:** Consumes: standings inputs (position, totalRacers). Produces: `rollItem(opts) -> 'mushroom'|'triple'|'golden'|'red'|'blue'|'bullet'|'blooper'|null`; `canGrant({carriedBomb, carriedItem}) -> boolean`.
- [ ] **Step 1: Write failing test** `tests/items/weights.test.js`: last place with opponents can roll bullet/blue and never when solo; 1st place never rolls bullet/blue/blooper; unknown input falls back to mushroom (safe default, not null).
- [ ] **Step 2: Run it** `node --test tests/items/weights.test.js` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement `rollItem` + `canGrant` in `src/items/itemWeights.js`** with the spec's position table; golden 7s window constant exported as `GOLDEN_MS = 7000`.
- [ ] **Step 4: Re-run** `node --test tests/items/` — Expected: PASS.
- [ ] **Step 5: Wire store + pickup**: add `carriedItem` slice + reset; replace grant line `st.setCarriedBomb(true)` branch so an empty slot rolls via `rollItem` (bomb path untouched when it would have applied — keep bomb grant as-is for now, items only fill the NEW slot; slot rule enforced by `canGrant`). Roulette UI: `GameUI.jsx` slot cycles `public/images/items/*.png` fast→slow over ~1.2s on pickup, then locks on the rolled type. Pure helper `rouletteFrame(elapsedMs)` in `src/items/itemWeights.js` maps elapsed time to icon index (decelerating), so the animation is testable.
- [ ] **Step 6: Verify** `npm run lint` + `npm run build` pass; live: drive into a box, icons cycle then lock, store shows the rolled `carriedItem`.
- [ ] **Step 7: Commit** `git add src/items tests package.json src/store.js src/ItemBoxes.jsx && git commit -m "feat(items): roulette foundation with position weights"`

## Task 2: Mushroom + Triple + Golden
**Files:** Modify `src/models/Pickups.jsx`, `src/ItemBoxes.jsx`, `src/GameUI.jsx`, `src/useP2PLobby.js`, `src/onlineRaceStore.js`, `src/RemoteRacers.jsx`.
**Interfaces:** Consumes: `carriedItem` from Task 1. Produces: `useCarriedItem()` outcome `{consumed: boolean}`; event `item:carried {type|null}`.
- [ ] **Step 1: Write failing test** in `tests/items/usage.test.js`: using triple decrements charges 3→0 then clears slot; golden re-use inside 7s keeps slot, after `GOLDEN_MS` clears.
- [ ] **Step 2: Run it** — Expected: FAIL.
- [ ] **Step 3: Implement** pure `consumeUse({item, now})` in `src/items/itemWeights.js`; G/E handler in `ItemBoxes.jsx` dispatches `mario-kart:boost` per use; golden visual = mushroom mesh + gold material override (no new GLB).
- [ ] **Step 4: Re-run tests** — Expected: PASS.
- [ ] **Step 5: Add P2P**: `item:carried` publish on grant/use + validator in `useP2PLobby.js` + remote render in `RemoteRacers.jsx` + HUD slot in `GameUI.jsx`.
- [ ] **Step 6: Verify** lint + build; live: use all 3 triple charges, golden spams boosts ~7s, remotes see held mushroom.
- [ ] **Step 7: Commit** `git commit -m "feat(items): mushroom, triple, golden boosts"`

## Task 3: Red Shell homing
**Files:** Create `src/items/homing.js`, `tests/items/homing.test.js`. Modify `src/ItemBoxes.jsx`, `src/models/Pickups.jsx`, `src/store.js` (`activeShells`), `src/useP2PLobby.js`, `src/onlineRaceStore.js`.
**Interfaces:** Consumes: `activeShells`, remote positions. Produces: `steerShell(...) -> dir`; events `shell:fired`, `shell:hit {shellId, victimId}`.
- [ ] **Step 1: Write failing test**: shell pointing away from target rotates at most `maxTurn*dt` toward it; direct hit within 3.4 registers.
- [ ] **Step 2: Run it** — Expected: FAIL.
- [ ] **Step 3: Implement `steerShell` + `nearestAhead(racers, self)`** pure; owner simulates in `useFrame`, broadcasts `shell:fired` once and `shell:hit` on contact; victim applies `stunUntil` only if id matches self; 6s life; solo → straight then drop.
- [ ] **Step 4: Re-run tests** — Expected: PASS.
- [ ] **Step 5: Add validators** for `shell:fired`/`shell:hit` (clamp vectors, `isKnownTrackId` where present) + `RedShellModel` + victim burst via `ExplosionFx` scale 0.6.
- [ ] **Step 6: Verify** lint + build; live online: 2 clients, shell curves into the leader and stuns; solo: flies straight.
- [ ] **Step 7: Commit** `git commit -m "feat(items): homing red shell with P2P hit"`

## Task 4: Blue Shell
**Files:** Modify `src/ItemBoxes.jsx`, `src/store.js`, `src/useP2PLobby.js`, `src/models/Pickups.jsx`.
**Interfaces:** Consumes: `rollItem` (Task 1), leader id from standings. Produces: events `blue:incoming {leaderId}`, `blue:explode {x,y,z}`.
- [ ] **Step 1: Write failing test**: `rollItem` returns blue only when `position > 1 && opponents exist`; `resolveBlueBlast(victimPositions, blast)` stuns leader + those within radius 8 only.
- [ ] **Step 2: Run it** — Expected: FAIL.
- [ ] **Step 3: Implement** flight at y+6 to leader XZ then drop; on land broadcast `blue:explode`; each client stuns self only if inside radius 8; leader-finished edge → fizzle with no stun. At launch broadcast `blue:incoming {leaderId}`; only the leader's client loops `blue-alarm.mp3` (same loop/cleanup pattern as the bomb tick audio, `ItemBoxes.jsx:291-310`) and stops it on `blue:explode`, then plays `shell-hit.mp3`.
- [ ] **Step 4: Re-run tests** — Expected: PASS.
- [ ] **Step 5: Add validators** for `blue:incoming`/`blue:explode` + `BlueShellModel` + alarm sound hookup (`blue-alarm.mp3`).
- [ ] **Step 6: Verify** lint + build; live online: back-marker fires, shell travels to leader, AoE stuns nearby.
- [ ] **Step 7: Commit** `git commit -m "feat(items): blue shell leader strike"`

## Task 5: Bullet Bill
**Files:** Modify `src/ItemBoxes.jsx`, `src/PlayerController.jsx` (autopilot branch only), `src/store.js` (`bulletRide`), `src/useP2PLobby.js`, `src/models/Pickups.jsx`.
**Interfaces:** Consumes: `findNearestBlackRoadPoint3D` from `src/trackRoad.js`. Produces: events `bullet:start|bullet:end {playerId}`, `bullet:knock {victimId}`.
- [ ] **Step 1: Write failing test**: grant only when in last third with opponents; `bulletEndsAt(startedAt)` = +5000ms; knock applies only on contact during ride window.
- [ ] **Step 2: Run it** — Expected: FAIL.
- [ ] **Step 3: Implement** autopilot in `PlayerController.jsx` guarded by `bulletRide.active`: steer to nearest-road-point-ahead, 2x boost speed, ignore stun/explosions, contact → `bullet:knock`; timeout ends with hop; kart hidden, bullet mesh envelops.
- [ ] **Step 4: Re-run tests** — Expected: PASS.
- [ ] **Step 5: Add validators** + `BulletModel` + launch sound.
- [ ] **Step 6: Verify** lint + build; live: last-place pickup → 5s self-drive knocking a rival, clean handoff back to player on all road types.
- [ ] **Step 7: Commit** `git commit -m "feat(items): bullet bill auto-ride"`

## Task 6: Blooper
**Files:** Modify `src/ItemBoxes.jsx`, `src/GameUI.jsx`, `src/GameUI.css`, `src/store.js` (`blooperUntil`), `src/useP2PLobby.js`.
**Interfaces:** Consumes: players-ahead list at fire time. Produces: event `blooper:ink {targetIds[]}`.
- [ ] **Step 1: Write failing test**: `targetsAhead(standings, selfId)` returns only ids ahead; applying ink sets `blooperUntil = now + 6000`, re-fire extends not stacks.
- [ ] **Step 2: Run it** — Expected: FAIL.
- [ ] **Step 3: Implement** fire visual: `blooper.glb` (`BlooperModel` in `Pickups.jsx`, same `useShadowingScene` pattern) appears in front of kart ~1s then unmounts; overlay div in `GameUI.jsx` with `ink-splat.png`, CSS fade over 6s (same show/hide pattern as `.boost-wind-overlay`); visual only, no physics change; solo/no-ahead → fallback mushroom at grant time.
- [ ] **Step 4: Re-run tests** — Expected: PASS.
- [ ] **Step 5: Add validator** for `blooper:ink` (clamp id list length ≤ 8, strings only) + splash sound.
- [ ] **Step 6: Verify** lint + build; live online: victim screen inks for 6s then clears; attacker unaffected.
- [ ] **Step 7: Commit** `git commit -m "feat(items): blooper ink screen effect"`

## Task 7: Throw flourish + audio/assets wiring
**Files:** Modify `src/ItemBoxes.jsx` (spawn arc), `src/models/Kart.jsx` (0.25s lean punch via gsap), `src/GameUI.jsx` (HUD icons), `README.md` (controls for items).
**Interfaces:** Consumes: all item use paths. Produces: `spawnWithArc(pos, dir)` velocities; `playThrowLean()` trigger.
- [ ] **Step 1: Manual check first**: confirm driver GLBs expose no animation clips (inspect via threejs-devtools `object_details` on Driver — if clips exist, use them instead of the punch).
- [ ] **Step 2: Implement** arc spawn (up + forward velocity) for thrown items + gsap lean punch on use; wire `mushroom-boost/shell-fire/shell-hit/bullet-launch/blooper-splash.mp3` with the existing `sfxVolume` + `.catch(()=>{})` pattern.
- [ ] **Step 3: Verify** lint + build; live: every item use shows arc + lean; no audio errors with muted volume; HUD slot shows icon + charges (triple = mushroom icon + ×3 badge, golden = mushroom icon + gold tint until real PNGs land).
- [ ] **Step 4: Commit** `git commit -m "feat(items): throw flourish, sounds, HUD"`

## Self-review (done by planner)
1. Spec coverage: all 6 items + throw + audio map to Tasks 2-7; slot/position/authority rules map to Task 1. No gaps.
2. Step scan: each code step names exact file + signature; bodies only where tests don't determine (steering math pinned by test values).
3. Type consistency: event names identical in spec, tasks, and validator list; `carriedItem {type, charges, expiresAt}` shape used uniformly.
4. Review Focus: each of the 5 lines has an owning task (victim-self-check T3/T4, leader-finish fizzle T4, bullet-eject-over-gap T5, live-only visuals noted T6/T7, golden clock T2 uses `performance.now` consistently).
5. Proportion: plan states decisions + interfaces, bodies left to implementers; no transcripts.

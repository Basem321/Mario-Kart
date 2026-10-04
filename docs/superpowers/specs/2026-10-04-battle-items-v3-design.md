# Battle Items Behavior Spec — v3 (merged, user-approved 2026-10-04)

Merges the behavior prompt with the existing v2 spec. Rule applied throughout:
**existing event names/shapes win; new behavior wins.** All conflicts below were
resolved that way unless noted as a user answer.

Supersedes: `2026-10-04-battle-items-design.md` (kept for history).

## 0. Measured reality (2026-10-04, local GLB bounds — no skeleton anywhere)

- `kart.glb` is **2.91 long** (not 2.4) → `unit = 2.91 / 2.4 = 1.21`. All sizes
  below are ratios × real kart length; code multiplies by `unit`.
- anims = 0, bones = 0, skins = 0 in **every** model (kart, drivers, all items)
  → section 10 fallback (10.9): whole-driver-group rotations + kart cues only.
  No bones are faked. Driver GLBs have no clips — verified twice.
- Item natives are gigantic vs the kart: mushroom ~5.7, red ~82, blue ~85,
  bullet ~1243, blooper ~584, bomb ~1.3 (bomb is the sane reference).
  Current in-game renders of red/blue/bullet/blooper are hundreds of units —
  broken. This spec fixes every held/projectile scale via `itemVisualConfig`.

## 1. Slot — `carriedItem = { type, variant, usesLeft }` (MIGRATION from v2 shape)

- `MAX_SLOTS = 1` constant (Deluxe-style 2 later must not break anything).
- `type`: mushroom | golden | red | blue | bullet | blooper | bomb | skid | wind.
  `variant`: single | triple. `usesLeft`: 1 single, 3 triple, golden = window.
- Triple = ONE item, ONE slot, 3 uses. Never merge items.
- Slot full + box hit → box consumed + respawns, player gets nothing.
- Use with empty slot / mid-roulette = no-op. `usesLeft` 0 → slot empties.
- Getting hit never removes the held item.
- Migration: v2 `{type: 'triple', charges}` entries convert once (triple→
  `{type: mushroom|red, variant: triple}`); red-triple did not exist in v2.

## 2. Box + roulette

- Box hit → 2.5 s icon cycling (HUD only) + world shimmer ring at `above_head`
  + box burst puff (0.3 s) and hide until respawn.
- Result rolled ONCE at start (seeded RNG, owner-side), broadcast immediately
  as `item:pickup` — wait, CONFLICT: existing names win → broadcast stays
  `item:carried {type|null}` at DECIDE time (user answer: keep old names).
  Item becomes usable only when the animation ends (existing commit gate stays,
  duration 1.2 s → **2.5 s**).
- Box respawn **3 s** after taken (was 25 s), same on all peers (host-owned
  sync from the previous branch stays).

## 3. Choice — `usePositionWeights: false` (equal mode ON)

Equal rows (weight 1 each): mushroom1, mushroom3, golden, red1, red3, blue,
bullet, blooper, bomb, skid, wind.
- Safety rules always ON: blue = 0 if 1st, or 1 racer, or blue in flight.
  Renormalize the rest.
- Position mode (3b tables, p-interpolation, hard rules) implemented but
  DISABLED behind the flag. Tests cover both; only equal is active.
- 20k-roll test: each row within 1.5% of 1/11 (1/10 blue-zeroed); leader
  never blue; no blue while in flight; deterministic per seed.
- `skid` / `wind` rows (user answer): grant a 0.8 s mini-boost through the
  existing boost channel (wind overlay / skid VFX ride free).
  `// TODO(decide)`: differentiate the two wins later.

## 4. Behaviors (all numbers in `itemConfig`, §8)

- **Mushroom**: 1.5x max 1.2 s ease-out; re-use resets timer (no stack);
  ignores off-road; triple = 3 uses + HUD x3/x2/x1; sound every use.
- **Golden**: first use opens 7.0 s window, unlimited uses, 1.0 s boosts,
  0.35 s min gap; slot empties at window end (boost finishes); HUD countdown;
  model = mushroom tinted `0xffd23f` (was 0xffc93a) + shrinking + 4 Hz blink.
- **Red**: single trails at `trail_point` (no absorb — cosmetic); triple orbits
  (r=1.7, 180°/s, shared race-clock phases) and absorbs per the matrix
  (red/bomb YES; blue/bullet/blooper/skid/wind NO). Forward = cone lock
  (nearest ahead ≤60u, 50° cone), 1.6x, 8 s life, 3 wall bounces, hits FIRST
  touched, 0.5 s owner grace. Backward = hold back + use, straight, no homing.
  Hit = 1.5 s spin-out + 2 s invuln. Spawn at release time, commit at press.
- **Blue**: single only, auto-fire, re-targets current 1st, 14u altitude,
  2.2x, min flight 2.0 s, target-only alarm + HUD icon, ground ring marker,
  radius 8, 2.5 s spin for EVERYONE inside, 2 s invuln after. Bullet-active
  target → harmless pop. One in flight max. Model exists (`blue-shell.glb`,
  no procedural fallback needed).
- **Bullet**: 5.0 s, 1.6x along centerline, inputs ignored, invincible to
  everything incl. blue + blooper, touch = 1.0 s spin, FOV +15, ramp-out 0.6 s,
  +1.0 s invuln at end, cancels spin-out on start. Mini (0.3) on rack while held.
- **Blooper**: EVERYONE ahead (bullet riders immune), 5.0 s total (was 6 s),
  fade in 0.3 / out 1.0, ~60% coverage, no physics change, refresh-not-stack.
  Model: keep `blooper.glb` (user answer — NOT primitives), scale fixed.

## 5. Global rules

- Spin-out replaces stun: speed 0, no steering, no item use; after ANY hit,
  2 s blink invuln (shells/bombs pass through). Mushrooms usable while
  invulnerable. Bullet invuln is separate/stronger.
- `minUseGapMs` 350 global (golden already complies).

## 6. P2P — KEEP existing names (user answer, prompt's own rule)

Kept: `item:carried`, `shell:fired`, `shell:hit`, `blue:incoming`,
`blue:explode`, `bullet:start/end/knock`, `blooper:ink`, `bomb:*`,
`item:boxes/boxTaken`. Prompt's `item:pickup/use/spawn/hit/destroy`,
`boost:start`, `blooper:splat`, `blue:launch/impact` are NOT adopted.
- Authority stays: firer simulates; victim detects own hits (already true).
- ADD: `animState + startedAt` to the kart state packet (10.7) so remotes
  play spins/flinches — needs `toRaceTransform` + RemoteRacers work.
- ADD: `usesLeft/variant` to `item:carried` payload (shape extension).

## 7. Visuals (10.x, all inside each item's task)

- Sockets + `itemVisualConfig` (exact values from prompt §10.8 + `sizes`
  ratios §10.11, multiplied by measured `unit = 1.21`).
- Driver fallback (no skeleton): group-level pitch/yaw 3–5°, kart hop/flash/
  particles at `hand_R` instead of arm swings; spins rotate whole kart.
  Report replaced animations per task.
- Held visuals derived from replicated `carriedItem` (already true); orbit
  phases from race clock (new); triple re-space; golden shrink/blink.
- Projectile spawns at release time; `usesLeft` drops at press (test both).
- `visualFor(carriedItem, effects, now)` pure + tests (timer fractions,
  re-space, orbit angles, priority with fake clock).
- DEV-ONLY grant panel (per item+variant button), hidden in production.

## 8. `itemConfig` — single source, values from the prompt §8 verbatim

Plus measured `unit: 1.21` and `sizes` ratios. No magic numbers in logic
(migration moves ~30 existing constants: shell speeds/lives, boost values,
radii, timings — behavior-preserving except where this spec overrides).

## 9. Order (prompt §7)

Foundation (slot shape + roulette 2.5 s + weights + itemConfig + scale fixes)
→ mushroom (+golden) → red (single+triple) → blue → bullet → blooper →
visuals/anim pass → throw/audio polish + DEV panel. Assets all in place;
foundation needs none new.

## 10. Per-task report

What changed, tests passing, `TODO(decide)`s, anything that didn't fit.
Current TODOs: skid-vs-wind win differentiation; triple/golden PNG icons
(still fallback badge/tint).

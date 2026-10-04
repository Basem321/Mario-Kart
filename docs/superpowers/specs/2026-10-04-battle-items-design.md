# Battle Items Spec — v2 (user-approved 2026-10-04)

**Goal:** 6 items بقواعد Mario Kart: Mushroom / Triple+Golden / Red Shell (homing) / Blue Shell / Bullet Bill / Blooper + throw flourish procedural.

Supersedes the old roadmap items (tennis ball, treats — dropped, never started).
Bomb system stays untouched as the reference implementation.

## Shared rules
- One slot: pickup grants an item ONLY when `!carriedBomb && !carriedItem`.
- Pickup shows a Mario-Kart-style roulette: slot icons cycle fast and decelerate over ~1.2s, then lock on the granted item. Cycling is visual randomness ONLY — the final result always comes from the position weights below.
- Roulette icons: `public/images/items/{mushroom,red-shell,blue-shell,bullet-bill,blooper}.png`. Triple = mushroom icon + ×3 badge; golden = mushroom icon + gold CSS tint. Drop-in `triple.png`/`golden.png` later replaces the fallback in one place.
- New state lives in `src/store.js` next to bomb state: `carriedItem: null | {type, charges, expiresAt}`.
- Position source: online standings (completedLaps + progress, same inputs as `OnlineRaceLeaderboard.jsx`); solo = 1 of 1.
- Fallback: if the rolled item can't apply (no opponents), grant single Mushroom.
- Authority: projectile OWNER simulates; hits are broadcast; victim applies own `stunUntil`.
- Every new P2P event gets a validator branch in `src/useP2PLobby.js` (same allowlist pattern as `bomb:*`, ~lines 105-135) + transport via `onlineRaceTransport.js` + state in `onlineRaceStore.js`. Never trust remote vectors blindly.

## Items (exact behavior)
1. **Mushroom** — one short boost. Implementation = dispatch existing `mario-kart:boost` window event (same channel `PlayerController` already listens to). Any position.
2. **Triple Mushrooms** — 3 charges, each use consumes one. **Golden** — re-usable every 1.2s until `expiresAt` (7s from pickup). Golden visual = mushroom mesh with gold material override (no separate GLB).
3. **Red Shell (homing)** — locks nearest opponent AHEAD; turn-limited steering (2.2 rad/s), 1.5x boost speed, 6s life, hit radius 3.4 (same as `BOMB_TRIGGER_RADIUS`). No opponents (solo) → flies straight then drops. Victim: `stunUntil` + small burst (reuse `ExplosionFx` at scale 0.6).
4. **Blue Shell** — granted only when user is NOT 1st and opponents exist. Flies above road (y+6) to the leader, drops, explosion radius 8 stuns leader + anyone inside. Rare (lowest weight). Warning: owner broadcasts `blue:incoming {leaderId}` at launch; ONLY the leader's client loops `blue-alarm.mp3` until `blue:explode`, then plays `shell-hit.mp3`.
5. **Bullet Bill** — granted only in last/near-last with opponents. 5s auto-ride: ~2x boost speed, auto-centers to road via `findNearestBlackRoadPoint3D`, invincible (ignores stun/explosions), contact knocks opponents (stun + broadcast). Ends with a hop. Visual: bullet mesh envelops kart, kart hidden during ride.
6. **Blooper** — granted only online when opponents are ahead. Targets = players ahead at fire time. Fire visual: `blooper.glb` appears in front of the kart ~1s (squirt pose) then disappears. Victim screens: ink overlay div (`public/textures/ink-splat.png`, same pattern as `.boost-wind-overlay` in `GameUI`), fades over 6s, visual only (no physics change).

## Throw flourish (procedural — driver GLBs have no animation clips)
- Projectile spawns with an arc (up + forward velocity from kart pos).
- 0.25s kart lean punch (rotation nudge via existing gsap dep).
- No skeletal animation, no new rig.

## P2P events (all need validators)
`item:carried {type|null}` / `shell:fired {shellId, kind, x,y,z, dir}` / `shell:hit {shellId, victimId}` / `blue:incoming {leaderId}` (alarm on leader client only) / `blue:explode {x,y,z}` / `bullet:start|bullet:end {playerId}` / `bullet:knock {victimId}` / `blooper:ink {targetIds[]}`

## Assets (in place, verified 2026-10-04 — all GLB/PNG/MP3 headers OK, no anim clips)
- `public/models/mushroom.glb`, `red-shell.glb`, `blue-shell.glb`, `bullet-bill.glb`, `blooper.glb`
- `public/images/items/mushroom.png`, `red-shell.png`, `blue-shell.png`, `bullet-bill.png`, `blooper.png`
- `public/textures/ink-splat.png` (1024x1031, transparent)
- `public/music/mushroom-boost.mp3`, `shell-fire.mp3`, `shell-hit.mp3`, `blue-alarm.mp3`, `bullet-launch.mp3`, `blooper-splash.mp3`
- Reused (no new asset): `explosion.jpg` particles, `explosion.mp3`, `collecting_box.mp3`, boost VFX chain
- Still missing (fallback specced, optional): `public/images/items/triple.png`, `golden.png`

## Out of scope
Tennis ball, treats, flame texture, drift modifiers, new tracks → separate backlog.

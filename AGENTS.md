# AGENTS.md — mario-kart-gpu

Stack: React 19 + R3F v9 + Three r176 + Rapier + zustand + PeerJS. 60fps game, no compromises on perf.

## Commands
- `npm run dev` → Vite dev (`vite --host`), game at localhost:5173
- `npm run build` / `npm run preview`
- `npm run lint` → eslint

## Architecture rules (must follow)

1. **Tracks:** any new track registers in `src/tracks.js` in `TRACKS[]` with same pattern:
   `id, name, glb, offset, scale, roadNodes[], dirtNodes[], explicitMeshes[], finishOffset, lateralOffset, halfWidth, boostPads[], wallExclusion[], spawnSlots[{position, rotationY}]`.
   Source of truth for tuning = root `*-config.json` (Map Editor export overwrites it).

2. **P2P / Online:** any new P2P message MUST go through validator in `src/useP2PLobby.js` + transport in `src/onlineRaceTransport.js` + state in `src/onlineRaceStore.js`. Never trust remote `position/rotation` blindly — validate `trackId` via `isKnownTrackId()`, clamp vectors. See `toPlayer()` / `normaliseName()` pattern.

3. **State:** game state in zustand stores only (`src/store.js` = local/game, `src/onlineRaceStore.js` = net, `src/mapEditorStore.js` = editor). No prop drilling for `playerPosition, speed, wallSegments, roadMapData, itemBoxes`.

4. **Physics:** player physics ONLY in `src/PlayerController.jsx` (raycast + `resolveWallCollision` from `src/collision.js`, road queries from `src/trackRoad.js`). Don't duplicate collision logic in `TrackWalls.jsx` / `RemoteRacers.jsx` — they are visual / remote only.

## Perf rules
- Merged geometries via `BufferGeometryUtils.mergeGeometries` (see `tracks.js:getMergedRoadGeometry`). No per-frame allocations in `useFrame`.
- Walls = precomputed flat XZ segments in store (`wallSegments`), not per-frame raycast against full scene.
- `r3f-perf` is already in deps — use it to verify Shroom Ridge stays 60fps.

## MCP / Docs
- When you need docs for R3F v9 / React 19 / Three r176, use `context7` tools (models hallucinate old APIs).
- For live scene debug ("collision غلط ليه؟", "FPS واقع ليه؟"): use `threejs-devtools-mcp` tools — requires `npm run dev` running. It auto-detects port and opens bridge on 9222.
- For browser console / perf traces: use `chrome-devtools` tools — requires Chrome stable + Node >= 20.19.

## Superpowers workflow
For roadmap features (red shell, skid marks, new tracks): use skills `brainstorming` → `writing-plans` → `executing-plans` / `subagent-driven-development`. Don't jump straight to code on large features.

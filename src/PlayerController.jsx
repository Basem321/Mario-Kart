import { Kart } from "./models/Kart";
import { useGLTF, useKeyboardControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Vector3, Raycaster } from "three";
import { damp, clamp } from "three/src/math/MathUtils.js";
import { getOnlineSpawnSlot, kartSettings } from "./constants";
import { useGameStore, applySpin, absorbWithOrbit } from "./store";
import gsap from "gsap";
import { useTouchScreen } from "./hooks/useTouchScreen";
import { playSfx, startLoop, stopLoop } from "./audio.js";
import VFXEmitter from "./wawa-vfx/VFXEmitter";
import { useGameManager } from "./gameManager";
import { useMapEditorStore } from "./mapEditorStore";
import { publishOnlineRaceTransform } from "./onlineRaceTransport";
import {
  resolveWallCollision,
  wallSpeedFactor,
  KART_RADIUS,
  WALL_SKIN,
} from "./collision";
import { bulletActive, bulletPhase, hitApplies, shouldApplyHit, BULLET_SPEED } from "./items/homing";
import { boostTargetSpeed } from "./items/itemWeights";
import { findNearestBlackRoadPoint3D, getHighestRoadYAt, isOffRoad, trackConfigToTransform } from "./trackRoad";
import { itemConfig } from "./items/itemConfig.js";
import { getTrack, getMergedRoadGeometry } from "./tracks";

// Horizontal ray vs the visible track meshes (barriers included).
// Catches real walls even where the precomputed segments have gaps.
const wallRaycaster = new Raycaster();
wallRaycaster.firstHitOnly = true;

// Module scratch: updatePlayer + resolveMeshWalls run every frame — no
// per-frame Vector3 allocations (AGENTS.md). Raycaster.set copies values,
// so sharing these is safe.
const _desiredDir = new Vector3();
const _wallOrigin = new Vector3();
const _wallDir = new Vector3();
// Scratch for the wall-face height filter + collider dedup below.
const _triA = new Vector3();
const _triB = new Vector3();
const _triC = new Vector3();
const _colliderPos = new Vector3();
// Faces shorter than this world-Y span are bumps/decor, not walls.
// Shroom Ridge has low relief meshes (0.05-0.9 high) sitting inside the
// asphalt that otherwise read as invisible walls narrowing the road.
const MIN_WALL_FACE_HEIGHT = 0.5;
const _camPos = new Vector3();
const _camLook = new Vector3();
const _camRearPos = new Vector3();
const _camRearLook = new Vector3();

export const PlayerController = () => {
  const rbRef = useRef(null);
  const playerRef = useRef(null);
  const cameraGroupRef = useRef(null);
  const cameraLookAtRef = useRef(null);
  const cameraFrontRef = useRef(null);
  const rearLookRef = useRef(null);
  const lookingBackRef = useRef(0);
  const kartRef = useRef(null);
  const jumpIsHeld = useRef(false);
  const driftDirections = {
    none: 0,
    left: 1.4,
    right: -1.4,
  };
  const jumpOffset = useRef(0);
  const driftDirection = useRef(driftDirections.none);
  const driftPower = useRef(0);
  // Off-track cache: the black-road triangle walk is throttled, not per-frame.
  const offRoadCacheRef = useRef({ isOff: false, lastCheck: 0 });
  const turbo = useRef(0);
  const isJumping = useRef(false);
  const backWheelOffset = useRef({
    left: 0,
    right: 0,
  });
  const gamepadRef = useRef(null);
  const inputTurn = useRef(0);
  const lastExplosionIdRef = useRef(0);
  const lastNetworkSyncRef = useRef(-Infinity);
  // BUG-5 fix: monotonically increasing sequence counter for outgoing packets
  const networkSeqRef = useRef(0);
  const resetHeldRef = useRef(false);
  const resetRequestedRef = useRef(false);
  const lastResetAtRef = useRef(0);
  // Auto-Lakitu state: timestamp + frame counter for the throttled
  // trapped-under-the-deck check (see useFrame below).
  const stuckSinceRef = useRef(0);
  const stuckTickRef = useRef(0);
  const honkHeldRef = useRef(false);
  // Camera elevation follow: the chase mounts are group-relative, so on
  // hilly courses the camera would bury under climbs (or float high above
  // drops). This lift tracks the kart's terrain height instead.
  const camLiftRef = useRef(0);
  const isOnlineRace = useGameManager((state) => state.isOnlineRace);
  const gameOver = useGameManager((state) => state.gameOver);
  const onlineSpawnIndex = useGameManager((state) => state.onlineSpawnIndex);
  const selectedTrackId = useGameManager((state) => state.selectedTrackId);
  const activeTrack = getTrack(selectedTrackId);
  // Authored Map Editor grid slots apply everywhere: online uses the lobby
  // index, single-player / time-trial starts on the P1 slot.
  const spawnSlot = getOnlineSpawnSlot(
    isOnlineRace ? onlineSpawnIndex : 0,
    activeTrack
  );
  // Per-spawn kart size (Map Editor). Scales the whole kart group (visual +
  // chase camera mounts + wheel-ray origins) and the collision radius below.
  const kartScale = spawnSlot.kartScale ?? 1;

  // Publish the scale for the Kart wheel rig (ground offsets scale with it).
  useEffect(() => {
    useGameStore.getState().setKartScale(kartScale);
  }, [kartScale]);

  // Blast reaction: if a new explosion appeared near the kart, shove the
  // kart away and spin it out (v3 heavy). Triple-red orbit absorbs bombs.
  // Never behind the results screen.
  function reactToExplosions(player) {
    const st = useGameStore.getState();
    const gm = useGameManager.getState();
    if (!shouldApplyHit({ gameStarted: gm.gameStarted, gameOver: gm.gameOver })) {
      const list0 = st.explosions;
      if (list0 && list0.length > 0) {
        lastExplosionIdRef.current = list0[list0.length - 1].id;
      }
      return;
    }
    const list = st.explosions;
    if (!list || list.length === 0) return;
    const latest = list[list.length - 1];
    if (latest.id === lastExplosionIdRef.current) return;
    lastExplosionIdRef.current = latest.id;
    // Soft bursts render only (red-shell hits carry their own precise stun).
    if (latest.soft) return;
    // Bullet Bill ride: invincible, blasts wash over the bullet (owner only).
    const ride0 = st.bulletRide;
    if (
      ride0 &&
      ride0.ownerId === (useGameManager.getState().onlineSelfId ?? "local") &&
      bulletActive(ride0, performance.now())
    ) {
      return;
    }
    // Triple-red orbit absorbs bomb blasts (no shove, no spin).
    if (String(latest.id).startsWith("explosion-") && absorbWithOrbit("bomb")) {
      return;
    }
    // Hit-invulnerability: shells and bombs pass through (v3 §5).
    if (!hitApplies({ invulnUntil: st.invulnUntil }, performance.now())) {
      return;
    }
    const dx = player.position.x - latest.x;
    const dz = player.position.z - latest.z;
    const d = Math.hypot(dx, dz);
    const BLAST_RADIUS = 12;
    if (d > BLAST_RADIUS) return;
    // Level gate: blasts on another deck don't shove through the floor.
    // latest.y may be absent on old payloads — then keep the legacy XZ rule.
    // groundY must be declared BEFORE the gate: reading a later `const`
    // threw a TDZ ReferenceError for every blast within range, so the
    // shove + heavy spin below never ran.
    const groundY = st.groundPosition;
    const blastY = Number(latest.y);
    if (Number.isFinite(blastY) && Number.isFinite(groundY) && Math.abs(blastY - groundY) > 5) {
      return;
    }
    const push = (1 - d / BLAST_RADIUS) * 6 * kartScale;
    const nx = d > 1e-4 ? dx / d : 0;
    const nz = d > 1e-4 ? dz / d : 1;
    const segs = st.wallSegments;
    const resolved = resolveWallCollision(
      player.position.x,
      player.position.z,
      player.position.x + nx * push,
      player.position.z + nz * push,
      segs && segs.length > 0 ? segs : [],
      KART_RADIUS * kartScale,
      groundY
    );
    player.position.x = resolved.x;
    player.position.z = resolved.z;
    // Heavy spin-out (throttle dead while spinning, see updateSpeed).
    applySpin({ victim: "self", heavy: true, now: performance.now() });
    // Pooled loop, stopped shortly after (respects sfxVolume).
    const spinEl = startLoop("spin.mp3", 0.9);
    window.setTimeout(() => stopLoop(spinEl), 3000);
  }

  const [, get] = useKeyboardControls();

  const speedRef = useRef(0);
  const rotationSpeedRef = useRef(0);
  const smoothedDirectionRef = useRef(new Vector3(0, 0, -1));

  const isTouchScreen = useTouchScreen();

  const setPlayerPosition = useGameStore((state) => state.setPlayerPosition);
  const setIsBoosting = useGameStore((state) => state.setIsBoosting);
  const setSpeed = useGameStore((state) => state.setSpeed);
  const setGamepad = useGameStore((state) => state.setGamepad);

  const scene = useThree((s) => s.scene);
  const { nodes: trackNodes } = useGLTF(activeTrack.glb);
  const blackRoadGeometry = getMergedRoadGeometry(trackNodes, activeTrack);
  const roadTransform = trackConfigToTransform(activeTrack);
  const meshCollidersRef = useRef(null);

  // "Race Again" without reload: re-seat the kart on its grid slot and zero
  // every physics ref, or the new race inherits the old run's position,
  // speed, drift and turbo. Runs on every session (including the first).
  const sessionId = useGameManager((state) => state.sessionId);
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    player.position.set(spawnSlot.position[0], spawnSlot.position[1], spawnSlot.position[2]);
    player.rotation.set(0, spawnSlot.rotationY ?? 0, 0);
    speedRef.current = 0;
    rotationSpeedRef.current = 0;
    inputTurn.current = 0;
    driftDirection.current = driftDirections.none;
    driftPower.current = 0;
    turbo.current = 0;
    jumpOffset.current = 0;
    isJumping.current = false;
    jumpIsHeld.current = false;
    stuckSinceRef.current = 0;
    lastResetAtRef.current = 0;
    smoothedDirectionRef.current.set(
      -Math.sin(player.rotation.y),
      0,
      -Math.cos(player.rotation.y),
    );
    try {
      const gs = useGameStore.getState();
      gs.setSpeed?.(0);
      gs.setIsBoosting?.(false);
      gs.setPlayerPosition?.(player.position);
      gs.setPlayerRotationY?.(player.rotation.y);
      gs.setRespawnCheckpointIndex?.(-1);
    } catch {
      // ignore — store writes must never break session setup
    }
    lastNetworkSyncRef.current = -Infinity;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // The HUD uses this event so its Reset button and the R key share exactly
  // the same physics-safe recovery path.  Keeping the request in a ref lets
  // the actual teleport happen inside the next Three.js frame.
  useEffect(() => {
    const requestReset = () => {
      resetRequestedRef.current = true;
    };
    const requestBoost = (e) => {
      const dur = e.detail?.duration ?? 2.0;
      // Boost targets are tuned for full-size karts — scale them so a mini
      // kart gets a proportional push instead of a warp-speed launch.
      const spd = (e.detail?.speed ?? 62) * kartScale;
      const launchVy = (e.detail?.launchVy ?? 11) * kartScale;
      turbo.current = Math.max(turbo.current, dur);
      speedRef.current = Math.max(speedRef.current, spd);
      setSpeed(speedRef.current);
      setIsBoosting(true);
      window.dispatchEvent(
        new CustomEvent("mario-kart:launch-jump", {
          detail: { launchVy },
        })
      );
    };

    window.addEventListener("mario-kart:reset", requestReset);
    window.addEventListener("mario-kart:boost", requestBoost);
    return () => {
      window.removeEventListener("mario-kart:reset", requestReset);
      window.removeEventListener("mario-kart:boost", requestBoost);
    };
  }, [setSpeed, setIsBoosting, kartScale]);

  // Shared reset epilogue: stop the kart, face it along its (possibly new)
  // heading and let an online peer publish the corrected position on this
  // same frame.
  const finishReset = (player) => {
    stuckSinceRef.current = 0;
    speedRef.current = 0;
    rotationSpeedRef.current = 0;
    driftDirection.current = driftDirections.none;
    driftPower.current = 0;
    turbo.current = 0;
    setIsBoosting(false);
    smoothedDirectionRef.current.set(
      -Math.sin(player.rotation.y),
      0,
      -Math.cos(player.rotation.y),
    );
    setSpeed(0);
    useGameStore.getState().setPlayerPosition(player.position);
    useGameStore.getState().setPlayerRotationY(player.rotation.y);
    lastNetworkSyncRef.current = -Infinity;
  };

  const resetToNearestBlackRoad = (player) => {
    if (!useGameManager.getState().gameStarted) return false;
    // 3s cooldown: Reset is a rescue tool, not a teleport button. Without
    // this, mashing R re-rolls the rescue every frame.
    const nowMs = performance.now();
    if (nowMs - (lastResetAtRef.current || 0) < 3000) return false;
    lastResetAtRef.current = nowMs;

    // Checkpoints first: respawn at the LAST VISITED checkpoint (tracked by
    // FinishLine), never the nearest — nearest is exploitable as a shortcut
    // and drops karts on the wrong deck of stacked switchbacks.
    // Editor overrides apply live while the editor is open, else the track
    // code defaults.
    const editorStore = useMapEditorStore.getState();
    const checkpoints =
      (editorStore.isOpen && editorStore.editedConfig?.checkpoints) ||
      activeTrack.checkpoints ||
      [];
    const lastVisited = Number(useGameStore.getState().respawnCheckpointIndex);
    if (
      checkpoints.length > 0 &&
      Number.isInteger(lastVisited) &&
      lastVisited >= 0 &&
      checkpoints[lastVisited]
    ) {
      const spot = checkpoints[lastVisited];
      if (
        Number.isFinite(spot?.position?.[0]) &&
        Number.isFinite(spot?.position?.[1]) &&
        Number.isFinite(spot?.position?.[2])
      ) {
        player.position.x = spot.position[0];
        player.position.z = spot.position[2];
        useGameStore.getState().setWheelSnapY(spot.position[1]);
        const headingDeg = Number(spot.rotationY);
        if (Number.isFinite(headingDeg)) {
          player.rotation.y = (headingDeg * Math.PI) / 180;
        }
        finishReset(player);
        return true;
      }
      // Bad data for the visited slot: fall through to road rescue below.
    }
    if (checkpoints.length > 0) {
      const storeState = useGameStore.getState();
      const kartY = Number.isFinite(storeState.groundPosition)
        ? storeState.groundPosition
        : player.position.y;
      let best = null;
      let bestDistanceSq = Infinity;
      for (const checkpoint of checkpoints) {
        const cx = checkpoint?.position?.[0];
        const cy = checkpoint?.position?.[1];
        const cz = checkpoint?.position?.[2];
        if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)) continue;
        const dx = player.position.x - cx;
        const dy = kartY - cy;
        const dz = player.position.z - cz;
        const distanceSq = dx * dx + dy * dy + dz * dz;
        if (distanceSq < bestDistanceSq) {
          bestDistanceSq = distanceSq;
          best = checkpoint;
        }
      }
      if (best) {
        player.position.x = best.position[0];
        player.position.z = best.position[2];
        useGameStore.getState().setWheelSnapY(best.position[1]);
        const headingDeg = Number(best.rotationY);
        if (Number.isFinite(headingDeg)) {
          player.rotation.y = (headingDeg * Math.PI) / 180;
        }
        finishReset(player);
        return true;
      }
      // No usable checkpoint (bad data): fall through to road rescue below.
    }

    // 3D rescue: the kart's height reference is the wheel-derived ground
    // level (the group origin itself never moves on flat tracks). On stacked
    // courses (Waluigi jump: deck above, pit below, same XZ) this picks the
    // driving level closest to the kart instead of no-op'ing on its own XZ.
    // While airborne groundPosition is the body height in the air — still
    // the right reference: nearest 3D road is the landing below.
    const storeState = useGameStore.getState();
    const kartY = Number.isFinite(storeState.groundPosition)
      ? storeState.groundPosition
      : player.position.y;
    let point = null;
    try {
      point = findNearestBlackRoadPoint3D(
        blackRoadGeometry,
        player.position.x,
        kartY,
        player.position.z,
        roadTransform,
      );
    } catch {
      point = null;
    }
    // Hard fallback: if the road index is missing (still loading) or the
    // kart is over a true void with no road nearby, drop it back on spawn
    // instead of leaving it hanging in the air forever (old R-does-nothing bug).
    if (!point) {
      // This racer's OWN grid slot (online index included), not slot 0:
      // every online racer rescued to slot 0 stacked on the same spot.
      const fallback = spawnSlot;
      player.position.x = fallback.position[0];
      player.position.z = fallback.position[2];
      if (Number.isFinite(fallback.rotationY)) {
        player.rotation.y = fallback.rotationY;
      }
      useGameStore.getState().setWheelSnapY(0);
    } else {
      // Recover X/Z onto the rescued road level and snap the wheels to its
      // height. The snap is essential on stacked courses: teleporting X/Z
      // alone leaves the wheel rays underneath the elevated deck, both rays
      // miss it, and the kart stays trapped in the pit it was "rescued" from.
      player.position.x = point.x;
      player.position.z = point.z;
      useGameStore.getState().setWheelSnapY(point.y);
    }
    finishReset(player);
    return true;
  };

  // Auto-Lakitu: if the kart is (almost) stopped while a whole other road
  // level floats high above it — i.e. it fell into the pit under an elevated
  // deck/jump and can never climb the steep dirt walls back out — rescue it
  // onto the nearest level after a short grace period. Throttled to ~every
  // 20th frame; the height query itself is a cheap XZ triangle scan.
  const detectTrappedUnderDeck = (player) => {    if (!useGameManager.getState().gameStarted) return;
    stuckTickRef.current += 1;
    if (stuckTickRef.current % 20 !== 0) return;

    const st = useGameStore.getState();
    const groundY = st.groundPosition;
    // Crawl threshold follows kart size: 2 u/s is a normal cruise for a
    // 0.2-scale kart (max 6) and must not count as "stuck".
    const crawling = Math.abs(speedRef.current) < Math.max(1, 2 * kartScale);
    const highestRoadY =
      blackRoadGeometry && Number.isFinite(player.position.x)
        ? getHighestRoadYAt(
            blackRoadGeometry,
            player.position.x,
            player.position.z,
            roadTransform
          )
        : null;
    const trapped =
      crawling &&
      Number.isFinite(groundY) &&
      highestRoadY !== null &&
      highestRoadY - groundY > 5;

    const now = performance.now();
    if (!trapped) {
      stuckSinceRef.current = 0;
      return;
    }
    if (!stuckSinceRef.current) {
      stuckSinceRef.current = now;
      return;
    }
    if (now - stuckSinceRef.current > 2500) {
      stuckSinceRef.current = 0;
      resetToNearestBlackRoad(player);
    }
  };

  // Lost-off-the-map watchdog: if the kart ends up far from ANY road
  // surface (fell through a gap, slipped inside geometry, got blasted off
  // a cliff) it snaps back to the nearest checkpoint almost immediately
  // instead of driving around lost inside rocks. On-road karts are always
  // ~0 away, so this can never misfire while racing — including on stacked
  // switchbacks (the query is 3D, so the kart's own deck counts) and over
  // jump gaps (the landing below stays within range). Throttled to ~every
  // 15th frame with a 2-strike grace so a single bad sample can't teleport.
  const lostTickRef = useRef(0);
  const lostStrikesRef = useRef(0);
  const detectLostOffMap = (player) => {
    if (!useGameManager.getState().gameStarted) return;
    if (!blackRoadGeometry) return;
    // Jump guard: boost-pad launches (45-60 u/s) spend ~a second far from any
    // deck mid-flight. Only a slow kart can be genuinely lost, so fast flight
    // never accumulates strikes — this keeps the watchdog safe on jump-heavy
    // courses (Waluigi) and lets it run on every track.
    if (Math.abs(speedRef.current) > 12) {
      lostStrikesRef.current = 0;
      return;
    }
    lostTickRef.current += 1;
    if (lostTickRef.current % 15 !== 0) return;

    const storeState = useGameStore.getState();
    const kartY = Number.isFinite(storeState.groundPosition)
      ? storeState.groundPosition
      : player.position.y;
    let distance = Infinity;
    try {
      const point = findNearestBlackRoadPoint3D(
        blackRoadGeometry,
        player.position.x,
        kartY,
        player.position.z,
        roadTransform,
      );
      if (point) distance = point.distance;
    } catch {
      distance = Infinity;
    }

    if (distance > 12) {
      lostStrikesRef.current += 1;
      if (lostStrikesRef.current >= 2) {
        lostStrikesRef.current = 0;
        resetToNearestBlackRoad(player);
      }
    } else {
      lostStrikesRef.current = 0;
    }
  };

  // Visible track meshes (road + barriers — everything named "ground").
  // Collected once; our own "wall-barrier" mesh is excluded by name.
  // Never caches an empty list (a pre-load call would disable mesh walls for
  // the whole race), and rebuilds when the track changes.
  const meshCollidersTrackRef = useRef(null);
  const getMeshColliders = () => {
    const trackId = useGameManager.getState().selectedTrackId;
    if (
      !meshCollidersRef.current ||
      meshCollidersRef.current.length === 0 ||
      meshCollidersTrackRef.current !== trackId
    ) {
      const list = [];
      // Waluigi's GLB carries duplicated nodes (2x triangles): identical
      // geometry at an identical world transform would raycast twice, so
      // collapse those duplicates here (distinct placements still collide).
      const seen = new Set();
      scene.traverse((obj) => {
        if (!obj.isMesh || !obj.name.includes("ground")) return;
        obj.getWorldPosition(_colliderPos);
        const key = `${obj.geometry?.uuid ?? obj.uuid}|${Math.round(_colliderPos.x * 50)},${Math.round(_colliderPos.y * 50)},${Math.round(_colliderPos.z * 50)}`;
        if (seen.has(key)) return;
        seen.add(key);
        list.push(obj);
      });
      if (list.length > 0 || meshCollidersTrackRef.current !== trackId) {
        meshCollidersRef.current = list;
        meshCollidersTrackRef.current = trackId;
      }
    }
    return meshCollidersRef.current;
  };

  // Second wall layer: horizontal rays from the kart against the real
  // track geometry. Only steep faces count as walls (floor is skipped).
  // The track group has no rotation (translation + uniform scale only),
  // so the object-space face normal is also the world normal direction.
  // World-space Y span of a hit triangle: low relief INSIDE the asphalt
  // never counts as a wall, even when its normal reads as steep.
  function wallFaceSpanY(hit) {
    const posAttr = hit.object?.geometry?.attributes?.position;
    const face = hit.face;
    if (!posAttr || !face) return Infinity;
    _triA.fromBufferAttribute(posAttr, face.a);
    _triB.fromBufferAttribute(posAttr, face.b);
    _triC.fromBufferAttribute(posAttr, face.c);
    hit.object.localToWorld(_triA);
    hit.object.localToWorld(_triB);
    hit.object.localToWorld(_triC);
    return (
      Math.max(_triA.y, _triB.y, _triC.y) -
      Math.min(_triA.y, _triB.y, _triC.y)
    );
  }
  function resolveMeshWalls(prevX, prevZ, inX, inZ) {
    const colliders = getMeshColliders();
    if (!colliders || colliders.length === 0) {
      return { x: inX, z: inZ, hit: false, nx: 0, nz: 0 };
    }
    const dx = inX - prevX;
    const dz = inZ - prevZ;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-6) {
      return { x: inX, z: inZ, hit: false, nx: 0, nz: 0 };
    }
    // Waluigi's wheel floor needs n.y >= 0.4 (steep dirt pit walls are not
    // floor); the mesh-wall test must match, or slopes in (0.35, 0.4] are
    // neither floor nor wall and karts clip through them.
    const isRoughWalls =
      useGameManager.getState().selectedTrackId === "waluigi-stadium";
    const wallNormalY = isRoughWalls ? 0.4 : 0.35;
    const minD = (KART_RADIUS + WALL_SKIN) * kartScale;
    const dirX = dx / dist;
    const dirZ = dz / dist;
    const originY = (useGameStore.getState().groundPosition ?? 0) + 0.25;
    // Three rays: center + both flanks at kart half-width. A single center
    // ray misses side-swipe contact and corners, so karts clipped through
    // walls at shallow angles (Waluigi ramp exclusions especially).
    const lat = KART_RADIUS * kartScale;
    let x = inX;
    let z = inZ;
    let hitAny = false;
    let hitNx = 0;
    let hitNz = 0;
    for (const side of [0, 1, -1]) {
      const ox = prevX - dirZ * lat * side;
      const oz = prevZ + dirX * lat * side;
      wallRaycaster.set(
        _wallOrigin.set(ox, originY, oz),
        _wallDir.set(dirX, 0, dirZ)
      );
      wallRaycaster.far = dist + minD;
      const hits = wallRaycaster.intersectObjects(colliders, false);
      for (const h of hits) {
        const n = h.face?.normal;
        // Allow inclined slopes / ramps up to ~70 degrees to be drivable, not blocking walls
        if (!n || Math.abs(n.y) > wallNormalY) continue; // floor/ramp/ceiling, not a wall
        // Low relief inside the road surface (curbs, decor seams) is not
        // a wall even when its normal is steep — this was the Shroom
        // Ridge "invisible walls narrowing the road" report.
        if (wallFaceSpanY(h) < MIN_WALL_FACE_HEIGHT) continue;
        const nl = Math.hypot(n.x, n.z);
        if (nl < 1e-4) continue;
        let nx = n.x / nl;
        let nz = n.z / nl;
        // Face the kart: normal must point from wall toward the kart.
        const px = x - h.point.x;
        const pz = z - h.point.z;
        let d = px * nx + pz * nz;
        if (d < 0) {
          nx = -nx;
          nz = -nz;
          d = -d;
        }
        if (d >= minD) continue;
        x = x + nx * (minD - d);
        z = z + nz * (minD - d);
        hitAny = true;
        hitNx = nx;
        hitNz = nz;
      }
    }
    return { x, z, hit: hitAny, nx: hitNx, nz: hitNz };
  }

  // Poll the gamepad without spamming the store: setGamepad with a fresh
  // snapshot object every frame re-renders every subscriber 60x/sec, so only
  // publish when the pad identity/connection actually changes.
  const lastPadIdRef = useRef(null);
  const getGamepad = () => {
    if (navigator.getGamepads) {
      const gamepads = navigator.getGamepads();
      if (gamepads.length > 0) {
        const pad = gamepads[0] ?? null;
        gamepadRef.current = pad;
        const padId = pad ? `${pad.id}:${pad.connected}` : null;
        if (padId !== lastPadIdRef.current) {
          lastPadIdRef.current = padId;
          setGamepad(pad);
        }
      }
    }
  };

  const jumpAnim = () => {
    gsap.to(jumpOffset, {
      current: 0.3,
      duration: 0.125,
      ease: "power2.out",
      yoyo: true,
      repeat: 1,
      onComplete: () => {
        isJumping.current = false;
        setTimeout(() => {
          if (driftDirection.current !== 0) {
            gsap.killTweensOf(backWheelOffset.current);
            gsap.to(backWheelOffset.current, {
              left: driftDirection.current === driftDirections.left ? 0.4 : 0,
              right: driftDirection.current === driftDirections.right ? 0.4 : 0,
              duration: 0.3,
              ease: "power4.out",
              onComplete: () => {
                gsap.to(backWheelOffset.current, {
                  left: 0,
                  right: 0,
                  duration: 0.8,
                  ease: "bounce.out",
                });
              },
            });
          }
        }, 100);
      },
    });
  };

  function updateSpeed(forward, backward, delta) {
    // Bullet Bill: full-throttle manual drive, invincible (skips the stun
    // gate below so nothing slows the ride). Steering is the player's own —
    // no autopilot. Owner-only: a remote racer's ride must never drive local.
    const ride = useGameStore.getState().bulletRide;
    const myId = useGameManager.getState().onlineSelfId ?? "local";
    const myRide =
      ride &&
      ride.ownerId === myId &&
      bulletActive(ride, performance.now());
    if (myRide) {
      speedRef.current = BULLET_SPEED * kartScale;
      setSpeed(speedRef.current);
      // Bullet ride never sets isBoosting (1.5): kart flames, wind overlay
      // and boost_lean all key off that flag. FOV +15 comes from the ride
      // itself (BoostCameraRig reads bulletRide + itemConfig.fov.bullet).
      setIsBoosting(false);
      return;
    }
    // Ramp-out: control is back (normal steering), speed eases to normal.
    if (
      ride &&
      ride.ownerId === myId &&
      bulletPhase(ride, performance.now()) === "ramp"
    ) {
      const baseMaxSpeed = kartSettings.speed.max;
      speedRef.current = damp(
        speedRef.current,
        baseMaxSpeed * kartScale,
        3,
        delta
      );
      setSpeed(speedRef.current);
      setIsBoosting(speedRef.current > baseMaxSpeed * kartScale);
      return;
    }
    // Stunned / spinning out: no throttle, speed collapses. This gate runs
    // BEFORE the mushroom branch (2.1 #2) so a boost can never cancel a spin.
    if (performance.now() < useGameStore.getState().stunUntil) {
      speedRef.current = damp(speedRef.current, 0, 6, delta);
      setSpeed(speedRef.current);
      return;
    }
    // Mushroom boost: exact 1.5x-max target (no stacking — re-use resets the
    // window). Damp-out gives the ease-out tail for free when it expires.
    // Dirt never slows it: this branch returns before any surface factor.
    // Unreachable while stunned: applySpin zeroes shroomUntil AND the gate
    // above runs first, so a mid-spin press can't keep full speed.
    const shroom = useGameStore.getState().shroomUntil;
    if (shroom && performance.now() < shroom) {
      speedRef.current = damp(
        speedRef.current,
        boostTargetSpeed(kartSettings.speed.max, kartScale),
        4,
        delta
      );
      setSpeed(speedRef.current);
      setIsBoosting(true);
      return;
    }
    // Off-track: anything outside the black asphalt slows to 50%.
    // Mushroom (branch above) + bullet (branch above) return early so they
    // bypass. Turbo / mini-boost / pads do NOT bypass — they get halved too.
    let offRoadMult = 1;
    try {
      const nowO = performance.now();
      const cache = offRoadCacheRef.current;
      const checkMs = Number(itemConfig.offRoad?.checkMs) || 100;
      if (nowO - cache.lastCheck > checkMs) {
        cache.lastCheck = nowO;
        const pp = useGameStore.getState().playerPosition;
        const py = Number(useGameStore.getState().groundPosition ?? pp?.y);
        cache.isOff = blackRoadGeometry
          ? isOffRoad(
              blackRoadGeometry,
              Number(pp?.x),
              Number(pp?.z),
              roadTransform,
              Number(itemConfig.offRoad?.slack) || 1.0,
              // Level-aware: a kart under a bridge is off-track unless its
              // own level is road (not the deck above it).
              py
            )
          : false;
      }
      if (cache.isOff) offRoadMult = Number(itemConfig.offRoad?.slowMult) || 0.5;
    } catch {
      offRoadMult = 1;
    }
    // Apply time trial speed factor if in time trial mode
    const isTimeTrialMode = useGameManager.getState().isTimeTrial;
    const speedFactor = isTimeTrialMode ? kartSettings.speed.timeTrialSpeedFactor || 1.5 : 1.0;

    // Adjust max speed for time trial mode. Everything scales with kart
    // size so a mini kart feels proportional (same relative pace/turning)
    // instead of a full-speed missile. At kartScale=1 unchanged.
    const baseMaxSpeed = kartSettings.speed.max;
    const maxSpeed = (((baseMaxSpeed * speedFactor) + (turbo.current > 0 ? 40 : 0)) * kartScale) * offRoadMult;
    const minSpeed = kartSettings.speed.min * kartScale * offRoadMult;

    // Boost flag drives flames + FOV kick + wind overlay. It must reflect an
    // actual mini-turbo, not the higher time-trial cruising speed.
    turbo.current > 0 ? setIsBoosting(true) : setIsBoosting(false);

    const gamepadButtons = {
      forward: false,
      backward: false,
    };

    if (gamepadRef.current?.buttons) {
      gamepadButtons.forward = Boolean(gamepadRef.current.buttons[0]?.pressed);
      gamepadButtons.backward = Boolean(gamepadRef.current.buttons[1]?.pressed);
    }
    const forwardAccel = Number(
      (isTouchScreen && !gamepadRef.current) ||
        forward ||
        gamepadButtons.forward
    );

    // Make the damping more responsive in time trial mode
    const dampingFactor = isTimeTrialMode ? 2.5 : 1.5;
    
    speedRef.current = damp(
      speedRef.current,
      maxSpeed * forwardAccel +
        minSpeed * Number(backward || gamepadButtons.backward),
      dampingFactor,
      delta
    );
    setSpeed(speedRef.current);
    if (speedRef.current < 20 * kartScale) {
      driftDirection.current = driftDirections.none;
      driftPower.current = 0;
    }
    turbo.current -= delta;
  }

  function rotatePlayer(left, right, player, joystickX, delta) {
    // Bullet Bill: the PLAYER steers (manual drive at bullet speed).
    // No autopilot — fall through to normal steering below.
    // Spin-out: no steering while tumbling (v3 §5).
    const spinNow = useGameStore.getState().spin;
    if (spinNow && performance.now() < spinNow.until) return;
    // Apply time trial mode handling adjustments
    const isTimeTrialMode = useGameManager.getState().isTimeTrial;
    const handlingFactor = isTimeTrialMode ? 1.5 : 1.0;
    
    const gamepadJoystick = {
      x: 0,
    };

    {
      const rawAxis = Number(gamepadRef.current?.axes?.[0]);
      gamepadJoystick.x =
        Number.isFinite(rawAxis) && Math.abs(rawAxis) > 0.15 ? rawAxis : 0;
    }

    // Make turning more responsive in time trial mode
    const turnSensitivity = isTimeTrialMode ? 0.15 : 0.1;
    
    inputTurn.current =
      (-gamepadJoystick.x -
        joystickX +
        (Number(left) - Number(right)) +
        driftDirection.current) *
      turnSensitivity;

    // Faster rotation response in time trial mode
    const rotationDampFactor = isTimeTrialMode ? 6 : 4;
    
    rotationSpeedRef.current = damp(
      rotationSpeedRef.current,
      inputTurn.current,
      rotationDampFactor,
      delta
    );
    
    const targetRotation =
      player.rotation.y +
      // Normalized by the kart's OWN top speed so a mini kart at its full
      // pace turns with the same angular response (and proportional radius)
      // as a full-size kart — instead of a 5x-wider boat turn. Reverse keeps
      // its (negative) sign. At kartScale=1 identical to the old formula.
      Math.min(speedRef.current / (kartSettings.speed.max * kartScale), 1.35) *
        rotationSpeedRef.current *
        handlingFactor;

    // More responsive rotation damping in time trial mode
    const finalDampFactor = isTimeTrialMode ? 12 : 8;
    player.rotation.y = damp(player.rotation.y, targetRotation, finalDampFactor, delta);
  }

  function jumpPlayer(spaceKey, left, right, joystickX) {
    if (spaceKey && !jumpIsHeld.current && !isJumping.current) {
      // rb.applyImpulse({ x: 0, y: 45, z: 0 }, true);

      jumpAnim();
      isJumping.current = true;
      jumpIsHeld.current = true;
      driftDirection.current =
        left || joystickX < 0
          ? driftDirections.left
          : right || joystickX > 0
          ? driftDirections.right
          : driftDirections.none;
    }

    if (!spaceKey) {
      jumpIsHeld.current = false;
      if (turbo.current <= 0) {
        turbo.current = useGameStore.getState().boostPower
          ? useGameStore.getState().boostPower
          : 0;
      }
      driftDirection.current = driftDirections.none;
      driftPower.current = 0;
    }
  }

  function driftPlayer(delta) {
    if (driftDirection.current !== driftDirections.none) {
      driftPower.current += delta;
    }
  }

  function updatePlayer(player, speed, camera, kart, delta) {
    // Apply time trial specific adjustments
    const isTimeTrialMode = useGameManager.getState().isTimeTrial;
    // NOTE: no extra movement multiplier here — updateSpeed already targets
    // 1.5x max in time trial. A second 1.5x here made the kart 2.25x while
    // the HUD showed 1.5x.
    const desiredDirection = _desiredDir.set(
      -Math.sin(player.rotation.y),
      0,
      -Math.cos(player.rotation.y)
    );

    // More responsive direction change in time trial mode
    const directionLerpFactor = isTimeTrialMode ? 18 : 12;
    smoothedDirectionRef.current.lerp(desiredDirection, directionLerpFactor * delta);
    const dir = smoothedDirectionRef.current;

    const angle = Math.atan2(
      desiredDirection.x * dir.z - desiredDirection.z * dir.x,
      desiredDirection.x * dir.x + desiredDirection.z * dir.z
    );

    // More responsive kart rotation in time trial mode
    const kartRotationDampFactor = isTimeTrialMode ? 9 : 6;
    kart.rotation.y = damp(
      kart.rotation.y,
      angle * 1.3 + driftDirection.current * 0.1,
      kartRotationDampFactor,
      delta
    );

    // Camera responsiveness in time trial mode
    const cameraLerpFactor = isTimeTrialMode ? 12 : 8;
    // Terrain follow: lift every chase mount by the kart's height above the
    // flat-course baseline, so climbs never bury the camera (and drops never
    // leave it floating). Damped + rate-limited so a physics spike on the
    // steep stadium ramp can't yank the camera 10m up in 0.3s.
    const groundY = useGameStore.getState().groundPosition;
    if (Number.isFinite(groundY)) {
      const targetLift = clamp(groundY + 0.7, -3, 14);
      const nextLift = damp(camLiftRef.current, targetLift, 5, delta);
      // Max camera climb/dive speed: 8 units/sec. Ramps still track, but
      // wheel-detach spikes (old bug) can't teleport the view anymore.
      const maxStep = 8 * Math.min(Math.max(delta, 0.0005), 0.05);
      camLiftRef.current = clamp(
        nextLift,
        camLiftRef.current - maxStep,
        camLiftRef.current + maxStep
      );
    }
    const camLift = camLiftRef.current;
    // Camera mounts live in the scaled player group, but the chase framing
    // must stay proportional: world mount = ground + base * kartScale.
    // groundEst backs the damped lift out to road level. At kartScale=1
    // this reduces exactly to the old formulas (mount = base + camLift).
    const groundEst = camLift - 0.7;
    cameraGroupRef.current.position.y = groundEst / kartScale + 2.7;
    cameraLookAtRef.current.position.y = groundEst / kartScale - 1.3;
    if (cameraFrontRef.current) cameraFrontRef.current.position.y = groundEst / kartScale + 2.9;
    if (rearLookRef.current) rearLookRef.current.position.y = groundEst / kartScale + 0.9;
    // R = look behind: blend from the normal chase cam to a front cam
    // that looks backwards. lookingBackRef 0→1 makes it smooth both ways.
    const lookT = lookingBackRef.current;
    const camTargetPos = cameraGroupRef.current.getWorldPosition(_camPos);
    const camTargetLook = cameraLookAtRef.current.getWorldPosition(_camLook);
    if (lookT > 0.001 && cameraFrontRef.current && rearLookRef.current) {
      const rearPos = cameraFrontRef.current.getWorldPosition(_camRearPos);
      const rearLook = rearLookRef.current.getWorldPosition(_camRearLook);
      camTargetPos.lerp(rearPos, lookT);
      camTargetLook.lerp(rearLook, lookT);
    }
    camera.lookAt(camTargetLook);
    camera.position.lerp(camTargetPos, cameraLerpFactor * delta);

    // const body = useGameStore.getState().body;
    // if(body){
    //   cameraGroupRef.current.position.y = lerp(cameraGroupRef.current.position.y, body.position.y + 2, 8 * delta);
    //   cameraLookAtRef.current.position.y = body.position.y;
    // }
    const direction = smoothedDirectionRef.current;

    // Desired movement for this frame (before walls).
    const prevX = player.position.x;
    const prevZ = player.position.z;
    const desiredX = prevX + direction.x * speed * delta;
    const desiredZ = prevZ + direction.z * speed * delta;

    // --- Wall physics: the kart slides along walls and can never pass through.
    // Layer 1: cheap precomputed segments (road edge + outer fence).
    const wallSegments = useGameStore.getState().wallSegments;
    let wallX = desiredX;
    let wallZ = desiredZ;
    let wallHit = false;
    let wallNX = 0;
    let wallNZ = 0;
    if (wallSegments && wallSegments.length > 0) {
      const resolved = resolveWallCollision(
        prevX,
        prevZ,
        desiredX,
        desiredZ,
        wallSegments,
        KART_RADIUS * kartScale,
        groundY
      );
      wallX = resolved.x;
      wallZ = resolved.z;
      wallHit = resolved.hit;
      wallNX = resolved.nx;
      wallNZ = resolved.nz;
    }
    // Layer 2: horizontal ray vs the visible track walls (candy barriers…).
    // Catches real geometry even where segments have gaps.
    const meshResolved = resolveMeshWalls(prevX, prevZ, wallX, wallZ);
    wallX = meshResolved.x;
    wallZ = meshResolved.z;
    if (meshResolved.hit) {
      wallHit = true;
      wallNX = meshResolved.nx;
      wallNZ = meshResolved.nz;
    }
    player.position.x = wallX;
    player.position.z = wallZ;
    // Odometer for lap-tie position ranks (teleports capped in the store).
    // Only motion along the kart's heading counts, so reversing or sliding
    // backwards never lifts a racer's rank. Remote racers use the same
    // projection (onlineRaceStore.setRemoteRacer), keeping both comparable.
    const fwdDist =
      (wallX - prevX) * -Math.sin(player.rotation.y) +
      (wallZ - prevZ) * -Math.cos(player.rotation.y);
    if (fwdDist > 0.001) useGameStore.getState().addSelfDistance(fwdDist);
    if (wallHit) {
      const motionX = desiredX - prevX;
      const motionZ = desiredZ - prevZ;
      const factor = wallSpeedFactor(motionX, motionZ, wallNX, wallNZ);
      // Scrub speed on impact so grinding a wall doesn't keep full pace.
      // Head-on hits lose more than gentle scrapes (see collision.js).
      // Delta-scaled (factor is defined per 60fps frame): without this the
      // kart stops ~2.4x faster on 144Hz than on 60Hz.
      const frameDt = Number.isFinite(delta) && delta > 0 ? Math.min(delta, 0.1) : 1 / 60;
      speedRef.current *= Math.pow(factor, frameDt * 60);
      setSpeed(speedRef.current);
    }

    setPlayerPosition(player.position);
  }

  // Send a compact transform about 15 times/sec. Rendering of remote karts
  // smooths the received states, which keeps traffic low while making the
  // side-by-side starting grid and race movement visible to everyone.
  // animState rides along (v3 §10.7): spins/bullet/boost_lean so remotes
  // play hit visuals. Wall clock (Date.now) — peers share it roughly.
  // `finished` is set once the local race is over: the physics step stops
  // then, but the pose keeps being published (with the flag) so remotes hide
  // the parked kart instead of leaving a frozen ghost on the road.
  function publishNetworkState(player, finished) {
    const now = performance.now();
    if (
      !isOnlineRace ||
      !useGameManager.getState().gameStarted ||
      now - lastNetworkSyncRef.current < 66
    ) {
      return;
    }
    lastNetworkSyncRef.current = now;
    const gsAnim = useGameStore.getState();
    const spinA = gsAnim.spin;
    const rideA = gsAnim.bulletRide;
    const selfIdA = useGameManager.getState().onlineSelfId ?? "local";
    const throwA = gsAnim.itemAnim;
    const throwLive =
      throwA && now >= throwA.start && now < throwA.start + throwA.totalMs
        ? throwA.name
        : null;
    const anim =
      spinA && now < spinA.until
        ? spinA.heavy
          ? "spin_hit_heavy"
          : "spin_hit_light"
        : rideA && rideA.ownerId === selfIdA && bulletActive(rideA, now)
          ? "bullet"
          : throwLive ?? (gsAnim.isBoosting
            ? "boost_lean"
            : gsAnim.carriedItem || gsAnim.carriedBomb || gsAnim.roulette
              ? "hold_item"
              : "drive");
    publishOnlineRaceTransform({
      x: player.position.x,
      y: player.position.y,
      z: player.position.z,
      rotationY: player.rotation.y,
      bodyY: useGameStore.getState().groundPosition ?? 0,
      anim,
      animAt: Date.now(),
      finished,
      // Remaining hit-invulnerability for the owner's skip check (2.1 #10).
      invulnMs: Math.max(0, Math.min(4000, Math.round((gsAnim.invulnUntil || 0) - now))),
      // BUG-1 fix: drift state so remote players render spark trails + glow.
      // driftDirection: -1.4 (left) | 0 (none) | 1.4 (right); driftPower: accumulated seconds.
      driftDir: driftDirection.current,
      driftPow: Math.min(driftPower.current, 10),
      // BUG-5 fix: sequence number so receivers drop out-of-order packets
      seq: ++networkSeqRef.current,
    });
  }

  useFrame((state, delta) => {
    if (!playerRef.current && !rbRef.current) return;
    // True pause (offline): freeze the whole physics step. Online races never
    // set isPaused — the menu there is informational only.
    // No driving before GO or after the results: inputs during the 3-2-1
    // countdown or behind the results screen must not move the kart.
    const gmState = useGameManager.getState();
    if (gmState.isPaused || !gmState.gameStarted) return;
    if (gmState.gameOver) {
      // Race finished locally: no more physics, but keep telling the others
      // the kart is parked/finished so they stop rendering and targeting it.
      if (playerRef.current) publishNetworkState(playerRef.current, true);
      return;
    }
    const player = playerRef.current;
    const cameraGroup = cameraGroupRef.current;
    const kart = kartRef.current;
    const camera = state.camera;

    if (!player || !cameraGroup || !kart) return;
    
    // Get time trial status from the game manager
    const isTimeTrial = useGameManager.getState().isTimeTrial;
    
    // Use a smaller delta cap for time trial mode to ensure fast responses
    // This ensures physics updates are more consistent and responsive 
    const maxDelta = isTimeTrial ? 0.05 : 0.1;
    const cappedDelta = Math.min(delta, maxDelta);

    const joystick = useGameStore.getState().joystick;
    const jumpButtonPressed = useGameStore.getState().jumpButtonPressed;

    const { forward, backward, left, right, jump, reset, lookBehind, honk } = get();

    const gamepadButtons = {
      jump: false,
      x: 0,
    };

    // Crash-proof gamepad read: cheap controllers expose < 8 buttons and
    // no axes. Optional chaining + deadzone keeps every frame TypeError-free
    // and stops stick drift from steering the kart.
    const pad = gamepadRef.current;
    const padButton = (i) => Boolean(pad?.buttons?.[i]?.pressed);
    const padAxis = (i) => {
      const v = Number(pad?.axes?.[i]);
      return Number.isFinite(v) && Math.abs(v) > 0.15 ? v : 0;
    };
    if (pad) {
      gamepadButtons.jump = padButton(5) || padButton(7);
      gamepadButtons.x = padAxis(0);
    }
    // Gamepad item use (X / LB): flows through the same store flag as the
    // mobile B button, edge-triggered by ItemBoxes like E/G.
    try {
      useGameStore.getState().setUseItemPressed(padButton(2) || padButton(4));
    } catch {
      // ignore — input must never break the physics loop
    }
    // Reset is edge-triggered so holding R cannot repeatedly teleport the
    // kart. The screen button queues the same request through CustomEvent.
    const resetDown = Boolean(reset);
    if ((resetDown && !resetHeldRef.current) || resetRequestedRef.current) {
      resetRequestedRef.current = false;
      resetToNearestBlackRoad(player);
    }
    resetHeldRef.current = resetDown;

    // H = honk (edge-triggered so holding H plays the horn once).
    const honkDown = Boolean(honk);
    if (honkDown && !honkHeldRef.current) {
      playSfx("car-honk.mp3", 1);
    }
    honkHeldRef.current = honkDown;

    updateSpeed(forward, backward, cappedDelta);
    rotatePlayer(left, right, player, joystick.x, cappedDelta);
    // Q = look behind while held, smooth back to the chase camera on release.
    lookingBackRef.current = damp(
      lookingBackRef.current,
      lookBehind ? 1 : 0,
      10,
      cappedDelta
    );
    updatePlayer(player, speedRef.current, camera, kart, cappedDelta);
    // Share heading for item drops + react to new explosions (blast+stun).
    const storeState = useGameStore.getState();
    if (storeState.setPlayerRotationY) {
      storeState.setPlayerRotationY(player.rotation.y);
    }
    reactToExplosions(player);
    detectTrappedUnderDeck(player);
    detectLostOffMap(player);
    const isJumpPressed = jumpButtonPressed || jump || gamepadButtons.jump;
    jumpPlayer(isJumpPressed, left, right, joystick.x || gamepadButtons.x);
    driftPlayer(cappedDelta);
    getGamepad();

    publishNetworkState(player, false);
  });

  return (
    <>
      <group></group>
      <group ref={playerRef} position={spawnSlot.position} rotation-y={spawnSlot.rotationY} scale={kartScale}>
        <group ref={cameraGroupRef} position={[0, 2, 5]}></group>

        <group ref={kartRef}>
          {/* Finish celebration: mounted only behind the results screen, so
              the 1000-particle burst fires once instead of looping all race
              (the old loop:true emitted ~2000 particles/sec forever). */}
          {gameOver && (
          <VFXEmitter
            emitter="confettis"
            settings={{
              duration: 0.5,
              delay: 0.1,
              nbParticles: 1000,
              spawnMode: "time",
              loop: false,
              startPositionMin: [-100, 0, -100],
              startPositionMax: [100, 10, 100],
              startRotationMin: [-1, -1, -1],
              startRotationMax: [1, 1, 1],
              particlesLifetime: [3, 4],
              speed: [1, 3],
              colorStart: [
                "#FF3F3F",
                "#FF9A00",
                "#FFE600",
                "#32FF6A",
                "#00E5FF",
                "#6A5CFF",
                "#FF5CFF",
                "#FF66B3",
                "#00FFB3",
                "#FFD700",
              ],
              directionMin: [-1, -1, -1],
              directionMax: [1, 0, 1],
              rotationSpeedMin: [-10, -10, -10],
              rotationSpeedMax: [10, 10, 10],
              size: [0.5, 1],
            }}
          />
          )}

          <Kart
            speed={speedRef}
            driftDirection={driftDirection}
            driftPower={driftPower}
            jumpOffset={jumpOffset}
            backWheelOffset={backWheelOffset}
            inputTurn={inputTurn}
          />

          <group ref={cameraLookAtRef} position={[0, -2, -9]}></group>
          {/* Look-behind mounts: camera jumps to the front, looks backwards */}
          <group ref={cameraFrontRef} position={[0, 2.2, -6.5]}></group>
          <group ref={rearLookRef} position={[0, 0.2, 10]}></group>
        </group>
      </group>

      {/* <OrbitControls/> */}
    </>
  );
};

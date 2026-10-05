import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF, useTexture, useKeyboardControls } from "@react-three/drei";
import * as THREE from "three";
import { useGameStore, applySpin, absorbWithOrbit } from "./store";import { useOnlineRaceStore } from "./onlineRaceStore";
import { ItemBoxModel, BombModel, RedShellModel, BlueShellModel, BlooperModel } from "./models/Pickups";
import {
  BLOOPER_INK_MS,
  BLOOPER_SQUIRT_MS,
  BLUE_BLAST_RADIUS,
  BLUE_FLY_HEIGHT,
  BLUE_LIFE_MS,
  BLUE_SPEED,
  BULLET_KNOCK_RADIUS,
  BULLET_RIDE_MS,
  RED_HIT_RADIUS,
  RED_LIFE_MS,
  RED_MAX_TURN,
  RED_SPEED,
  RED_STUN_MS,
  bulletActive,
  bounceShell,
  blueShouldDive,
  coneLock,
  cruiseSettle,
  hitApplies,
  inkUntil,
  isValidKnock,
  resolveBlueBlast,
  retargetBlue,
  shouldApplyHit,
  spawnDue,
  steerShell,
  targetsAhead,
  wallHitNormal,
} from "./items/homing";
import {
  ROULETTE_MS,
  canGrant,
  compareRacers,
  consumeUse,
  nextBoostUntil,
  normalizeBoxList,
  rankOf,
  refireAllowed,
  rollItem,
  rowToSlot,
  leaderOf,
} from "./items/itemWeights";
import {
  publishOnlineRaceEvent,
  subscribeOnlineRaceEvents,
} from "./onlineRaceTransport";
import { itemConfig } from "./items/itemConfig.js";
import { useGameManager } from "./gameManager";
import { kartSettings } from "./constants";
import { getMergedRoadGeometry, getTrack } from "./tracks";
import { sampleBlackRoadPoint, trackConfigToTransform } from "./trackRoad";

const BOX_COUNT = 3;
const PICKUP_RADIUS = 2.6;
const BOMB_ARM_SECONDS = 1.0;
const BOMB_TRIGGER_RADIUS = 3.4;
const EXPLOSION_LIFE = 1.05;

const snapRaycaster = new THREE.Raycaster();
const downDir = new THREE.Vector3(0, -1, 0);
let nextId = 1;
// Last committed item-use press (performance.now). Global min-use gap (§10.6).
let lastUseAt = 0;

// Red throw, two-phase: the press consumes the slot NOW, the shell spawns at
// the throw animation's release time (spec: 180ms forward).
const queueRedThrow = (backward, now) => {
  const st = useGameStore.getState();
  st.setCarriedItem(null);
  publishCarried(null);
  st.setPendingSpawns([
    ...st.pendingSpawns,
    {
      kind: "red",
      backward: Boolean(backward),
      pressAt: now,
      releaseMs: itemConfig.throwForward.releaseMs,
    },
  ]);
};

// Blue throw, two-phase: release at the throw-up apex (150ms).
const queueBlueThrow = (now) => {
  const st = useGameStore.getState();
  st.setCarriedItem(null);
  publishCarried(null);
  st.setPendingSpawns([
    ...st.pendingSpawns,
    { kind: "blue", pressAt: now, releaseMs: itemConfig.throwUp.releaseMs },
  ]);
};

// Bullet start, two-phase: mesh swap at 100ms (spec transform timing).
const queueBulletRide = (now) => {
  const st = useGameStore.getState();
  st.setCarriedItem(null);
  publishCarried(null);
  st.setPendingSpawns([
    ...st.pendingSpawns,
    { kind: "bullet", pressAt: now, releaseMs: itemConfig.bulletTransform.swapMs },
  ]);
};

const bombExplosionId = (bombId) => `explosion-${String(bombId)}`;

// Instant mini-boost for skid/wind roulette wins (TODO(decide): differentiate).
const fireMiniBoost = () => {
  window.dispatchEvent(
    new CustomEvent("mario-kart:boost", {
      detail: {
        duration: itemConfig.miniBoost.boostMs / 1000,
        speed: kartSettings.speed.max * itemConfig.miniBoost.speedMult,
        launchVy: 2,
      },
    })
  );
};

const publishCarried = (item) => {
  publishOnlineRaceEvent({
    type: "item:carried",
    itemType: item ? item.type : null,
    variant: item ? item.variant ?? "single" : null,
    // Remote visuals need counts + golden window (orbit + shrink).
    usesLeft: item && Number.isInteger(item.usesLeft) ? item.usesLeft : null,
    windowUntil:
      item && Number.isFinite(item.windowUntil) ? item.windowUntil : null,
  });
};

// Host owns box positions: publishes the full list; guests apply it.
const publishBoxes = () => {
  publishOnlineRaceEvent({
    type: "item:boxes",
    boxes: useGameStore.getState().itemBoxes,
  });
};

// Local standing for the item roulette. Solo = 1 of 1. Online ranks by
// laps first, distance driven second (same rule as the HUD badge).
const getStanding = () => {
  const gm = useGameManager.getState();
  if (!gm.isOnlineRace || !gm.onlinePlayers?.length) {
    return {
      position: 1,
      totalRacers: 1,
      hasOpponents: false,
      hasOpponentsAhead: false,
    };
  }
  const ors = useOnlineRaceStore.getState();
  const gs = useGameStore.getState();
  const localCompleted = Array.isArray(gm.lapTimes) ? gm.lapTimes.length : 0;
  const rows = gm.onlinePlayers.map((p) => {
    const isSelf = p.id === gm.onlineSelfId;
    return {
      id: p.id,
      laps: isSelf
        ? localCompleted
        : Number(ors.remoteRaceProgress[p.id]?.completedLaps) || 0,
      dist: isSelf
        ? gs.selfDistance || 0
        : ors.remoteDistances[p.id] || 0,
    };
  });
  const selfRow = rows.find((r) => r.id === gm.onlineSelfId);
  const { position } = rankOf(rows, gm.onlineSelfId);
  const ahead = selfRow
    ? rows.filter((r) => compareRacers(r, selfRow) < 0).length
    : 0;
  return {
    position,
    totalRacers: rows.length,
    hasOpponents: rows.length > 1,
    hasOpponentsAhead: ahead > 0,
  };
};

// Fire one boost from a carried mushroom-family item. Sets an exact
// 1.5x-max window (PlayerController targets it precisely, no stacking —
// re-use resets the timer). Golden uses its own shorter boost window.
const fireBoostItem = (item) => {
  const st = useGameStore.getState();
  const now = performance.now();
  const r = consumeUse({ item, now });
  if (r.boosted) {
    const durationMs =
      item.type === "golden"
        ? itemConfig.golden.boostMs
        : itemConfig.mushroom.boostMs;
    st.setShroomUntil(nextBoostUntil(st.shroomUntil, now, durationMs));
    try {
      const rawVol = Number(useGameManager.getState().sfxVolume);
      const sfx = new Audio("/music/mushroom-boost.mp3");
      sfx.volume = Number.isFinite(rawVol) ? Math.max(0, Math.min(1, rawVol)) : 0.7;
      sfx.play().catch(() => {});
    } catch {
      // ignore — audio must never break item use
    }
  }
  st.setCarriedItem(r.item);
  publishCarried(r.item);
};

const myRacerId = () => useGameManager.getState().onlineSelfId ?? "local";

// Local vulnerability: hits pass through while invulnerable (v3 §5).
const myVulnerable = (now = performance.now()) =>
  hitApplies({ invulnUntil: useGameStore.getState().invulnUntil }, now);

// Late/duplicate P2P hits must never stun behind the results screen.
const raceLive = () => {
  const gm = useGameManager.getState();
  return shouldApplyHit({ gameStarted: gm.gameStarted, gameOver: gm.gameOver });
};

const shellHitFxId = (shellId) => `shellhit-${String(shellId)}`;

// Stun the LOCAL kart from a shell hit + small burst. Remote victims apply
// this themselves when their shell:hit arrives (owner never stuns remotes).
const applyShellStun = ({ x, y, z, shellId, scale = 0.6, soft = false, stun = true, ms = null, heavy = false }) => {
  const st = useGameStore.getState();
  if (stun) applySpin({ victim: "self", heavy, ms, now: performance.now() });
  const fxId = shellHitFxId(shellId);
  if (!st.explosions.some((e) => e.id === fxId)) {
    st.setExplosions([
      ...st.explosions,
      { id: fxId, x, y, z, scale, soft, at: performance.now() },
    ]);
  }
  try {
    const rawVol = Number(useGameManager.getState().sfxVolume);
    const hit = new Audio("/music/shell-hit.mp3");
    hit.volume = Number.isFinite(rawVol) ? Math.max(0, Math.min(1, rawVol)) : 0.7;
    hit.play().catch(() => {});
  } catch {
    // ignore — audio must never break hit feedback
  }
};

const addRemoteShell = (shell) => {
  const st = useGameStore.getState();
  const id = String(shell?.id ?? "");
  if (!id || st.activeShells.some((s) => s.id === id)) return false;
  // Remotes derive the cruise height (spawn is always cruise + 1.2).
  st.setActiveShells([
    ...st.activeShells,
    { ...shell, id, owner: false, cruiseY: shell.y - 1.2 },
  ]);
  return true;
};

const onRemoteShellHit = (event) => {
  const st = useGameStore.getState();
  const shellId = String(event?.shellId ?? "");
  if (!shellId) return;
  const shell = st.activeShells.find((s) => s.id === shellId);
  st.setActiveShells(st.activeShells.filter((s) => s.id !== shellId));
  if (String(event?.victimId ?? "") === myRacerId() && shell && raceLive() && myVulnerable()) {
    // Triple orbit absorbs red shells instead of spinning (matrix §4.3).
    if (shell.kind !== "red" || !absorbWithOrbit("red")) {
      applyShellStun({ x: shell.x, y: shell.y, z: shell.z, shellId, soft: true });
    }
  }
};

const fireRedShell = (backward = false) => {
  const st = useGameStore.getState();
  const gm = useGameManager.getState();
  const playerPos = st.playerPosition;
  if (!playerPos) return false;
  const ry = st.playerRotationY || 0;
  const fx = -Math.sin(ry);
  const fz = -Math.cos(ry);
  // Backward throw (back held + use): straight back, no homing.
  const dx = backward ? -fx : fx;
  const dz = backward ? -fz : fz;
  const me = myRacerId();
  const gy = st.groundPosition ?? playerPos.y ?? 0;

  let targetId = null;
  if (gm.isOnlineRace && !backward) {
    const ors = useOnlineRaceStore.getState();
    const racers = Object.entries(ors.remoteRacers).map(([id, r]) => ({
      id,
      x: Number(r?.x) || 0,
      z: Number(r?.z) || 0,
    }));
    const target = coneLock({ id: me, x: playerPos.x, z: playerPos.z, fx, fz }, racers);
    targetId = target ? target.id : null;
  }

  const shell = {
    id: `shell-${me}-${Date.now().toString(36)}`,
    kind: "red",
    x: playerPos.x + dx * 2,
    y: gy + 0.9 + 1.2,
    z: playerPos.z + dz * 2,
    cruiseY: gy + 0.9,
    dx,
    dz,
    targetId,
    homing: !backward && targetId !== null,
    bounces: itemConfig.redShell.maxBounces,
    ownerId: me,
    owner: true,
    at: performance.now(),
  };
  st.setActiveShells([...st.activeShells, shell]);
  publishCarried(null);
  publishOnlineRaceEvent({
    type: "shell:fired",
    shell: {
      id: shell.id,
      kind: "red",
      x: shell.x,
      y: shell.y,
      z: shell.z,
      dx: shell.dx,
      dz: shell.dz,
      targetId,
      homing: shell.homing,
      bounces: shell.bounces,
      ownerId: me,
    },
  });
  try {
    const rawVol = Number(gm.sfxVolume);
    const fire = new Audio("/music/shell-fire.mp3");
    fire.volume = Number.isFinite(rawVol) ? Math.max(0, Math.min(1, rawVol)) : 0.7;
    fire.play().catch(() => {});
  } catch {
    // ignore — audio must never break firing
  }
  return true;
};

// Bullet Bill: 5s self-drive. Start clears the slot; end adds a hop.
// Only the owner's client runs knock detection (victims apply on receipt).
const startBulletRide = () => {
  const st = useGameStore.getState();
  const me = myRacerId();
  const ride = {
    rideId: `ride-${me}-${Date.now().toString(36)}`,
    ownerId: me,
    until: performance.now() + BULLET_RIDE_MS,
    endingUntil: 0,
  };
  // Starting cancels any spin-out in progress (§4.4).
  st.setSpin(null);
  st.setStunUntil(0);
  st.setBulletRide(ride);
  st.setCarriedItem(null);
  publishOnlineRaceEvent({ type: "item:carried", itemType: null });
  publishOnlineRaceEvent({ type: "bullet:start", rideId: ride.rideId, playerId: me });
  try {
    const rawVol = Number(useGameManager.getState().sfxVolume);
    const launch = new Audio("/music/bullet-launch.mp3");
    launch.volume = Number.isFinite(rawVol) ? Math.max(0, Math.min(1, rawVol)) : 0.7;
    launch.play().catch(() => {});
  } catch {
    // ignore — audio must never break the ride
  }
  return true;
};

// Blooper: squirt visual (~1s) + ink event to whoever is ahead right now.
// Zero targets still consumes the item (mistimed shots whiff).
const fireBlooper = () => {
  const st = useGameStore.getState();
  const gm = useGameManager.getState();
  const playerPos = st.playerPosition;
  if (!playerPos) return false;
  const ry = st.playerRotationY || 0;
  const fx = -Math.sin(ry);
  const fz = -Math.cos(ry);
  const me = myRacerId();
  const gy = st.groundPosition ?? playerPos.y ?? 0;

  let targetIds = [];
  if (gm.isOnlineRace) {
    const ors = useOnlineRaceStore.getState();
    const racers = Object.entries(ors.remoteRacers).map(([id, r]) => ({
      id,
      x: Number(r?.x) || 0,
      z: Number(r?.z) || 0,
      laps: Number(ors.remoteRaceProgress[id]?.completedLaps) || 0,
      bullet: Boolean(r?.bulletRide),
    }));
    const localCompleted = Array.isArray(gm.lapTimes) ? gm.lapTimes.length : 0;
    targetIds = targetsAhead(
      { id: me, x: playerPos.x, z: playerPos.z, laps: localCompleted, fx, fz },
      racers
    );
  }

  st.setBlooperSquirt({
    x: playerPos.x + fx * 1.5,
    y: gy + 1.2,
    z: playerPos.z + fz * 1.5,
    until: performance.now() + BLOOPER_SQUIRT_MS,
  });
  st.setCarriedItem(null);
  publishOnlineRaceEvent({ type: "item:carried", itemType: null });
  if (targetIds.length > 0) {
    publishOnlineRaceEvent({ type: "blooper:ink", targetIds });
  }
  try {
    const rawVol = Number(gm.sfxVolume);
    const splash = new Audio("/music/blooper-splash.mp3");
    splash.volume = Number.isFinite(rawVol) ? Math.max(0, Math.min(1, rawVol)) : 0.7;
    splash.play().catch(() => {});
  } catch {
    // ignore — audio must never break firing
  }
  return true;
};
const endBulletRide = (hop = true) => {
  const st = useGameStore.getState();
  if (!st.bulletRide || st.bulletRide.endingUntil) return;
  const now = performance.now();
  const ownerId = st.bulletRide.ownerId;
  // Ramp-out: keep the ride entry with an expired `until` so speed eases
  // over 600ms, then clear. Plus 1.0 s hit-invulnerability.
  st.setBulletRide({
    ...st.bulletRide,
    endingUntil: now + itemConfig.bullet.rampOutMs,
  });
  st.setInvulnUntil(now + itemConfig.bullet.endInvulnMs);
  publishOnlineRaceEvent({ type: "bullet:end", playerId: ownerId });
  if (hop) {
    const scale = useGameStore.getState().kartScale ?? 1;
    window.dispatchEvent(
      new CustomEvent("mario-kart:launch-jump", { detail: { launchVy: 6 * scale } })
    );
  }
};

let blueAlarmAudio = null;
const startBlueAlarm = () => {
  try {
    stopBlueAlarm();
    blueAlarmAudio = new Audio("/music/blue-alarm.mp3");
    blueAlarmAudio.loop = true;
    blueAlarmAudio.volume = 0.6;
    blueAlarmAudio.play().catch(() => {});
  } catch {
    blueAlarmAudio = null;
  }
};
const stopBlueAlarm = () => {
  try {
    blueAlarmAudio?.pause();
  } catch {
    // ignore — alarm is best-effort
  }
  blueAlarmAudio = null;
};

// Blue shell: targets whoever leads RIGHT NOW (including self if the owner
// took the lead after the pickup — MK-accurate). Refuses to fire solo.
const fireBlueShell = () => {
  const st = useGameStore.getState();
  const gm = useGameManager.getState();
  const playerPos = st.playerPosition;
  if (!playerPos || !gm.isOnlineRace) return false;
  const me = myRacerId();
  const ors = useOnlineRaceStore.getState();
  const localCompleted = Array.isArray(gm.lapTimes) ? gm.lapTimes.length : 0;
  const rows = [{ id: me, laps: localCompleted, finished: false, dist: st.selfDistance || 0 }];
  for (const [id, p] of Object.entries(ors.remoteRaceProgress)) {
    rows.push({
      id,
      laps: Number(p?.completedLaps) || 0,
      finished: Boolean(p?.finished),
      dist: ors.remoteDistances[id] || 0,
    });
  }
  const leaderId = leaderOf(rows);
  if (!leaderId) return false;

  const gy = st.groundPosition ?? playerPos.y ?? 0;
  const shell = {
    id: `blue-${me}-${Date.now().toString(36)}`,
    kind: "blue",
    x: playerPos.x,
    y: gy + 1,
    z: playerPos.z,
    dx: 0,
    dz: 0,
    targetId: leaderId,
    top: gy + 1 + BLUE_FLY_HEIGHT,
    phase: "fly",
    ownerId: me,
    owner: true,
    at: performance.now(),
  };
  st.setActiveShells([...st.activeShells, shell]);
  st.setCarriedItem(null);
  publishOnlineRaceEvent({ type: "item:carried", itemType: null });
  publishOnlineRaceEvent({
    type: "shell:fired",
    shell: {
      id: shell.id,
      kind: "blue",
      x: shell.x,
      y: shell.y,
      z: shell.z,
      dx: 0,
      dz: 0,
      targetId: leaderId,
      ownerId: me,
    },
  });
  publishOnlineRaceEvent({ type: "blue:incoming", leaderId });
  // Self-target (took the lead after pickup): the owner never processes its
  // own publish, so start the warning loop locally too.
  if (leaderId === me) startBlueAlarm();
  try {
    const rawVol = Number(gm.sfxVolume);
    const fire = new Audio("/music/shell-fire.mp3");
    fire.volume = Number.isFinite(rawVol) ? Math.max(0, Math.min(1, rawVol)) : 0.7;
    fire.play().catch(() => {});
  } catch {
    // ignore — audio must never break firing
  }
  return true;
};

const bombAgeMs = (bomb, now) => {
  if (Number.isFinite(bomb?.createdAt)) {
    return Math.max(0, Date.now() - bomb.createdAt);
  }
  return now - (Number.isFinite(bomb?.at) ? bomb.at : now);
};

const makeBombId = () => {
  const selfId = useGameManager.getState().onlineSelfId;
  const owner = String(selfId || "local")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 24) || "local";

  return `bomb-${owner}-${Date.now().toString(36)}-${nextId++}`;
};

const addDroppedBomb = (bomb) => {
  const st = useGameStore.getState();
  const id = String(bomb?.id ?? "");
  if (!id || st.droppedBombs.some((entry) => entry.id === id)) return false;
  if (st.explosions.some((entry) => entry.id === bombExplosionId(id))) return false;

  // Bombs keep their owner's kart size so a mini kart drops a mini bomb.
  const rawScale = Number(bomb?.scale);
  st.setDroppedBombs([
    ...st.droppedBombs,
    {
      id,
      x: bomb.x,
      y: bomb.y,
      z: bomb.z,
      scale: Number.isFinite(rawScale) ? Math.max(0.2, Math.min(3, rawScale)) : 1,
      createdAt: Number.isFinite(bomb.createdAt) ? bomb.createdAt : Date.now(),
      at: performance.now(),
    },
  ]);
  return true;
};

const triggerBombExplosion = (bomb, { broadcast = false } = {}) => {
  const st = useGameStore.getState();
  const id = String(bomb?.id ?? "");
  if (!id) return false;

  const explosionId = bombExplosionId(id);
  if (st.explosions.some((entry) => entry.id === explosionId)) return false;

  st.setDroppedBombs(st.droppedBombs.filter((entry) => entry.id !== id));
  st.setExplosions([
    ...st.explosions,
    {
      id: explosionId,
      x: bomb.x,
      y: bomb.y,
      z: bomb.z,
      // The blast renders at its owner's kart size (mini bomb, mini boom).
      scale: Number.isFinite(Number(bomb?.scale)) ? bomb.scale : 1,
      at: performance.now(),
    },
  ]);

  const boom = new Audio("/music/explosion.mp3");
  boom.volume = 1;
  boom.play().catch(() => {});

  if (broadcast) {
    publishOnlineRaceEvent({
      type: "bomb:explode",
      bombId: id,
      x: bomb.x,
      y: bomb.y,
      z: bomb.z,
      scale: Number.isFinite(Number(bomb?.scale)) ? bomb.scale : 1,
    });
  }

  return true;
};

function ExplosionFx({ data }) {
  const tex = useTexture("/textures/explosion.jpg");
  const pointsRef = useRef(null);
  const flashRef = useRef(null);
  const flashMatRef = useRef(null);
  const pointsMatRef = useRef(null);
  const lightRef = useRef(null);
  const tRef = useRef(0);

  const { positions, velocities } = useMemo(() => {
    const N = 150;
    const positions = new Float32Array(N * 3);
    const velocities = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 4 + Math.random() * 7;
      velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
      velocities[i * 3 + 1] =
        Math.abs(Math.cos(phi)) * speed * 0.9 + 2 + Math.random() * 4;
      velocities[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed;
    }
    return { positions, velocities };
  }, []);

  useFrame((_, delta) => {
    const t = (tRef.current += Math.min(delta, 0.05));
    if (t >= EXPLOSION_LIFE) {
      const rest = useGameStore
        .getState()
        .explosions.filter((e) => e.id !== data.id);
      useGameStore.getState().setExplosions(rest);
      return;
    }
    const pos = pointsRef.current?.geometry.attributes.position;
    if (pos) {
      const arr = pos.array;
      for (let i = 0; i < arr.length / 3; i++) {
        velocities[i * 3 + 1] -= 11 * delta;
        arr[i * 3] += velocities[i * 3] * delta;
        arr[i * 3 + 1] += velocities[i * 3 + 1] * delta;
        arr[i * 3 + 2] += velocities[i * 3 + 2] * delta;
        if (arr[i * 3 + 1] < 0.05) arr[i * 3 + 1] = 0.05;
      }
      pos.needsUpdate = true;
    }
    const fade = 1 - t / EXPLOSION_LIFE;
    if (pointsMatRef.current) pointsMatRef.current.opacity = fade * 0.9;    if (flashRef.current) {
      // Small flash on purpose: a big additive sphere swallows the camera
      // and turns the whole screen white.
      const s = 1 + (t / EXPLOSION_LIFE) * 3;
      flashRef.current.scale.set(s, s, s);
    }
    if (flashMatRef.current) flashMatRef.current.opacity = fade * 0.4;
    if (lightRef.current) lightRef.current.intensity = fade * 45 * (data.scale ?? 1);
  });

  return (
    <group position={[data.x, data.y + 1, data.z]} scale={data.scale ?? 1}>
      <points ref={pointsRef} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          ref={pointsMatRef}
          map={tex}
          size={1.9}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          color="#ffca7a"
          sizeAttenuation
        />
      </points>
      <mesh ref={flashRef}>
        <sphereGeometry args={[1, 20, 20]} />
        <meshBasicMaterial
          ref={flashMatRef}
          color="#ffe3a3"
          transparent
          opacity={0.65}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <pointLight ref={lightRef} color="#ffb14e" intensity={45} distance={22 * (data.scale ?? 1)} decay={2} />
    </group>
  );
}

// Ground ring under the blue shell's target (all peers see it). Shrinks as
// the shell approaches: full radius far away, tight at impact.
function BlueTargetRing({ shell }) {
  const playerPosition = useGameStore((s) => s.playerPosition);
  const remoteRacers = useOnlineRaceStore((s) => s.remoteRacers);
  const me = myRacerId();
  const target =
    shell.targetId === me
      ? { x: playerPosition?.x ?? shell.x, y: playerPosition?.y ?? shell.y, z: playerPosition?.z ?? shell.z }
      : remoteRacers[shell.targetId];
  if (!target) return null;
  const distXZ = Math.hypot((target.x ?? shell.x) - shell.x, (target.z ?? shell.z) - shell.z);
  const scale = Math.max(0.15, Math.min(1, distXZ / 60)) * itemConfig.blueShell.radius;
  return (
    <group position={[target.x ?? shell.x, (target.y ?? shell.y) + 0.15, target.z ?? shell.z]}>
      <mesh rotation-x={-Math.PI / 2} scale={scale}>
        <ringGeometry args={[0.9, 1, 40]} />
        <meshBasicMaterial color="#ff3b30" transparent opacity={0.8} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

export function ItemBoxes() {  const selectedTrackId = useGameManager((s) => s.selectedTrackId);
  const activeTrack = getTrack(selectedTrackId);
  const { nodes } = useGLTF(activeTrack.glb);
  const scene = useThree((s) => s.scene);
  const [, getKeys] = useKeyboardControls();
  const collidersRef = useRef(null);
  const boxNodesRef = useRef(new Map());
  const dropHeldRef = useRef(false);
  const goldenLastRef = useRef(0);
  const knockedRef = useRef({ rideId: null, ids: new Set() });
  const boxSyncRef = useRef(0);
  // Race-start timestamp for position-mode age rules (performance.now clock).
  const matchStartRef = useRef(0);
  const tickAudioRef = useRef(null);
  const blackRoadGeometry = getMergedRoadGeometry(nodes, activeTrack);
  const roadTransform = trackConfigToTransform(activeTrack);

  const itemBoxes = useGameStore((s) => s.itemBoxes);
  const droppedBombs = useGameStore((s) => s.droppedBombs);
  const explosions = useGameStore((s) => s.explosions);
  const activeShells = useGameStore((s) => s.activeShells);
  const blooperSquirt = useGameStore((s) => s.blooperSquirt);
  const carriedBomb = useGameStore((s) => s.carriedBomb);
  // Pickups render at the local kart's size so a mini kart meets a mini box.
  const boxVisualScale = useGameStore((s) => s.kartScale) ?? 1;

  // Apply reliable gameplay events received from another racer. The local
  // player is excluded by the P2P layer, so these never duplicate their own
  // drop/explosion action.
  useEffect(
    () =>
      subscribeOnlineRaceEvents((event) => {
        if (!event || typeof event !== "object") return;

        if (event.type === "bomb:dropped" && event.bomb) {
          addDroppedBomb(event.bomb);
          return;
        }

        if (event.type === "bomb:explode" && event.bombId) {
          triggerBombExplosion(
            {
              id: event.bombId,
              x: event.x,
              y: event.y,
              z: event.z,
              scale: event.scale,
            },
            { broadcast: false },
          );
          return;
        }

        if (event.type === "shell:fired" && event.shell) {
          addRemoteShell(event.shell);
          return;
        }

        if (event.type === "item:boxes" && event.boxes) {
          const clean = normalizeBoxList(event.boxes);
          if (clean) useGameStore.getState().setItemBoxes(clean);
          return;
        }

        if (event.type === "item:boxTaken" && Number.isInteger(event.boxId)) {
          const st4 = useGameStore.getState();
          st4.setItemBoxes(
            st4.itemBoxes.map((o) =>
              o.id === event.boxId && o.active
                ? {
                    ...o,
                    active: false,
                    respawnAt: performance.now() + itemConfig.boxRespawnMs,
                  }
                : o
            )
          );
          return;
        }

        if (event.type === "shell:hit" && event.shellId) {
          onRemoteShellHit(event);
          return;
        }

        if (event.type === "blue:incoming" && event.leaderId) {
          // Alarm loops ONLY on the targeted client, per spec.
          if (event.leaderId === myRacerId()) {
            startBlueAlarm();
            useGameStore.getState().setBlueWarning({ since: performance.now() });
          }
          return;
        }

        if (event.type === "bullet:start" && event.playerId) {
          useOnlineRaceStore
            .getState()
            .setRemoteRacerBulletRide(event.playerId, {
              rideId: event.rideId,
              ownerId: event.playerId,
              until: performance.now() + BULLET_RIDE_MS,
            });
          return;
        }

        if (event.type === "bullet:end" && event.playerId) {
          const cur = useOnlineRaceStore.getState().remoteRacers[event.playerId];
          if (cur?.bulletRide) {
            useOnlineRaceStore.getState().setRemoteRacerBulletRide(event.playerId, null);
          }
          return;
        }

        if (event.type === "bullet:knock" && event.victimId) {
          // Sender must own that exact live ride — otherwise anyone could
          // stun anyone at any range with a forged event.
          const senderRide =
            useOnlineRaceStore.getState().remoteRacers[event.playerId]?.bulletRide;
          if (
            event.victimId === myRacerId() &&
            raceLive() &&
            myVulnerable() &&
            isValidKnock({ senderRide, rideId: event.rideId, now: performance.now() })
          ) {
            const p = useGameStore.getState().playerPosition;
            applyShellStun({
              x: p?.x ?? 0,
              y: p?.y ?? 0,
              z: p?.z ?? 0,
              shellId: `knock-${event.rideId}`,
              scale: 0.8,
              soft: true,
              ms: itemConfig.bullet.hitSpinMs,
            });
          }
          return;
        }

        if (event.type === "blooper:ink" && Array.isArray(event.targetIds)) {
          // Bullet riders are immune (§4.5).
          const myRide = useGameStore.getState().bulletRide;
          const immune =
            myRide &&
            myRide.ownerId === myRacerId() &&
            bulletActive(myRide, performance.now());
          if (!immune && event.targetIds.includes(myRacerId())) {
            useGameStore.getState().setBlooperUntil(inkUntil(performance.now()));
            try {
              const rawVol = Number(useGameManager.getState().sfxVolume);
              const splash = new Audio("/music/blooper-splash.mp3");
              splash.volume = Number.isFinite(rawVol)
                ? Math.max(0, Math.min(1, rawVol))
                : 0.7;
              splash.play().catch(() => {});
            } catch {
              // ignore — audio must never break the ink effect
            }
          }
        }

        if (event.type === "blue:explode" && Number.isFinite(event.x)) {
          stopBlueAlarm();
          useGameStore.getState().setBlueWarning(null);
          const st2 = useGameStore.getState();
          st2.setActiveShells(
            st2.activeShells.filter(
              (s) =>
                !(
                  s.kind === "blue" &&
                  Math.hypot(s.x - event.x, s.z - event.z) < 20
                )
            )
          );
          if (!event.fizzle) {
            const me2 = myRacerId();
            const p2 = st2.playerPosition;
            // Bullet riders are immune to the blast (alarm already stopped).
            const myRide = st2.bulletRide;
            const immune =
              myRide &&
              myRide.ownerId === me2 &&
              bulletActive(myRide, performance.now());
          if (
            !immune &&
            raceLive() &&
            myVulnerable() &&
            p2 &&
            resolveBlueBlast([{ id: me2, x: p2.x, z: p2.z }], event).includes(me2)
          ) {
              applyShellStun({
                x: event.x,
                y: event.y,
                z: event.z,
                shellId: `blue-${event.x}-${event.z}`,
                scale: 1.2,
                heavy: true,
              });
            }
          }
        }
      }),
    [],
  );

  const getColliders = () => {
    if (!collidersRef.current) {
      const list = [];
      scene.traverse((obj) => {
        if (obj.isMesh && obj.name.includes("ground")) list.push(obj);
      });
      collidersRef.current = list;
    }
    return collidersRef.current;
  };

  const snapToGround = (x, z) => {
    snapRaycaster.set(new THREE.Vector3(x, 60, z), downDir);
    snapRaycaster.far = 200;
    snapRaycaster.firstHitOnly = true;
    const hits = snapRaycaster.intersectObjects(getColliders(), false);
    const g = hits.find((h) => h.object.name.includes("ground"));
    return g ? g.point.y : null;
  };

  const randomBoxSpot = () => {
    // Sample the actual road triangles. The prior bounding
    // box + general ground ray could resolve to grass, barriers or scenery.
    const point = sampleBlackRoadPoint(blackRoadGeometry, roadTransform);
    if (!point) return null;
    // Hover height follows the local kart size so a mini box hugs the road
    // instead of floating a full kart-height above it. Stored per box so
    // respawns and bobbing stay consistent even if the scale changes.
    const s = useGameStore.getState().kartScale ?? 1;
    return { x: point.x, y: point.y + 1.1 * s, z: point.z, s };
  };

  // Initial spawn. Solo + host generate spots; guests wait for the host's
  // item:boxes (plus the 2s heartbeat below, which heals late joins).
  useEffect(() => {
    if (useGameStore.getState().itemBoxes.length > 0) return;
    const gm = useGameManager.getState();
    const ownsBoxes =
      !gm.isOnlineRace || useOnlineRaceStore.getState().isHost === true;
    if (!ownsBoxes) return;
    const spots = [];
    for (let i = 0; i < BOX_COUNT; i++) {
      const s = randomBoxSpot();
      if (s) spots.push({ id: nextId++, ...s, active: true, respawnAt: 0 });
    }
    if (spots.length > 0) useGameStore.getState().setItemBoxes(spots);
    if (gm.isOnlineRace) publishBoxes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, scene, selectedTrackId]);

  // Blue alarm is module-level audio: always stop on unmount (exit) so it
  // never loops into the menu or the next race.
  useEffect(() => () => stopBlueAlarm(), []);
  // A race reset while a blue is airborne must also kill the loop: the
  // fizzle explode never fires once activeShells is cleared.
  const raceRunning = useGameManager((s) => s.gameStarted);
  useEffect(() => {
    if (!raceRunning) {
      stopBlueAlarm();
      useGameStore.getState().setBlueWarning(null);
    }
  }, [raceRunning]);

  // Ticking loop while carrying the bomb.
  useEffect(() => {
    if (carriedBomb) {
      const audio = new Audio("/music/explosion.mp3");
      audio.loop = true;
      audio.volume = 0.35;
      audio.play().catch(() => {});
      tickAudioRef.current = audio;
    } else if (tickAudioRef.current) {
      tickAudioRef.current.pause();
      tickAudioRef.current = null;
    }
    return () => {
      // Always stop on unmount (exit) — otherwise the loop keeps playing
      // and a second loop starts on re-entry while still carrying.
      if (tickAudioRef.current) {
        tickAudioRef.current.pause();
        tickAudioRef.current = null;
      }
    };
  }, [carriedBomb]);

  useFrame((state, delta) => {
    const st = useGameStore.getState();
    const playerPos = st.playerPosition;
    const now = performance.now();
    const t = state.clock.elapsedTime;

    // Spin + bob living boxes (bob amplitude follows each box's scale).
    for (const b of st.itemBoxes) {
      const g = boxNodesRef.current.get(b.id);
      if (!g || !b.active) continue;
      g.rotation.y = t * 2 + b.id;
      g.position.y = b.y + Math.sin(t * 2.2 + b.id * 1.7) * 0.3 * (b.s ?? 1);
    }

    if (!playerPos) return;
    const px = playerPos.x;
    const pz = playerPos.z;
    // Radii follow the local kart size (clamped so mini karts can still
    // grab boxes without pixel-perfect driving). At scale=1 unchanged.
    const myScale = useGameStore.getState().kartScale ?? 1;
    const pickupRadius = Math.max(1.2, PICKUP_RADIUS * myScale);
    const triggerRadius = Math.max(1.2, BOMB_TRIGGER_RADIUS * myScale);

    // Pickup: single slot shared by the bomb and battle items. The bomb
    // keeps its exact legacy grant path when it wins the roll; otherwise a
    // position-weighted item fills the new carriedItem slot (Task 1).
    if (
      canGrant({
        carriedBomb: st.carriedBomb,
        carriedItem: st.carriedItem,
        roulette: st.roulette,
      })
    ) {
      for (const b of st.itemBoxes) {
        if (!b.active) continue;
        const d = Math.hypot(px - b.x, pz - b.z);
        if (d < pickupRadius) {
          try {
            const rawVol = Number(useGameManager.getState().sfxVolume);
            const vol = Number.isFinite(rawVol) ? Math.max(0, Math.min(1, rawVol)) : 0.7;
            const pickup = new Audio("./music/collecting_box.mp3");
            pickup.volume = vol;
            pickup.play().catch(() => {});
          } catch {
            // ignore — audio must never break the pickup loop
          }
          if (Math.random() < 0.3) {
            st.setCarriedBomb(true);
            publishOnlineRaceEvent({ type: "bomb:carried", carried: true });
          } else {
            // Roulette starts: the row commits only when the spin locks.
            const activeBlue = st.activeShells.some((s) => s.kind === "blue");
            if (useGameManager.getState().gameStarted && !matchStartRef.current) {
              matchStartRef.current = now;
            }
            st.setRoulette({
              type: rollItem({
                ...getStanding(),
                activeBlue,
                raceAgeMs: now - matchStartRef.current,
              }),
              startedAt: now,
            });
          }          st.setItemBoxes(
            st.itemBoxes.map((o) =>
              o.id === b.id
                ? { ...o, active: false, respawnAt: now + itemConfig.boxRespawnMs }
                : o
            )
          );
          // Tell everyone the box is gone (offline publish is a no-op).
          publishOnlineRaceEvent({ type: "item:boxTaken", boxId: b.id });
          break;
        }
      }
    }

    // Respawn collected boxes. ONLY the owner (solo/host) rolls new spots —
    // guests apply the host's list, so positions stay identical everywhere.
    const gmFrame = useGameManager.getState();
    const orsFrame = useOnlineRaceStore.getState();
    const ownsBoxes = !gmFrame.isOnlineRace || orsFrame.isHost === true;
    let needsRespawn = false;
    let next = st.itemBoxes;
    if (ownsBoxes) {
      next = st.itemBoxes.map((b) => {
        if (!b.active && b.respawnAt > 0 && now >= b.respawnAt) {
          const s = randomBoxSpot();
          needsRespawn = true;
          if (s) return { ...b, ...s, active: true, respawnAt: 0 };
          return { ...b, respawnAt: now + 2000 };
        }
        return b;
      });
      if (needsRespawn) {
        st.setItemBoxes(next);
        if (gmFrame.isOnlineRace) publishBoxes();
      }
    }

    // Host heartbeat: full list every 2s heals late joins and lost packets.
    if (gmFrame.isOnlineRace && orsFrame.isHost === true) {
      if (now - boxSyncRef.current > 2000) {
        boxSyncRef.current = now;
        publishBoxes();
      }
    }

    // Drop with G or E (edge trigger). Spin-out and the global use gap
    // gate every use (§10.6); lastUseAt is stamped on any committed press.
    const keys = getKeys();
    const dropDown = Boolean(keys?.dropBomb || keys?.useItem);
    const spinningNow = st.spin && now < st.spin.until;
    const gapOk = now - lastUseAt >= itemConfig.minUseGapMs;
    if (dropDown && !dropHeldRef.current && st.carriedBomb && !spinningNow && gapOk) {
      lastUseAt = now;
      const ry = st.playerRotationY || 0;
      const myScale = useGameStore.getState().kartScale ?? 1;
      const fx = -Math.sin(ry);
      const fz = -Math.cos(ry);
      const dropBack = 2.6 * Math.max(0.5, myScale);
      const bx = px - fx * dropBack;
      const bz = pz - fz * dropBack;
      const gy = snapToGround(bx, bz) ?? (st.groundPosition ?? 0);
      const bomb = {
        id: makeBombId(),
        x: bx,
        y: gy + 0.9 * myScale,
        z: bz,
        scale: myScale,
        createdAt: Date.now(),
      };
      addDroppedBomb(bomb);
      st.setCarriedBomb(false);
      publishOnlineRaceEvent({ type: "bomb:carried", carried: false });
      publishOnlineRaceEvent({ type: "bomb:dropped", bomb });
    }
    // Roulette lock: the spun row resolves (bomb legacy path, instant
    // mini-boosts, or a carried slot) only when the animation stops.
    const pending = st.roulette;
    if (pending && now - pending.startedAt >= ROULETTE_MS) {
      st.setRoulette(null);
      const slot = rowToSlot(pending.type, now);
      if (slot.bomb) {
        st.setCarriedBomb(true);
        publishOnlineRaceEvent({ type: "bomb:carried", carried: true });
      } else if (slot.type === "skid" || slot.type === "wind") {
        fireMiniBoost();
      } else {
        st.setCarriedItem(slot);
        publishCarried(slot);
      }
    }

    // Mushroom-family use. Singles/triples fire on edge; golden re-fires
    // while held (GOLDEN_REUSE_MS) and expires on the performance.now clock.
    // Edge is computed BEFORE dropHeldRef updates below. Spin-out blocks
    // every use; presses closer than minUseGapMs are ignored (§10.6).
    const spinning = spinningNow;
    // Bullet Bill active: no item use at all, slot kept (§10.6).
    const myBulletRide =
      st.bulletRide &&
      st.bulletRide.ownerId === myRacerId() &&
      bulletActive(st.bulletRide, now);
    const edgeDown =
      dropDown && !dropHeldRef.current && !spinning && !myBulletRide && gapOk;
    const heldItem = st.carriedItem;
    if (edgeDown && (st.carriedBomb || heldItem)) lastUseAt = now;
    if (heldItem && heldItem.type === "red") {
      if (edgeDown) queueRedThrow(Boolean(keys?.backward), now);
    } else if (heldItem && heldItem.type === "blue") {
      if (edgeDown) queueBlueThrow(now);
    } else if (heldItem && heldItem.type === "bullet") {
      if (edgeDown) queueBulletRide(now);
    } else if (heldItem && heldItem.type === "blooper") {
      if (edgeDown) fireBlooper();
    } else if (
      heldItem &&
      (heldItem.type === "mushroom" || heldItem.type === "golden")
    ) {
      if (heldItem.type === "golden" && now >= heldItem.windowUntil) {
        st.setCarriedItem(null);
        publishCarried(null);
      } else if (heldItem.type === "golden") {
        if (
          dropDown &&
          !spinning &&
          !myBulletRide &&
          refireAllowed(goldenLastRef.current, now, itemConfig.golden.minGapMs)
        ) {
          goldenLastRef.current = now;
          fireBoostItem(useGameStore.getState().carriedItem);
        }
      } else if (edgeDown) {
        fireBoostItem(heldItem);
      }
    }

    dropHeldRef.current = dropDown;

    // Release-time spawns: committed presses materialize at release.
    const due = st.pendingSpawns.filter((p) => spawnDue(p, now));
    if (due.length > 0) {
      st.setPendingSpawns(st.pendingSpawns.filter((p) => !spawnDue(p, now)));
      for (const p of due) {
        if (p.kind === "red") fireRedShell(p.backward);
        else if (p.kind === "blue") fireBlueShell();
        else if (p.kind === "bullet") startBulletRide();
      }
    }

    // Live bombs explode when the kart touches them (after arm time).
    for (const bomb of [...st.droppedBombs]) {
      if (bombAgeMs(bomb, now) < BOMB_ARM_SECONDS * 1000) continue;
      const d = Math.hypot(px - bomb.x, pz - bomb.z);
      if (d < triggerRadius) triggerBombExplosion(bomb, { broadcast: true });
    }
    // Bullet Bill expiry (owner ends with a hop) + knock detection.
    // Only the owner's client detects knocks; victims apply on receipt.
    // Knocks run during the full ride only — never on the ramp.
    const ride = st.bulletRide;
    if (ride && ride.endingUntil && now >= ride.endingUntil) {
      st.setBulletRide(null);
    } else if (ride && !bulletActive(ride, now) && !ride.endingUntil) {
      endBulletRide(true);
    } else if (ride && ride.ownerId === myRacerId() && bulletActive(ride, now)) {
      if (knockedRef.current.rideId !== ride.rideId) {
        knockedRef.current = { rideId: ride.rideId, ids: new Set() };
      }
      const orsRide = useOnlineRaceStore.getState();
      for (const [id, r] of Object.entries(orsRide.remoteRacers)) {
        const d = Math.hypot(px - (Number(r?.x) || 0), pz - (Number(r?.z) || 0));
        if (d < BULLET_KNOCK_RADIUS && !knockedRef.current.ids.has(id)) {
          knockedRef.current.ids.add(id);
          publishOnlineRaceEvent({
            type: "bullet:knock",
            rideId: ride.rideId,
            victimId: id,
          });
        }
      }
    }

    // Blooper squirt visual expires after ~1s.
    if (st.blooperSquirt && now >= st.blooperSquirt.until) {
      st.setBlooperSquirt(null);
    }

    // Homing shells: every client moves every shell the same way (owner and
    // remotes share constants); ONLY the owner detects hits and broadcasts.
    if (st.activeShells.length > 0) {
      const step = Math.min(delta, 0.05);
      const me = myRacerId();
      const ors = useOnlineRaceStore.getState();
      const victims = [
        { id: me, x: px, z: pz },
        ...Object.entries(ors.remoteRacers).map(([id, r]) => ({
          id,
          x: Number(r?.x) || 0,
          z: Number(r?.z) || 0,
        })),
      ];
      const next = [];
      for (const shell of st.activeShells) {
        const life =
          shell.kind === "blue" ? BLUE_LIFE_MS : itemConfig.redShell.lifetimeMs;
        if (now - shell.at >= life) continue;
        if (shell.kind === "blue") {
          // Stable re-target: switch only on laps-greater or +5 dist, so ties
          // never flap the target (and the alarm) every frame.
          const orsB = useOnlineRaceStore.getState();
          const rows = victims.map((v) => ({
            id: v.id,
            laps:
              v.id === me
                ? Array.isArray(useGameManager.getState().lapTimes)
                  ? useGameManager.getState().lapTimes.length
                  : 0
                : Number(orsB.remoteRaceProgress[v.id]?.completedLaps) || 0,
            dist:
              v.id === me
                ? useGameStore.getState().selfDistance || 0
                : orsB.remoteDistances[v.id] || 0,
          }));
          const leaderId = retargetBlue(shell.targetId, rows);
          if (leaderId !== shell.targetId) shell.targetId = leaderId;
          // Leader gone or finished → fizzle (alarm stops via explode).
          // Self-targets finish locally: remoteRaceProgress never holds self.
          const leader = victims.find((v) => v.id === shell.targetId);
          const leaderProg = ors.remoteRaceProgress[shell.targetId];
          const selfDone =
            shell.targetId === me && useGameManager.getState().gameOver;
          if (!leader || leaderProg?.finished || selfDone) {
            if (shell.owner) {
              publishOnlineRaceEvent({
                type: "blue:explode",
                x: shell.x,
                y: shell.y,
                z: shell.z,
                fizzle: true,
              });
            }
            continue;
          }
          const dxl = leader.x - shell.x;
          const dzl = leader.z - shell.z;
          const distXZ = Math.hypot(dxl, dzl) || 1;
          const diving =
            shell.phase === "drop" ||
            blueShouldDive({ distXZ, flightMs: now - shell.at });
          const phase = diving ? "drop" : "fly";
          let moved;
          if (phase === "fly") {
            const top = Number(shell.top) || shell.y;
            moved = {
              ...shell,
              phase,
              x: shell.x + (dxl / distXZ) * BLUE_SPEED * step,
              y: shell.y + (top - shell.y) * Math.min(1, 2 * step),
              z: shell.z + (dzl / distXZ) * BLUE_SPEED * step,
            };
          } else {
            const ground = st.groundPosition ?? shell.top - BLUE_FLY_HEIGHT;
            moved = { ...shell, phase, y: shell.y - 45 * step };
            if (moved.y <= ground) {
              // Bullet-immune target: harmless pop, nobody spins.
              const targetRide =
                shell.targetId === me
                  ? st.bulletRide
                  : ors.remoteRacers[shell.targetId]?.bulletRide;
              const immune =
                targetRide && bulletActive(targetRide, now);
              if (shell.owner) {
                publishOnlineRaceEvent({
                  type: "blue:explode",
                  x: moved.x,
                  y: ground,
                  z: moved.z,
                  fizzle: Boolean(immune),
                });
                if (immune) {
                  applyShellStun({
                    x: moved.x, y: ground, z: moved.z,
                    shellId: shell.id, scale: 0.5, soft: true, stun: false,
                  });
                } else {
                  const hitIds = resolveBlueBlast(victims, {
                    x: moved.x,
                    z: moved.z,
                  });
                  if (hitIds.includes(me) && raceLive() && myVulnerable(now)) {
                    applyShellStun({
                      x: moved.x,
                      y: ground,
                      z: moved.z,
                      shellId: shell.id,
                      scale: 1.2,
                      heavy: true,
                    });
                  }
                }
              }
              continue;
            }
          }
          next.push(moved);
          continue;
        }
        let { dx, dz } = shell;
        let bounces = shell.bounces ?? itemConfig.redShell.maxBounces;
        // Homing steers only with a live target; backward/untargeted fly straight.
        if (shell.homing && shell.targetId) {
          const target = victims.find((v) => v.id === shell.targetId);
          if (target) {
            const steered = steerShell({
              dir: { x: dx, z: dz },
              toTarget: { x: target.x - shell.x, z: target.z - shell.z },
              maxTurn: RED_MAX_TURN,
              dt: step,
            });
            dx = steered.x;
            dz = steered.z;
          }
        }
        const shellSpeed =
          itemConfig.redShell.speedMult * kartSettings.speed.max;
        const moved = {
          ...shell,
          x: shell.x + dx * shellSpeed * step,
          y: cruiseSettle(shell.y, shell.cruiseY ?? shell.y, step),
          z: shell.z + dz * shellSpeed * step,
          dx,
          dz,
        };
        // Wall bounce (up to maxBounces, then the shell drops).
        const wallN = wallHitNormal(moved.x, moved.z, st.wallSegments, 1);
        if (wallN) {
          const bounced = bounceShell({ x: dx, z: dz }, wallN, bounces);
          if (!bounced) continue;
          moved.dx = bounced.dx;
          moved.dz = bounced.dz;
          moved.bounces = bounced.left;
        }
        if (shell.owner) {
          // First racer TOUCHED (nearest in radius), owner grace 0.5 s.
          let hit = null;
          let hitDist = Infinity;
          for (const v of victims) {
            if (v.id === me && now - shell.at < itemConfig.redShell.ownerGraceMs) {
              continue;
            }
            const d = Math.hypot(v.x - moved.x, v.z - moved.z);
            if (d < RED_HIT_RADIUS && d < hitDist) {
              hit = v;
              hitDist = d;
            }
          }
          if (hit) {
            publishOnlineRaceEvent({
              type: "shell:hit",
              shellId: shell.id,
              victimId: hit.id,
              x: moved.x,
              y: moved.y,
              z: moved.z,
            });
            if (hit.id === me) {
              // Triple orbit absorbs instead of spinning (matrix §4.3).
              if (raceLive() && myVulnerable(now) && !absorbWithOrbit("red")) {
                applyShellStun({ x: moved.x, y: moved.y, z: moved.z, shellId: shell.id, soft: true });
              }
            } else {
              // Owner-side visual only (soft + no stun — the victim applies
              // their own precise stun on receipt).
              applyShellStun({ x: moved.x, y: moved.y, z: moved.z, shellId: shell.id, soft: true, stun: false });
            }
            continue;
          }
        }
        next.push(moved);
      }
      if (next.length !== st.activeShells.length) st.setActiveShells(next);
      else if (next.some((s, i) => s.x !== st.activeShells[i].x)) {
        st.setActiveShells(next);
      }
    }

    void delta;
  });

  return (
    <>
      {itemBoxes.map(
        (b) =>
          b.active && (
            <group
              key={b.id}
              ref={(g) => {
                if (g) boxNodesRef.current.set(b.id, g);
                else boxNodesRef.current.delete(b.id);
              }}
              position={[b.x, b.y, b.z]}
            >
              <group scale={boxVisualScale}>
                <ItemBoxModel />
              </group>
            </group>
          )
      )}
      {droppedBombs.map((b) => (
        <group key={b.id} position={[b.x, b.y, b.z]} scale={0.75 * (b.scale ?? 1)}>
          <BombModel />
        </group>
      ))}
      {activeShells.map((s) => (
        <group key={s.id} position={[s.x, s.y, s.z]}>
          {s.kind === "red" && <RedShellModel />}
          {s.kind === "blue" && <BlueShellModel />}
        </group>
      ))}
      {activeShells
        .filter((s) => s.kind === "blue")
        .map((s) => (
          <BlueTargetRing key={`ring-${s.id}`} shell={s} />
        ))}
      {blooperSquirt && (
        <group position={[blooperSquirt.x, blooperSquirt.y, blooperSquirt.z]}>
          {/* Cast moment = full size (1.95u vs 0.84u held → ×2.3). */}
          <BlooperModel scale={2.3} />
        </group>
      )}
      {explosions.map((e) => (
        <ExplosionFx key={e.id} data={e} />
      ))}
    </>
  );
}

useGLTF.preload("./models/mario-circuit-test-transformed.glb");

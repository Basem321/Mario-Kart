import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF, useTexture, useKeyboardControls } from "@react-three/drei";
import * as THREE from "three";
import { useGameStore } from "./store";
import { useOnlineRaceStore } from "./onlineRaceStore";
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
  cruiseSettle,
  inkUntil,
  nearestAhead,
  resolveBlueBlast,
  steerShell,
  targetsAhead,
} from "./items/homing";
import { leaderOf } from "./items/itemWeights";
import {
  canGrant,
  consumeUse,
  makeCarriedItem,
  rollItem,
} from "./items/itemWeights";
import {
  publishOnlineRaceEvent,
  subscribeOnlineRaceEvents,
} from "./onlineRaceTransport";
import { useGameManager } from "./gameManager";
import { getMergedRoadGeometry, getTrack } from "./tracks";
import { sampleBlackRoadPoint, trackConfigToTransform } from "./trackRoad";

const BOX_COUNT = 3;
const PICKUP_RADIUS = 2.6;
const BOMB_ARM_SECONDS = 1.0;
const BOMB_TRIGGER_RADIUS = 3.4;
const RESPAWN_SECONDS = 25;
const EXPLOSION_LIFE = 1.05;

const snapRaycaster = new THREE.Raycaster();
const downDir = new THREE.Vector3(0, -1, 0);
let nextId = 1;

const bombExplosionId = (bombId) => `explosion-${String(bombId)}`;

// Local standing for the item roulette. Solo = 1 of 1. Online mirrors the
// leaderboard inputs (completed laps) without subscribing the canvas loop.
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
  const localCompleted = Array.isArray(gm.lapTimes) ? gm.lapTimes.length : 0;
  let ahead = 0;
  for (const p of gm.onlinePlayers) {
    if (p.id === gm.onlineSelfId) continue;
    const c = Number(ors.remoteRaceProgress[p.id]?.completedLaps) || 0;
    if (c > localCompleted) ahead += 1;
  }
  return {
    position: ahead + 1,
    totalRacers: gm.onlinePlayers.length,
    hasOpponents: gm.onlinePlayers.length > 1,
    hasOpponentsAhead: ahead > 0,
  };
};

const GOLDEN_REUSE_MS = 1200;

// Fire one boost from a carried mushroom-family item. Boosts ride the exact
// pad channel PlayerController already listens to (mario-kart:boost).
const fireBoostItem = (item) => {
  const st = useGameStore.getState();
  const r = consumeUse({ item, now: performance.now() });
  if (r.boosted) {
    window.dispatchEvent(
      new CustomEvent("mario-kart:boost", {
        detail: { duration: 1.8, speed: 62, launchVy: 4 },
      })
    );
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
  publishOnlineRaceEvent({
    type: "item:carried",
    itemType: r.item ? r.item.type : null,
  });
};

const myRacerId = () => useGameManager.getState().onlineSelfId ?? "local";

const shellHitFxId = (shellId) => `shellhit-${String(shellId)}`;

// Stun the LOCAL kart from a shell hit + small burst. Remote victims apply
// this themselves when their shell:hit arrives (owner never stuns remotes).
const applyShellStun = ({ x, y, z, shellId, scale = 0.6, soft = false, stun = true }) => {
  const st = useGameStore.getState();
  if (stun) st.setStunUntil(performance.now() + RED_STUN_MS);
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
  if (String(event?.victimId ?? "") === myRacerId() && shell) {
    applyShellStun({ x: shell.x, y: shell.y, z: shell.z, shellId, soft: true });
  }
};

const fireRedShell = () => {
  const st = useGameStore.getState();
  const gm = useGameManager.getState();
  const playerPos = st.playerPosition;
  if (!playerPos) return false;
  const ry = st.playerRotationY || 0;
  const fx = -Math.sin(ry);
  const fz = -Math.cos(ry);
  const me = myRacerId();
  const gy = st.groundPosition ?? playerPos.y ?? 0;

  let targetId = null;
  if (gm.isOnlineRace) {
    const ors = useOnlineRaceStore.getState();
    const racers = Object.entries(ors.remoteRacers).map(([id, r]) => ({
      id,
      x: Number(r?.x) || 0,
      z: Number(r?.z) || 0,
      laps: Number(ors.remoteRaceProgress[id]?.completedLaps) || 0,
    }));
    const localCompleted = Array.isArray(gm.lapTimes) ? gm.lapTimes.length : 0;
    const target = nearestAhead(
      { id: me, x: playerPos.x, z: playerPos.z, laps: localCompleted, fx, fz },
      racers
    );
    targetId = target ? target.id : null;
  }

  const shell = {
    id: `shell-${me}-${Date.now().toString(36)}`,
    kind: "red",
    x: playerPos.x + fx * 2,
    y: gy + 0.9 + 1.2,
    z: playerPos.z + fz * 2,
    cruiseY: gy + 0.9,
    dx: fx,
    dz: fz,
    targetId,
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
      kind: "red",
      x: shell.x,
      y: shell.y,
      z: shell.z,
      dx: shell.dx,
      dz: shell.dz,
      targetId,
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
  };
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

const endBulletRide = (hop = true) => {  const st = useGameStore.getState();
  if (!st.bulletRide) return;
  const ownerId = st.bulletRide.ownerId;
  st.setBulletRide(null);
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
  const rows = [{ id: me, laps: localCompleted, finished: false }];
  for (const [id, p] of Object.entries(ors.remoteRaceProgress)) {
    rows.push({
      id,
      laps: Number(p?.completedLaps) || 0,
      finished: Boolean(p?.finished),
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

export function ItemBoxes() {
  const selectedTrackId = useGameManager((s) => s.selectedTrackId);
  const activeTrack = getTrack(selectedTrackId);
  const { nodes } = useGLTF(activeTrack.glb);
  const scene = useThree((s) => s.scene);
  const [, getKeys] = useKeyboardControls();
  const collidersRef = useRef(null);
  const boxNodesRef = useRef(new Map());
  const dropHeldRef = useRef(false);
  const goldenLastRef = useRef(0);
  const knockedRef = useRef({ rideId: null, ids: new Set() });
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

        if (event.type === "shell:hit" && event.shellId) {
          onRemoteShellHit(event);
          return;
        }

        if (event.type === "blue:incoming" && event.leaderId) {
          // Alarm loops ONLY on the targeted client, per spec.
          if (event.leaderId === myRacerId()) startBlueAlarm();
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
          if (event.victimId === myRacerId()) {
            const p = useGameStore.getState().playerPosition;
            applyShellStun({
              x: p?.x ?? 0,
              y: p?.y ?? 0,
              z: p?.z ?? 0,
              shellId: `knock-${event.rideId}`,
              scale: 0.8,
              soft: true,
            });
          }
          return;
        }

        if (event.type === "blooper:ink" && Array.isArray(event.targetIds)) {
          if (event.targetIds.includes(myRacerId())) {
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
            if (
              p2 &&
              resolveBlueBlast([{ id: me2, x: p2.x, z: p2.z }], event).includes(me2)
            ) {
              applyShellStun({
                x: event.x,
                y: event.y,
                z: event.z,
                shellId: `blue-${event.x}-${event.z}`,
                scale: 1.2,
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

  // Initial spawn.
  useEffect(() => {
    if (useGameStore.getState().itemBoxes.length > 0) return;
    const spots = [];
    for (let i = 0; i < BOX_COUNT; i++) {
      const s = randomBoxSpot();
      if (s) spots.push({ id: nextId++, ...s, active: true, respawnAt: 0 });
    }
    if (spots.length > 0) useGameStore.getState().setItemBoxes(spots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, scene, selectedTrackId]);

  // Blue alarm is module-level audio: always stop on unmount (exit) so it
  // never loops into the menu or the next race.
  useEffect(() => () => stopBlueAlarm(), []);

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
      canGrant({ carriedBomb: st.carriedBomb, carriedItem: st.carriedItem })
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
            st.setCarriedItem(
              makeCarriedItem(rollItem(getStanding()), now)
            );
            publishOnlineRaceEvent({
              type: "item:carried",
              itemType: useGameStore.getState().carriedItem?.type ?? null,
            });
          }
          st.setItemBoxes(
            st.itemBoxes.map((o) =>
              o.id === b.id
                ? { ...o, active: false, respawnAt: now + RESPAWN_SECONDS * 1000 }
                : o
            )
          );
          break;
        }
      }
    }

    // Respawn collected boxes.
    let needsRespawn = false;
    const next = st.itemBoxes.map((b) => {
      if (!b.active && b.respawnAt > 0 && now >= b.respawnAt) {
        const s = randomBoxSpot();
        needsRespawn = true;
        if (s) return { ...b, ...s, active: true, respawnAt: 0 };
        return { ...b, respawnAt: now + 2000 };
      }
      return b;
    });
    if (needsRespawn) st.setItemBoxes(next);

    // Drop with G or E (edge trigger).
    const keys = getKeys();
    const dropDown = Boolean(keys?.dropBomb || keys?.useItem);
    if (dropDown && !dropHeldRef.current && st.carriedBomb) {
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
    // Mushroom-family use. Singles/triples fire on edge; golden re-fires
    // while held (GOLDEN_REUSE_MS) and expires on the performance.now clock.
    // Edge is computed BEFORE dropHeldRef updates below.
    const edgeDown = dropDown && !dropHeldRef.current;
    const heldItem = st.carriedItem;
    if (heldItem && heldItem.type === "red") {
      if (edgeDown) fireRedShell();
    } else if (heldItem && heldItem.type === "blue") {
      if (edgeDown) fireBlueShell();
    } else if (heldItem && heldItem.type === "bullet") {
      if (edgeDown) startBulletRide();
    } else if (heldItem && heldItem.type === "blooper") {
      if (edgeDown) fireBlooper();
    } else if (
      heldItem &&
      (heldItem.type === "mushroom" ||
        heldItem.type === "triple" ||
        heldItem.type === "golden")
    ) {
      if (heldItem.type === "golden" && now >= heldItem.expiresAt) {
        st.setCarriedItem(null);
        publishOnlineRaceEvent({ type: "item:carried", itemType: null });
      } else if (heldItem.type === "golden") {
        if (dropDown && now - goldenLastRef.current >= GOLDEN_REUSE_MS) {
          goldenLastRef.current = now;
          fireBoostItem(useGameStore.getState().carriedItem);
        }
      } else if (edgeDown) {
        fireBoostItem(heldItem);
      }
    }

    dropHeldRef.current = dropDown;

    // Live bombs explode when the kart touches them (after arm time).
    for (const bomb of [...st.droppedBombs]) {
      if (bombAgeMs(bomb, now) < BOMB_ARM_SECONDS * 1000) continue;
      const d = Math.hypot(px - bomb.x, pz - bomb.z);
      if (d < triggerRadius) triggerBombExplosion(bomb, { broadcast: true });
    }

    // Bullet Bill expiry (owner ends with a hop) + knock detection.
    // Only the owner's client detects knocks; victims apply on receipt.
    const ride = st.bulletRide;    if (ride && !bulletActive(ride, now)) {
      endBulletRide(true);
    } else if (ride && ride.ownerId === myRacerId()) {
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
        const life = shell.kind === "blue" ? BLUE_LIFE_MS : RED_LIFE_MS;
        if (now - shell.at >= life) continue;
        if (shell.kind === "blue") {
          // Leader gone or finished → fizzle (alarm stops via explode).
          const leader = victims.find((v) => v.id === shell.targetId);
          const leaderProg = ors.remoteRaceProgress[shell.targetId];
          if (!leader || leaderProg?.finished) {
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
          const phase = shell.phase === "drop" || distXZ < 4 ? "drop" : "fly";
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
              if (shell.owner) {
                publishOnlineRaceEvent({
                  type: "blue:explode",
                  x: moved.x,
                  y: ground,
                  z: moved.z,
                  fizzle: false,
                });
                const hitIds = resolveBlueBlast(victims, {
                  x: moved.x,
                  z: moved.z,
                });
                if (hitIds.includes(me)) {
                  applyShellStun({
                    x: moved.x,
                    y: ground,
                    z: moved.z,
                    shellId: shell.id,
                    scale: 1.2,
                  });
                }
              }
              continue;
            }
          }
          next.push(moved);
          continue;
        }
        let { dx, dz } = shell;
        if (shell.targetId) {
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
        const moved = {
          ...shell,
          x: shell.x + dx * RED_SPEED * step,
          y: cruiseSettle(shell.y, shell.cruiseY ?? shell.y, step),
          z: shell.z + dz * RED_SPEED * step,
          dx,
          dz,
        };
        if (shell.owner) {
          const hit = victims.find(
            (v) => Math.hypot(v.x - moved.x, v.z - moved.z) < RED_HIT_RADIUS
          );
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
              applyShellStun({ x: moved.x, y: moved.y, z: moved.z, shellId: shell.id, soft: true });
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
      {blooperSquirt && (
        <group position={[blooperSquirt.x, blooperSquirt.y, blooperSquirt.z]}>
          <BlooperModel />
        </group>
      )}
      {explosions.map((e) => (
        <ExplosionFx key={e.id} data={e} />
      ))}
    </>
  );
}

useGLTF.preload("./models/mario-circuit-test-transformed.glb");

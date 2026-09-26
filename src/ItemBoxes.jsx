import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF, useTexture, useKeyboardControls } from "@react-three/drei";
import * as THREE from "three";
import { useGameStore } from "./store";
import { ItemBoxModel, BombModel } from "./models/Pickups";
import {
  publishOnlineRaceEvent,
  subscribeOnlineRaceEvents,
} from "./onlineRaceTransport";
import { useGameManager } from "./gameManager";
import { getBlackRoadGeometry, sampleBlackRoadPoint } from "./trackRoad";

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

  st.setDroppedBombs([
    ...st.droppedBombs,
    {
      id,
      x: bomb.x,
      y: bomb.y,
      z: bomb.z,
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
    if (pointsMatRef.current) pointsMatRef.current.opacity = fade * 0.9;
    if (flashRef.current) {
      // Small flash on purpose: a big additive sphere swallows the camera
      // and turns the whole screen white.
      const s = 1 + (t / EXPLOSION_LIFE) * 3;
      flashRef.current.scale.set(s, s, s);
    }
    if (flashMatRef.current) flashMatRef.current.opacity = fade * 0.4;
    if (lightRef.current) lightRef.current.intensity = fade * 45;
  });

  return (
    <group position={[data.x, data.y + 1, data.z]}>
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
      <pointLight ref={lightRef} color="#ffb14e" intensity={45} distance={22} decay={2} />
    </group>
  );
}

export function ItemBoxes() {
  const { nodes } = useGLTF("./models/mario-circuit-test-transformed.glb");
  const scene = useThree((s) => s.scene);
  const [, getKeys] = useKeyboardControls();
  const collidersRef = useRef(null);
  const boxNodesRef = useRef(new Map());
  const dropHeldRef = useRef(false);
  const tickAudioRef = useRef(null);
  const blackRoadGeometry = getBlackRoadGeometry(nodes);

  const itemBoxes = useGameStore((s) => s.itemBoxes);
  const droppedBombs = useGameStore((s) => s.droppedBombs);
  const explosions = useGameStore((s) => s.explosions);
  const carriedBomb = useGameStore((s) => s.carriedBomb);

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
            },
            { broadcast: false },
          );
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
    // Sample the actual Object_24 black-road triangles. The prior bounding
    // box + general ground ray could resolve to grass, barriers or scenery.
    const point = sampleBlackRoadPoint(blackRoadGeometry);
    return point ? { x: point.x, y: point.y + 1.1, z: point.z } : null;
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
  }, [nodes, scene]);

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

    // Spin + bob living boxes.
    for (const b of st.itemBoxes) {
      const g = boxNodesRef.current.get(b.id);
      if (!g || !b.active) continue;
      g.rotation.y = t * 2 + b.id;
      g.position.y = b.y + Math.sin(t * 2.2 + b.id * 1.7) * 0.3;
    }

    if (!playerPos) return;
    const px = playerPos.x;
    const pz = playerPos.z;

    // Pickup.
    if (!st.carriedBomb) {
      for (const b of st.itemBoxes) {
        if (!b.active) continue;
        const d = Math.hypot(px - b.x, pz - b.z);
        if (d < PICKUP_RADIUS) {
          st.setCarriedBomb(true);
          try {
            const rawVol = Number(useGameManager.getState().sfxVolume);
            const vol = Number.isFinite(rawVol) ? Math.max(0, Math.min(1, rawVol)) : 0.7;
            const pickup = new Audio("./music/collecting_box.mp3");
            pickup.volume = vol;
            pickup.play().catch(() => {});
          } catch {
            // ignore — audio must never break the pickup loop
          }
          publishOnlineRaceEvent({ type: "bomb:carried", carried: true });
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
      const fx = -Math.sin(ry);
      const fz = -Math.cos(ry);
      const bx = px - fx * 2.6;
      const bz = pz - fz * 2.6;
      const gy = snapToGround(bx, bz) ?? (st.groundPosition ?? 0);
      const bomb = {
        id: makeBombId(),
        x: bx,
        y: gy + 0.9,
        z: bz,
        createdAt: Date.now(),
      };
      addDroppedBomb(bomb);
      st.setCarriedBomb(false);
      publishOnlineRaceEvent({ type: "bomb:carried", carried: false });
      publishOnlineRaceEvent({ type: "bomb:dropped", bomb });
    }
    dropHeldRef.current = dropDown;

    // Live bombs explode when the kart touches them (after arm time).
    for (const bomb of [...st.droppedBombs]) {
      if (bombAgeMs(bomb, now) < BOMB_ARM_SECONDS * 1000) continue;
      const d = Math.hypot(px - bomb.x, pz - bomb.z);
      if (d < BOMB_TRIGGER_RADIUS) triggerBombExplosion(bomb, { broadcast: true });
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
              <ItemBoxModel />
            </group>
          )
      )}
      {droppedBombs.map((b) => (
        <group key={b.id} position={[b.x, b.y, b.z]} scale={0.75}>
          <BombModel />
        </group>
      ))}
      {explosions.map((e) => (
        <ExplosionFx key={e.id} data={e} />
      ))}
    </>
  );
}

useGLTF.preload("./models/mario-circuit-test-transformed.glb");

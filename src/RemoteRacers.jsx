import { useEffect, useRef } from "react";
import { useGLTF, useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { MathUtils, Vector3 } from "three";
import { getOnlineSpawnSlot } from "./constants";
import { getTrack } from "./tracks";
import { useGameManager } from "./gameManager";
import { Driver } from "./models/Driver";
import { BulletModel } from "./models/Pickups";
import { HeldItems } from "./models/HeldItems.jsx";
import { remoteBulletActive, remoteSpinning } from "./items/homing.js";
import { animBlend, animDur, animLive, animT, bodyPose, spinPose } from "./items/animCurves.js";
import { itemConfig } from "./items/itemConfig.js";
import VFXEmitter from "./wawa-vfx/VFXEmitter.tsx";
import { KartDust } from "./models/KartDust.jsx";
import { RemoteDriftFX } from "./RemoteDriftFX.jsx";
import { dropRemoteFxSource, getRemoteFxSource } from "./remoteFx";
import { isRacerTargetable, useOnlineRaceStore } from "./onlineRaceStore";

const smoothAngle = (from, to, lambda, delta) => {
  const difference = MathUtils.euclideanModulo(to - from + Math.PI, Math.PI * 2) - Math.PI;
  return from + difference * (1 - Math.exp(-lambda * delta));
};

const RemoteKart = ({ player, playerIndex }) => {
  const { nodes, materials } = useGLTF("/models/kart.glb");
  const remoteState = useOnlineRaceStore((state) => state.remoteRacers[player.id]);
  // Replicated spin visuals (v3 §10.7 + 2.2 #11): computed from the RECEIPT
  // clock (animRecvAt, stamped in setRemoteRacer), never the sender wall
  // clock. Held items hide during the spin.
  const remoteAnim = remoteState?.anim;
  const spinningNow = remoteSpinning(remoteAnim, remoteState?.animRecvAt, performance.now());
  // Lost bullet:end heals itself (2.2 #13): the ride counts as ended after
  // until + rampOutMs + 1000 (until was anchored at receipt).
  const remoteRideActive = remoteBulletActive(remoteState?.bulletRide, performance.now());
  const wasSpinningRef = useRef(false);
  const selectedTrackId = useGameManager((state) => state.selectedTrackId);
  const kartRef = useRef(null);
  const visualRef = useRef(null);
  const driverGroupRef = useRef(null);
  // Last seen carried slot: mirrors the local ghost so the follow-through
  // keeps showing the item after the release publish clears the slot.
  const ghostCacheRef = useRef(null);
  const spawnSlot = getOnlineSpawnSlot(playerIndex, getTrack(selectedTrackId));
  // Replicated item anim from the receipt clock (T6 §3.2).
  const remoteAnimState = {
    name: remoteState?.anim ?? "drive",
    start: remoteState?.animRecvAt ?? 0,
    totalMs: animDur(remoteState?.anim),
  };
  const starsTex = useTexture("/textures/stars.png");
  const bodyMeshRef = useRef(null);
  const steerWheelRef = useRef(null);
  const frontWheelsRef = useRef(null);
  const wheelRefs = useRef([null, null, null, null]);
  const rearLRef = useRef(null);
  const rearRRef = useRef(null);
  const flameLRef = useRef(null);
  const flameRRef = useRef(null);
  const smokeLRef = useRef(null);
  const smokeRRef = useRef(null);
  const starsGroupRef = useRef(null);
  const smokeOnRef = useRef(null);
  // Smoothed values mirroring the local kart (drift yaw, steering).
  const driftYawRef = useRef(0);
  const steerRef = useRef(0);
  // Dust at the wheels (same component as the local kart; the flag per wheel
  // comes from the racer's published onDirt).
  const dustWheelStates = useRef([
    { position: new Vector3(-0.7, -0.2, 0.7), shouldEmit: false },
    { position: new Vector3(0.7, -0.2, 0.7), shouldEmit: false },
    { position: new Vector3(-0.77, -0.137, -0.7), shouldEmit: false },
    { position: new Vector3(0.77, -0.137, -0.7), shouldEmit: false },
  ]);

  // Effect anchors published for the shared flame / skid systems.
  useEffect(() => () => dropRemoteFxSource(player.id), [player.id]);

  useFrame((_, delta) => {
    // Expired remote ride clears locally (2.2 #13): a lost bullet:end can't
    // leave a kart stuck as a bullet forever.
    const rsRide = useOnlineRaceStore.getState().remoteRacers[player.id];
    if (rsRide?.bulletRide && !remoteBulletActive(rsRide.bulletRide, performance.now())) {
      useOnlineRaceStore.getState().setRemoteRacerBulletRide(player.id, null);
    }
    if (rsRide?.carriedItem) ghostCacheRef.current = rsRide.carriedItem;
    if (rsRide?.carriedBomb) ghostCacheRef.current = { bomb: true };
    const nowF = performance.now();
    const spd = Number(rsRide?.speed) || 0;
    const turn = Number(rsRide?.steer) || 0;
    const drift = Number(rsRide?.driftDir) || 0;
    const spinNow = remoteSpinning(rsRide?.anim, rsRide?.animRecvAt, nowF);
    const rideNow = remoteBulletActive(rsRide?.bulletRide, nowF);
    // Whole-driver throw/receive/use pose from the receipt clock.
    if (driverGroupRef.current) {
      const nowA = performance.now();
      const BASE_X = 0;
      const BASE_Y = 0.45;
      const BASE_Z = -0.1;
      if (animLive(remoteAnimState, nowA)) {
        const t = animT(remoteAnimState, nowA);
        const pose = bodyPose(remoteAnimState.name, t);
        const b = animBlend(t, remoteAnimState.totalMs);
        driverGroupRef.current.rotation.set(pose.pitch * b, pose.yaw * b, pose.roll * b);
        driverGroupRef.current.position.set(
          BASE_X + (pose.x ?? 0) * b,
          BASE_Y + (pose.y ?? 0) * b,
          BASE_Z + (pose.z ?? 0) * b
        );
      } else {
        // Steering lean + drift hang + speed tuck + idle vibe: same layers as
        // the local driver (models/Kart.jsx), fed by the published
        // steer / driftDir / speed.
        const D = Math.PI / 180;
        const spdRatio = Math.min(spd / 75, 1);
        const targetRoll = -turn * 20 * D + drift * 18 * D;
        const targetYaw = -turn * 12 * D + drift * 10 * D;
        const targetPitch = spdRatio * 10 * D;
        const g = driverGroupRef.current;
        g.rotation.x = MathUtils.damp(g.rotation.x, targetPitch, 8, delta);
        g.rotation.y = MathUtils.damp(g.rotation.y, targetYaw, 8, delta);
        g.rotation.z = MathUtils.damp(g.rotation.z, targetRoll, 8, delta);
        g.position.x = MathUtils.damp(g.position.x, BASE_X + (-turn * 0.07 + drift * 0.06), 8, delta);
        g.position.y = MathUtils.damp(g.position.y, BASE_Y + Math.sin(nowA / 300) * 0.012, 8, delta);
        g.position.z = MathUtils.damp(g.position.z, BASE_Z + spdRatio * 0.03, 8, delta);
      }
    }
    if (!kartRef.current || !visualRef.current) return;

    // Finished karts (parked at the line) and karts that stopped sending
    // (disconnected / backgrounded) are hidden instead of lingering as a
    // frozen ghost. Their last pose stays in the store for standings.
    kartRef.current.visible = rsRide ? isRacerTargetable(rsRide) : true;

    // Scalars instead of `{ ...fallback, ...remoteState }`: no per-frame
    // object allocation in useFrame (AGENTS.md perf rule). Falls back to the
    // spawn slot until the first network state arrives.
    const targetX = remoteState?.x ?? spawnSlot.position[0];
    const targetY = remoteState?.y ?? spawnSlot.position[1];
    const targetZ = remoteState?.z ?? spawnSlot.position[2];
    const targetRotationY = remoteState?.rotationY ?? spawnSlot.rotationY;
    const targetBodyY = remoteState?.bodyY ?? 0;
    // kartRef is the OUTER group: its position lives in the parent (world)
    // space, so damp it directly. (Only visualRef below is a child of the
    // scaled group and needs the rs conversion.)
    const rs = spawnSlot.kartScale ?? 1;

    kartRef.current.position.x = MathUtils.damp(kartRef.current.position.x, targetX, 14, delta);
    kartRef.current.position.y = MathUtils.damp(kartRef.current.position.y, targetY, 14, delta);
    kartRef.current.position.z = MathUtils.damp(kartRef.current.position.z, targetZ, 14, delta);
    kartRef.current.rotation.y = smoothAngle(kartRef.current.rotation.y, targetRotationY, 16, delta);
    // Remote spin uses the SAME yaw-only spinPose curve as the local kart
    // (progress from the receipt clock): light 540deg, heavy 720deg, hop.
    const heavyRemote = typeof remoteAnim === "string" && remoteAnim.includes("heavy");
    const spinTotal = heavyRemote ? itemConfig.hit.heavyMs : itemConfig.hit.lightMs;
    const spinP = spinningNow
      ? Math.max(0, Math.min(1, (performance.now() - Number(remoteState?.animRecvAt || 0)) / spinTotal))
      : 0;
    const spinPse = spinningNow ? spinPose(heavyRemote ? "heavy" : "light", spinP) : null;
    if (spinningNow && spinPse) {
      wasSpinningRef.current = true;
      visualRef.current.rotation.set(spinPse.pitch, Math.PI + spinPse.yaw, spinPse.roll);
    } else {
      wasSpinningRef.current = false;
      // Drift: the whole kart (and its particles) slides at +/-0.4 rad into
      // the drift, exactly like the local kart's drift yaw.
      driftYawRef.current = MathUtils.damp(driftYawRef.current, drift * 0.4, 4, delta);
      visualRef.current.rotation.set(0, Math.PI + driftYawRef.current, 0);
    }
    visualRef.current.position.y = MathUtils.damp(
      visualRef.current.position.y * rs,
      (Number.isFinite(targetBodyY) ? targetBodyY : 0) - 0.5,
      12,
      delta,
    ) / rs + (spinPse ? spinPse.hop : 0);

    // --- Mirrors of the local kart's visuals (models/Kart.jsx) ---------------
    // Wheel spin + steering (front wheels + steering wheel).
    const spin = spd * 0.6 * Math.min(delta, 0.1);
    for (let i = 0; i < 4; i++) {
      const w = wheelRefs.current[i];
      if (w) w.rotation.x += spin;
    }
    steerRef.current = MathUtils.damp(steerRef.current, turn, 4, delta);
    if (frontWheelsRef.current) frontWheelsRef.current.rotation.y = steerRef.current;
    if (steerWheelRef.current) steerWheelRef.current.rotation.y = steerRef.current * Math.PI * 4;

    // Hit-invulnerability blink (8 Hz) after a spin ends; bullet riders hide
    // the kart model entirely.
    const blinking = !spinNow && !rideNow && nowF < (Number(rsRide?.invulnUntilLocal) || 0);
    visualRef.current.visible =
      !rideNow && (!blinking || Math.floor(nowF / (1000 / 8 / 2)) % 2 === 0);

    // Dizzy stars while spinning out.
    if (starsGroupRef.current) {
      starsGroupRef.current.visible = spinNow;
      if (spinNow) {
        starsGroupRef.current.rotation.y += delta * 7;
        starsGroupRef.current.position.y = 1.35 + Math.sin(nowF / 90) * 0.08;
      }
    }

    // Exhaust smoke at low speed (same threshold as the local kart) and dust
    // on dirt.
    const smokeOn = spd <= 15;
    if (smokeOn !== smokeOnRef.current) {
      smokeOnRef.current = smokeOn;
      if (smokeOn) {
        smokeLRef.current?.startEmitting();
        smokeRRef.current?.startEmitting();
      } else {
        smokeLRef.current?.stopEmitting();
        smokeRRef.current?.stopEmitting();
      }
    }
    const dirty = rsRide?.onDirt === true && spd > 2;
    for (let i = 0; i < 4; i++) dustWheelStates.current[i].shouldEmit = dirty;

    // Anchors for the shared boost-flame and skid-mark systems.
    const fx = getRemoteFxSource(player.id);
    const visibleNow = kartRef.current.visible && !rideNow;
    fx.boosting = visibleNow && rsRide?.boosting === true;
    fx.drifting = visibleNow && drift !== 0 && !spinNow;
    if (fx.boosting && flameLRef.current && flameRRef.current) {
      flameLRef.current.getWorldPosition(fx.flameL);
      flameRRef.current.getWorldPosition(fx.flameR);
    }
    if (fx.drifting && rearLRef.current && rearRRef.current && bodyMeshRef.current) {
      rearLRef.current.getWorldPosition(fx.rearL);
      rearRRef.current.getWorldPosition(fx.rearR);
      bodyMeshRef.current.getWorldQuaternion(fx.quat);
    }
  });

  return (
    <group
      ref={kartRef}
      position={spawnSlot.position}
      rotation-y={spawnSlot.rotationY}
      scale={spawnSlot.kartScale ?? 1}
      name={`remote-racer-${player.id}`}
    >
      <group ref={visualRef} name="spinGroup" position-y={-0.5} rotation-y={Math.PI}>
        <mesh ref={bodyMeshRef} castShadow receiveShadow geometry={nodes.body.geometry} material={materials.m_Body}>
          <group position={[-0.77, 0, -0.7]} />
          <group position={[0.77, 0, -0.7]} />
          <group position={[0.7, 0, 0.7]} />
          <group position={[-0.7, 0, 0.7]} />
          {/* Rear wheel anchors for the shared skid-mark system. */}
          <group ref={rearLRef} position={[-0.77, -0.137, -0.7]} />
          <group ref={rearRRef} position={[0.77, -0.137, -0.7]} />
          <KartDust wheelStates={dustWheelStates.current} trackLocal={false} />
          <mesh
            ref={steerWheelRef}
            castShadow
            receiveShadow
            geometry={nodes.d_wheel.geometry}
            material={materials.m_Body}
            position={[0, 0.355, 0.542]}
            rotation={[-1.134, 0, 0]}
          />
          <mesh
            castShadow
            receiveShadow
            geometry={nodes.booster.geometry}
            material={materials.m_Body}
            position={[0, 0.25, -0.55]}
            rotation={[0.279, 0, 0]}
          />
          <group ref={driverGroupRef} position={[0, 0.45, -0.1]} scale={0.7}>
            <Driver character={player.driver ?? "mario"} />
          </group>
          {/* Shared held-item visuals (HeldItems) — same glove + orbit as the
              local kart, ghosted through throws from the cached slot. */}
          <HeldItems
            carriedItem={remoteState?.carriedItem}
            carriedBomb={remoteState?.carriedBomb}
            hidden={spinningNow}
            driver={player.driver ?? "mario"}
            anim={remoteAnimState}
            ghost={
              ghostCacheRef.current
                ? { item: ghostCacheRef.current, anim: remoteAnimState.name, start: remoteAnimState.start, totalMs: remoteAnimState.totalMs }
                : null
            }
          />
          {/* Dizzy stars while spun out (same as the local kart). */}
          <group ref={starsGroupRef} position={[0, 1.35, -0.1]} visible={false}>
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const a = (i / 6) * Math.PI * 2;
              return (
                <sprite
                  key={i}
                  position={[Math.cos(a) * 0.9, (i % 2) * 0.25, Math.sin(a) * 0.9]}
                  scale={[0.45, 0.45, 1]}
                >
                  <spriteMaterial map={starsTex} transparent depthWrite={false} />
                </sprite>
              );
            })}
          </group>
          {/* Exhaust anchors: boost flames spawn here and the idle smoke
              emitters ride on them, same spots as the local kart. */}
          <group ref={flameLRef} position={[0.5, 0.65, -1.5]} rotation-x={-Math.PI / 9}>
            <VFXEmitter
              ref={smokeLRef}
              emitter="smoke"
              settings={{
              duration: 0.02,
              delay: 0.1,
              nbParticles: 1,
              spawnMode: "time",
              loop: true,
              startPositionMin: [0, 0, 0],
              startPositionMax: [0, 0, 0],
              startRotationMin: [0, 0, -1],
              startRotationMax: [0, 0, 1],
              particlesLifetime: [0.2, 0.4],
              speed: [0.5, 1],
              colorStart: ["#ffffff"],
              directionMin: [-0.1, 0, 0],
              directionMax: [0.1, 0.01, 0.5],
              rotationSpeedMin: [0, 0, -1],
              rotationSpeedMax: [0, 0, 1],
              size: [0.5, 1],
            }}
            />
          </group>
          <group ref={flameRRef} position={[-0.5, 0.65, -1.5]} rotation-x={-Math.PI / 9}>
            <VFXEmitter
              ref={smokeRRef}
              emitter="smoke"
              settings={{
              duration: 0.02,
              delay: 0.1,
              nbParticles: 1,
              spawnMode: "time",
              loop: true,
              startPositionMin: [0, 0, 0],
              startPositionMax: [0, 0, 0],
              startRotationMin: [0, 0, -1],
              startRotationMax: [0, 0, 1],
              particlesLifetime: [0.2, 0.4],
              speed: [0.5, 1],
              colorStart: ["#ffffff"],
              directionMin: [-0.1, 0, 0],
              directionMax: [0.1, 0.01, 0.5],
              rotationSpeedMin: [0, 0, -1],
              rotationSpeedMax: [0, 0, 1],
              size: [0.5, 1],
            }}
            />
          </group>
        </mesh>
        <mesh
          ref={(el) => (wheelRefs.current[2] = el)}
          castShadow
          receiveShadow
          geometry={nodes.wheel_2.geometry}
          material={materials.m_Tire}
          position={[-0.77, -0.137, -0.7]}
          layers={1}
        />
        <mesh
          ref={(el) => (wheelRefs.current[3] = el)}
          castShadow
          receiveShadow
          geometry={nodes.wheel_3.geometry}
          material={materials.m_Tire}
          position={[0.77, -0.137, -0.7]}
          layers={1}
        />
        <group ref={frontWheelsRef}>
          <mesh
            ref={(el) => (wheelRefs.current[1] = el)}
            castShadow
            receiveShadow
            geometry={nodes.wheel_1.geometry}
            material={materials.m_Tire}
            position={[0.7, -0.2, 0.7]}
            layers={1}
          />
          <mesh
            ref={(el) => (wheelRefs.current[0] = el)}
            castShadow
            receiveShadow
            geometry={nodes.wheel_0.geometry}
            material={materials.m_Tire}
            position={[-0.7, -0.2, 0.7]}
            layers={1}
          />
        </group>
        {/* Drift glow / sparks / skate / trails, driven by the racer's
            published driftDir + driftPow (never the local player's store). */}
        <RemoteDriftFX playerId={player.id} />
      </group>

      {remoteRideActive && (
        <group rotation-y={Math.PI}>
          <BulletModel position={[0, 0.1, 0]} />
        </group>
      )}
    </group>
  );
};

export const RemoteRacers = () => {
  const isOnlineRace = useGameManager((state) => state.isOnlineRace);
  const selfId = useGameManager((state) => state.onlineSelfId);
  const players = useGameManager((state) => state.onlinePlayers);

  if (!isOnlineRace || !selfId || !players.length) return null;

  return players.map((player, playerIndex) => {
    if (player.id === selfId) return null;

    return <RemoteKart key={player.id} player={player} playerIndex={playerIndex} />;
  });
};

useGLTF.preload("/models/kart.glb");

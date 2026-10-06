import { useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { MathUtils } from "three";
import { getOnlineSpawnSlot } from "./constants";
import { getTrack } from "./tracks";
import { useGameManager } from "./gameManager";
import { Driver } from "./models/Driver";
import { BulletModel } from "./models/Pickups";
import { HeldItems } from "./models/HeldItems.jsx";
import { remoteBulletActive, remoteSpinning } from "./items/homing.js";


import { useOnlineRaceStore } from "./onlineRaceStore";

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
  const remoteSpinning = spinningNow;
  // Lost bullet:end heals itself (2.2 #13): the ride counts as ended after
  // until + rampOutMs + 1000 (until was anchored at receipt).
  const remoteRideActive = remoteBulletActive(remoteState?.bulletRide, performance.now());
  const wasSpinningRef = useRef(false);
  const selectedTrackId = useGameManager((state) => state.selectedTrackId);
  const kartRef = useRef(null);
  const visualRef = useRef(null);
  const spawnSlot = getOnlineSpawnSlot(playerIndex, getTrack(selectedTrackId));

  useFrame((_, delta) => {
    // Expired remote ride clears locally (2.2 #13): a lost bullet:end can't
    // leave a kart stuck as a bullet forever.
    const rsRide = useOnlineRaceStore.getState().remoteRacers[player.id];
    if (rsRide?.bulletRide && !remoteBulletActive(rsRide.bulletRide, performance.now())) {
      useOnlineRaceStore.getState().setRemoteRacerBulletRide(player.id, null);
    }
    if (!kartRef.current || !visualRef.current) return;

    const fallbackTarget = {
      x: spawnSlot.position[0],
      y: spawnSlot.position[1],
      z: spawnSlot.position[2],
      rotationY: spawnSlot.rotationY,
      bodyY: 0,
    };
    const target = { ...fallbackTarget, ...remoteState };
    // The outer group is scaled by kartScale, so network world positions
    // convert to local (at scale=1 this is exactly the old code).
    const rs = spawnSlot.kartScale ?? 1;

    kartRef.current.position.x = MathUtils.damp(kartRef.current.position.x * rs, target.x, 14, delta) / rs;
    kartRef.current.position.y = MathUtils.damp(kartRef.current.position.y * rs, target.y, 14, delta) / rs;
    kartRef.current.position.z = MathUtils.damp(kartRef.current.position.z * rs, target.z, 14, delta) / rs;
    kartRef.current.rotation.y = smoothAngle(kartRef.current.rotation.y, target.rotationY, 16, delta);
    if (remoteSpinning) {
      wasSpinningRef.current = true;
      visualRef.current.rotation.y += delta * 12;
    } else if (wasSpinningRef.current) {
      wasSpinningRef.current = false;
      visualRef.current.rotation.y = Math.PI;
    }
    visualRef.current.position.y = MathUtils.damp(
      visualRef.current.position.y * rs,
      (Number.isFinite(target.bodyY) ? target.bodyY : 0) - 0.5,
      12,
      delta,
    ) / rs;
  });

  return (
    <group
      ref={kartRef}
      position={spawnSlot.position}
      rotation-y={spawnSlot.rotationY}
      scale={spawnSlot.kartScale ?? 1}
      name={`remote-racer-${player.id}`}
    >
      <group ref={visualRef} position-y={-0.5} rotation-y={Math.PI} visible={!remoteRideActive}>
        <mesh castShadow receiveShadow geometry={nodes.body.geometry} material={materials.m_Body}>
          <group position={[-0.77, 0, -0.7]} />
          <group position={[0.77, 0, -0.7]} />
          <group position={[0.7, 0, 0.7]} />
          <group position={[-0.7, 0, 0.7]} />
          <mesh
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
          <group position={[0, 0.45, -0.1]} scale={0.7}>
            <Driver character={player.driver ?? "mario"} />
          </group>
          {/* Shared held-item visuals (HeldItems) — same mounts as the local
              kart (remote bomb moves from [0,1.0,-1.2] to the shared rack). */}
          <HeldItems
            carriedItem={remoteState?.carriedItem}
            carriedBomb={remoteState?.carriedBomb}
            hidden={remoteSpinning}
          />
        </mesh>
        <mesh
          castShadow
          receiveShadow
          geometry={nodes.wheel_2.geometry}
          material={materials.m_Tire}
          position={[-0.77, -0.137, -0.7]}
          layers={1}
        />
        <mesh
          castShadow
          receiveShadow
          geometry={nodes.wheel_3.geometry}
          material={materials.m_Tire}
          position={[0.77, -0.137, -0.7]}
          layers={1}
        />
        <mesh
          castShadow
          receiveShadow
          geometry={nodes.wheel_1.geometry}
          material={materials.m_Tire}
          position={[0.7, -0.2, 0.7]}
          layers={1}
        />
        <mesh
          castShadow
          receiveShadow
          geometry={nodes.wheel_0.geometry}
          material={materials.m_Tire}
          position={[-0.7, -0.2, 0.7]}
          layers={1}
        />
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

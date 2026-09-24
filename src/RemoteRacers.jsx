import { useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { MathUtils } from "three";
import { getOnlineSpawnSlot } from "./constants";
import { useGameManager } from "./gameManager";
import { Driver } from "./models/Driver";
import { BombModel } from "./models/Pickups";
import { useOnlineRaceStore } from "./onlineRaceStore";

const smoothAngle = (from, to, lambda, delta) => {
  const difference = MathUtils.euclideanModulo(to - from + Math.PI, Math.PI * 2) - Math.PI;
  return from + difference * (1 - Math.exp(-lambda * delta));
};

const RemoteKart = ({ player, playerIndex }) => {
  const { nodes, materials } = useGLTF("/models/kart.glb");
  const remoteState = useOnlineRaceStore((state) => state.remoteRacers[player.id]);
  const kartRef = useRef(null);
  const visualRef = useRef(null);
  const spawnSlot = getOnlineSpawnSlot(playerIndex);

  useFrame((_, delta) => {
    if (!kartRef.current || !visualRef.current) return;

    const fallbackTarget = {
      x: spawnSlot.position[0],
      y: spawnSlot.position[1],
      z: spawnSlot.position[2],
      rotationY: spawnSlot.rotationY,
      bodyY: 0,
    };
    const target = { ...fallbackTarget, ...remoteState };

    kartRef.current.position.x = MathUtils.damp(kartRef.current.position.x, target.x, 14, delta);
    kartRef.current.position.y = MathUtils.damp(kartRef.current.position.y, target.y, 14, delta);
    kartRef.current.position.z = MathUtils.damp(kartRef.current.position.z, target.z, 14, delta);
    kartRef.current.rotation.y = smoothAngle(kartRef.current.rotation.y, target.rotationY, 16, delta);
    visualRef.current.position.y = MathUtils.damp(
      visualRef.current.position.y,
      (Number.isFinite(target.bodyY) ? target.bodyY : 0) - 0.5,
      12,
      delta,
    );
  });

  return (
    <group
      ref={kartRef}
      position={spawnSlot.position}
      rotation-y={spawnSlot.rotationY}
      name={`remote-racer-${player.id}`}
    >
      <group ref={visualRef} position-y={-0.5} rotation-y={Math.PI}>
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
          {remoteState?.carriedBomb && (
            <group position={[0, 1.0, -1.2]} scale={0.5}>
              <BombModel />
            </group>
          )}
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

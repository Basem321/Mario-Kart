// Shared held-item visuals (2.3 #21): the SINGLE place that decides what a
// carried slot looks like. Both Kart.jsx (local) and RemoteRacers.jsx render
// this — the triple-mushroom static trio used to be duplicated (and wrong)
// in both files. `visualFor` (itemVisuals.js) is the routing source of
// truth; this component does the rendering.
//
// Triple mushrooms still render as the legacy static trio here — T4 (1.3)
// generalizes ItemOrbit for mushrooms + red shells in this one file.

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { itemConfig } from "../items/itemConfig.js";
import { visualFor } from "../items/itemVisuals.js";
import {
  BombModel,
  MushroomModel,
  RedShellModel,
  BlueShellModel,
  BulletModel,
  BlooperModel,
  RedTripleOrbit,
  GoldenMushroom,
} from "./Pickups.jsx";

// Held blooper mount (§1.2b): floats above the glove-side hold. Derived from
// driverRig.handRest (driver-local, pre-0.7): driver group sits at
// [0, 0.45, -0.1], so kart-local = [0.7*0.62, 0.45+0.7*0.15+0.35 hover, ...].
// T6 moves this onto the live glove; the offset stays in one place.
const BLOOPER_HOLD_POS = [0.434, 0.905, -0.065];

function BlooperFloat() {
  const ref = useRef(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime;
    ref.current.position.y = BLOOPER_HOLD_POS[1] + Math.sin(t * 2.1) * 0.06;
    ref.current.rotation.z = Math.sin(t * 1.4) * 0.14;
    ref.current.rotation.y = Math.sin(t * 0.9) * 0.2;
  });
  return (
    <group ref={ref} position={BLOOPER_HOLD_POS}>
      <BlooperModel />
    </group>
  );
}

export function HeldItems({ carriedItem, carriedBomb, hidden }) {
  if (hidden) return null;
  const RACK = itemConfig.sockets.rack;
  const TRAIL = itemConfig.sockets.trailPoint;
  const vis = visualFor(carriedItem ?? null);
  const item = carriedItem;

  return (
    <>
      {carriedBomb && (
        <group position={RACK} scale={0.5}>
          <BombModel />
        </group>
      )}
      {vis.held === "rack" && item?.type === "mushroom" && item?.variant !== "triple" && (
        <group position={RACK}>
          <MushroomModel />
        </group>
      )}
      {vis.held === "rack" && item?.type === "golden" && (
        <group position={RACK}>
          <GoldenMushroom windowUntil={item?.windowUntil} />
        </group>
      )}
      {item?.type === "mushroom" && item?.variant === "triple" && (
        <group position={RACK}>
          {[90, 210, 330].map((deg) => {
            const a = (deg * Math.PI) / 180;
            return (
              <group
                key={deg}
                position={[Math.cos(a) * 1.1, 0, Math.sin(a) * 1.1]}
              >
                <MushroomModel />
              </group>
            );
          })}
        </group>
      )}
      {vis.held === "trail" && item?.type === "red" && (
        <group position={TRAIL}>
          <RedShellModel />
        </group>
      )}
      {vis.held === "orbit" && item?.type === "red" && (
        <RedTripleOrbit count={item?.usesLeft ?? 3} />
      )}
      {vis.held === "trail" && item?.type === "blue" && (
        <group position={TRAIL}>
          <BlueShellModel />
        </group>
      )}
      {vis.held === "rack" && item?.type === "bullet" && (
        <group position={RACK}>
          <BulletModel
            sizeMul={
              itemConfig.sizes.bulletHeldLength /
              itemConfig.sizes.bulletActiveLength
            }
          />
        </group>
      )}
      {vis.held === "float" && item?.type === "blooper" && <BlooperFloat />}
    </>
  );
}

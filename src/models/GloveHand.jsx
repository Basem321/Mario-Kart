// Procedural glove hand (T4b): the drivers are single rigid meshes (Case C),
// so the held item is carried by a separate glove in driver-local space.
// White palm sphere + tapered cuff (shirt color) reaching back toward the
// shoulder, so it reads as an arm, not a floating ball. The item rides above
// the palm at world size (counter-scaled out of the 0.7 driver frame).
// Throw/receive animation lands in T6 — this is the static hold only.

import { useMemo } from "react";
import { itemConfig } from "../items/itemConfig.js";
import { cuffTransform } from "../items/itemScale.js";

// Driver-local frame mount. MUST match the Driver mounts in Kart.jsx,
// RemoteRacers.jsx and the gallery (position [0, 0.45, -0.1], scale 0.7).
export function DriverSpace({ children }) {
  return (
    <group position={[0, 0.45, -0.1]} scale={0.7}>
      {children}
    </group>
  );
}

export function GloveHand({ driver = "mario", pose = "handRest", lift = 0.4, children }) {
  const rig = itemConfig.driverRig[driver] ?? itemConfig.driverRig.mario;
  const p = rig[pose] ?? rig.handRest;
  const palmR = rig.gloveRadius ?? 0.23;
  const cuff = useMemo(
    () => cuffTransform(p, rig.shoulder ?? [0.3, 0.4, 0], rig.cuffLen ?? 0.38),
    // rig sub-arrays are static config refs; pose selects among them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [driver, pose]
  );
  // lift arrives in world units; the glove lives in driver-local (0.7).
  const liftLocal = Number(lift) / 0.7;
  return (
    <group position={p}>
      {/* forearm stub toward the shoulder */}
      <mesh position={cuff.mid} quaternion={cuff.quat}>
        <cylinderGeometry args={[palmR * 0.8, palmR * 0.55, cuff.len, 12]} />
        <meshStandardMaterial color={rig.cuffColor} roughness={0.7} />
      </mesh>
      {/* palm */}
      <mesh>
        <sphereGeometry args={[palmR, 20, 20]} />
        <meshStandardMaterial color="#ffffff" roughness={0.6} />
      </mesh>
      {/* held item at world size above the palm */}
      <group position={[0, liftLocal, 0]}>
        <group scale={1 / 0.7}>{children}</group>
      </group>
    </group>
  );
}

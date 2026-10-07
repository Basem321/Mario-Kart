// Procedural glove hand (T4b static hold + T6 §3.2 animation): the drivers
// are single rigid meshes (Case C), so the held item is carried by a
// separate glove in driver-local space. White palm sphere + tapered cuff
// (shirt color) reaching back toward the shoulder, so it reads as an arm,
// not a floating ball. The item rides above the palm at world size
// (counter-scaled out of the 0.7 driver frame).
//
// Animation: while an item anim is live the glove follows gloveAnimPos and
// the item pops/shrinks; otherwise it idles at the rest pose with a gentle
// bob. t advances on the caller's clock via useFrame (no re-renders);
// frozenT freezes it (gallery time scrub).

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { itemConfig } from "../items/itemConfig.js";
import { cuffTransform } from "../items/itemScale.js";
import {
  animLive,
  animT,
  gloveAnimPos,
  popScale,
  useItemScale,
} from "../items/animCurves.js";
import { setHandGetter } from "../items/handAnchor.js";

// Driver-local frame mount. MUST match the Driver mounts in Kart.jsx,
// RemoteRacers.jsx and the gallery (position [0, 0.45, -0.1], scale 0.7).
export function DriverSpace({ children }) {
  return (
    <group position={[0, 0.45, -0.1]} scale={0.7}>
      {children}
    </group>
  );
}

export function GloveHand({
  driver = "mario",
  pose = "handRest",
  lift = 0.4,
  children,
  animName = null,
  animStart = 0,
  animDur = 0,
  frozenT = null,
  isGolden = false,
  ghostUntil = 0,
  liveAnchor = false,
}) {
  // Disabled via itemConfig.glove.enabled (code stays): no ball, no sleeve.
  // The item floats at the same hold spot (same rest/anim/bob math, same
  // throw anchor) — only the hand meshes are skipped.
  const gloveOn = itemConfig.glove?.enabled === true;
  const rig = itemConfig.driverRig[driver] ?? itemConfig.driverRig.mario;
  const rest = rig[pose] ?? rig.handRest;
  const palmR = rig.gloveRadius ?? 0.23;
  const cuff = useMemo(
    () => cuffTransform(rest, rig.shoulder ?? [0.3, 0.4, 0], rig.cuffLen ?? 0.38),
    // rig sub-arrays are static config refs; pose selects among them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [driver, pose]
  );
  const groupRef = useRef(null);
  const itemRef = useRef(null);
  const palmRef = useRef(null);
  // lift arrives in world units; the glove lives in driver-local (0.7).
  const liftLocal = Number(lift) / 0.7;

  // Only the LOCAL kart's glove publishes the spawn anchor (remotes and the
  // gallery render the same component without registering).
  useEffect(() => {
    if (!liveAnchor) return undefined;
    setHandGetter((out) => {
      if (palmRef.current) palmRef.current.getWorldPosition(out);
    });
    return () => setHandGetter(null);
  }, [liveAnchor]);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const now = performance.now();
    const state = { name: animName, start: animStart, totalMs: animDur };
    const live = frozenT != null || animLive(state, now);
    const t = frozenT != null ? Math.max(0, Math.min(1, frozenT)) : animT(state, now);
    const p = live && animName ? gloveAnimPos(animName, t, rig) : [...rest];
    if (!live || !animName) {
      // hold_item idle: gentle bob on top of the rest pose.
      p[1] += Math.sin(clock.elapsedTime * 2.2) * 0.02;
    }
    groupRef.current.position.set(p[0], p[1], p[2]);
    if (itemRef.current) {
      const pop = live && animName === "item_got" ? popScale(t) : 1;
      const shrink = live && animName === "use_mushroom" ? useItemScale(animName, t, isGolden) : 1;
      itemRef.current.scale.setScalar((1 / 0.7) * pop * shrink);
    }
    // Ghost visibility expires with the throw (carried items ignore this).
    if (ghostUntil > 0) {
      groupRef.current.visible = now < ghostUntil;
    } else if (!groupRef.current.visible) {
      groupRef.current.visible = true;
    }
  });

  return (
    <group ref={groupRef} position={rest}>
      {gloveOn && (
        <>
          {/* forearm stub toward the shoulder */}
          <mesh position={cuff.mid} quaternion={cuff.quat}>
            <cylinderGeometry args={[palmR * 0.8, palmR * 0.55, cuff.len, 12]} />
            <meshStandardMaterial color={rig.cuffColor} roughness={0.7} />
          </mesh>
          {/* palm */}
          <mesh ref={palmRef}>
            <sphereGeometry args={[palmR, 20, 20]} />
            <meshStandardMaterial color="#ffffff" roughness={0.6} />
          </mesh>
        </>
      )}
      {/* Invisible throw anchor at the palm spot (same origin, no hand). */}
      {!gloveOn && <group ref={palmRef} />}
      {/* held item at world size above the palm */}
      <group position={[0, liftLocal, 0]}>
        <group ref={itemRef} scale={1 / 0.7}>
          {children}
        </group>
      </group>
    </group>
  );
}

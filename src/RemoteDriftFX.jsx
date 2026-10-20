import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Glow } from "./particles/drift/glow/Glow.jsx";
import { Sparks } from "./particles/sparks/Sparks.jsx";
import { Skate } from "./particles/drift/Skate/Skate.jsx";
import { Trails } from "./particles/sparks/Trails.jsx";
import { getDriftLevel } from "./constants";
import { useOnlineRaceStore } from "./onlineRaceStore";

// Drift effects of a REMOTE kart: the same Glow / Sparks / Skate / Trails set
// the local kart renders (models/Kart.jsx), driven by the driftDir/driftPow the
// racer publishes instead of the local drift refs. Mount it inside the remote
// kart's visual group (already rotated by PI and offset by -0.5 in Y).
export const RemoteDriftFX = ({ playerId }) => {
  const glowL = useRef(null);
  const glowR = useRef(null);
  const sparksL = useRef(null);
  const sparksR = useRef(null);
  const skateL = useRef(null);
  const skateR = useRef(null);
  // Real refs on purpose: Glow reads driftDirection.current and Trails reads
  // driftLevelRef.current every frame.
  const driftDirRef = useRef(0);
  const driftLevelRef = useRef(null);
  const wasDriftingRef = useRef(false);

  const setDrifting = (on) => {
    sparksL.current?.setEmitState(on);
    sparksR.current?.setEmitState(on);
    glowL.current?.setOpacity(on ? 1 : 0);
    glowR.current?.setOpacity(on ? 1 : 0);
    skateL.current?.setOpacity(on ? 1 : 0);
    skateR.current?.setOpacity(on ? 1 : 0);
  };

  // Everything starts hidden, like the local kart.
  useEffect(() => {
    setDrifting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame(() => {
    const r = useOnlineRaceStore.getState().remoteRacers[playerId];
    const dir = Number(r?.driftDir) || 0;
    const pow = Number(r?.driftPow) || 0;
    const drifting = dir !== 0 && r?.finished !== true;
    driftDirRef.current = dir;

    const level = getDriftLevel(pow);
    driftLevelRef.current = drifting ? level : null;

    if (drifting !== wasDriftingRef.current) {
      wasDriftingRef.current = drifting;
      setDrifting(drifting);
    }
    if (drifting) {
      glowL.current?.setColor(level.color);
      glowR.current?.setColor(level.color);
      glowL.current?.setLevel(level.threshold);
      glowR.current?.setLevel(level.threshold);
      sparksL.current?.setColor(level.color);
      sparksR.current?.setColor(level.color);
    }
  });

  return (
    <>
      <group position={[-0.97, -0.337, -0.9]}>
        <Glow ref={glowL} driftDirection={driftDirRef} />
        <Sparks ref={sparksL} />
        <Trails driftLevelRef={driftLevelRef} />
        <group position={[0.15, 0.2, -0.2]}>
          <Skate ref={skateL} />
        </group>
      </group>
      <group position={[0.97, -0.337, -0.9]}>
        <Glow ref={glowR} driftDirection={driftDirRef} />
        <Sparks ref={sparksR} left />
        <Trails left driftLevelRef={driftLevelRef} />
        <group position={[-0.15, 0.2, -0.2]}>
          <Skate ref={skateR} />
        </group>
      </group>
    </>
  );
};

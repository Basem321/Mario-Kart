// Driver model — static GLB (rigid mesh, no skeleton).
// Animations are whole-group procedural: Kart.jsx's driverGroupRef drives
// throw/receive/use via bodyPose() (animCurves.js). This component adds a
// steering-lean layer: gentle left/right tilt while turning.
//
// forwardRef: rig code in Kart/RemoteRacers can attach ref to the mesh for
// future probing or per-frame reads.

import { forwardRef, useMemo } from "react";
import { useGLTF } from "@react-three/drei";

const DRIVER_PATHS = {
  mario: "/models/mario-driver.glb",
  luigi: "/models/luigi-driver.glb",
};

export const Driver = forwardRef(function Driver({ character = "mario", itemAnim, ...props }, ref) {
  const path = DRIVER_PATHS[character] ?? DRIVER_PATHS.mario;
  const { scene } = useGLTF(path);
  const model = useMemo(() => {
    const clone = scene.clone();
    clone.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
      }
    });
    return clone;
  }, [scene]);
  return <primitive object={model} ref={ref} {...props} />;
});

useGLTF.preload("/models/mario-driver.glb");
useGLTF.preload("/models/luigi-driver.glb");

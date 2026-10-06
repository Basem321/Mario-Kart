import { forwardRef, useMemo } from "react";
import { useGLTF } from "@react-three/drei";

const DRIVER_PATHS = {
  mario: "/models/mario-driver.glb",
  luigi: "/models/luigi-driver.glb",
};

// forwardRef (T5): rig code can reach the driver model through ref
// (the whole-body lean animates the wrapper group in Kart/RemoteRacers;
// this ref exposes the model itself for probing and future work).
export const Driver = forwardRef(function Driver({ character = "mario", ...props }, ref) {
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

import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";

const DRIVER_PATHS = {
  mario: "/models/mario-driver.glb",
  luigi: "/models/luigi-driver.glb",
};

export function Driver({ character = "mario", ...props }) {
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
  return <primitive object={model} {...props} />;
}

useGLTF.preload("/models/mario-driver.glb");
useGLTF.preload("/models/luigi-driver.glb");

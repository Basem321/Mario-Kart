import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";

function useShadowingScene(path) {
  const { scene } = useGLTF(path);
  return useMemo(() => {
    const clone = scene.clone();
    clone.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
      }
    });
    return clone;
  }, [scene]);
}

export function ItemBoxModel(props) {
  const model = useShadowingScene("/models/item-box.glb");
  return <primitive object={model} {...props} />;
}

export function BombModel(props) {
  const model = useShadowingScene("/models/bomb.glb");
  return <primitive object={model} {...props} />;
}

useGLTF.preload("/models/item-box.glb");
useGLTF.preload("/models/bomb.glb");

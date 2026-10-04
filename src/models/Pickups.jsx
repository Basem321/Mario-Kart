import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { Color } from "three";

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

export function MushroomModel({ gold = false, ...props }) {
  const base = useShadowingScene("/models/mushroom.glb");
  const model = useMemo(() => {
    if (!gold) return base;
    // Gold is a code-side tint of the same mesh (no separate GLB).
    // Materials are cloned so the shared base instances stay untouched.
    const clone = base.clone();
    clone.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.color = new Color(0xffc93a);
        if (o.material.emissive) o.material.emissive = new Color(0x7a5200);
      }
    });
    return clone;
  }, [base, gold]);
  return <primitive object={model} {...props} />;
}

useGLTF.preload("/models/item-box.glb");
useGLTF.preload("/models/bomb.glb");
useGLTF.preload("/models/mushroom.glb");

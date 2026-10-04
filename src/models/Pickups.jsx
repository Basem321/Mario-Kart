import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { Color } from "three";
import { itemConfig, modelNativeSizes } from "../items/itemConfig.js";

// Render scale = target size / native GLB size. Targets come from spec ratios
// (sizes) times the real kart length; natives were measured 2026-10-04.
// Props spread last so callers can still override scale per use.
const scaledPrimitive = (model, scale, props) => (
  <primitive object={model} scale={scale} {...props} />
);

const targetUnits = (ratio) => ratio * modelNativeSizes.kartLength;

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
  const scale = targetUnits(itemConfig.sizes.mushroomHeld) / modelNativeSizes.mushroomWidth;
  const model = useMemo(() => {
    if (!gold) return base;
    // Gold is a code-side tint of the same mesh (no separate GLB).
    // Materials are cloned so the shared base instances stay untouched.
    const clone = base.clone();
    clone.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.color = new Color(itemConfig.golden.tint);
        if (o.material.emissive) o.material.emissive = new Color(0x7a5200);
      }
    });
    return clone;
  }, [base, gold]);
  return scaledPrimitive(model, scale, props);
}

useGLTF.preload("/models/item-box.glb");
useGLTF.preload("/models/bomb.glb");
useGLTF.preload("/models/mushroom.glb");

export function RedShellModel(props) {
  const model = useShadowingScene("/models/red-shell.glb");
  const scale =
    targetUnits(itemConfig.sizes.redShell) / modelNativeSizes.redShellDiameter;
  return scaledPrimitive(model, scale, props);
}

useGLTF.preload("/models/red-shell.glb");

export function BlueShellModel(props) {
  const model = useShadowingScene("/models/blue-shell.glb");
  const scale =
    targetUnits(itemConfig.sizes.blueShell) / modelNativeSizes.blueShellOverall;
  return scaledPrimitive(model, scale, props);
}

useGLTF.preload("/models/blue-shell.glb");

export function BulletModel(props) {
  const model = useShadowingScene("/models/bullet-bill.glb");
  const scale =
    targetUnits(itemConfig.sizes.bulletActiveLength) / modelNativeSizes.bulletLength;
  return scaledPrimitive(model, scale, props);
}

useGLTF.preload("/models/bullet-bill.glb");

export function BlooperModel(props) {
  const model = useShadowingScene("/models/blooper.glb");
  const scale =
    targetUnits(itemConfig.sizes.bloopHeldHeight) / modelNativeSizes.blooperHeight;
  return scaledPrimitive(model, scale, props);
}

useGLTF.preload("/models/blooper.glb");

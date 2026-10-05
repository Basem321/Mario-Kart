import { useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Color } from "three";
import { itemConfig, modelNativeSizes } from "../items/itemConfig.js";
import { orbitAngle } from "../items/homing.js";

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

// Red-triple orbit: three shells around orbit_center, phases from the shared
// race clock (Date.now — peers agree within tens of ms, no packets needed).
// count = shells left (3 → 2 → 1), re-spaced evenly.
export function RedTripleOrbit({ count = 3 }) {
  const ref = useRef(null);
  useFrame(() => {
    if (ref.current) {
      ref.current.rotation.y = (-orbitAngle(Date.now(), 0) * Math.PI) / 180;
    }
  });
  const n = Math.max(0, Math.min(3, count));
  const r = itemConfig.orbit.radius;
  return (
    <group ref={ref} position={itemConfig.sockets.orbitCenter}>
      {[0, 1, 2].slice(0, n).map((i) => {
        // Survivors re-space evenly (2 left → opposite sides).
        const a = ((i * (360 / Math.max(1, n))) * Math.PI) / 180;
        return (
          <group key={i} position={[Math.cos(a) * r, 0, Math.sin(a) * r]}>
            <RedShellModel />
          </group>
        );
      })}
    </group>
  );
}

// Golden shrink/blink: full mini shrinking over the window, 4 Hz blink in the
// last 1.5 s. Driven per-frame from windowUntil (no re-renders).
export function GoldenMushroom({ windowUntil }) {
  const ref = useRef(null);
  const base = targetUnits(itemConfig.sizes.mushroomHeld) / modelNativeSizes.mushroomWidth;
  useFrame(() => {
    if (!ref.current) return;
    const total = itemConfig.golden.windowMs;
    const remain = Number(windowUntil) - performance.now();
    const frac = Math.max(0, Math.min(1, remain / total));
    ref.current.scale.setScalar(Math.max(0.001, base * Math.max(0.05, frac)));
    ref.current.visible =
      frac <= 0 ||
      remain > 1500 ||
      Math.floor(performance.now() / 125) % 2 === 0;
  });
  return (
    <group ref={ref}>
      <MushroomModel gold />
    </group>
  );
}

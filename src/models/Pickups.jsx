import { useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Box3, Color, Group, Vector3 } from "three";
import { itemConfig, modelNativeSizes } from "../items/itemConfig.js";
import { renderScale } from "../items/itemScale.js";
import { orbitAngle } from "../items/homing.js";

// Render scale = target size / native GLB size (see itemScale.js). Targets
// come from spec ratios (sizes) times the real kart length; natives were
// measured 2026-10-04 (bullet axis re-measured 2026-10-06).
//
// Sizing contract (§1.2): callers pass `sizeMul` to MULTIPLY the computed
// scale (held mini, cast flourish). A raw `scale` prop is stripped and
// ignored — it can never replace the computed scale again (the blooper was
// rendering hundreds of units tall that way).
const scaledPrimitive = (model, scale, props) => {
  const { scale: _stripped, sizeMul = 1, ...rest } = props ?? {};
  return <primitive object={model} scale={scale * Number(sizeMul)} {...rest} />;
};

function useShadowingScene(path, refAxis = "x", refSize = 1) {
  const { scene } = useGLTF(path);
  return useMemo(() => {
    const clone = scene.clone();
    clone.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
      }
    });
    // Neutralize authoring ancestor scales (matrix-encoded, invisible to
    // accessor min/max — e.g. red-shell's "Shell" node at x2.65): measure
    // the clone's Box3 along the reference axis and fold the correction
    // into the INNER clone scale. It must live below the wrapper: R3F's
    // `scale` prop overwrites the scale of whatever object the primitive
    // holds (the wrapper), which is exactly the renderScale factor.
    // Total = renderScale x normalization, holding in-scene.
    const box = new Box3().setFromObject(clone);
    const size = new Vector3();
    box.getSize(size);
    const world = Number(size[refAxis]) || 0;
    if (world > 0 && Number.isFinite(refSize) && refSize > 0) {
      clone.scale.multiplyScalar(refSize / world);
    }
    const wrap = new Group();
    wrap.add(clone);
    return wrap;
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const base = useShadowingScene("/models/mushroom.glb", "x", modelNativeSizes.mushroomWidth);
  const scale = renderScale("mushroom");
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
  const model = useShadowingScene("/models/red-shell.glb", "x", modelNativeSizes.redShellDiameter);
  return scaledPrimitive(model, renderScale("red"), props);
}

useGLTF.preload("/models/red-shell.glb");

export function BlueShellModel(props) {
  const model = useShadowingScene("/models/blue-shell.glb", "x", modelNativeSizes.blueShellOverall);
  return scaledPrimitive(model, renderScale("blue"), props);
}

useGLTF.preload("/models/blue-shell.glb");

export function BulletModel(props) {
  const model = useShadowingScene("/models/bullet-bill.glb", "x", modelNativeSizes.bulletLength);
  const { scale: _stripped, sizeMul = 1, ...groupProps } = props ?? {};
  const o = itemConfig.modelOrientation.bullet;
  return (
    <group rotation={[o.rotX, o.rotY, o.rotZ]} {...groupProps}>
      <primitive object={model} scale={renderScale("bulletActive") * Number(sizeMul)} />
    </group>
  );
}

useGLTF.preload("/models/bullet-bill.glb");

export function BlooperModel(props) {
  const model = useShadowingScene("/models/blooper.glb", "y", modelNativeSizes.blooperHeight);
  return scaledPrimitive(model, renderScale("bloopHeld"), props);
}

useGLTF.preload("/models/blooper.glb");

// Red-triple orbit: three shells around orbit_center, phases from the shared
// race clock (Date.now — peers agree within tens of ms, no packets needed).
// count = shells left (3 → 2 → 1), re-spaced evenly. radius overridable for
// the gallery tuning panel (default = config).
export function RedTripleOrbit({ count = 3, radius = null, shellMul = 1 }) {
  const ref = useRef(null);
  useFrame(() => {
    if (ref.current) {
      ref.current.rotation.y = (-orbitAngle(Date.now(), 0) * Math.PI) / 180;
    }
  });
  const n = Math.max(0, Math.min(3, count));
  const r = Number(radius) || itemConfig.orbit.radius;
  return (
    <group ref={ref} position={itemConfig.sockets.orbitCenter}>
      {[0, 1, 2].slice(0, n).map((i) => {
        // Survivors re-space evenly (2 left → opposite sides).
        const a = ((i * (360 / Math.max(1, n))) * Math.PI) / 180;
        return (
          <group key={i} position={[Math.cos(a) * r, 0, Math.sin(a) * r]}>
            <RedShellModel sizeMul={shellMul} />
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
  const base = renderScale("mushroom");
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

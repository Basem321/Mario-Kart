import { Children, useMemo, useRef } from "react";
import { useGLTF, useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Box3, BufferGeometry, Color, Group, Mesh, MeshStandardMaterial, Vector3 } from "three";
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
    // the LARGEST SINGLE MESH's Box3 along the reference axis and fold the
    // correction into the INNER clone scale. Per-mesh (not whole-clone
    // union): part offsets inflate the union (red union spans 220 while one
    // shell spans ~166). It must live below the wrapper: R3F's `scale` prop
    // overwrites the scale of whatever object the primitive holds (the
    // wrapper), which is exactly the renderScale factor.
    // Total = renderScale x normalization, holding in-scene.
    clone.updateWorldMatrix(true, true);
    const meshBox = new Box3();
    const meshSize = new Vector3();
    const meshMax = { x: 0, y: 0, z: 0 };
    clone.traverse((o) => {
      if (!o.isMesh) return;
      meshBox.setFromObject(o);
      meshBox.getSize(meshSize);
      meshMax.x = Math.max(meshMax.x, meshSize.x);
      meshMax.y = Math.max(meshMax.y, meshSize.y);
      meshMax.z = Math.max(meshMax.z, meshSize.z);
    });
    const world = Number(meshMax[refAxis]) || 0;
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
  const model = useShadowingScene("/models/item-box.glb", "x", 1.56);
  return <primitive object={model} {...props} />;
}

export function BombModel(props) {
  const model = useShadowingScene("/models/bomb.glb", "x", 1.31);
  return <primitive object={model} {...props} />;
}
// Pixel cache for gold part classification (per texture image).
const goldPixels = new WeakMap();
const goldImageData = (img) => {
  let e = goldPixels.get(img);
  if (!e && img && img.width > 0) {
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    e = ctx.getImageData(0, 0, img.width, img.height);
    goldPixels.set(img, e);
  }
  return e;
};
const sampleUV = (px, u, v) => {
  const x = Math.max(0, Math.min(px.width - 1, Math.round(u * (px.width - 1))));
  const y = Math.max(0, Math.min(px.height - 1, Math.round((1 - v) * (px.height - 1))));
  const o = (y * px.width + x) * 4;
  return [px.data[o], px.data[o + 1], px.data[o + 2]];
};
// Texture-space part classification (matches the shipped skin: red cap with
// white spots, beige stem band, two black eyes).
const classifyShroomTri = ([r, g, b]) => {
  if (r < 90 && g < 90 && b < 90) return "eye";
  if (Math.min(r, g, b) > 190) return "spot";
  if (r > 150 && r - g > 50 && r - b > 50) return "cap";
  return "stem";
};
export function MushroomModel({ gold = false, ...props }) {
  const base = useShadowingScene("/models/mushroom.glb", "x", modelNativeSizes.mushroomWidth);
  const scale = renderScale("mushroom");
  const model = useMemo(() => {
    if (!gold) return base;
    // Golden look (T4.5): dedicated materials per surface part — cap gets
    // metallic gold (no map), spots + stem pale gold, eyes keep the ORIGINAL
    // textured material untouched. Parts are split by texture-space color
    // (the GLB carries no part separation: two identical meshes, one
    // material). The normal mushroom path above is never touched.
    const mats = itemConfig.golden.materials;
    const capMat = new MeshStandardMaterial({
      color: mats.cap.color,
      metalness: mats.cap.metalness,
      roughness: mats.cap.roughness,
      emissive: new Color(mats.cap.emissive),
      emissiveIntensity: mats.cap.emissiveIntensity,
    });
    const paleMat = new MeshStandardMaterial({ color: mats.pale.color, metalness: 0.35, roughness: 0.45 });
    const clone = base.clone();
    const swaps = [];
    clone.traverse((o) => {
      if (!o.isMesh) return;
      const uv = o.geometry.attributes.uv;
      const px = o.material?.map?.image ? goldImageData(o.material.map.image) : null;
      if (!uv || !px) {
        swaps.push([o, null]);
        return;
      }
      const idx = o.geometry.index;
      const buckets = { cap: [], pale: [], eye: [] };
      const triCount = idx ? idx.count / 3 : uv.count / 3;
      for (let t = 0; t < triCount; t++) {
        let cu = 0;
        let cv = 0;
        const ids = [];
        for (let k = 0; k < 3; k++) {
          const id = idx ? idx.getX(t * 3 + k) : t * 3 + k;
          ids.push(id);
          cu += uv.getX(id);
          cv += uv.getY(id);
        }
        const kind = classifyShroomTri(sampleUV(px, cu / 3, cv / 3));
        const bucket = kind === "cap" ? buckets.cap : kind === "eye" ? buckets.eye : buckets.pale;
        for (const id of ids) bucket.push(id);
      }
      swaps.push([o, buckets]);
    });
    for (const [o, buckets] of swaps) {
      const parent = o.parent;
      if (!parent) continue;
      if (!buckets) {
        o.material = o.material.clone();
        o.material.color = new Color(itemConfig.golden.tint);
        continue;
      }
      const eyeMat = o.material.clone(); // original textured skin: eyes untouched
      const group = new Group();
      group.position.copy(o.position);
      group.quaternion.copy(o.quaternion);
      group.scale.copy(o.scale);
      for (const [list, mat] of [[buckets.cap, capMat], [buckets.pale, paleMat], [buckets.eye, eyeMat]]) {
        if (!list.length) continue;
        const sub = new BufferGeometry();
        for (const name in o.geometry.attributes) {
          sub.setAttribute(name, o.geometry.attributes[name]);
        }
        sub.setIndex(list);
        const mesh = new Mesh(sub, mat);
        mesh.castShadow = true;
        group.add(mesh);
      }
      parent.add(group);
      parent.remove(o);
    }
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

// Shared triple orbit (T4.3/1.3): ONE component for red shells AND triple
// mushrooms — same spin, same shared race-clock phase, same ground plane,
// same bob. count = items left (3 → 2 → 1), survivors re-space evenly.
// Slots sit at y + lift (per-kind bottom lift from orbit.lifts) so bottoms
// ride the road; the group bobs gently (orbit.bob). radius/y overridable
// for the gallery tuning panel (defaults = config).
export function ItemOrbit({ count = 3, radius = null, y = null, lift = 0, children }) {
  const ref = useRef(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.rotation.y = (-orbitAngle(Date.now(), 0) * Math.PI) / 180;
      ref.current.position.y = Math.sin(clock.elapsedTime * 2.2) * itemConfig.orbit.bob;
    }
  });
  const kids = Children.toArray(children);
  const left = Math.max(0, Math.min(kids.length, count));
  const n = Math.max(1, left);
  const r = Number(radius) || itemConfig.orbit.radius;
  const planeY = (y ?? itemConfig.orbit.height) + Number(lift);
  const cx = itemConfig.sockets.orbitCenter[0] ?? 0;
  const cz = itemConfig.sockets.orbitCenter[2] ?? 0;
  return (
    <group ref={ref} position={[cx, 0, cz]}>
      {kids.slice(0, left).map((kid, i) => {
        // Survivors re-space evenly (2 left → opposite sides).
        const a = ((i * (360 / n)) * Math.PI) / 180;
        return (
          <group key={i} position={[Math.cos(a) * r, planeY, Math.sin(a) * r]}>
            {kid}
          </group>
        );
      })}
    </group>
  );
}

// Thin red-shell triple over the shared orbit (same ground plane + bob).
export function RedTripleOrbit({ count = 3, radius = null, y = null, shellMul = 1 }) {
  return (
    <ItemOrbit count={count} radius={radius} y={y} lift={itemConfig.orbit.lifts.shell}>
      {[0, 1, 2].map((i) => (
        <RedShellModel key={i} sizeMul={shellMul} />
      ))}
    </ItemOrbit>
  );
}

// Golden sparkles: a few additive sprites wheeling around the golden
// mushroom while held and while the window runs. Cheap (5 sprites).
export function GoldenSparkles({ radius = 0.55, count = 5 }) {
  const ref = useRef(null);
  const tex = useTexture("/textures/stars.png");
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime;
    ref.current.rotation.y = t * 2.4;
    const kids = ref.current.children;
    for (let i = 0; i < kids.length; i++) {
      const s = 0.1 + 0.035 * (0.5 + 0.5 * Math.sin(t * 5 + (i * Math.PI * 2) / kids.length));
      kids[i].scale.set(s, s, 1);
    }
  });
  return (
    <group ref={ref}>
      {Array.from({ length: count }, (_, i) => {
        const a = ((i * 360) / count) * (Math.PI / 180);
        return (
          <sprite key={i} position={[Math.cos(a) * radius, Math.sin(a * 2) * 0.15, Math.sin(a) * radius]}>
            <spriteMaterial
              map={tex}
              transparent
              depthWrite={false}
              blending={2}
              opacity={0.9}
            />
          </sprite>
        );
      })}
    </group>
  );
}

// Golden shrink/blink (§4.2): full size while held (windowUntil null =
// window not yet opened), shrinking over the window once first use opens
// it, 4 Hz blink in the last 1.5 s. Driven per-frame (no re-renders).
export function GoldenMushroom({ windowUntil }) {
  const ref = useRef(null);
  const base = renderScale("mushroom");
  useFrame(() => {
    if (!ref.current) return;
    const total = itemConfig.golden.windowMs;
    // Unopened window → full-size mushroom, no blink.
    if (windowUntil == null || !Number.isFinite(Number(windowUntil))) {
      ref.current.scale.setScalar(Math.max(0.001, base));
      ref.current.visible = true;
      return;
    }
    const remain = Number(windowUntil) - performance.now();
    const frac = Math.max(0, Math.min(1, remain / total));
    ref.current.scale.setScalar(Math.max(0.001, base * Math.max(0.05, frac)));
    ref.current.visible =
      frac <= 0 ||
      remain > 1500 ||
      Math.floor(performance.now() / 125) % 2 === 0;
  });
  return (
    <>
      <group ref={ref}>
        <MushroomModel gold />
      </group>
      <GoldenSparkles />
    </>
  );
}

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Mesh } from "three";
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from "three-mesh-bvh";

// Guarantees every "ground" mesh (the raycast targets for wheels + walls)
// has a BVH, no matter when drei's <Bvh> traverse ran relative to async
// model loading, and no matter how many sessions came before.
// Without this, wheel/wall raycasts fall back to brute force (~27ms per
// ray vs ~0.04ms with BVH) and the game drops to single-digit fps.
function ensureBVH(root, label) {
  let total = 0;
  let had = 0;
  let built = 0;
  let skipped = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.isBufferGeometry) return;
    if (!o.name.includes("ground")) return;
    total += 1;
    if (o.geometry.boundsTree) {
      had += 1;
      return;
    }
    try {
      if (o.raycast !== Mesh.prototype.raycast) {
        skipped += 1;
        return;
      }
      o.raycast = acceleratedRaycast;
      o.geometry.computeBoundsTree = computeBoundsTree;
      o.geometry.disposeBoundsTree = disposeBoundsTree;
      o.geometry.computeBoundsTree();
      built += 1;
    } catch {
      skipped += 1;
    }
  });
  console.log(
    `[BVHEnsure:${label}] ground meshes:${total} already:${had} built:${built} skipped:${skipped}`
  );
}

export function BVHEnsure() {
  const scene = useThree((s) => s.scene);
  // Suspend until the always-rendered track models are loaded, so the
  // traverse below actually sees them (runs post-load, every session).
  useGLTF("./models/mario-circuit-test-transformed.glb");
  useGLTF("/models/kart.glb");

  useEffect(() => {
    ensureBVH(scene, "mount");
  }, [scene]);

  return null;
}

useGLTF.preload("./models/mario-circuit-test-transformed.glb");
useGLTF.preload("/models/kart.glb");

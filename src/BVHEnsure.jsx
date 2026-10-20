import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { Mesh } from "three";
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from "three-mesh-bvh";
import { useGameManager } from "./gameManager";
import { getTrack } from "./tracks";

// Guarantees every "ground" mesh (the raycast targets for wheels + walls)
// has a BVH, no matter when drei's <Bvh> traverse ran relative to async
// model loading, and no matter how many sessions came before.
// Without this, wheel/wall raycasts fall back to brute force (~27ms per
// ray vs ~0.04ms with BVH) and the game drops to single-digit fps.
//
// IMPORTANT: a geometry having `boundsTree` is NOT enough. The BVH lives on
// the geometry (which useGLTF caches for the whole page lifetime) but the
// accelerated `raycast` lives on the Mesh INSTANCE. When the canvas is
// unmounted (Return to room) R3F detaches every child from the <Bvh> group
// before drei's cleanup traverses it, so the cleanup never disposes the
// trees. On the next race the cached geometries still have their boundsTree
// (so drei's <Bvh> skips them) but the freshly created Mesh objects carry the
// default brute-force `Mesh.prototype.raycast`. So we always re-arm the
// instance, whether or not the tree already exists.
function ensureBVH(root, label) {
  let total = 0;
  let had = 0;
  let built = 0;
  let rearmed = 0;
  let skipped = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.isBufferGeometry) return;
    const isGround = o.name.includes("ground");
    if (isGround) total += 1;

    if (o.geometry.boundsTree) {
      // Tree survived from a previous session: just make this Mesh use it.
      // Only swap the stock Mesh raycast (same gate as drei's <Bvh>) so
      // InstancedMesh / SkinnedMesh keep their own implementations.
      if (o.raycast === Mesh.prototype.raycast) {
        o.raycast = acceleratedRaycast;
        rearmed += 1;
      }
      if (isGround) had += 1;
      return;
    }

    if (!isGround) return;
    try {
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
    `[BVHEnsure:${label}] ground meshes:${total} already:${had} built:${built} rearmed:${rearmed} skipped:${skipped}`
  );
}

export function BVHEnsure() {
  const scene = useThree((s) => s.scene);
  const selectedTrackId = useGameManager((s) => s.selectedTrackId);
  const activeTrack = getTrack(selectedTrackId);
  // Suspend until the always-rendered track models are loaded, so the
  // traverse below actually sees them (runs post-load, every session).
  useGLTF(activeTrack.glb);
  useGLTF("/models/kart.glb");

  useEffect(() => {
    ensureBVH(scene, selectedTrackId);
  }, [scene, selectedTrackId]);

  return null;
}

useGLTF.preload("/models/kart.glb");

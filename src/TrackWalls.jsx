import { useLayoutEffect, useMemo, useRef, useEffect } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { useGameStore } from "./store";

// Must match the <Track> transform in models/Mario-circuit-test.jsx
const TRACK_OFFSET = new THREE.Vector3(155, -28, 15);
const TRACK_SCALE = 0.08;

const WALL_HEIGHT = 2.2;
const WALL_THICKNESS = 0.6;
// Room to roam on grass around the road before hitting the outer fence.
const OUTER_MARGIN = 45;
// Safety cap so pathological tracks can't freeze load or the per-frame loop.
const MAX_WALL_SEGMENTS = 2500;

const toWorld = (lx, ly, lz) => ({
  x: lx * TRACK_SCALE + TRACK_OFFSET.x,
  y: ly * TRACK_SCALE + TRACK_OFFSET.y,
  z: lz * TRACK_SCALE + TRACK_OFFSET.z,
});

const q = (v) => Math.round(v * 20) / 20;
const edgeKey = (ax, ay, az, bx, by, bz) => {
  const a = `${q(ax)},${q(ay)},${q(az)}`;
  const b = `${q(bx)},${q(by)},${q(bz)}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
};

/**
 * Find boundary edges (edges used by exactly one triangle) of a road mesh.
 * Those outline the drivable surface, so they are exactly where walls belong.
 * Returns world-space segments [{ ax, az, bx, bz, y }].
 */
function getBoundarySegments(geometry) {
  const pos = geometry.attributes.position;
  if (!pos) return [];
  const index = geometry.index ? geometry.index.array : null;
  const triCount = index ? index.length / 3 : pos.count / 3;

  const edgeCounts = new Map();
  const edgeData = new Map();

  const v = (i) => {
    const vi = index ? index[i] : i;
    return {
      x: pos.getX(vi),
      y: pos.getY(vi),
      z: pos.getZ(vi),
    };
  };

  for (let t = 0; t < triCount; t++) {
    const a = v(t * 3);
    const b = v(t * 3 + 1);
    const c = v(t * 3 + 2);
    const edges = [
      [a, b],
      [b, c],
      [c, a],
    ];
    for (const [p1, p2] of edges) {
      const key = edgeKey(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
      if (!edgeData.has(key)) edgeData.set(key, [p1, p2]);
    }
  }

  const segments = [];
  for (const [key, count] of edgeCounts) {
    if (count !== 1) continue; // interior edge, not a wall
    const [p1, p2] = edgeData.get(key);
    const w1 = toWorld(p1.x, p1.y, p1.z);
    const w2 = toWorld(p2.x, p2.y, p2.z);
    // Skip degenerate slivers
    const dx = w2.x - w1.x;
    const dz = w2.z - w1.z;
    if (dx * dx + dz * dz < 1e-6) continue;
    segments.push({
      ax: w1.x,
      az: w1.z,
      bx: w2.x,
      bz: w2.z,
      y: (w1.y + w2.y) / 2,
    });
  }
  return segments;
}

export function TrackWalls() {
  const { nodes } = useGLTF("./models/mario-circuit-test-transformed.glb");
  const instancedRef = useRef(null);
  const setWallSegments = useGameStore((s) => s.setWallSegments);

  const segments = useMemo(() => {
    // Main road surface. Object_24 is the flat road mesh (see Track component).
    const roadGeometry =
      nodes?.Object_24?.geometry ?? nodes?.Object_25?.geometry ?? null;
    let segs = [];
    if (roadGeometry) {
      segs = getBoundarySegments(roadGeometry);
    }
    const boundaryCount = segs.length;

    // Downsample if a track ever yields an extreme edge count.
    if (segs.length > MAX_WALL_SEGMENTS - 4) {
      const step = Math.ceil(segs.length / (MAX_WALL_SEGMENTS - 4));
      segs = segs.filter((_, i) => i % step === 0);
    }

    // Outer safety fence: keeps the kart from driving to infinity on grass.
    // Built from the road bounding box — ALWAYS, even when boundary
    // extraction finds nothing (closed meshes have no boundary edges).
    if (roadGeometry) {
      roadGeometry.computeBoundingBox();
      const bb = roadGeometry.boundingBox;
      if (bb) {
        const c1 = toWorld(bb.min.x, bb.min.y, bb.min.z);
        const c2 = toWorld(bb.max.x, bb.max.y, bb.max.z);
        const avgY = (c1.y + c2.y) / 2;
        const minX = Math.min(c1.x, c2.x) - OUTER_MARGIN;
        const maxX = Math.max(c1.x, c2.x) + OUTER_MARGIN;
        const minZ = Math.min(c1.z, c2.z) - OUTER_MARGIN;
        const maxZ = Math.max(c1.z, c2.z) + OUTER_MARGIN;
        segs.push(
          { ax: minX, az: minZ, bx: maxX, bz: minZ, y: avgY, outer: true },
          { ax: maxX, az: minZ, bx: maxX, bz: maxZ, y: avgY, outer: true },
          { ax: maxX, az: maxZ, bx: minX, bz: maxZ, y: avgY, outer: true },
          { ax: minX, az: maxZ, bx: minX, bz: minZ, y: avgY, outer: true }
        );
      }
    }

    console.info(
      `[TrackWalls] road boundary segments: ${boundaryCount}, total with outer fence: ${segs.length}`
    );
    return segs;
  }, [nodes]);

  // Publish collision segments for the PlayerController.
  useEffect(() => {
    // Strip render-only fields before storing.
    setWallSegments(
      segments.map((s) => ({ ax: s.ax, az: s.az, bx: s.bx, bz: s.bz }))
    );
    return () => setWallSegments([]);
  }, [segments, setWallSegments]);

  // Build the visible barrier instances.
  useLayoutEffect(() => {
    const mesh = instancedRef.current;
    if (!mesh || segments.length === 0) return;
    const dummy = new THREE.Object3D();
    const red = new THREE.Color("#d6362c");
    const white = new THREE.Color("#f2ede4");
    const gray = new THREE.Color("#5b6b7f");

    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const dx = s.bx - s.ax;
      const dz = s.bz - s.az;
      const length = Math.hypot(dx, dz) + WALL_THICKNESS;
      dummy.position.set(
        (s.ax + s.bx) / 2,
        s.y + WALL_HEIGHT / 2 - 0.25,
        (s.az + s.bz) / 2
      );
      dummy.rotation.set(0, -Math.atan2(dz, dx), 0);
      dummy.scale.set(length, WALL_HEIGHT, WALL_THICKNESS);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, s.outer ? gray : i % 2 === 0 ? red : white);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [segments]);

  if (segments.length === 0) return null;

  return (
    <instancedMesh
      ref={instancedRef}
      name="wall-barrier"
      args={[undefined, undefined, segments.length]}
      frustumCulled={false}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.6} metalness={0.05} />
    </instancedMesh>
  );
}

useGLTF.preload("./models/mario-circuit-test-transformed.glb");

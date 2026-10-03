import { useLayoutEffect, useMemo, useRef, useEffect } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { useGameStore } from "./store";
import { useGameManager } from "./gameManager";
import { getRoadMapData, trackConfigToTransform } from "./trackRoad";
import { getTrack, getMergedRoadGeometry, trackToWorld } from "./tracks";
import { useMapEditorStore } from "./mapEditorStore";

const WALL_HEIGHT = 2.2;
const WALL_THICKNESS = 0.6;
// Room to roam on grass around the road before hitting the outer fence.
const OUTER_MARGIN = 45;
// Safety cap so pathological tracks can't freeze load or the per-frame loop.
const MAX_WALL_SEGMENTS = 2500;

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
function getBoundarySegments(geometry, track) {
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

  // Up-facing triangles kept for the road-beside/below tests below.
  const roadTris = [];
  for (let t = 0; t < triCount; t++) {
    const a = v(t * 3);
    const b = v(t * 3 + 1);
    const c = v(t * 3 + 2);
    // Road meshes are often double-sided or closed. Skipping bottom-facing
    // faces prevents outer boundary edges from being cancelled out (count = 2).
    const normalY = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    if (normalY < 0) continue;
    roadTris.push(a, b, c);

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

  // Local-unit tolerances (track scale ~0.08 => 20 units ≈ 1.6 world units,
  // far below the ~284-unit road width and the kart radius).
  const SIDE_OFFSET = 20;
  const SAME_LEVEL = 20;
  const ABOVE_DROP = 20;

  const roadHeightAt = (x, z) => {
    // Topmost up-facing road surface above the XZ point (any height).
    let best = null;
    for (let i = 0; i < roadTris.length; i += 3) {
      const a = roadTris[i];
      const b = roadTris[i + 1];
      const c = roadTris[i + 2];
      if (x < Math.min(a.x, b.x, c.x) || x > Math.max(a.x, b.x, c.x)) continue;
      if (z < Math.min(a.z, b.z, c.z) || z > Math.max(a.z, b.z, c.z)) continue;
      const denominator = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (Math.abs(denominator) < 1e-9) continue;
      const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / denominator;
      const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / denominator;
      const w = 1 - u - v;
      if (u < 0 || v < 0 || w < 0) continue;
      const y = a.y * u + b.y * v + c.y * w;
      if (best === null || y > best) best = y;
    }
    return best;
  };

  const roadAboveAt = (x, z, yRef) => {
    // Any up-facing road surface clearly above the reference height
    // (ramp passing over a skirt bottom, bridge over underpass, ...).
    for (let i = 0; i < roadTris.length; i += 3) {
      const a = roadTris[i];
      const b = roadTris[i + 1];
      const c = roadTris[i + 2];
      if (x < Math.min(a.x, b.x, c.x) || x > Math.max(a.x, b.x, c.x)) continue;
      if (z < Math.min(a.z, b.z, c.z) || z > Math.max(a.z, b.z, c.z)) continue;
      const denominator = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (Math.abs(denominator) < 1e-9) continue;
      const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / denominator;
      const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / denominator;
      const w = 1 - u - v;
      if (u < 0 || v < 0 || w < 0) continue;
      if (a.y * u + b.y * v + c.y * w > yRef + ABOVE_DROP) return true;
    }
    return false;
  };

  const segments = [];
  for (const [key, count] of edgeCounts) {
    if (count !== 1) continue; // interior edge, not a wall
    const [p1, p2] = edgeData.get(key);
    const mx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2;
    const mz = (p1.z + p2.z) / 2;
    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) continue;
    // Road on BOTH sides at the same level => split-part seam inside the
    // driving line (multi-part roads). Walling it would block the track.
    const nx = -dz / len;
    const nz = dx / len;
    const yA = roadHeightAt(mx + nx * SIDE_OFFSET, mz + nz * SIDE_OFFSET);
    const yB = roadHeightAt(mx - nx * SIDE_OFFSET, mz - nz * SIDE_OFFSET);
    if (
      yA !== null && yB !== null &&
      Math.abs(yA - my) < SAME_LEVEL && Math.abs(yB - my) < SAME_LEVEL
    ) {
      continue;
    }
    // Road clearly above the edge => buried skirt / lower cut edge under the
    // driving surface. A 2D wall here would block karts driving on top.
    if (roadAboveAt(mx, mz, my)) continue;
    // Authored wall-free corridor (jump approach/landing): rails would block
    // the flight path or float mid-air, and runoff is recoverable by Reset.
    if (
      Array.isArray(track.wallExclusion) &&
      track.wallExclusion.some(
        (zone) =>
          mx * track.scale + track.offset[0] >= zone.minX &&
          mx * track.scale + track.offset[0] <= zone.maxX &&
          mz * track.scale + track.offset[2] >= zone.minZ &&
          mz * track.scale + track.offset[2] <= zone.maxZ,
      )
    ) {
      continue;
    }

    const w1 = trackToWorld(track, p1.x, p1.y, p1.z);
    const w2 = trackToWorld(track, p2.x, p2.y, p2.z);
    // Skip degenerate slivers
    const wdx = w2.x - w1.x;
    const wdz = w2.z - w1.z;
    if (wdx * wdx + wdz * wdz < 1e-6) continue;
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
  const selectedTrackId = useGameManager((s) => s.selectedTrackId);
  const baseTrack = getTrack(selectedTrackId);
  const editorOpen = useMapEditorStore((s) => s.isOpen);
  const editorExclusion = useMapEditorStore((s) => s.editedConfig?.wallExclusion);
  const editorOffset = useMapEditorStore((s) => s.editedConfig?.offset);
  const editorScale = useMapEditorStore((s) => s.editedConfig?.scale);
  const editorNaturalWalls = useMapEditorStore((s) => s.editedConfig?.naturalWalls);

  const track = useMemo(() => {
    if (!editorOpen) return baseTrack;
    return {
      ...baseTrack,
      wallExclusion: editorExclusion ?? baseTrack.wallExclusion,
      offset: editorOffset ?? baseTrack.offset,
      scale: editorScale ?? baseTrack.scale,
      naturalWalls: editorNaturalWalls ?? baseTrack.naturalWalls,
    };
  }, [baseTrack, editorOpen, editorExclusion, editorOffset, editorScale, editorNaturalWalls]);

  const { nodes } = useGLTF(track.glb);
  const instancedRef = useRef(null);
  const setWallSegments = useGameStore((s) => s.setWallSegments);
  const setRoadMapData = useGameStore((s) => s.setRoadMapData);

  const roadGeometry = getMergedRoadGeometry(nodes, track);
  const roadTransform = trackConfigToTransform(track);

  // Directly extract and publish roadMapData for the minimap
  useEffect(() => {
    if (roadGeometry && setRoadMapData) {
      const mapData = getRoadMapData(roadGeometry, roadTransform);
      if (mapData) {
        setRoadMapData(mapData);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, setRoadMapData, selectedTrackId]);

  const segments = useMemo(() => {
    // Main road surface(s) for the active track (merged when split in parts).
    // Boundary walls are ALWAYS built for collision — tracks with authored
    // model walls (naturalWalls) just don't RENDER the red/white barriers
    // (see visibleSegments below); the invisible edges still stop karts
    // from sliding sideways off the road and falling inside the map.
    let segs = [];
    if (roadGeometry) {
      segs = getBoundarySegments(roadGeometry, track);
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
        const c1 = trackToWorld(track, bb.min.x, bb.min.y, bb.min.z);
        const c2 = trackToWorld(track, bb.max.x, bb.max.y, bb.max.z);
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
      `[TrackWalls] ${track.id} road boundary segments: ${boundaryCount}, total with outer fence: ${segs.length}`
    );
    return segs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, selectedTrackId, track]);

  // Publish collision segments for the PlayerController.
  useEffect(() => {
    // Strip render-only fields before storing.
    setWallSegments(
      // Keep the outer-fence flag for the UI map. Collision only reads the
      // coordinates, while the minimap can exclude this artificial safety
      // rectangle and draw the real black-road outline.
      segments.map((s) => ({
        ax: s.ax,
        az: s.az,
        bx: s.bx,
        bz: s.bz,
        y: s.y,
        outer: Boolean(s.outer),
      }))
    );
    return () => setWallSegments([]);
  }, [segments, setWallSegments]);

  // Visible subset: natural-wall tracks hide the red/white road-edge
  // barriers (collision above still stops the kart invisibly) and render
  // only the gray outer safety fence.
  const visibleSegments = useMemo(
    () => (track.naturalWalls ? segments.filter((s) => s.outer) : segments),
    [segments, track]
  );

  // Build the visible barrier instances.
  useLayoutEffect(() => {
    const mesh = instancedRef.current;
    if (!mesh || visibleSegments.length === 0) return;
    const dummy = new THREE.Object3D();
    const red = new THREE.Color("#d6362c");
    const white = new THREE.Color("#f2ede4");
    const gray = new THREE.Color("#5b6b7f");

    for (let i = 0; i < visibleSegments.length; i++) {
      const s = visibleSegments[i];
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
  }, [visibleSegments]);

  if (visibleSegments.length === 0) return null;

  return (
    <instancedMesh
      ref={instancedRef}
      name="wall-barrier"
      args={[undefined, undefined, visibleSegments.length]}
      frustumCulled={false}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.6} metalness={0.05} />
    </instancedMesh>
  );
}

useGLTF.preload("./models/mario-circuit-test-transformed.glb");

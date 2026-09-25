import * as THREE from "three";

// These values must stay in sync with the <Track> group in
// models/Mario-circuit-test.jsx.  The road helpers work directly with the
// source GLTF geometry, then convert every point into the playable world.
export const TRACK_OFFSET = new THREE.Vector3(155, -28, 15);
export const TRACK_SCALE = 0.08;

const EPSILON = 1e-7;
const samplerCache = new WeakMap();

export const getBlackRoadGeometry = (nodes) =>
  nodes?.Object_24?.geometry ?? nodes?.Object_25?.geometry ?? null;

const toWorldPoint = (position, index) => ({
  x: position.getX(index) * TRACK_SCALE + TRACK_OFFSET.x,
  y: position.getY(index) * TRACK_SCALE + TRACK_OFFSET.y,
  z: position.getZ(index) * TRACK_SCALE + TRACK_OFFSET.z,
});

const triangleProjectedArea = (a, b, c) =>
  Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) * 0.5;

const triangleNormalY = (a, b, c) =>
  (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);

/**
 * Turns the actual black-road triangles into a compact world-space sampler.
 * It is cached per GLTF geometry, so item spawning and Reset never rebuild it
 * during normal play.
 */
const makeRoadSampler = (geometry) => {
  const position = geometry?.attributes?.position;
  if (!position) return null;

  const index = geometry.index?.array ?? null;
  const triangleCount = index ? Math.floor(index.length / 3) : Math.floor(position.count / 3);
  const upward = [];
  const downward = [];

  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const base = triangleIndex * 3;
    const ia = index ? index[base] : base;
    const ib = index ? index[base + 1] : base + 1;
    const ic = index ? index[base + 2] : base + 2;

    const a = toWorldPoint(position, ia);
    const b = toWorldPoint(position, ib);
    const c = toWorldPoint(position, ic);
    const area = triangleProjectedArea(a, b, c);
    if (area <= EPSILON) continue;

    const triangle = {
      a,
      b,
      c,
      area,
      cx: (a.x + b.x + c.x) / 3,
      cy: (a.y + b.y + c.y) / 3,
      cz: (a.z + b.z + c.z) / 3,
    };

    // The black road is a top-facing mesh.  Some exported GLTFs reverse
    // winding, so keep both sets and choose the dominant side below.
    if (triangleNormalY(a, b, c) >= 0) upward.push(triangle);
    else downward.push(triangle);
  }

  const totalArea = (list) => list.reduce((sum, triangle) => sum + triangle.area, 0);
  const upwardArea = totalArea(upward);
  const downwardArea = totalArea(downward);
  const triangles = upwardArea >= downwardArea ? upward : downward;
  if (triangles.length === 0) return null;

  let cumulativeArea = 0;
  for (const triangle of triangles) {
    cumulativeArea += triangle.area;
    triangle.cumulativeArea = cumulativeArea;
  }

  return { triangles, totalArea: cumulativeArea };
};

const getRoadSampler = (geometry) => {
  if (!geometry) return null;
  const cached = samplerCache.get(geometry);
  if (cached) return cached;

  const sampler = makeRoadSampler(geometry);
  if (sampler) samplerCache.set(geometry, sampler);
  return sampler;
};

const chooseTriangle = (sampler, random) => {
  const target = Math.max(0, Math.min(0.999999999, random())) * sampler.totalArea;
  let low = 0;
  let high = sampler.triangles.length - 1;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (sampler.triangles[middle].cumulativeArea < target) low = middle + 1;
    else high = middle;
  }

  return sampler.triangles[low];
};

/**
 * Returns a uniformly distributed point on the playable black road only.
 * Sampling the true road triangles avoids the old bounding-box behaviour
 * that could put item boxes on grass or outside the course.
 */
export const sampleBlackRoadPoint = (geometry, random = Math.random) => {
  const sampler = getRoadSampler(geometry);
  if (!sampler) return null;

  const triangle = chooseTriangle(sampler, random);
  const root = Math.sqrt(Math.max(0, Math.min(1, random())));
  const u = 1 - root;
  const v = root * Math.max(0, Math.min(1, random()));
  const w = 1 - u - v;

  return {
    x: triangle.a.x * u + triangle.b.x * v + triangle.c.x * w,
    y: triangle.a.y * u + triangle.b.y * v + triangle.c.y * w,
    z: triangle.a.z * u + triangle.b.z * v + triangle.c.z * w,
  };
};

const closestPointOnSegmentXZ = (x, z, a, b) => {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  const t =
    lengthSq <= EPSILON
      ? 0
      : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lengthSq));

  return {
    x: a.x + dx * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + dz * t,
  };
};

const pointInTriangleXZ = (x, z, triangle) => {
  const { a, b, c } = triangle;
  const denominator = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
  if (Math.abs(denominator) <= EPSILON) return null;

  const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / denominator;
  const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / denominator;
  const w = 1 - u - v;

  if (u < -EPSILON || v < -EPSILON || w < -EPSILON) return null;
  return {
    x,
    y: a.y * u + b.y * v + c.y * w,
    z,
  };
};

const distanceSqXZ = (x, z, point) => {
  const dx = x - point.x;
  const dz = z - point.z;
  return dx * dx + dz * dz;
};

/**
 * Finds the nearest point on the black road in the XZ plane.  This is used by
 * Reset, where "nearest" needs to mean nearest visible road rather than the
 * nearest general ground mesh (which includes grass, scenery and barriers).
 */
export const findNearestBlackRoadPoint = (geometry, x, z) => {
  const sampler = getRoadSampler(geometry);
  if (!sampler || !Number.isFinite(x) || !Number.isFinite(z)) return null;

  let best = null;
  let bestDistanceSq = Infinity;
  let bestTriangle = null;

  for (const triangle of sampler.triangles) {
    const inside = pointInTriangleXZ(x, z, triangle);
    if (inside) {
      return { ...inside, distance: 0, triangle };
    }

    for (const [start, end] of [
      [triangle.a, triangle.b],
      [triangle.b, triangle.c],
      [triangle.c, triangle.a],
    ]) {
      const candidate = closestPointOnSegmentXZ(x, z, start, end);
      const distanceSq = distanceSqXZ(x, z, candidate);
      if (distanceSq < bestDistanceSq) {
        best = candidate;
        bestDistanceSq = distanceSq;
        bestTriangle = triangle;
      }
    }
  }

  if (!best || !bestTriangle) return null;

  // An off-road reset normally lands at an edge. Blend a little toward the
  // owning road triangle so the kart is safely on black asphalt, not inside a
  // collision barrier sitting directly on the edge.
  const centroidDx = bestTriangle.cx - best.x;
  const centroidDz = bestTriangle.cz - best.z;
  const centroidDistance = Math.hypot(centroidDx, centroidDz);
  const inset = Math.min(1.2, centroidDistance * 0.22);
  const insetT = centroidDistance > EPSILON ? inset / centroidDistance : 0;

  return {
    x: best.x + centroidDx * insetT,
    y: best.y + (bestTriangle.cy - best.y) * insetT,
    z: best.z + centroidDz * insetT,
    distance: Math.sqrt(bestDistanceSq),
    triangle: bestTriangle,
  };
};

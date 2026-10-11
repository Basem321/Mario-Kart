import * as THREE from "three";

// These values must stay in sync with the <Track> group in
// models/Mario-circuit-test.jsx.  The road helpers work directly with the
// source GLTF geometry, then convert every point into the playable world.
export const TRACK_OFFSET = new THREE.Vector3(155, -28, 15);
export const TRACK_SCALE = 0.08;

// Per-track transform override: { scale, offset: {x, y, z} }.
// Defaults to the Mario Circuit transform so existing single-argument calls
// keep working unchanged.
const DEFAULT_TRANSFORM = {
  scale: TRACK_SCALE,
  offset: { x: TRACK_OFFSET.x, y: TRACK_OFFSET.y, z: TRACK_OFFSET.z },
};

const resolveTransform = (transform) => {
  if (
    transform &&
    Number.isFinite(transform.scale) &&
    transform.offset &&
    Number.isFinite(transform.offset.x) &&
    Number.isFinite(transform.offset.y) &&
    Number.isFinite(transform.offset.z)
  ) {
    return transform;
  }
  return DEFAULT_TRANSFORM;
};

export const trackConfigToTransform = (track) =>
  track
    ? { scale: track.scale, offset: { x: track.offset[0], y: track.offset[1], z: track.offset[2] } }
    : DEFAULT_TRANSFORM;

const EPSILON = 1e-7;
const samplerCache = new WeakMap();

export const getBlackRoadGeometry = (nodes) =>
  nodes?.Object_24?.geometry ?? nodes?.Object_25?.geometry ?? null;

const toWorldPoint = (position, index, transform) => ({
  x: position.getX(index) * transform.scale + transform.offset.x,
  y: position.getY(index) * transform.scale + transform.offset.y,
  z: position.getZ(index) * transform.scale + transform.offset.z,
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
const makeRoadSampler = (geometry, transform) => {
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

    const a = toWorldPoint(position, ia, transform);
    const b = toWorldPoint(position, ib, transform);
    const c = toWorldPoint(position, ic, transform);
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

  // Spatial index for the proximity queries below (built once, reused by
  // every isOffRoad / rescue / Lakitu check for the whole session).
  const grid = buildTriangleGrid(triangles);

  return { triangles, totalArea: cumulativeArea, grid };
};

export const getRoadSampler = (geometry, transform) => {
  if (!geometry) return null;
  // Geometries are unique per track (merged road cache), so one entry each.
  const cached = samplerCache.get(geometry);
  if (cached) return cached;

  const sampler = makeRoadSampler(geometry, resolveTransform(transform));
  if (sampler) samplerCache.set(geometry, sampler);
  return sampler;
};

const mapDataCache = new WeakMap();

// --- Uniform XZ grid over the road triangles -------------------------------
// The linear scans below looped all ~15k road triangles (3 segment probes +
// temporaries each) every 100ms / 15 frames / 20 frames — GC churn + hitches.
// The grid is built once per sampler and turns those scans into cell + ring
// lookups with identical results.
const GRID_CELL = 8;
const GRID_BIG_TRI_MAX_CELLS = 256;

const buildTriangleGrid = (triangles) => {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const t of triangles) {
    if (t.a.x < minX) minX = t.a.x;
    if (t.b.x < minX) minX = t.b.x;
    if (t.c.x < minX) minX = t.c.x;
    if (t.a.x > maxX) maxX = t.a.x;
    if (t.b.x > maxX) maxX = t.b.x;
    if (t.c.x > maxX) maxX = t.c.x;
    if (t.a.z < minZ) minZ = t.a.z;
    if (t.b.z < minZ) minZ = t.b.z;
    if (t.c.z < minZ) minZ = t.c.z;
    if (t.a.z > maxZ) maxZ = t.a.z;
    if (t.b.z > maxZ) maxZ = t.b.z;
    if (t.c.z > maxZ) maxZ = t.c.z;
  }
  const cells = new Map();
  const big = [];
  const cellOf = (x, z) => [
    Math.floor((x - minX) / GRID_CELL),
    Math.floor((z - minZ) / GRID_CELL),
  ];
  triangles.forEach((t, index) => {
    const tMinX = Math.min(t.a.x, t.b.x, t.c.x);
    const tMaxX = Math.max(t.a.x, t.b.x, t.c.x);
    const tMinZ = Math.min(t.a.z, t.b.z, t.c.z);
    const tMaxZ = Math.max(t.a.z, t.b.z, t.c.z);
    const [c0x, c0z] = cellOf(tMinX, tMinZ);
    const [c1x, c1z] = cellOf(tMaxX, tMaxZ);
    const span = (c1x - c0x + 1) * (c1z - c0z + 1);
    if (span > GRID_BIG_TRI_MAX_CELLS) {
      big.push(index);
      return;
    }
    for (let cx = c0x; cx <= c1x; cx += 1) {
      for (let cz = c0z; cz <= c1z; cz += 1) {
        const key = cx * 100000 + cz;
        let list = cells.get(key);
        if (!list) {
          list = [];
          cells.set(key, list);
        }
        list.push(index);
      }
    }
  });
  return { minX, minZ, cells, big, count: triangles.length };
};

const gridCellList = (grid, cx, cz) => grid.cells.get(cx * 100000 + cz);

const gridTrianglesInCell = (grid, triangles, x, z) => {
  const cx = Math.floor((x - grid.minX) / GRID_CELL);
  const cz = Math.floor((z - grid.minZ) / GRID_CELL);
  const list = gridCellList(grid, cx, cz);
  const out = [];
  if (list) {
    for (const i of list) out.push(triangles[i]);
  }
  for (const i of grid.big) out.push(triangles[i]);
  return out;
};

export const getRoadMapData = (geometry, transform) => {
  if (!geometry) return null;
  const cached = mapDataCache.get(geometry);
  if (cached) return cached;

  const sampler = getRoadSampler(geometry, transform);
  if (!sampler || sampler.triangles.length === 0) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  const edges = new Map();

  for (const tri of sampler.triangles) {
    for (const p of [tri.a, tri.b, tri.c]) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }

    const triEdges = [
      [tri.a, tri.b],
      [tri.b, tri.c],
      [tri.c, tri.a],
    ];

    for (const [p1, p2] of triEdges) {
      const k1 = `${Math.round(p1.x * 20)},${Math.round(p1.z * 20)}`;
      const k2 = `${Math.round(p2.x * 20)},${Math.round(p2.z * 20)}`;
      const key = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
      const existing = edges.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        edges.set(key, { ax: p1.x, az: p1.z, bx: p2.x, bz: p2.z, count: 1 });
      }
    }
  }

  const boundaryEdges = [];
  for (const entry of edges.values()) {
    if (entry.count === 1) {
      boundaryEdges.push({
        ax: entry.ax,
        az: entry.az,
        bx: entry.bx,
        bz: entry.bz,
      });
    }
  }

  const roadTriangles = sampler.triangles.map((tri) => ({
    a: { x: tri.a.x, z: tri.a.z },
    b: { x: tri.b.x, z: tri.b.z },
    c: { x: tri.c.x, z: tri.c.z },
  }));

  const result = {
    triangles: roadTriangles,
    boundaryEdges,
    minX,
    maxX,
    minZ,
    maxZ,
  };

  mapDataCache.set(geometry, result);
  return result;
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
export const sampleBlackRoadPoint = (geometry, transform, random = Math.random) => {
  const sampler = getRoadSampler(geometry, transform);
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
 *
 * Grid + ring expansion: identical results to the old full scan (rings stop
 * only once every unvisited triangle is provably farther than the best hit).
 * `y`/`yTol` (world units) optionally restrict the inside match to the kart's
 * own level, so a kart driving UNDER a bridge doesn't count as on the road
 * above it. Edge probes stay XZ-only, exactly like before.
 */
export const findNearestBlackRoadPoint = (geometry, x, z, transform, y = null, yTol = 7) => {
  const sampler = getRoadSampler(geometry, transform);
  if (!sampler || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  const { triangles, grid } = sampler;
  const levelAware = Number.isFinite(y);

  // Fast path: containing cell usually holds the answer for on-road karts.
  if (grid) {
    for (const triangle of gridTrianglesInCell(grid, triangles, x, z)) {
      const inside = pointInTriangleXZ(x, z, triangle);
      if (inside && (!levelAware || Math.abs(inside.y - y) <= yTol)) {
        return { ...inside, distance: 0, triangle };
      }
    }
  }

  // Ring expansion over grid cells (or full scan when no grid).
  let best = null;
  let bestDistanceSq = Infinity;
  let bestTriangle = null;
  const consider = (triangle) => {
    const inside = pointInTriangleXZ(x, z, triangle);
    if (inside) {
      if (!levelAware || Math.abs(inside.y - y) <= yTol) {
        best = inside;
        bestDistanceSq = 0;
        bestTriangle = triangle;
      }
      return;
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
  };

  if (grid) {
    const ccx = Math.floor((x - grid.minX) / GRID_CELL);
    const ccz = Math.floor((z - grid.minZ) / GRID_CELL);
    const seen = new Set();
    // Oversized triangles live outside the grid: always scan them.
    for (const i of grid.big) {
      seen.add(i);
      consider(triangles[i]);
      if (bestDistanceSq === 0) break;
    }
    for (let r = 0; r < 400; r += 1) {
      // Termination: rings beyond r sit at least (r-1)*CELL away — past best.
      if (r > 0 && (r - 1) * GRID_CELL > Math.sqrt(bestDistanceSq)) break;
      for (let dx = -r; dx <= r; dx += 1) {
        for (let dz = -r; dz <= r; dz += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const list = gridCellList(grid, ccx + dx, ccz + dz);
          if (!list) continue;
          for (const i of list) {
            if (seen.has(i)) continue;
            seen.add(i);
            consider(triangles[i]);
            if (bestDistanceSq === 0) break;
          }
          if (bestDistanceSq === 0) break;
        }
        if (bestDistanceSq === 0) break;
      }
      if (bestDistanceSq === 0) break;
    }
  } else {
    for (const triangle of triangles) {
      consider(triangle);
      if (bestDistanceSq === 0) break;
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

/**
 * Off-track check: true when (x, z) lies outside the black-road triangles
 * by more than `slack` world units (dirt + grass both count as off-track).
 * Returns false when the road index is missing so loading never slowdowns.
 * Pass the kart's height `y` so stacked decks don't count: a kart under a
 * bridge is off-track unless its own level is road.
 */
export const isOffRoad = (geometry, x, z, transform, slack = 1.0, y = null) => {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  let hit = null;
  try {
    hit = findNearestBlackRoadPoint(geometry, x, z, transform, y);
  } catch {
    return false;
  }
  if (!hit) return false;
  return Number(hit.distance) > Number(slack);
};

/**
 * 3D-aware rescue query. The XZ-only version above returns the kart's own XZ
 * whenever it sits inside ANY road triangle — including the elevated deck of
 * a jump while the kart is trapped in the pit underneath it (Waluigi Stadium
 * big jump: deck at y≈8 stacked directly above the pit floor at y≈-4, and the
 * pit floor itself is road mesh). Such a "reset" changes nothing and the kart
 * can never climb out: steep dirt walls are skipped by the wheel-height
 * raycasts and push the kart back via the horizontal mesh-wall ray, while
 * head-on slowdown kills all speed.
 *
 * Strategy: take the 3D-nearest road point, but when it is the kart's own
 * spot on its own level (the pocket-trap no-op case), look for the nearest
 * road level strictly ABOVE instead — Lakitu always puts you back on top,
 * never down into a hole. Pressing Reset while legitimately parked on a deck
 * therefore keeps you on that deck (nothing above it).
 */
export const findNearestBlackRoadPoint3D = (geometry, x, y, z, transform) => {
  const sampler = getRoadSampler(geometry, transform);
  if (
    !sampler ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(z)
  )
    return null;
  const { triangles, grid } = sampler;

  // Road levels less than this apart count as the SAME driving level.
  // (The stadium pit sits ~12 units below its deck, so 3 separates cleanly.)
  const LEVEL_GAP = 3;
  // XZ distance below which a rescue target counts as "the kart's own spot".
  const SAME_SPOT = 1.5;
  // The above-level escape only applies when stacked road floats (nearly)
  // overhead — otherwise a driver parked on a lower road would get teleported
  // to a far-away deck instead of staying put (a skippable shortcut).
  const ABOVE_RADIUS = 4;

  const nearest = (mustBeAbove) => {
    let best = null;
    let bestDistanceSq = Infinity;
    let bestTriangle = null;

    const consider = (triangle) => {
      const inside = pointInTriangleXZ(x, z, triangle);
      const candidates = inside
        ? [inside]
        : [
            closestPointOnSegmentXZ(x, z, triangle.a, triangle.b),
            closestPointOnSegmentXZ(x, z, triangle.b, triangle.c),
            closestPointOnSegmentXZ(x, z, triangle.c, triangle.a),
          ];
      for (const candidate of candidates) {
        if (mustBeAbove) {
          if (candidate.y - y < LEVEL_GAP) continue;
          const dxz = Math.hypot(x - candidate.x, z - candidate.z);
          if (dxz > ABOVE_RADIUS) continue;
        }
        const dx = x - candidate.x;
        const dy = y - candidate.y;
        const dz = z - candidate.z;
        const distanceSq = dx * dx + dy * dy + dz * dz;
        if (distanceSq < bestDistanceSq) {
          best = candidate;
          bestDistanceSq = distanceSq;
          bestTriangle = triangle;
        }
      }
    };

    if (grid) {
      // mustBeAbove searches a tiny XZ radius: clamp rings to it.
      const maxRing = mustBeAbove ? Math.ceil(ABOVE_RADIUS / GRID_CELL) + 1 : 400;
      const ccx = Math.floor((x - grid.minX) / GRID_CELL);
      const ccz = Math.floor((z - grid.minZ) / GRID_CELL);
      const seen = new Set();
      for (const i of grid.big) {
        seen.add(i);
        consider(triangles[i]);
      }
      for (let r = 0; r < maxRing; r += 1) {
        // XZ lower bound of further rings exceeds the best 3D distance.
        if (r > 0 && (r - 1) * GRID_CELL > Math.sqrt(bestDistanceSq)) break;
        for (let dx = -r; dx <= r; dx += 1) {
          for (let dz = -r; dz <= r; dz += 1) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const list = gridCellList(grid, ccx + dx, ccz + dz);
            if (!list) continue;
            for (const i of list) {
              if (seen.has(i)) continue;
              seen.add(i);
              consider(triangles[i]);
            }
          }
        }
      }
    } else {
      for (const triangle of triangles) consider(triangle);
    }

    if (!best || !bestTriangle) return null;
    return { best, bestDistanceSq, bestTriangle };
  };

  const applyEdgeInset = ({ best, bestDistanceSq, bestTriangle }) => {
    // Same edge inset as the XZ version: keep the rescued kart off barriers.
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

  const overall = nearest(false);
  if (!overall) return null;

  const sameSpot =
    Math.hypot(overall.best.x - x, overall.best.z - z) < SAME_SPOT;
  const sameLevel = Math.abs(overall.best.y - y) < LEVEL_GAP;
  if (!sameSpot || !sameLevel) return applyEdgeInset(overall);

  // Pocket trap: nearest road is the floor the kart already sits on.
  // Rescue onto the closest level above (the deck over the pit).
  const above = nearest(true);
  if (!above) return applyEdgeInset(overall);
  return applyEdgeInset(above);
};

/**
 * Highest road-surface Y directly above (x, z), or null when the kart is not
 * under stacked road. Used to detect the trapped-under-the-deck state: the
 * kart sits in a pit whose floor IS road mesh (so the XZ reset no-ops) while
 * a whole other driving level floats several units overhead.
 */
export const getHighestRoadYAt = (geometry, x, z, transform) => {
  const sampler = getRoadSampler(geometry, transform);
  if (!sampler || !Number.isFinite(x) || !Number.isFinite(z)) return null;

  // Every triangle containing (x, z) is registered in the query cell, so the
  // max over the cell is the exact global max.
  const candidates = sampler.grid
    ? gridTrianglesInCell(sampler.grid, sampler.triangles, x, z)
    : sampler.triangles;
  let highest = null;
  for (const triangle of candidates) {
    const inside = pointInTriangleXZ(x, z, triangle);
    if (inside && (highest === null || inside.y > highest)) {
      highest = inside.y;
    }
  }
  return highest;
};

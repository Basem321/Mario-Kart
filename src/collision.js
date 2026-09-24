import { kartSettings } from "./constants";

const collisionSettings = kartSettings.collision || {};
export const KART_RADIUS = collisionSettings.radius ?? 1.0;
// Keep a little extra skin so the kart visually stops before clipping the wall.
export const WALL_SKIN = collisionSettings.skin ?? 0.15;
// How much speed is kept after scraping a wall (1 = no slowdown).
export const WALL_FRICTION = collisionSettings.friction ?? 0.82;
// Head-on hits slow down harder.
export const WALL_HEAD_ON_SLOWDOWN = collisionSettings.headOnSlowdown ?? 0.45;

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Push a circle (kart) out of a single 2D wall segment.
 * Mutates `pos` ({x, z}) in place.
 * `motionX/Z` is this substep's movement, used to break ties when the
 * kart center lands exactly on the wall (push back where it came from
 * so it can never pop through to the wrong side).
 * Returns { hit, nx, nz, penetration }.
 */
export function collideCircleWithSegment(
  pos,
  radius,
  seg,
  motionX = 0,
  motionZ = 0
) {
  const abx = seg.bx - seg.ax;
  const abz = seg.bz - seg.az;
  const lenSq = abx * abx + abz * abz;
  if (lenSq < 1e-8) return { hit: false, nx: 0, nz: 0, penetration: 0 };

  const t = clamp01(((pos.x - seg.ax) * abx + (pos.z - seg.az) * abz) / lenSq);
  const cx = seg.ax + abx * t;
  const cz = seg.az + abz * t;

  const dx = pos.x - cx;
  const dz = pos.z - cz;
  const d2 = dx * dx + dz * dz;

  if (d2 >= radius * radius) return { hit: false, nx: 0, nz: 0, penetration: 0 };

  const d = Math.sqrt(d2);
  let nx;
  let nz;
  let penetration;
  if (d > 1e-6) {
    nx = dx / d;
    nz = dz / d;
    penetration = radius - d;
  } else {
    // Center exactly on the wall: push back against the motion so the
    // kart ends up on the side it came from (never tunnels through).
    const len = Math.sqrt(lenSq);
    nx = -abz / len;
    nz = abx / len;
    if (nx * motionX + nz * motionZ > 0) {
      nx = -nx;
      nz = -nz;
    }
    penetration = radius;
  }

  pos.x += nx * penetration;
  pos.z += nz * penetration;
  return { hit: true, nx, nz, penetration };
}

/**
 * Resolve kart position against all wall segments.
 *
 * @param {number} prevX previous safe X
 * @param {number} prevZ previous safe Z
 * @param {number} desiredX where the kart wants to go
 * @param {number} desiredZ where the kart wants to go
 * @param {Array} segments wall segments [{ax,az,bx,bz}]
 * @param {number} radius kart collision radius
 * @returns {{x, z, hit, nx, nz}} corrected position + hit info
 *
 * Uses substeps so fast karts can't tunnel through thin walls,
 * and iterates push-out twice per substep so corners resolve cleanly.
 */
export function resolveWallCollision(
  prevX,
  prevZ,
  desiredX,
  desiredZ,
  segments,
  radius = KART_RADIUS
) {
  if (!segments || segments.length === 0) {
    return { x: desiredX, z: desiredZ, hit: false, nx: 0, nz: 0 };
  }

  const r = radius + WALL_SKIN;
  const totalDX = desiredX - prevX;
  const totalDZ = desiredZ - prevZ;
  const dist = Math.hypot(totalDX, totalDZ);
  // Substep so no single step moves more than ~1/3 of the radius.
  const steps = Math.min(12, Math.max(1, Math.ceil(dist / (r * 0.3))));

  const pos = { x: prevX, z: prevZ };
  let hit = false;
  let hitNX = 0;
  let hitNZ = 0;

  for (let s = 0; s < steps; s++) {
    const stepDX = totalDX / steps;
    const stepDZ = totalDZ / steps;
    pos.x += stepDX;
    pos.z += stepDZ;

    // 2 relaxation passes handle corners (two walls at once).
    for (let iter = 0; iter < 2; iter++) {
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        // Broadphase: skip walls far from the kart.
        // (Cheap AABB check expanded by radius.)
        const minX = seg.ax < seg.bx ? seg.ax : seg.bx;
        const maxX = seg.ax > seg.bx ? seg.ax : seg.bx;
        const minZ = seg.az < seg.bz ? seg.az : seg.bz;
        const maxZ = seg.az > seg.bz ? seg.az : seg.bz;
        if (
          pos.x < minX - r - 0.5 ||
          pos.x > maxX + r + 0.5 ||
          pos.z < minZ - r - 0.5 ||
          pos.z > maxZ + r + 0.5
        ) {
          continue;
        }
        const res = collideCircleWithSegment(pos, r, seg, stepDX, stepDZ);
        if (res.hit) {
          hit = true;
          hitNX = res.nx;
          hitNZ = res.nz;
        }
      }
    }
  }

  return { x: pos.x, z: pos.z, hit, nx: hitNX, nz: hitNZ };
}

/**
 * Given a wall hit, compute the speed multiplier.
 * Glancing scrapes keep most speed, head-on impacts slow down hard.
 * NOTE: `nx/nz` is the push-out normal (wall -> kart), so motion INTO
 * the wall has a negative dot with the normal.
 */
export function wallSpeedFactor(motionX, motionZ, nx, nz) {
  const motionLen = Math.hypot(motionX, motionZ);
  if (motionLen < 1e-6) return 1;
  const intoWall = -((motionX * nx + motionZ * nz) / motionLen); // 1 = head-on
  if (intoWall <= 0) return 1; // moving away / parallel
  if (intoWall > 0.7) return WALL_HEAD_ON_SLOWDOWN; // head-on
  if (intoWall > 0.35) return (WALL_FRICTION + WALL_HEAD_ON_SLOWDOWN) / 2;
  return WALL_FRICTION; // gentle scrape
}

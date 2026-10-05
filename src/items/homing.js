// Red-shell homing steering (pure math on plain {x, z} vectors).
// Simulation + rendering live in ItemBoxes.jsx; P2P in useP2PLobby.js.

import { itemConfig } from "./itemConfig.js";
import { kartSettings } from "../constants.js";

export const RED_MAX_TURN = 2.2; // rad/s, per spec
export const RED_HIT_RADIUS = 3.4; // same as BOMB_TRIGGER_RADIUS
export const RED_LIFE_MS = 6000;
export const RED_SPEED = 93; // 1.5x pad boost speed (62), per spec
export const RED_STUN_MS = 1600;

// Blue shell constants — owned by itemConfig (§8), re-exported for compat.
export const BLUE_BLAST_RADIUS = itemConfig.blueShell.radius;
export const BLUE_FLY_HEIGHT = itemConfig.blueShell.altitude;
export const BLUE_SPEED = itemConfig.blueShell.speedMult * kartSettings.speed.max;
export const BLUE_LIFE_MS = 12000;

// Bullet Bill constants — owned by itemConfig (§8). NOTE: 1.6x base max is
// slower than boost pads; flagged for playtest tuning (one config line).
export const BULLET_SPEED = itemConfig.bullet.speedMult * kartSettings.speed.max;
export const BULLET_RIDE_MS = 5000;
export const BULLET_KNOCK_RADIUS = 3.5;

export const bulletActive = (ride, now) =>
  !!ride && Number(ride.until) > Number(now);

// Ride phase with ramp-out: full autopilot, then 600ms speed ease while the
// player steers again, then done. endingUntil set by endBulletRide.
export const bulletPhase = (ride, now) => {
  if (!ride) return "done";
  const t = Number(now);
  if (t < Number(ride.until)) return "ride";
  if (Number.isFinite(Number(ride.endingUntil)) && t < Number(ride.endingUntil)) {
    return "ramp";
  }
  return "done";
};

// Victim-side hits (shell:hit, bullet:knock, blue:explode) apply ONLY while
// the local race is live — late/duplicate events must not stun behind the
// results screen or after disconnect.
export const shouldApplyHit = (race) =>
  !!race && race.gameStarted === true && race.gameOver === false;

// A bullet:knock is valid only when the SENDER currently owns that exact
// live ride — otherwise anyone could stun anyone at any range.
export const isValidKnock = ({ senderRide, rideId, now } = {}) =>
  !!senderRide &&
  senderRide.rideId === rideId &&
  bulletActive(senderRide, now);

// Blooper constants — owned by itemConfig (§8).
export const BLOOPER_INK_MS = itemConfig.blooper.durationMs;
export const BLOOPER_SQUIRT_MS = 1000;

// Expiry timestamp for a fresh ink hit. Re-fire overwrites (extends), never
// stacks — there is a single blooperUntil per client.
export const inkUntil = (now) => Number(now) + BLOOPER_INK_MS;

// Every racer ahead of self (same ahead rule as nearestAhead). Returns ids.
export const targetsAhead = (self, racers) => {
  if (!self || !Array.isArray(racers)) return [];
  const fx = Number(self.fx) || 0;
  const fz = Number(self.fz) === 0 ? 0 : Number(self.fz) || -1;
  const out = [];
  for (const r of racers) {
    if (!r || r.id === self.id) continue;
    // Bullet Bill riders are immune to ink (§4.5) — never targeted.
    if (r.bullet) continue;
    const laps = Number(r.laps) || 0;
    const selfLaps = Number(self.laps) || 0;
    if (laps < selfLaps) continue;
    const dx = Number(r.x) - Number(self.x);
    const dz = Number(r.z) - Number(self.z);
    if (laps === selfLaps && dx * fx + dz * fz <= 0) continue;
    out.push(r.id);
  }
  return out;
};

const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Turn dir toward toTarget by at most maxTurn*dt. Returns a unit vector.
export const steerShell = ({ dir, toTarget, maxTurn, dt } = {}) => {
  const dx = Number(dir?.x) || 0;
  const dz = Number(dir?.z) === 0 ? 0 : Number(dir?.z) || 1;
  const tx = Number(toTarget?.x) || 0;
  const tz = Number(toTarget?.z) || 0;
  if ((dx !== 0 || dz !== 0) && tx === 0 && tz === 0) {
    const len = Math.hypot(dx, dz) || 1;
    return { x: dx / len, z: dz / len };
  }
  const cur = Math.atan2(dx, dz);
  const want = Math.atan2(tx, tz);
  const diff = wrapPi(want - cur);
  const step = Math.max(
    -(Number(maxTurn) || 0) * (Number(dt) || 0),
    Math.min((Number(maxTurn) || 0) * (Number(dt) || 0), diff)
  );
  const next = cur + step;
  return { x: Math.sin(next), z: Math.cos(next) };
};

// Blue re-target rule: switch only when the new best has strictly more laps,
// or same laps with a 5+ unit distance lead — ties never flap the target.
export const retargetBlue = (currentId, rows) => {
  if (!Array.isArray(rows) || rows.length === 0) return currentId;
  const cur = rows.find((r) => r && r.id === currentId);
  let best = null;
  for (const r of rows) {
    if (!r || r.id === currentId) continue;
    if (!best) {
      best = r;
      continue;
    }
    if (Number(r.laps) > Number(best.laps)) best = r;
    else if (Number(r.laps) === Number(best.laps) && Number(r.dist) > Number(best.dist)) best = r;
  }
  if (!best || !cur) return best ? best.id : currentId;
  if (Number(best.laps) > Number(cur.laps)) return best.id;
  if (Number(best.laps) === Number(cur.laps) && Number(best.dist) - Number(cur.dist) >= 5) {
    return best.id;
  }
  return currentId;
};

// Dive gate: proximity AND the minimum flight time (warning always audible).
export const blueShouldDive = ({ distXZ = Infinity, flightMs = 0 } = {}) =>
  Number(distXZ) < 4 && Number(flightMs) >= itemConfig.blueShell.minFlightMs;

// Ids of racers within the blue blast radius of {x, z}.
export const resolveBlueBlast = (racers, blast, radius = BLUE_BLAST_RADIUS) => {
  if (!Array.isArray(racers) || !blast) return [];
  const r = Number(radius) || 0;
  return racers
    .filter(
      (v) =>
        v && Math.hypot(Number(v.x) - blast.x, Number(v.z) - blast.z) <= r
    )
    .map((v) => v.id);
};

// Throw arc: shells spawn above cruise height and ease down. Pure so the
// settle curve is testable; the sim applies it every frame.
export const cruiseSettle = (y, cruise, dt) =>
  y + (Number(cruise) - Number(y)) * Math.min(1, 6 * (Number(dt) || 0));

// Closest opponent ahead: higher lap count wins outright, otherwise must be
// in front of the self forward vector. Returns the racer or null.
export const nearestAhead = (self, racers) => {
  if (!self || !Array.isArray(racers)) return null;
  const fx = Number(self.fx) || 0;
  const fz = Number(self.fz) === 0 ? 0 : Number(self.fz) || -1;
  let best = null;
  let bestScore = Infinity;
  for (const r of racers) {
    if (!r || r.id === self.id) continue;
    const laps = Number(r.laps) || 0;
    const selfLaps = Number(self.laps) || 0;
    const dx = Number(r.x) - Number(self.x);
    const dz = Number(r.z) - Number(self.z);
    const dist = Math.hypot(dx, dz);
    if (laps < selfLaps) continue;
    if (laps === selfLaps && dx * fx + dz * fz <= 0) continue;
    // Higher laps dominate; within a lap, closer wins.
    const score = (selfLaps - laps) * 1e6 + dist;
    if (score < bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
};

// Red-shell target lock (v3 §4.3): nearest racer AHEAD inside lockRange
// units and the lockConeDeg cone around the shooter forward, else null.
export const coneLock = (self, racers) => {
  if (!self || !Array.isArray(racers)) return null;
  const cfg = itemConfig.redShell;
  const fx = Number(self.fx) || 0;
  const fz = Number(self.fz) === 0 ? 0 : Number(self.fz) || -1;
  const cosLimit = Math.cos(((cfg.lockConeDeg / 2) * Math.PI) / 180);
  let best = null;
  let bestDist = Infinity;
  for (const r of racers) {
    if (!r || r.id === self.id) continue;
    const dx = Number(r.x) - Number(self.x);
    const dz = Number(r.z) - Number(self.z);
    const dist = Math.hypot(dx, dz);
    if (dist > cfg.lockRange || dist < 1e-6) continue;
    if ((dx * fx + dz * fz) / dist < cosLimit) continue;
    if (dist < bestDist) {
      bestDist = dist;
      best = r;
    }
  }
  return best;
};

// Wall bounce: reflect dir on the wall normal, spend one bounce.
// Returns {dx, dz, left} or null when bounces are exhausted (shell drops).
export const bounceShell = (dir, normal, bouncesLeft) => {
  const left = Number(bouncesLeft) || 0;
  if (left <= 0) return null;
  const dx = Number(dir?.x) || 0;
  const dz = Number(dir?.z) || 0;
  const nx = Number(normal?.x) || 0;
  const nz = Number(normal?.z) || 0;
  const dot = dx * nx + dz * nz;
  return { dx: dx - 2 * dot * nx, dz: dz - 2 * dot * nz, left: left - 1 };
};

// Wall face for shell bounces: first flat XZ segment within radius of the
// point, normal facing back toward the point. Null when no wall is near.
export const wallHitNormal = (x, z, segments, radius = 1) => {
  if (!Array.isArray(segments)) return null;
  const px = Number(x);
  const pz = Number(z);
  for (const s of segments) {
    const ax = Number(s?.ax);
    const az = Number(s?.az);
    const bx = Number(s?.bx);
    const bz = Number(s?.bz);
    if (![ax, az, bx, bz].every(Number.isFinite)) continue;
    const abx = bx - ax;
    const abz = bz - az;
    const lenSq = abx * abx + abz * abz || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / lenSq));
    const cx = ax + abx * t;
    const cz = az + abz * t;
    const dx = px - cx;
    const dz = pz - cz;
    const d = Math.hypot(dx, dz);
    if (d <= radius && d > 1e-6) return { x: dx / d, z: dz / d };
  }
  return null;
};

// Triple orbit angle from the SHARED race clock (degrees): peers never send
// orbit data, phases stay in sync through raceTimeMs.
export const orbitAngle = (raceTimeMs, index) => {
  const deg = (Number(raceTimeMs) / 1000) * itemConfig.orbit.degPerSec;
  return (((deg + Number(index) * 120) % 360) + 360) % 360;
};

// Triple absorb matrix (§4.3): orbiting shells eat red shells and bomb
// blasts only. Everything else passes through.
const ABSORBABLE = new Set(["red", "bomb"]);
export const absorbedByOrbit = (incomingKind) => ABSORBABLE.has(incomingKind);

// Release-time spawns: the press commits immediately, the projectile appears
// at pressAt + releaseMs (throw animation sync).
export const spawnDue = (pending, now) =>
  !!pending && Number(now) >= Number(pending.pressAt) + Number(pending.releaseMs);

// Spin-out windows (T8 core, frozen name): light/heavy spin then shared
// hit-invulnerability. All on the performance.now clock. ms overrides the
// preset (bullet touch = 1000ms) with the same invuln tail.
export const spinWindows = ({ heavy = false, ms = null, now = 0 } = {}) => {
  const spinMs = Number.isFinite(ms) ? ms : heavy ? itemConfig.hit.heavyMs : itemConfig.hit.lightMs;
  return {
    spinUntil: Number(now) + spinMs,
    invulnUntil: Number(now) + spinMs + itemConfig.hitInvulnMs,
  };
};

// Input gates during spin/invuln: no steering or item use while spinning;
// mushrooms stay usable while merely invulnerable.
export const spinBlocked = ({ spinUntil = 0, invulnUntil = 0, now = 0 } = {}) => {
  void invulnUntil;
  if (Number(now) < Number(spinUntil)) return { steer: false, use: false };
  return { steer: true, use: true };
};

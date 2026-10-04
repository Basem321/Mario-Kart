// Red-shell homing steering (pure math on plain {x, z} vectors).
// Simulation + rendering live in ItemBoxes.jsx; P2P in useP2PLobby.js.

export const RED_MAX_TURN = 2.2; // rad/s, per spec
export const RED_HIT_RADIUS = 3.4; // same as BOMB_TRIGGER_RADIUS
export const RED_LIFE_MS = 6000;
export const RED_SPEED = 93; // 1.5x pad boost speed (62), per spec
export const RED_STUN_MS = 1600;

// Blue shell constants, per spec.
export const BLUE_BLAST_RADIUS = 8;
export const BLUE_FLY_HEIGHT = 6;
export const BLUE_SPEED = 60;
export const BLUE_LIFE_MS = 12000;

// Bullet Bill constants, per spec.
export const BULLET_SPEED = 124; // ~2x pad boost speed (62)
export const BULLET_RIDE_MS = 5000;
export const BULLET_KNOCK_RADIUS = 3.5;

export const bulletActive = (ride, now) =>
  !!ride && Number(ride.until) > Number(now);

// Blooper constants, per spec.
export const BLOOPER_INK_MS = 6000;
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

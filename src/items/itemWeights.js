// Position-weighted item roulette (pure logic, no React/Three).
// Consumed by ItemBoxes pickup; each item task relies on these exact shapes.

export const GOLDEN_MS = 7000;
export const ROULETTE_MS = 1200;

const SOLO_TABLE = [
  ["mushroom", 70],
  ["triple", 30],
];

const FIRST_TABLE = [
  ["mushroom", 60],
  ["triple", 25],
  ["red", 15],
];

const MID_TABLE = [
  ["mushroom", 30],
  ["triple", 20],
  ["golden", 12],
  ["red", 20],
  ["blooper", 18],
];

const LAST_TABLE = [
  ["bullet", 20],
  ["blue", 12],
  ["golden", 18],
  ["blooper", 15],
  ["red", 15],
  ["mushroom", 10],
  ["triple", 10],
];

const NEEDS_OPPONENTS = new Set(["bullet", "blue", "blooper"]);
const NEEDS_AHEAD = new Set(["blooper"]);
const NEEDS_NOT_FIRST = new Set(["bullet", "blue"]);

const pickTable = ({ position, totalRacers }) => {
  if (!Number.isInteger(totalRacers) || totalRacers <= 1) return SOLO_TABLE;
  if (position <= 1) return FIRST_TABLE;
  if (totalRacers >= 2 && position > (totalRacers * 2) / 3) return LAST_TABLE;
  return MID_TABLE;
};

export const canGrant = ({ carriedBomb, carriedItem, roulette } = {}) =>
  !carriedBomb && !carriedItem && !roulette;

export const rollItem = (opts) => {
  if (!opts || typeof opts !== "object") return "mushroom";
  const { position, totalRacers } = opts;
  // Unknown standings: safe fallback instead of guessing a table.
  if (!Number.isFinite(position) || !Number.isFinite(totalRacers)) {
    return "mushroom";
  }
  const {
    hasOpponents = false,
    hasOpponentsAhead = false,
    rng = Math.random,
  } = opts;

  const entries = pickTable({ position, totalRacers }).filter(([type]) => {
    if (NEEDS_OPPONENTS.has(type) && !hasOpponents) return false;
    if (NEEDS_AHEAD.has(type) && !hasOpponentsAhead) return false;
    if (NEEDS_NOT_FIRST.has(type) && position <= 1) return false;
    return true;
  });

  if (entries.length === 0) return "mushroom";

  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = rng() * total;
  for (const [type, w] of entries) {
    r -= w;
    if (r < 0) return type;
  }
  return entries[entries.length - 1][0];
};

// Slot shape shared by every item task: {type, charges, expiresAt}.
// nowMs MUST be performance.now() (same clock as stunUntil and every expiry
// check). The default is the performance clock — never Date.now().
export const makeCarriedItem = (type, nowMs = performance.now()) => {
  if (type === "triple") return { type, charges: 3, expiresAt: 0 };
  if (type === "golden")
    return { type, charges: -1, expiresAt: nowMs + GOLDEN_MS };
  return { type, charges: 1, expiresAt: 0 };
};

// Consume one use of a carried item. Clock must be performance.now()
// (same clock as stunUntil) — see plan Review Focus.
export const consumeUse = ({ item, now = 0 } = {}) => {
  if (!item || typeof item !== "object") return { item: null, boosted: false };
  if (item.type === "golden") {
    if (now < item.expiresAt) return { item, boosted: true };
    return { item: null, boosted: false };
  }
  if (item.type === "triple") {
    const left = (Number(item.charges) || 1) - 1;
    if (left > 0) return { item: { ...item, charges: left }, boosted: true };
    return { item: null, boosted: true };
  }
  if (item.type === "mushroom") return { item: null, boosted: true };
  return { item, boosted: false };
};

// Host-authoritative box sync: the host generates spots, guests apply them
// wholesale. Pure normalizer for the item:boxes validator (same coordinate
// bounds as live transforms). Returns a clean list or null.
export const MAX_SYNC_BOXES = 10;

export const normalizeBoxList = (raw) => {
  if (!Array.isArray(raw) || raw.length > MAX_SYNC_BOXES) return null;
  const out = [];
  for (const b of raw) {
    if (!b || typeof b !== "object") continue;
    const id = Number(b.id);
    const x = Number(b.x);
    const y = Number(b.y);
    const z = Number(b.z);
    if (!Number.isInteger(id) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      continue;
    }
    const s = Number(b.s);
    const respawnAt = Number(b.respawnAt);
    out.push({
      id,
      x: Math.max(-2500, Math.min(2500, x)),
      y: Math.max(-500, Math.min(500, y)),
      z: Math.max(-2500, Math.min(2500, z)),
      s: Number.isFinite(s) ? Math.max(0.2, Math.min(3, s)) : 1,
      active: b.active !== false,
      respawnAt: Number.isFinite(respawnAt) && respawnAt >= 0 ? respawnAt : 0,
    });
  }
  return out;
};

// Race rank: laps dominate, distance driven breaks ties. Rows are
// [{id, laps, dist}]; missing dist counts as 0.
export const compareRacers = (a, b) => {
  const lapDiff = (Number(b?.laps) || 0) - (Number(a?.laps) || 0);
  if (lapDiff !== 0) return lapDiff;
  return (Number(b?.dist) || 0) - (Number(a?.dist) || 0);
};

export const rankOf = (rows, selfId) => {
  const list = Array.isArray(rows) ? [...rows].sort(compareRacers) : [];
  const idx = list.findIndex((r) => r && r.id === selfId);
  return { position: idx < 0 ? list.length : idx + 1, total: list.length };
};

// Current leader id from standings rows [{id, laps, finished, dist}].
// Finished racers no longer lead (race over for them). Lap ties break by
// distance driven. Null when empty.
export const leaderOf = (rows) => {
  if (!Array.isArray(rows)) return null;
  let best = null;
  for (const r of rows) {
    if (!r || r.finished) continue;
    if (!best || compareRacers(r, best) < 0) best = r;
  }
  return best ? best.id : null;
};

// Decelerating roulette frame for the pickup animation. Pure so the UI
// timing is testable: advances through icons, frozen once elapsed passes
// ROULETTE_MS (the UI locks on the rolled item then).
export const rouletteFrame = (elapsedMs, iconCount) => {
  const n = Math.max(1, Math.floor(Number(iconCount) || 1));
  const t = Math.min(Math.max(Number(elapsedMs) || 0, 0), ROULETTE_MS);
  const progress = t / ROULETTE_MS;
  const eased = 1 - (1 - progress) * (1 - progress);
  const steps = n * 3;
  return Math.floor(eased * steps) % n;
};

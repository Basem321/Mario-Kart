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

export const canGrant = ({ carriedBomb, carriedItem } = {}) =>
  !carriedBomb && !carriedItem;

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
// nowMs must be performance.now() (same clock as stunUntil) — the ItemBoxes
// grant path passes it; the Date.now() default only serves plain callers.
export const makeCarriedItem = (type, nowMs = Date.now()) => {
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

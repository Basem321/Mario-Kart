// Position-weighted item roulette (pure logic, no React/Three).
// Consumed by ItemBoxes pickup; each item task relies on these exact shapes.

import { itemConfig } from "./itemConfig.js";

export const GOLDEN_MS = itemConfig.golden.windowMs;
export const ROULETTE_MS = itemConfig.roulette.durationMs;

// v3 choice (Task 2): equal rows by default, position tables behind a flag.

export const canGrant = ({ carriedBomb, carriedItem, roulette } = {}) =>
  !carriedBomb && !carriedItem && !roulette;

export const rollItem = (opts) => {
  if (itemConfig.usePositionWeights) {
    if (!opts || typeof opts !== "object") return "mushroom1";
    return positionRoll({
      rank: opts.position,
      totalRacers: opts.totalRacers,
      raceAgeMs: opts.raceAgeMs,
      lastBlueAt: opts.lastBlueAt,
      rng: opts.rng,
    });
  }
  return equalRoll(opts);
};

const equalRoll = (opts) => {
  if (!opts || typeof opts !== "object") return "mushroom1";
  const { position, totalRacers, activeBlue = false, rng = Math.random } = opts;
  if (!Number.isFinite(position) || !Number.isFinite(totalRacers)) {
    return "mushroom1";
  }
  // Safety rules stay ON in equal mode: blue needs a target.
  const rows = itemConfig.equalRows.filter((row) => {
    if (row !== "blue") return true;
    if (position <= 1) return false;
    if (!Number.isInteger(totalRacers) || totalRacers <= 1) return false;
    if (activeBlue) return false;
    return true;
  });
  const list = rows.length > 0 ? rows : ["mushroom1"];
  return list[Math.floor(rng() * list.length) % list.length];
};

// Disabled position mode: interpolate front/mid/back by p, apply hard rules.
export const positionRoll = ({ rank, totalRacers, raceAgeMs, lastBlueAt, rng = Math.random } = {}) => {
  const tables = itemConfig.positionWeights;
  const N = Number(totalRacers) || 1;
  const p = N <= 1 ? 0 : (Number(rank) - 1) / (N - 1);
  const age = Number(raceAgeMs) || 0;
  const sinceBlue = age - (Number(lastBlueAt) || 0);
  const weightOf = (row) => {
    const f = tables.front[row] ?? 0;
    const m = tables.mid[row] ?? 0;
    const b = tables.back[row] ?? 0;
    return p <= 0.5 ? f + (m - f) * (p / 0.5) : m + (b - m) * ((p - 0.5) / 0.5);
  };
  const entries = [];
  for (const row of Object.keys(tables.front)) {
    if (row === "blue") {
      if (N < itemConfig.blueRules.minRacers) continue;
      if (age < itemConfig.raceGraceMs) continue;
      if (sinceBlue < itemConfig.blueRules.cooldownMs) continue;
    }
    if (row === "bullet") {
      if (age < itemConfig.raceGraceMs) continue;
      if (p < itemConfig.bulletRules.minP) continue;
    }
    if (row === "golden" && age < itemConfig.raceGraceMs) continue;
    const w = weightOf(row);
    if (w <= 0) continue;
    if (row === "legacy") {
      // Split equally: bomb / skid / wind.
      for (const sub of ["bomb", "skid", "wind"]) entries.push([sub, w / 3]);
    } else {
      entries.push([row, w]);
    }
  }
  const list = entries.length > 0 ? entries : [["mushroom1", 1]];
  const total = list.reduce((sum, [, w]) => sum + w, 0);
  let r = rng() * total;
  for (const [row, w] of list) {
    r -= w;
    if (r < 0) return row;
  }
  return list[list.length - 1][0];
};

const ROW_TO_TYPE = {
  mushroom1: "mushroom",
  mushroom3: "mushroom",
  golden: "golden",
  red1: "red",
  red3: "red",
  blue: "blue",
  bullet: "bullet",
  blooper: "blooper",
  bomb: "bomb",
  skid: "skid",
  wind: "wind",
};

// Row id -> v3 slot (or {bomb:true} for the legacy bomb path, handled by the
// pickup commit, never stored in carriedItem).
export const rowToSlot = (row, nowMs = performance.now()) => {
  switch (row) {
    case "mushroom3":
      return { type: "mushroom", variant: "triple", usesLeft: 3 };
    case "golden":
      return {
        type: "golden", variant: "single", usesLeft: -1,
        windowUntil: nowMs + itemConfig.golden.windowMs,
      };
    case "red3":
      return { type: "red", variant: "triple", usesLeft: 3 };
    case "bomb":
      return { bomb: true };
    case "skid":
    case "wind":
      // TODO(decide): skid vs wind wins are both a mini-boost today.
      return { type: row, variant: "single", usesLeft: 1 };
    default:
      return { type: ROW_TO_TYPE[row] || "mushroom", variant: "single", usesLeft: 1 };
  }
};

// v3 slot shape: {type, variant, usesLeft} (+windowUntil for golden).
// One-time adapter for v2-shaped slots ({type: 'triple', charges}).
export const migrateSlot = (old) => {
  if (!old || typeof old !== "object") return null;
  if (old.variant === "single" || old.variant === "triple") return old;
  if (old.type === "triple") {
    return {
      type: "mushroom",
      variant: "triple",
      usesLeft: Number.isInteger(old.charges) ? old.charges : 3,
    };
  }
  if (old.type === "golden") {
    return {
      type: "golden",
      variant: "single",
      usesLeft: -1,
      windowUntil: Number(old.expiresAt) || 0,
    };
  }
  if (typeof old.type === "string") {
    return { type: old.type, variant: "single", usesLeft: 1 };
  }
  return null;
};

// Slot shape shared by every item task: {type, variant, usesLeft}.
// Golden carries windowUntil instead of a count (usesLeft -1 sentinel).
// nowMs MUST be performance.now() — never Date.now().
export const makeCarriedItem = (type, variant = "single", nowMs = performance.now()) => {
  if (variant === "triple")
    return { type, variant, usesLeft: 3 };
  if (type === "golden")
    return { type, variant: "single", usesLeft: -1, windowUntil: nowMs + GOLDEN_MS };
  return { type, variant: "single", usesLeft: 1 };
};

// Consume one use of a carried item. Clock must be performance.now().
export const consumeUse = ({ item, now = 0 } = {}) => {
  if (!item || typeof item !== "object") return { item: null, boosted: false };
  if (item.type === "golden") {
    if (now < item.windowUntil) return { item, boosted: true };
    return { item: null, boosted: false };
  }
  if (item.variant === "triple") {
    const left = (Number(item.usesLeft) || 1) - 1;
    if (left > 0) return { item: { ...item, usesLeft: left }, boosted: true };
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

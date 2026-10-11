import { useGameManager } from "./gameManager";

// Central game-audio surface: every sound effect routes through here so it
// (a) respects the player's sfxVolume, (b) reuses elements instead of
// allocating a new HTMLAudioElement per trigger, and (c) never throws into
// gameplay. Paths are absolute (/music/...) — relative ./music/ breaks under
// nested routes.

// Current SFX level, clamped. Falls back to 0.7 outside a race context.
export const sfxLevel = () => {
  try {
    const raw = Number(useGameManager.getState().sfxVolume);
    return Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0.7;
  } catch {
    return 0.7;
  }
};

const POOL_PER_NAME = 4;
const pools = new Map();

const takePooled = (src) => {
  let pool = pools.get(src);
  if (!pool) {
    pool = [];
    pools.set(src, pool);
  }
  for (const el of pool) {
    if (el.paused || el.ended) return el;
  }
  if (pool.length < POOL_PER_NAME) {
    try {
      const el = new Audio(src);
      el.preload = "auto";
      pool.push(el);
      return el;
    } catch {
      return null;
    }
  }
  return pool[0];
};

// One-shot effect. volumeMul scales the player's sfxVolume (1 = full).
export const playSfx = (name, volumeMul = 1) => {
  try {
    const src = `/music/${String(name).replace(/^\/+/, "")}`;
    const el = takePooled(src);
    if (!el) return;
    el.loop = false;
    el.volume = Math.max(0, Math.min(1, sfxLevel() * volumeMul));
    el.currentTime = 0;
    el.play().catch(() => {});
  } catch {
    // ignore — audio must never break gameplay
  }
};

// Managed loop (alarms, fuses). The caller owns stopLoop(handle).
export const startLoop = (name, volumeMul = 1) => {
  try {
    const src = `/music/${String(name).replace(/^\/+/, "")}`;
    const el = new Audio(src);
    el.loop = true;
    el.volume = Math.max(0, Math.min(1, sfxLevel() * volumeMul));
    el.play().catch(() => {});
    return el;
  } catch {
    return null;
  }
};

export const stopLoop = (el) => {
  try {
    el?.pause();
  } catch {
    // ignore — best effort
  }
};

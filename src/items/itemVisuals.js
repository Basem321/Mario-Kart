// Item visual descriptors (pure, testable). Maps a carried slot + active
// effects to WHAT to render and WHERE — the components do the rendering.

import { itemConfig } from "./itemConfig.js";

// Golden window fraction (§4.2): 1 while held unopened (windowUntil null),
// shrinking 1 → 0 across the 7s window once first use opens it. Single
// source for the HUD descriptor AND the 3D shrink below.
export const goldenTimerFraction = (windowUntil, now = 0) => {
  if (windowUntil == null || !Number.isFinite(Number(windowUntil))) return 1;
  const total = Number(itemConfig.golden.windowMs) || 0;
  if (!(total > 0)) return 1;
  return Math.max(0, Math.min(1, (Number(windowUntil) - Number(now)) / total));
};

// Golden render multiplier: a pure FRACTION (1 full → 0.05 floor). The
// MushroomModel already carries its base renderScale — multiplying by base
// a second time shrank the held golden ~31x into invisibility.
export const goldenScaleMul = (windowUntil, now = 0) => {
  const frac = goldenTimerFraction(windowUntil, now);
  if (frac >= 1) return 1;
  return Math.max(0.05, frac);
};

// {held: rack|trail|orbit|float|none, count, tint, timerFraction}
export const visualFor = (carriedItem, effects = {}, now = 0) => {
  void effects;
  const none = { held: "none", count: 0, tint: null, timerFraction: 1 };
  if (!carriedItem || typeof carriedItem !== "object") return none;
  const { type, variant, usesLeft } = carriedItem;
  switch (type) {
    case "mushroom":
      return {
        held: "rack",
        count: variant === "triple" ? Math.max(0, Number(usesLeft) || 0) : 1,
        tint: null,
        timerFraction: 1,
      };
    case "golden": {
      return {
        held: "rack",
        count: 1,
        tint: "gold",
        timerFraction: goldenTimerFraction(carriedItem.windowUntil, now),
      };
    }
    case "red":
      return variant === "triple"
        ? { held: "orbit", count: Math.max(0, Number(usesLeft) || 0), tint: null, timerFraction: 1 }
        : { held: "trail", count: 1, tint: null, timerFraction: 1 };
    case "blue":
      return { held: "trail", count: 1, tint: "blue", timerFraction: 1 };
    case "bullet":
      return { held: "rack", count: 1, tint: null, timerFraction: 1 };
    case "blooper":
      return { held: "float", count: 1, tint: null, timerFraction: 1 };
    case "bomb":
      return { held: "rack", count: 1, tint: null, timerFraction: 1 };
    default:
      return none;
  }
};

// Animation priority: hit > bullet > item-action > drive. Returns the
// topmost still-active state name (fake-clock testable).
const PRIORITY = [
  "spin_hit_heavy",
  "spin_hit_light",
  "bullet",
  "throw_forward",
  "throw_back",
  "throw_up",
  "cast_up",
  "boost_lean",
  "item_got",
  "roulette_anticipate",
  "drive",
];

export const pickAnim = (states, now = 0) => {
  if (!Array.isArray(states)) return "drive";
  const t = Number(now);
  for (const name of PRIORITY) {
    const s = states.find((x) => x && x.name === name);
    if (s && Number(s.until) > t) return name;
  }
  return "drive";
};

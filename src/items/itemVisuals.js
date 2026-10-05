// Item visual descriptors (pure, testable). Maps a carried slot + active
// effects to WHAT to render and WHERE — the components do the rendering.

import { itemConfig } from "./itemConfig.js";

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
      const total = itemConfig.golden.windowMs;
      const remaining = Math.max(
        0,
        Math.min(total, Number(carriedItem.windowUntil) - Number(now))
      );
      return { held: "rack", count: 1, tint: "gold", timerFraction: remaining / total };
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

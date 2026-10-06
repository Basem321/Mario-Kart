// Item render scales (pure, testable). Single source of truth for GLB model
// sizing: every Pickups model derives its scale from here, callers only pass
// `sizeMul` (never a raw `scale` — scaledPrimitive strips it).
//
// target = sizes ratio x real kart length; render scale = target / native.

import { itemConfig, modelNativeSizes } from "./itemConfig.js";

const kartLength = () => modelNativeSizes.kartLength;

// Configured world size (game units) per visual kind.
export const targetSize = (kind) => {
  const L = kartLength();
  const s = itemConfig.sizes;
  switch (kind) {
    case "mushroom":
    case "golden":
      return s.mushroomHeld * L;
    case "red":
      return s.redShell * L;
    case "blue":
      return s.blueShell * L;
    case "bulletActive":
      return s.bulletActiveLength * L;
    case "bulletHeld":
      return s.bulletHeldLength * L;
    case "bloopHeld":
      return s.bloopHeldHeight * L;
    case "bloopCast":
      return s.bloopCastHeight * L;
    default:
      return 0;
  }
};

// Native GLB extent per visual kind (measured 2026-10-04/06).
export const nativeSize = (kind) => {
  switch (kind) {
    case "mushroom":
    case "golden":
      return modelNativeSizes.mushroomWidth;
    case "red":
      return modelNativeSizes.redShellDiameter;
    case "blue":
      return modelNativeSizes.blueShellOverall;
    case "bulletActive":
    case "bulletHeld":
      return modelNativeSizes.bulletLength;
    case "bloopHeld":
    case "bloopCast":
      return modelNativeSizes.blooperHeight;
    default:
      return 1;
  }
};

// Final model scale. mul multiplies (held mini, cast flourish) — callers
// pass ratios of configured sizes, never absolute numbers.
export const renderScale = (kind, mul = 1) =>
  (targetSize(kind) / nativeSize(kind)) * Number(mul);

// Final world size (for the 1% contract test).
export const worldSize = (kind, mul = 1) => targetSize(kind) * Number(mul);

// Orbit clearance (§1.1): the widest orbiting item's inner edge must stay
// outside the kart half-length (nose/tail), else shells clip the kart.
export const orbitClearsKart = () => {
  const L = kartLength();
  const widest = Math.max(
    itemConfig.sizes.redShell,
    itemConfig.sizes.blueShell,
    itemConfig.sizes.mushroomHeld
  ) * L;
  return itemConfig.orbit.radius - widest / 2 > L / 2;
};

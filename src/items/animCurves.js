// Glove + whole-body animation curves (T6, §3.2). Pure and clock-agnostic:
// callers pass t01 (0..1 through the anim) and get driver-local glove
// positions + body euler angles. Kart.jsx poses from performance.now, remote
// karts from animRecvAt, the gallery from its time slider — one code path.

import { itemConfig } from "./itemConfig.js";

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
const smooth = (t) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
const lerp3 = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

// Total duration per anim name from itemConfig (§3.2 table). Unknown = 0.
export const animDur = (name) => {
  switch (name) {
    case "throw_forward":
      return itemConfig.throwForward.totalMs;
    case "throw_back":
      return itemConfig.throwBack.totalMs;
    case "throw_up":
      return itemConfig.throwUp.totalMs;
    case "cast_up":
      return itemConfig.castUp.totalMs;
    case "use_mushroom":
      return itemConfig.useMushroom.totalMs;
    case "item_got":
      return itemConfig.receive.totalMs;
    default:
      return 0;
  }
};

// Live window + normalized progress for {name, start, totalMs} state.
export const animLive = (anim, now = 0) =>
  !!anim && Number(now) >= Number(anim.start) && Number(now) < Number(anim.start) + Number(anim.totalMs);

export const animT = (anim, now = 0) => {
  if (!anim || !(Number(anim.totalMs) > 0)) return 0;
  return clamp01((Number(now) - Number(anim.start)) / Number(anim.totalMs));
};

// Blend envelope: 100ms in, 150ms out (absolute, per §3.2).
export const animBlend = (t01, totalMs = 0) => {
  const t = clamp01(t01);
  const total = Number(totalMs) || 0;
  if (total <= 0) return t > 0 && t < 1 ? 1 : 0;
  return clamp01(Math.min((t * total) / 100, ((1 - t) * total) / 150, 1));
};

// Glove target in driver-local units for (anim, t01). Rest pose default.
export const gloveAnimPos = (animName, t01, rig) => {
  const t = clamp01(t01);
  const rest = rig.handRest;
  switch (animName) {
    case "throw_forward": {
      // rest -> windup -> forward, release at ~1/3.
      if (t < 0.35) return lerp3(rest, rig.handWindup, smooth(t / 0.35));
      return lerp3(rig.handWindup, rig.handForward, smooth((t - 0.35) / 0.65));
    }
    case "throw_back":
      return lerp3(rest, rig.handBack, smooth(t));
    case "throw_up":
      return lerp3(rest, rig.handUp, smooth(t));
    case "cast_up":
      return lerp3(rest, rig.handLeftCast, smooth(t));
    case "use_mushroom":
      return lerp3(rest, rig.handMouth, smooth(Math.min(1, t / 0.375)));
    case "item_got":
      return lerp3(itemConfig.receive.from, rest, 1 - Math.pow(1 - t, 3));
    default:
      return [...rest];
  }
};

// Whole-driver euler (radians) + translation offset [x, y, z] (driver space).
// Gives punchy, arcade-accurate physical reactions for throws, boosts, and celebrations.
export const bodyPose = (animName, t01) => {
  const t = clamp01(t01);
  const D = Math.PI / 180;
  switch (animName) {
    case "throw_forward": {
      // Phase 1 (0 -> 0.35): Anticipation - Mario pulls back in seat
      // Phase 2 (0.35 -> 0.7): Powerful forward lunge over steering wheel (-32° pitch!)
      // Phase 3 (0.7 -> 1.0): Spring back to rest with a bounce
      if (t < 0.35) {
        const p = smooth(t / 0.35);
        return {
          pitch: 18 * D * p,
          yaw: 10 * D * p,
          roll: -6 * D * p,
          x: -0.04 * p,
          y: -0.02 * p,
          z: -0.12 * p,
        };
      } else if (t < 0.7) {
        const p = smooth((t - 0.35) / 0.35);
        return {
          pitch: 18 * D - 50 * D * p, // -32° forward lunge!
          yaw: 10 * D - 22 * D * p,
          roll: -6 * D + 12 * D * p,
          x: -0.04 + 0.08 * p,
          y: -0.02 - 0.04 * p,
          z: -0.12 + 0.24 * p,        // Lurch forward +0.12
        };
      } else {
        const p = smooth((t - 0.7) / 0.3);
        return {
          pitch: (-32 * D) * (1 - p),
          yaw: (-12 * D) * (1 - p),
          roll: (6 * D) * (1 - p),
          x: 0.04 * (1 - p),
          y: -0.06 * (1 - p),
          z: 0.12 * (1 - p),
        };
      }
    }
    case "throw_back": {
      // Driver twists torso 60° looking over shoulder to throw behind
      const p = Math.sin(Math.PI * t);
      return {
        pitch: 8 * D * p,
        yaw: 60 * D * p,
        roll: -14 * D * p,
        x: 0.06 * p,
        y: 0.02 * p,
        z: -0.06 * p,
      };
    }
    case "throw_up": {
      // Sky launch (Blue shell): Two-handed arch back and pop up
      const p = Math.sin(Math.PI * t);
      return {
        pitch: 30 * D * p,
        yaw: 0,
        roll: 0,
        x: 0,
        y: 0.09 * p,
        z: -0.12 * p,
      };
    }
    case "cast_up": {
      const p = Math.sin(Math.PI * t);
      return {
        pitch: 22 * D * p,
        yaw: -18 * D * p,
        roll: 10 * D * p,
        x: -0.05 * p,
        y: 0.06 * p,
        z: -0.08 * p,
      };
    }
    case "use_mushroom": {
      // Boost hit: G-force pushes driver back, then driver tucks hard into speed pose
      if (t < 0.35) {
        const p = smooth(t / 0.35);
        return {
          pitch: 24 * D * p,
          yaw: 0,
          roll: 0,
          x: 0,
          y: 0.02 * p,
          z: -0.14 * p,
        };
      } else {
        const p = smooth((t - 0.35) / 0.65);
        return {
          pitch: 24 * D - 50 * D * p, // -26° tuck forward
          yaw: 0,
          roll: 0,
          x: 0,
          y: -0.05 * p,
          z: -0.14 + 0.22 * p,
        };
      }
    }
    case "item_got": {
      // Joyous victory double-hop on picking up item box
      const hop = Math.abs(Math.sin(t * Math.PI * 2));
      return {
        pitch: -14 * D * hop,
        yaw: 0,
        roll: 6 * D * Math.sin(t * Math.PI * 2),
        x: 0,
        y: 0.09 * hop,
        z: 0.04 * hop,
      };
    }
    default:
      return { pitch: 0, yaw: 0, roll: 0, x: 0, y: 0, z: 0 };
  }
};

// Receive pop-in: scale 0 -> overshoot -> 1 (popInMs + popInOvershoot).
export const popScale = (t01, overshoot = itemConfig.popInOvershoot) => {
  const t = clamp01(t01);
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const e = 1 - Math.pow(1 - Math.min(1, t * 2.5), 3);
  return e * (1 + (Number(overshoot) - 1) * Math.sin(Math.PI * t));
};

// Item visibility during use_mushroom: shrink to 0 at release; golden hops
// back to the glove afterwards (slot persists), singles stay gone.
export const useItemScale = (animName, t01, isGolden = false) => {
  if (animName !== "use_mushroom") return 1;
  const t = clamp01(t01);
  const shrinkEnd = Number(itemConfig.useMushroom.shrinkMs) / Number(itemConfig.useMushroom.totalMs);
  if (t < shrinkEnd) return 1 - t / shrinkEnd;
  if (isGolden) return Math.min(1, (t - shrinkEnd) / shrinkEnd);
  return 0;
};

// Ghost (just-used item shown through the throw) lives in its window.
export const ghostLive = (ghost, now = 0) =>
  !!ghost && Number(now) >= Number(ghost.start) && Number(now) < Number(ghost.start) + Number(ghost.totalMs);

// Spin-out pose (yaw-only spin, never a backflip): the kart + driver +
// held items rotate together around the kart center (tumble/visual group).
// Light = 540deg over hit.lightMs + small hop; heavy = 720deg over
// hit.heavyMs + higher hop. Pure so local (Kart) and remote (RemoteRacers)
// share one curve. pitch/roll are always 0 — no forward/back tilt.
export const spinPose = (kind, t01) => {
  const t = clamp01(t01);
  const heavy = typeof kind === "string" && kind.includes("heavy");
  const e = 1 - Math.pow(1 - t, 3);
  return {
    yaw: e * Math.PI * (heavy ? 4 : 3),
    hop: Math.sin(t * Math.PI) * (heavy ? 1.2 : 0.45),
    pitch: 0,
    roll: 0,
  };
};

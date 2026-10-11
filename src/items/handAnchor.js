// Glove world anchor (T6 §3.2): projectiles spawn AT the glove, not at
// playerPos + fixed offsets. The LOCAL kart's GloveHand registers a getter;
// ItemBoxes reads it at release time, falling back to the old spawn point
// when the rig is not mounted. Remotes/gallery never register.
import { Vector3 } from "three";

let getter = null;

export const setHandGetter = (fn) => {
  getter = typeof fn === "function" ? fn : null;
};

// Clears ONLY if the registered getter is the caller's own: several
// GloveHands can mount at once (bomb + held item), and an unmounting one
// must not steal the anchor from the survivors.
export const clearHandGetter = (fn) => {
  if (fn && getter === fn) getter = null;
};

// Returns a Vector3 (fresh) or null when the rig is not mounted.
export const getHandWorldPosition = () => {
  if (!getter) return null;
  try {
    const out = new Vector3();
    getter(out);
    if (!Number.isFinite(out.x) || !Number.isFinite(out.y) || !Number.isFinite(out.z)) {
      return null;
    }
    return out;
  } catch {
    return null;
  }
};

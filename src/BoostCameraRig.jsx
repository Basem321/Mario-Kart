import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { MathUtils } from "three";
import { useGameStore } from "./store";
import { playSfx } from "./audio.js";

/**
 * FOV kick when boosting: widens the camera while mini-turbo is active,
 * then eases back. Base FOV is captured from the canvas camera so this
 * works regardless of the default (R3F / custom).
 * Also plays the boost SFX once per boost (rising edge only).
 */
export function BoostCameraRig() {
  const baseFovRef = useRef(null);
  const wasBoostingRef = useRef(false);
  const lastBoostSfxRef = useRef(0);

  useFrame((state, delta) => {
    const camera = state.camera;
    if (!camera || !("fov" in camera)) return;

    if (baseFovRef.current === null) {
      baseFovRef.current = camera.fov;
    }
    const baseFov = baseFovRef.current;

    const st = useGameStore.getState();
    const boosting = Boolean(st.isBoosting);
    const speed = Number(st.speed) || 0;
    // Bullet Bill ride: spec FOV +15 without isBoosting (no flames/wind).
    // Local-only read; the ride entry is owner-gated where it is written.
    const bulletRiding =
      Boolean(st.bulletRide) &&
      Number(st.bulletRide.until) > performance.now();

    // Boost SFX on the rising edge only, so it plays once per mini-turbo.
    if (boosting && !wasBoostingRef.current) {
      const nowMs = performance.now();
      if (nowMs - lastBoostSfxRef.current > 600) {
        lastBoostSfxRef.current = nowMs;
        playSfx("boost_sound.mp3", 1);
      }
    }
    wasBoostingRef.current = boosting;

    // Mini-turbo = full kick. Bullet ride = spec +15. Very high speed
    // (downhill/turbo tail) = half kick.
    const targetFov = bulletRiding
      ? baseFov + 15
      : boosting
        ? baseFov + 14
        : speed > 55
          ? baseFov + 6
          : baseFov;

    const nextFov = MathUtils.damp(camera.fov, targetFov, boosting ? 7 : 4.5, delta);
    if (Math.abs(nextFov - camera.fov) > 0.01) {
      camera.fov = nextFov;
      camera.updateProjectionMatrix();
    } else if (camera.fov !== targetFov && Math.abs(camera.fov - targetFov) < 0.05) {
      camera.fov = targetFov;
      camera.updateProjectionMatrix();
    }
  });

  return null;
}

export default BoostCameraRig;

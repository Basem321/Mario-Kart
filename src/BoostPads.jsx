import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGameStore } from "./store";
import { useGameManager } from "./gameManager";
import { getTrack } from "./tracks";
import { useMapEditorStore } from "./mapEditorStore";

/**
 * Creates a glowing green neon boost pad texture with forward-pointing chevrons.
 */
function createBoostTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");

  // Emerald/neon green base
  ctx.fillStyle = "#008a32";
  ctx.fillRect(0, 0, 512, 512);

  // High-visibility neon border
  ctx.strokeStyle = "#39ff14";
  ctx.lineWidth = 24;
  ctx.strokeRect(12, 12, 488, 488);

  // Chevron boost arrows pointing forward (upwards along texture V)
  ctx.fillStyle = "#39ff14";
  ctx.shadowColor = "#39ff14";
  ctx.shadowBlur = 20;

  const arrowCount = 4;
  const rowHeight = 512 / arrowCount;

  for (let i = 0; i < arrowCount; i++) {
    const yCenter = (i + 0.5) * rowHeight;
    ctx.beginPath();
    ctx.moveTo(60, yCenter + 35);
    ctx.lineTo(256, yCenter - 35);
    ctx.lineTo(452, yCenter + 35);
    ctx.lineTo(400, yCenter + 35);
    ctx.lineTo(256, yCenter + 2);
    ctx.lineTo(112, yCenter + 35);
    ctx.closePath();
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** Returns the effective boost pads: editor overrides when open, else track defaults. */
function useEffectivePads() {
  const selectedTrackId = useGameManager((s) => s.selectedTrackId);
  const track = getTrack(selectedTrackId);
  const editorOpen = useMapEditorStore((s) => s.isOpen);
  const editorPads = useMapEditorStore((s) => s.editedConfig?.boostPads);
  if (editorOpen && editorPads) return editorPads;
  return track.boostPads ?? [];
}

export function BoostPads() {
  const pads = useEffectivePads();

  const boostTexture = useMemo(() => createBoostTexture(), []);
  const lastTriggerRef = useRef({});

  useFrame((_, delta) => {
    if (!pads || pads.length === 0) return;

    // Animate chevron arrows moving forward
    if (boostTexture) {
      boostTexture.offset.y -= delta * 2.8;
    }

    const playerPos = useGameStore.getState().playerPosition;
    if (!playerPos) return;

    const now = performance.now();

    for (const pad of pads) {
      const [px, py, pz] = pad.position;
      const hw = pad.width / 2;
      const hl = pad.length / 2;

      // Check if player position is within pad bounds
      const dx = Math.abs(playerPos.x - px);
      const dz = Math.abs(playerPos.z - pz);
      const dy = Math.abs((useGameStore.getState().groundPosition ?? playerPos.y) - py);

      // Tighter height check so flying 3m+ above a pad can't re-trigger it
      // mid-air and chain boosts into an endless float (pad 2 jump).
      if (dx <= hw && dz <= hl && dy < 2.0) {
        const lastTime = lastTriggerRef.current[pad.id] ?? 0;
        // Longer cooldown: a 0.9s cooldown re-fires while still airborne
        // from the first boost, stacking launch impulses forever.
        if (now - lastTime > 2000) {
          lastTriggerRef.current[pad.id] = now;

          window.dispatchEvent(
            new CustomEvent("mario-kart:boost", {
              detail: {
                duration: pad.duration ?? 2.0,
                speed: pad.speed ?? 62,
                launchVy: pad.launchVy ?? 12,
              },
            })
          );
        }
      }
    }
  });

  if (!pads || pads.length === 0) return null;

  return (
    <group name="boost-pads">
      {pads.map((pad) => (
        <group key={pad.id} position={pad.position} rotation={pad.rotation ?? [0, 0, 0]}>
          {/* Main glowing boost pad surface */}
          <mesh position={[0, 0.05, 0]}>
            <boxGeometry args={[pad.width, 0.1, pad.length]} />
            <meshStandardMaterial
              map={boostTexture}
              color="#39ff14"
              emissive="#00ff44"
              emissiveMap={boostTexture}
              emissiveIntensity={2.8}
              roughness={0.25}
              metalness={0.1}
            />
          </mesh>
          {/* Dark metallic mounting frame */}
          <mesh position={[0, 0.01, 0]}>
            <boxGeometry args={[pad.width + 0.6, 0.08, pad.length + 0.6]} />
            <meshStandardMaterial color="#1a1a1a" roughness={0.7} metalness={0.5} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export default BoostPads;

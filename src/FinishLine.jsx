import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useGameStore } from "./store";
import { useGameManager } from "./gameManager";
import { FINISH_LINE } from "./constants";
import { getTrack, getFinishFrame } from "./tracks";
import { publishOnlineRaceEvent } from "./onlineRaceTransport";
import { useMapEditorStore } from "./mapEditorStore";

const groundRaycaster = new THREE.Raycaster();
const downDir = new THREE.Vector3(0, -1, 0);

/**
 * خط النهاية تحت يافطة MARIO KART:
 * - بيتحط في إحداثيات مطلقة ثابتة = اللي بيظهر في الـ Map Editor بالظبط:
 *   بداية المستقيم عند نقطة الأصل، اتجاه السباق -Z
 *   (X = lateralOffset، Z = -finishOffset من إعدادات التراك)
 * - كل عبور في الاتجاه الصح => lap + 1
 */
export function FinishLine() {
  const centerRef = useRef(null); // {x,z,fx,fz,rx,rz,ry,y}
  const prevSRef = useRef(0);
  const maxDistRef = useRef(0);
  const [visual, setVisual] = useState(null);
  const scene = useThree((s) => s.scene);
  const collidersRef = useRef(null);

  // Reset when a session ends. Waiting for the road walls before creating the
  // line avoids placing it from a transient/empty collider list at race start.
  const showHomepage = useGameManager((s) => s.showHomepage);
  const gameStarted = useGameManager((s) => s.gameStarted);
  const onlineRaceId = useGameManager((s) => s.onlineRaceId);
  const selectedTrackId = useGameManager((s) => s.selectedTrackId);

  const editorOpen = useMapEditorStore((s) => s.isOpen);
  const editorFinishOffset = useMapEditorStore((s) => s.editedConfig?.finishOffset);
  const editorLateralOffset = useMapEditorStore((s) => s.editedConfig?.lateralOffset);
  const editorHalfWidth = useMapEditorStore((s) => s.editedConfig?.halfWidth);
  const editorFinishRotationY = useMapEditorStore((s) => s.editedConfig?.finishRotationY);

  // Per-track tuning: shorter start straights need the line closer to spawn.
  const forwardOffset =
    (editorOpen && editorFinishOffset !== undefined
      ? editorFinishOffset
      : getTrack(selectedTrackId).finishOffset) ?? FINISH_LINE.forwardOffset ?? 0;
  const lateralOffset =
    (editorOpen && editorLateralOffset !== undefined
      ? editorLateralOffset
      : getTrack(selectedTrackId).lateralOffset) ?? FINISH_LINE.lateralOffset ?? 0;
  const halfWidth =
    (editorOpen && editorHalfWidth !== undefined
      ? editorHalfWidth
      : getTrack(selectedTrackId).halfWidth) ?? FINISH_LINE.halfWidth ?? 12;
  // Line yaw (degrees, 0 = perpendicular to -Z). Rotatable in the Map Editor.
  const finishRotationY =
    (editorOpen && editorFinishRotationY !== undefined
      ? editorFinishRotationY
      : getTrack(selectedTrackId).finishRotationY) ?? 0;
  const finishFrame = getFinishFrame({ finishRotationY });

  useEffect(() => {
    centerRef.current = null;
    prevSRef.current = 0;
    maxDistRef.current = 0;
    collidersRef.current = null;
    setVisual(null);
  }, [
    gameStarted,
    onlineRaceId,
    showHomepage,
    selectedTrackId,
    editorOpen,
    editorFinishOffset,
    editorLateralOffset,
    editorHalfWidth,
    editorFinishRotationY,
  ]);

  const getColliders = () => {
    if (!collidersRef.current) {
      const list = [];
      scene.traverse((obj) => {
        if (obj.isMesh && obj.name.includes("ground")) list.push(obj);
      });
      collidersRef.current = list;
    }
    return collidersRef.current;
  };

  const groundYAt = (x, z) => {
    try {
      groundRaycaster.set(new THREE.Vector3(x, 60, z), downDir);
      groundRaycaster.far = 200;
      groundRaycaster.firstHitOnly = true;
      const hits = groundRaycaster.intersectObjects(getColliders(), false);
      const g = hits.find((h) => h.object.name.includes("ground"));
      if (g) return g.point.y;
    } catch {
      // ignore
    }
    return null;
  };

  useFrame(() => {
    const gm = useGameManager.getState();
    if (!gm.gameStarted || gm.gameOver) return;

    const st = useGameStore.getState();
    const p = st.playerPosition;
    if (!p) return;

    const HALF_WIDTH = halfWidth;
    const MIN_LAP_MS = FINISH_LINE.minLapMs;
    const MIN_DIST = FINISH_LINE.minDist;

    // أول فريم بعد بداية السباق: ثبّت الخط في نفس الإحداثيات المطلقة اللي
    // بيظهر بيها في الـ Map Editor (EditorFinishLine): بداية المستقيم عند
    // نقطة الأصل، اتجاه السباق -Z (أو حسب finishRotationY). كده اللي بتشوفه
    // في المحرر هو اللي بتسابق عليه بالظبط — مفيش تخمين من الحيطة ولا من
    // مكان السبون.
    if (!centerRef.current) {
      const { fx, fz, rx, rz } = finishFrame;

      const cx = fx * forwardOffset + rx * lateralOffset;
      const cz = fz * forwardOffset + rz * lateralOffset;

      const gy = groundYAt(cx, cz) ?? st.groundPosition ?? p.y ?? 0;
      const c = {
        x: cx,
        z: cz,
        fx,
        fz,
        rx,
        rz,
        ry: Math.atan2(-fx, -fz),
        y: gy,
        halfWidth: HALF_WIDTH,
      };
      centerRef.current = c;
      prevSRef.current = (p.x - cx) * fx + (p.z - cz) * fz;
      maxDistRef.current = 0;
      setVisual(c);
      console.log(
        `[FinishLine] at (${cx.toFixed(1)}, ${cz.toFixed(1)}) absolute (matches Map Editor)`
      );
      return;
    }

    const c = centerRef.current;
    const dx = p.x - c.x;
    const dz = p.z - c.z;

    // المسافة على طول اتجاه السير (s) والعرض (l)
    const s = dx * c.fx + dz * c.fz;
    const l = dx * c.rx + dz * c.rz;
    const dist = Math.hypot(dx, dz);
    if (dist > maxDistRef.current) maxDistRef.current = dist;

    const prevS = prevSRef.current;

    // عبور من ورا الخط لقدامه + جوه عرض الخط + بعيد كفاية + عدى وقت كفاية
    if (
      maxDistRef.current > MIN_DIST &&
      prevS <= 0 &&
      s > 0 &&
      Math.abs(l) < HALF_WIDTH &&
      gm.currentLapTime > MIN_LAP_MS
    ) {
      const lapTime = gm.currentLapTime;
      const result = gm.completeLap(lapTime);
      if (!result.counted) return;

      // Offline races keep their existing local-only behavior. In an online
      // race this compact, validated event lets every client rank the roster
      // by completed laps without coupling the finish-line physics to P2P.
      const updatedGame = useGameManager.getState();
      if (updatedGame.isOnlineRace) {
        publishOnlineRaceEvent({
          type: "race:progress",
          completedLaps: result.completedLap,
          currentLap: updatedGame.currentLap,
          finished: result.finished,
        });
      }

      console.log(
        `🏁 Lap ${result.completedLap} completed in ${gm.formatTime(lapTime)}${
          result.finished ? " — race finished" : ""
        }`,
      );
      // ابدأ قياس البعد من جديد للفة الجديدة
      maxDistRef.current = 0;
    }

    prevSRef.current = s;
  });

  if (!visual) return null;

  const HALF_WIDTH = visual.halfWidth ?? halfWidth;
  const COLS = Math.max(8, Math.round(HALF_WIDTH * 1.2));
  const CELL_W = (HALF_WIDTH * 2) / COLS;
  const CELL_D = 1.1;

  return (
    <group position={[visual.x, visual.y + 0.12, visual.z]} rotation-y={visual.ry}>
      {/* شطرنج: صفين */}
      {Array.from({ length: 2 }).map((_, row) =>
        Array.from({ length: COLS }).map((_, col) => {
          const isBlack = (row + col) % 2 === 0;
          return (
            <mesh
              key={`${row}-${col}`}
              position={[
                -HALF_WIDTH + CELL_W / 2 + col * CELL_W,
                0.02,
                row * CELL_D - CELL_D / 2,
              ]}
              rotation-x={-Math.PI / 2}
            >
              <planeGeometry args={[CELL_W, CELL_D]} />
              <meshBasicMaterial color={isBlack ? "#111" : "#fff"} toneMapped={false} />
            </mesh>
          );
        })
      )}
    </group>
  );
}

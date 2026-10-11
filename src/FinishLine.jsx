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
// Scratch ray origin (set() copies values in — never retained).
const _groundOrigin = new THREE.Vector3();
// Driving-surface level the kart rig assumes on every track (group origin at
// y=0, road ≈1.7 below). Used to pick the road hit out of stacked geometry.
const ROAD_LEVEL_Y = -1.7;

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
  // Anti-cut gates: checkpoint indices driven through since the last counted
  // lap (empty at race start — the grid-to-line stub of lap 1 counts freely,
  // every later crossing must prove a full tour first).
  const visitedRef = useRef(new Set());
  // Far-gate fallback for tracks with no authored checkpoints (Mario Circuit):
  // radial distance from the line that proves the kart left the start area.
  // Derived from the road bounds so it scales with the track; null until
  // roadMapData arrives.
  const farGateRef = useRef(null);
  const farVisitedRef = useRef(false);
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
    visitedRef.current = new Set();
    farGateRef.current = null;
    farVisitedRef.current = false;
    try {
      useGameStore.getState().setRespawnCheckpointIndex?.(-1);
    } catch {
      // ignore — store shape is forward-compatible
    }
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
      groundRaycaster.set(_groundOrigin.set(x, 60, z), downDir);
      groundRaycaster.far = 200;
      groundRaycaster.firstHitOnly = false;
      const hits = groundRaycaster.intersectObjects(getColliders(), false);
      const grounds = hits.filter((h) => h.object.name.includes("ground"));
      if (grounds.length === 0) return null;
      // The first hit from above is NOT always the road: Waluigi's start
      // gantry (≈16 above the asphalt) and Shroom's gate (≈3.6 above) win the
      // ray and leave the line floating. The kart rig pins every track so the
      // driving surface sits ≈1.7 below the group origin — pick the surface
      // closest to that level instead of the highest one.
      let best = grounds[0].point.y;
      let bestDist = Math.abs(best - ROAD_LEVEL_Y);
      for (const h of grounds) {
        const d = Math.abs(h.point.y - ROAD_LEVEL_Y);
        if (d < bestDist) {
          bestDist = d;
          best = h.point.y;
        }
      }
      return best;
    } catch {
      // Raycast must never break lap tracking (missing BVH, bad geometry).
      return null;
    }
  };

  useFrame(() => {
    const gm = useGameManager.getState();
    if (!gm.gameStarted || gm.gameOver || gm.isPaused) return;

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

    // Checkpoint tour tracking (Shroom Ridge, Waluigi Stadium): a checkpoint
    // counts as visited within 14 XZ units and 10 height units — lenient on
    // jumps and stacked decks. Mirrors only NEW visits to the store (rare)
    // so R can respawn at the last visited one instead of the nearest.
    const track = getTrack(selectedTrackId);
    const checkpoints =
      (editorOpen && editorFinishOffset !== undefined && editorHalfWidth !== undefined
        ? useMapEditorStore.getState().editedConfig?.checkpoints
        : null) ?? track.checkpoints ?? [];
    if (checkpoints.length > 0) {
      const kartY = st.groundPosition ?? p.y ?? 0;
      for (let i = 0; i < checkpoints.length; i += 1) {
        if (visitedRef.current.has(i)) continue;
        const cp = checkpoints[i]?.position;
        if (!cp) continue;
        const cdx = p.x - cp[0];
        const cdz = p.z - cp[2];
        if (cdx * cdx + cdz * cdz < 14 * 14 && Math.abs(kartY - cp[1]) < 10) {
          visitedRef.current.add(i);
          try {
            useGameStore.getState().setRespawnCheckpointIndex?.(i);
          } catch {
            // ignore
          }
        }
      }
    } else if (farGateRef.current == null) {
      // Lazy far-gate from the minimap road bounds (published by TrackWalls).
      // ~30% of the road-bbox XZ diagonal: a real lap always leaves the start
      // area that far; the reverse-28m-and-recross cheat never does.
      const road = useGameStore.getState().roadMapData;
      if (road && Number.isFinite(road.minX)) {
        const diag = Math.hypot(road.maxX - road.minX, road.maxZ - road.minZ);
        farGateRef.current =
          diag > 60 ? Math.max(35, Math.min(160, diag * 0.3)) : MIN_DIST;
      }
    } else if (dist > farGateRef.current) {
      farVisitedRef.current = true;
    }

    const prevS = prevSRef.current;

    // عبور من ورا الخط لقدامه + جوه عرض الخط + بعيد كفاية + عدى وقت كفاية
    // + إثبات لفة كاملة (ما عدا أول عبور: stub الشبكة للخط بيتحسب عادي).
    const lapsDone = Array.isArray(gm.lapTimes) ? gm.lapTimes.length : 0;
    const tourProven =
      lapsDone === 0 ||
      (checkpoints.length > 0
        ? visitedRef.current.size >= checkpoints.length
        : farVisitedRef.current);
    if (
      maxDistRef.current > MIN_DIST &&
      prevS <= 0 &&
      s > 0 &&
      Math.abs(l) < HALF_WIDTH &&
      gm.currentLapTime > MIN_LAP_MS &&
      tourProven
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

      // ابدأ قياس البعد والجولة من جديد للفة الجديدة
      maxDistRef.current = 0;
      visitedRef.current = new Set();
      farVisitedRef.current = false;
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

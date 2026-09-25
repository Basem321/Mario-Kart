import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useGameStore } from "./store";
import { useGameManager } from "./gameManager";
import { FINISH_LINE } from "./constants";
import { publishOnlineRaceEvent } from "./onlineRaceTransport";

const groundRaycaster = new THREE.Raycaster();
const downDir = new THREE.Vector3(0, -1, 0);

/**
 * يقدّر اتجاه الطريق ونصه حوالين نقطة البداية من حيطان الطريق
 * (الـ boundary edges بتمشي على طول الطريق، فاتجاهها = اتجاه السير).
 * بيرجع {cx, cz, fx, fz} أو null لو مفيش حيطان قريبة.
 */
function estimateTrackFrame(spawnX, spawnZ, headingFx, headingFz, wallSegments) {
  const R = FINISH_LINE.snapRadius ?? 50;
  let sumSin2 = 0;
  let sumCos2 = 0;
  let cx = 0;
  let cz = 0;
  let n = 0;
  for (const s of wallSegments) {
    const mx = (s.ax + s.bx) / 2;
    const mz = (s.az + s.bz) / 2;
    if (Math.hypot(mx - spawnX, mz - spawnZ) > R) continue;
    const dx = s.bx - s.ax;
    const dz = s.bz - s.az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    // خط بلا اتجاه: نضاعف الزاوية عشان الاتجاهين المتعاكسين يتجمعوا صح
    const theta = Math.atan2(dz / len, dx / len);
    sumSin2 += Math.sin(2 * theta);
    sumCos2 += Math.cos(2 * theta);
    cx += mx;
    cz += mz;
    n += 1;
  }
  if (n === 0) return null;
  const avgTheta = Math.atan2(sumSin2, sumCos2) / 2;
  let fx = Math.cos(avgTheta);
  let fz = Math.sin(avgTheta);
  // اختار الاتجاه اللي ماشي مع وش الكارت (ناحية اليافطة)
  if (fx * headingFx + fz * headingFz < 0) {
    fx = -fx;
    fz = -fz;
  }
  return { cx: cx / n, cz: cz / n, fx, fz };
}

/**
 * خط النهاية تحت يافطة MARIO KART:
 * - بيتحط تلقائياً على نص الطريق عند البداية + إزاحة لقدام ناحية اليافطة
 *   (ظبطها من FINISH_LINE.forwardOffset في constants.js)
 * - كل عبور في الاتجاه الصح => lap + 1
 */
export function FinishLine() {
  const centerRef = useRef(null); // {x,z,fx,fz,rx,rz,ry,y}
  const prevSRef = useRef(0);
  const maxDistRef = useRef(0);
  const setupStartedAtRef = useRef(null);
  const [visual, setVisual] = useState(null);
  const scene = useThree((s) => s.scene);
  const collidersRef = useRef(null);

  // Reset when a session ends. Waiting for the road walls before creating the
  // line avoids placing it from a transient/empty collider list at race start.
  const showHomepage = useGameManager((s) => s.showHomepage);
  const gameStarted = useGameManager((s) => s.gameStarted);
  const onlineRaceId = useGameManager((s) => s.onlineRaceId);
  useEffect(() => {
    if (showHomepage || !gameStarted) {
      centerRef.current = null;
      prevSRef.current = 0;
      maxDistRef.current = 0;
      setupStartedAtRef.current = null;
      collidersRef.current = null;
      setVisual(null);
    }
  }, [gameStarted, onlineRaceId, showHomepage]);

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

  useFrame((state) => {
    const gm = useGameManager.getState();
    if (!gm.gameStarted || gm.gameOver) return;

    const st = useGameStore.getState();
    const p = st.playerPosition;
    if (!p) return;

    const HALF_WIDTH = FINISH_LINE.halfWidth;
    const MIN_LAP_MS = FINISH_LINE.minLapMs;
    const MIN_DIST = FINISH_LINE.minDist;

    // أول فريم بعد بداية السباق: ثبّت الخط على نص الطريق ناحية اليافطة
    if (!centerRef.current) {
      const now = state.clock.elapsedTime * 1000;
      if (setupStartedAtRef.current === null) setupStartedAtRef.current = now;

      const ry0 = st.playerRotationY || 0;
      const headingFx = -Math.sin(ry0);
      const headingFz = -Math.cos(ry0);

      const segs = st.wallSegments || [];
      // TrackWalls normally publishes before GO. On a slow asset load, wait a
      // short moment for it; then use the safe spawn fallback instead of never
      // enabling lap counting.
      if (segs.length === 0 && now - setupStartedAtRef.current < 1500) return;
      const est = estimateTrackFrame(p.x, p.z, headingFx, headingFz, segs);

      const fx = est ? est.fx : headingFx;
      const fz = est ? est.fz : headingFz;
      // اليمين = عمودي على اتجاه السير
      const rx = -fz;
      const rz = fx;

      let cx = est ? est.cx : p.x;
      let cz = est ? est.cz : p.z;
      // زيح الخط لقدام ناحية اليافطة + يمين/شمال لو محتاج
      cx += fx * (FINISH_LINE.forwardOffset ?? 0) + rx * (FINISH_LINE.lateralOffset ?? 0);
      cz += fz * (FINISH_LINE.forwardOffset ?? 0) + rz * (FINISH_LINE.lateralOffset ?? 0);

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
      };
      centerRef.current = c;
      prevSRef.current = (p.x - cx) * fx + (p.z - cz) * fz;
      maxDistRef.current = 0;
      setVisual(c);
      console.log(
        `[FinishLine] at (${cx.toFixed(1)}, ${cz.toFixed(1)}) dir=(${fx.toFixed(2)}, ${fz.toFixed(2)}) snapped=${est ? "road" : "spawn"}`
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

  const HALF_WIDTH = FINISH_LINE.halfWidth;
  const COLS = 14;
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

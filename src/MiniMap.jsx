import { useEffect, useMemo, useRef } from "react";
import { useGameManager } from "./gameManager";
import { useGameStore } from "./store";
import { useOnlineRaceStore } from "./onlineRaceStore";
import "./MiniMap.css";

const MAP_PADDING = 16;
const RACER_COLORS = ["#ff4757", "#2ed573", "#ffa502", "#1e90ff", "#9b59b6", "#e056fd"];

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const pointKey = (x, z) => `${Math.round(x * 20)}:${Math.round(z * 20)}`;

const validRoadSegments = (segments) =>
  (Array.isArray(segments) ? segments : []).filter(
    (segment) =>
      !segment?.outer &&
      [segment?.ax, segment?.az, segment?.bx, segment?.bz].every(Number.isFinite),
  );

/** Join boundary segments into fillable loops if using wallSegments fallback. */
const buildRoadLoops = (segments) => {
  const connections = new Map();
  const addConnection = (key, connection) => {
    const entries = connections.get(key) ?? [];
    entries.push(connection);
    connections.set(key, entries);
  };

  segments.forEach((segment, index) => {
    addConnection(pointKey(segment.ax, segment.az), { index, atStart: true });
    addConnection(pointKey(segment.bx, segment.bz), { index, atStart: false });
  });

  const unused = new Set(segments.map((_, index) => index));
  const loops = [];

  while (unused.size > 0) {
    const firstIndex = unused.values().next().value;
    const first = segments[firstIndex];
    const startKey = pointKey(first.ax, first.az);
    let currentKey = pointKey(first.bx, first.bz);
    const loop = [
      { x: first.ax, z: first.az },
      { x: first.bx, z: first.bz },
    ];
    unused.delete(firstIndex);

    for (let safety = 0; safety <= segments.length; safety += 1) {
      if (currentKey === startKey) break;
      const next = (connections.get(currentKey) ?? []).find((entry) => unused.has(entry.index));
      if (!next) break;

      const segment = segments[next.index];
      unused.delete(next.index);
      const point = next.atStart
        ? { x: segment.bx, z: segment.bz }
        : { x: segment.ax, z: segment.az };
      loop.push(point);
      currentKey = pointKey(point.x, point.z);
    }

    if (loop.length >= 4 && currentKey === startKey) loops.push(loop);
  }

  return loops;
};

const makeMapDataFromSegments = (wallSegments) => {
  const segments = validRoadSegments(wallSegments);
  if (segments.length === 0) return null;

  const coordinates = segments.flatMap((segment) => [
    { x: segment.ax, z: segment.az },
    { x: segment.bx, z: segment.bz },
  ]);
  const minX = Math.min(...coordinates.map((point) => point.x));
  const maxX = Math.max(...coordinates.map((point) => point.x));
  const minZ = Math.min(...coordinates.map((point) => point.z));
  const maxZ = Math.max(...coordinates.map((point) => point.z));

  return {
    boundaryEdges: segments,
    loops: buildRoadLoops(segments),
    minX,
    maxX,
    minZ,
    maxZ,
  };
};

const makeProjection = (mapData, width, height) => {
  const drawableWidth = Math.max(1, width - MAP_PADDING * 2);
  const drawableHeight = Math.max(1, height - MAP_PADDING * 2);
  const spanX = Math.max(1, mapData.maxX - mapData.minX);
  const spanZ = Math.max(1, mapData.maxZ - mapData.minZ);
  const scale = Math.min(drawableWidth / spanX, drawableHeight / spanZ);
  const offsetX = (width - spanX * scale) / 2 - mapData.minX * scale;
  const offsetY = (height - spanZ * scale) / 2 + mapData.maxZ * scale;

  return {
    point: (x, z) => ({ x: offsetX + x * scale, y: offsetY - z * scale }),
  };
};

const drawRoad = (context, mapData, projection, width, height) => {
  context.clearRect(0, 0, width, height);
  // Dark circular map background
  context.fillStyle = "#11141c";
  context.fillRect(0, 0, width, height);

  // Subtle grid
  context.strokeStyle = "rgba(255, 255, 255, 0.045)";
  context.lineWidth = 1;
  for (let x = 12; x < width; x += 22) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = 12; y < height; y += 22) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  // Draw road surface from triangles if available
  if (mapData.triangles && mapData.triangles.length > 0) {
    context.fillStyle = "#3a404c";
    context.beginPath();
    for (const tri of mapData.triangles) {
      const pa = projection.point(tri.a.x, tri.a.z);
      const pb = projection.point(tri.b.x, tri.b.z);
      const pc = projection.point(tri.c.x, tri.c.z);
      context.moveTo(pa.x, pa.y);
      context.lineTo(pb.x, pb.y);
      context.lineTo(pc.x, pc.y);
    }
    context.fill();
  } else if (mapData.loops && mapData.loops.length > 0) {
    context.beginPath();
    for (const loop of mapData.loops) {
      const first = projection.point(loop[0].x, loop[0].z);
      context.moveTo(first.x, first.y);
      for (let i = 1; i < loop.length; i += 1) {
        const p = projection.point(loop[i].x, loop[i].z);
        context.lineTo(p.x, p.y);
      }
      context.closePath();
    }
    context.fillStyle = "#3a404c";
    context.fill("evenodd");
  }

  // Stroke crisp road boundary edges
  const edges = mapData.boundaryEdges || [];
  if (edges.length > 0) {
    context.strokeStyle = "rgba(255, 255, 255, 0.88)";
    context.lineWidth = 1.6;
    context.lineCap = "round";
    context.beginPath();
    for (const edge of edges) {
      const a = projection.point(edge.ax, edge.az);
      const b = projection.point(edge.bx, edge.bz);
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
    }
    context.stroke();
  }
};

const drawRacer = (context, projection, racer, color, isSelf, label, width, height) => {
  if (!Number.isFinite(racer?.x) || !Number.isFinite(racer?.z)) return;
  const raw = projection.point(racer.x, racer.z);
  const x = clamp(raw.x, 8, width - 8);
  const y = clamp(raw.y, 8, height - 8);
  const rotationY = Number.isFinite(racer.rotationY) ? racer.rotationY : 0;

  context.save();
  context.translate(x, y);
  context.rotate(rotationY + Math.PI / 2);

  // Directional arrow
  context.beginPath();
  context.moveTo(7, 0);
  context.lineTo(-4.5, -4);
  context.lineTo(-2.2, 0);
  context.lineTo(-4.5, 4);
  context.closePath();
  context.fillStyle = color;
  context.fill();
  context.lineWidth = isSelf ? 2.2 : 1.3;
  context.strokeStyle = isSelf ? "#ffffff" : "rgba(0, 0, 0, 0.75)";
  context.stroke();
  context.restore();

  // Subtle highlight halo for local player
  if (isSelf) {
    context.beginPath();
    context.arc(x, y, 8, 0, Math.PI * 2);
    context.strokeStyle = "rgba(57, 198, 255, 0.55)";
    context.lineWidth = 1.5;
    context.stroke();
  }

  if (label) {
    context.fillStyle = "#ffffff";
    context.font = "800 8px 'Oswald', sans-serif";
    context.textAlign = "center";
    context.shadowColor = "rgba(0, 0, 0, 0.9)";
    context.shadowBlur = 3;
    context.fillText(label, x, y - 9);
    context.shadowBlur = 0;
  }
};

/**
 * High-performance 2D canvas minimap.
 * Renders the accurate road surface + real-time player positions.
 */
export function MiniMap() {
  const canvasRef = useRef(null);
  const gameStarted = useGameManager((state) => state.gameStarted);
  const roadMapData = useGameStore((state) => state.roadMapData);
  const wallSegments = useGameStore((state) => state.wallSegments);

  const mapData = useMemo(() => {
    if (roadMapData && roadMapData.triangles && roadMapData.triangles.length > 0) {
      return roadMapData;
    }
    return makeMapDataFromSegments(wallSegments);
  }, [roadMapData, wallSegments]);

  useEffect(() => {
    if (!gameStarted || !canvasRef.current) return undefined;

    const canvas = canvasRef.current;
    let frame = 0;
    let staticLayer = null;
    let width = 0;
    let height = 0;
    let deviceScale = 0;
    let projection = null;

    const prepareCanvas = () => {
      const bounds = canvas.getBoundingClientRect();
      const nextWidth = Math.max(1, Math.round(bounds.width));
      const nextHeight = Math.max(1, Math.round(bounds.height));
      const nextDeviceScale = Math.max(1, window.devicePixelRatio || 1);
      if (
        nextWidth === width &&
        nextHeight === height &&
        nextDeviceScale === deviceScale &&
        staticLayer
      ) {
        return;
      }

      width = nextWidth;
      height = nextHeight;
      deviceScale = nextDeviceScale;
      canvas.width = Math.round(width * deviceScale);
      canvas.height = Math.round(height * deviceScale);
      projection = mapData ? makeProjection(mapData, width, height) : null;

      staticLayer = document.createElement("canvas");
      staticLayer.width = canvas.width;
      staticLayer.height = canvas.height;
      const staticContext = staticLayer.getContext("2d");
      staticContext.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
      if (mapData && projection) {
        drawRoad(staticContext, mapData, projection, width, height);
      } else {
        staticContext.fillStyle = "#11141c";
        staticContext.fillRect(0, 0, width, height);
      }
    };

    const draw = () => {
      prepareCanvas();
      const context = canvas.getContext("2d");
      context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
      context.clearRect(0, 0, width, height);
      if (staticLayer) context.drawImage(staticLayer, 0, 0, width, height);

      if (projection) {
        const game = useGameManager.getState();
        const playerState = useGameStore.getState();
        const remoteRacers = useOnlineRaceStore.getState().remoteRacers;
        const players = game.onlinePlayers ?? [];

        if (game.isOnlineRace && players.length > 0) {
          players.forEach((player, index) => {
            const isSelf = player.id === game.onlineSelfId;
            const transform = isSelf ? playerState.playerPosition : remoteRacers[player.id];
            if (!transform) return;
            drawRacer(
              context,
              projection,
              isSelf
                ? {
                    x: transform.x,
                    z: transform.z,
                    rotationY: playerState.playerRotationY,
                  }
                : transform,
              RACER_COLORS[index % RACER_COLORS.length],
              isSelf,
              isSelf ? "YOU" : String(player.name ?? "?").slice(0, 1).toUpperCase(),
              width,
              height,
            );
          });
        } else if (playerState.playerPosition) {
          // Single player / time trial
          drawRacer(
            context,
            projection,
            {
              x: playerState.playerPosition.x,
              z: playerState.playerPosition.z,
              rotationY: playerState.playerRotationY,
            },
            "#39c6ff",
            true,
            "YOU",
            width,
            height,
          );
        }
      }

      frame = window.requestAnimationFrame(draw);
    };

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(prepareCanvas);
    resizeObserver?.observe(canvas);
    window.addEventListener("resize", prepareCanvas);
    frame = window.requestAnimationFrame(draw);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", prepareCanvas);
      resizeObserver?.disconnect();
    };
  }, [gameStarted, mapData]);

  if (!gameStarted) return null;

  return (
    <aside className="mini-map" aria-label="Track minimap">
      <span className="mini-map-title">MAP</span>
      <canvas ref={canvasRef} aria-label="Track map with racer positions">
        Track map
      </canvas>
    </aside>
  );
}

export default MiniMap;

import { useEffect, useMemo, useRef } from "react";
import { useGameManager } from "./gameManager";
import { useGameStore } from "./store";
import { useOnlineRaceStore } from "./onlineRaceStore";
import "./MiniMap.css";

const MAP_PADDING = 15;
const RACER_COLORS = ["#ff4c4c", "#42c7ff", "#ffdb3d", "#a772ff", "#55df8b", "#ff8d43"];

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const pointKey = (x, z) => `${Math.round(x * 20)}:${Math.round(z * 20)}`;

const validRoadSegments = (segments) =>
  (Array.isArray(segments) ? segments : []).filter(
    (segment) =>
      !segment?.outer &&
      [segment?.ax, segment?.az, segment?.bx, segment?.bz].every(Number.isFinite),
  );

/** Join the real road-boundary edges into fillable loops for the map. */
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

    // Boundary vertices should have degree two. If an exported mesh contains
    // a junction, choosing an unused neighbor still yields a faithful outline
    // instead of blocking the entire minimap.
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

const makeMapData = (wallSegments) => {
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
    segments,
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
  context.fillStyle = "#15181f";
  context.fillRect(0, 0, width, height);

  // A subtle grid makes position changes easy to read without replacing the
  // true track outline as the visual source of truth.
  context.strokeStyle = "rgba(255, 255, 255, 0.035)";
  context.lineWidth = 1;
  for (let coordinate = 10; coordinate < width; coordinate += 20) {
    context.beginPath();
    context.moveTo(coordinate, 0);
    context.lineTo(coordinate, height);
    context.stroke();
  }
  for (let coordinate = 10; coordinate < height; coordinate += 20) {
    context.beginPath();
    context.moveTo(0, coordinate);
    context.lineTo(width, coordinate);
    context.stroke();
  }

  if (mapData.loops.length > 0) {
    context.beginPath();
    for (const loop of mapData.loops) {
      const first = projection.point(loop[0].x, loop[0].z);
      context.moveTo(first.x, first.y);
      for (let index = 1; index < loop.length; index += 1) {
        const point = projection.point(loop[index].x, loop[index].z);
        context.lineTo(point.x, point.y);
      }
      context.closePath();
    }
    context.fillStyle = "#555a63";
    context.fill("evenodd");
  }

  // Always stroke the original edges, including any loop a malformed export
  // could not close. This keeps the minimap's visual course exact.
  context.strokeStyle = "rgba(255, 246, 225, 0.76)";
  context.lineWidth = 1.35;
  context.beginPath();
  for (const segment of mapData.segments) {
    const a = projection.point(segment.ax, segment.az);
    const b = projection.point(segment.bx, segment.bz);
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
  }
  context.stroke();
};

const drawRacer = (context, projection, racer, color, isSelf, label, width, height) => {
  if (!Number.isFinite(racer?.x) || !Number.isFinite(racer?.z)) return;
  const raw = projection.point(racer.x, racer.z);
  const x = clamp(raw.x, 7, width - 7);
  const y = clamp(raw.y, 7, height - 7);
  const rotationY = Number.isFinite(racer.rotationY) ? racer.rotationY : 0;

  context.save();
  context.translate(x, y);
  context.rotate(rotationY + Math.PI / 2);
  context.beginPath();
  context.moveTo(6.5, 0);
  context.lineTo(-4.5, -4.25);
  context.lineTo(-2.4, 0);
  context.lineTo(-4.5, 4.25);
  context.closePath();
  context.fillStyle = color;
  context.fill();
  context.lineWidth = isSelf ? 2.4 : 1.4;
  context.strokeStyle = isSelf ? "#ffffff" : "rgba(0, 0, 0, 0.72)";
  context.stroke();
  context.restore();

  if (label) {
    context.fillStyle = "#ffffff";
    context.font = "700 8px system-ui, sans-serif";
    context.textAlign = "center";
    context.fillText(label, x, y - 8);
  }
};

/**
 * Canvas minimap for online races. Marker coordinates are read directly from
 * the same local/remote transforms that render the 3D karts, so it stays in
 * sync without adding a second network channel or a React render every frame.
 */
export function MiniMap() {
  const canvasRef = useRef(null);
  const isOnlineRace = useGameManager((state) => state.isOnlineRace);
  const gameStarted = useGameManager((state) => state.gameStarted);
  const wallSegments = useGameStore((state) => state.wallSegments);
  const mapData = useMemo(() => makeMapData(wallSegments), [wallSegments]);

  useEffect(() => {
    if (!isOnlineRace || !gameStarted || !canvasRef.current) return undefined;

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
      if (mapData && projection) drawRoad(staticContext, mapData, projection, width, height);
      else {
        staticContext.fillStyle = "#15181f";
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
  }, [gameStarted, isOnlineRace, mapData]);

  if (!isOnlineRace || !gameStarted) return null;

  return (
    <aside className="mini-map" aria-label="Live map of every online racer">
      <span className="mini-map-title">Map</span>
      <canvas ref={canvasRef} aria-label="Track map with racer positions">
        Live online track map
      </canvas>
    </aside>
  );
}

export default MiniMap;

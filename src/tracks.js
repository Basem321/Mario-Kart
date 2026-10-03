import * as THREE from "three";
import {
  mergeGeometries,
  mergeVertices,
} from "three/addons/utils/BufferGeometryUtils.js";
// Root config file is the source of truth for Shroom Ridge: tuning values
// below come from ds-shroom-ridge-config.json (Map Editor exports overwrite
// that file to make editor changes permanent).
import dsShroomRidgeConfig from "../ds-shroom-ridge-config.json";

const shroomJson =
  dsShroomRidgeConfig && dsShroomRidgeConfig.trackId === "ds-shroom-ridge"
    ? dsShroomRidgeConfig
    : {};

/**
 * Finish-line frame: forward (race direction) and right vectors plus the
 * visual yaw. finishRotationY is in degrees, 0 = facing -Z (the legacy
 * behavior every existing track keeps).
 */
export const getFinishFrame = (config = {}) => {
  const rotationY = ((Number(config.finishRotationY) || 0) * Math.PI) / 180;
  const fx = -Math.sin(rotationY);
  const fz = -Math.cos(rotationY);
  return { fx, fz, rx: -fz, rz: fx, ry: Math.atan2(-fx, -fz) };
};

/**
 * Track registry. Every playable course is normalized so its start behaves
 * like the main map: a straight section centered on world origin, race
 * direction -Z. That lets spawn slots, the online grid, the finish line,
 * item boxes, walls and the minimap work unchanged on any track.
 */
export const TRACKS = [
  {
    id: "mario-circuit",
    name: "Mario Circuit",
    tagline: "Classic asphalt Grand Prix",
    image: "/snes.webp",
    glb: "/models/mario-circuit-test-transformed.glb",
    offset: [155, -28, 15],
    scale: 0.08,
    // Node names (drei `nodes` keys) holding the drivable road surface.
    // The first entry is the primary road; the rest are merged in.
    // (Mario uses Object_24 only: the legacy loader preferred it whenever
    // present, so this preserves the exact original behavior.)
    roadNodes: ["Object_24"],
    // Subset of roadNodes rendered with the dusty "ground dirt" material name.
    dirtNodes: [],
    // Exact render list (preserves the original course behavior pixel-for-pixel).
    // Entries: [nodeName, meshName, materialKey].
    explicitMeshes: [
      ["Object_10", "ground", "material_5"],
      ["Object_11", "ground dirt", "material_6"],
      ["Object_12", "ground", "material_7"],
      ["Object_13", "ground", "material_8"],
      ["Object_18", "ground", "material_12"],
      ["Object_22", "ground", "material_16"],
      ["Object_24", "ground", "material_18"],
      ["Object_25", "ground", "material_19"],
      ["Object_27", "ground speed", "material_21"],
      ["Object_47", "ground", "material_3"],
    ],
    excludeNodes: [],
    // Distance ahead of spawn (world units) where the finish line sits.
    finishOffset: 30.5,
    // Left / right shift of the line along the road normal.
    lateralOffset: 0,
    // Trigger half-width across the track (full width = 58).
    halfWidth: 29,
    boostPads: [],
    wallExclusion: [],
    // Authored starting grid (from Map Editor export: mario-circuit-config.json).
    // rotationY is in degrees, 0 = facing race direction (-Z).
    spawnSlots: [
      { position: [-5.3, -1.7, -25.3], rotationY: 0 },
      { position: [-3.0, -1.7, -21.8], rotationY: 0 },
      { position: [-0.7, -1.7, -19.2], rotationY: 0 },
      { position: [1.2, -1.7, -16.0], rotationY: 0 },
      { position: [3.6, -1.7, -12.5], rotationY: 0 },
      { position: [6.0, -1.7, -9.2], rotationY: 0 },
      { position: [-4.2, -1.7, -6.0], rotationY: 0 },
      { position: [-2.0, -1.7, -3.2], rotationY: 0 },
      { position: [0.3, -1.7, 0.1], rotationY: 0 },
      { position: [2.6, -1.7, 3.4], rotationY: 0 },
    ],
  },
  {
    id: "waluigi-stadium",
    name: "Waluigi Stadium",
    tagline: "Dirt oval with the legendary big jump",
    image: "/waluigi-stadium.png",
    glb: "/models/waluigi-stadiumMap.glb",
    // Start straight (local x≈0, z≈650, road y≈135.5) mapped to world origin.
    // Y matches Mario Circuit (-1.68): the kart rig assumes the road sits
    // ~1.7 units below the player-group origin (wheel ray origins).
    offset: [0, -12.52, -52],
    scale: 0.08,
    // Dirt road halves, starting grid, ramps, and elevated bridges
    roadNodes: [
      "Object_30",
      "Object_31",
      "Object_11",
      "Object_34",
      "Object_47",
      "Object_32",
    ],
    // Like Shroom Ridge: the model ships its own barriers, so the generated
    // red/white road-edge barriers stay hidden (invisible collision still
    // applies, including the jump wallExclusion corridors below).
    naturalWalls: true,
    dirtNodes: [
      "Object_30",
      "Object_31",
      "Object_11",
      "Object_34",
      "Object_47",
      "Object_32",
    ],
    // Render every node except the sky domes (custom sky already exists).
    // In the GLTF, the 3 sky domes (meshes 2, 3, 33) are duplicated across
    // nodes: Object_6/123, Object_7/122, Object_37/108. Exclude all 6.
    explicitMeshes: null,
    excludeNodes: [
      "Object_6",
      "Object_7",
      "Object_37",
      "Object_108",
      "Object_122",
      "Object_123",
    ],
    finishOffset: 20,
    // Recenter the line on the road middle (wall-density snap biases +x).
    lateralOffset: 0,
    // Trigger half-width across the track (full width = 26).
    halfWidth: 13,
    // Wall-free corridor (world XZ rect) over the jump approach, lip,
    // elevated band and landing: rails there would block the flight line or
    // float mid-air. Runoff stays recoverable via Reset; outer walls
    // outside it are kept.
    wallExclusion: [
      { minX: -20, maxX: 20, minZ: 45, maxZ: 125 },
      // Small-loop jump: ramp takeoff at z≈-155 (x≈55, z≈-155), gap and landing down to z≈-195
      { minX: 30, maxX: 85, minZ: -195, maxZ: -110 },
    ],
    // Glowing green boost pads across the road before each ramp
    // (authored positions from Map Editor export: waluigi-stadium-config.json)
    boostPads: [
      {
        id: "stadium-ramp-1",
        position: [0.2, -1, 134.8],
        width: 13,
        length: 4.5,
        speed: 60,
        launchVy: 10,
        duration: 2.0,
      },
      {
        id: "stadium-ramp-2",
        position: [54.2, 0.1, -188.9],
        width: 13,
        length: 4.5,
        speed: 45,
        launchVy: 6,
        duration: 2.2,
      },
    ],
    // Authored starting grid (from Map Editor export: waluigi-stadium-config.json).
    // rotationY is in degrees, 0 = facing race direction (-Z).
    spawnSlots: [
      { position: [-6.3, -1.7, -14.1], rotationY: 0 },
      { position: [-4.1, -1.7, -11.4], rotationY: 0 },
      { position: [-2.0, -1.7, -7.8], rotationY: 0 },
      { position: [0.4, -1.7, -4.6], rotationY: 0 },
      { position: [2.8, -1.7, -1.7], rotationY: 0 },
      { position: [5.4, -1.7, 1.9], rotationY: 0 },
      { position: [-5.2, -1.7, 4.8], rotationY: 0 },
      { position: [-2.9, -1.7, 7.7], rotationY: 0 },
      { position: [-0.4, -1.7, 11.1], rotationY: 0 },
      { position: [1.7, -1.7, 14.6], rotationY: 0 },
    ],
  },
  {
    id: "ds-shroom-ridge",
    name: "Shroom Ridge",
    tagline: "DS mountain pass with tunnel switchbacks",
    image: "/ds-shroom-ridge.png",
    glb: "/models/ds-shroom-ridge.glb",
    // Tuning values below are owned by ds-shroom-ridge-config.json at the
    // repo root (the file is the source of truth — edit it or overwrite it
    // with a Map Editor export to retune permanently). Code-side geometry
    // choices (which GLB nodes form the road, what gets rendered) stay here.
    // Start/finish straight (local x≈-33.5, z≈154.9, road y≈287.7)
    // mapped to world origin.
    // Y matches Mario Circuit (-1.68): the kart rig assumes the road sits
    // ~1.7 units below the player-group origin (wheel ray origins).
    offset: shroomJson.offset ?? [2.68, -24.7, -12.39],
    scale: shroomJson.scale ?? 0.08,
    // Main asphalt + shoulder. Merged together so the seam between them
    // cancels out instead of spawning invisible walls across the driving
    // line (same pattern as Waluigi's multi-part dirt road).
    roadNodes: ["Object_49", "Object_47"],
    dirtNodes: [],
    // The model ships its own rock walls / tunnel / barriers, so the
    // generated red/white road-edge barriers are hidden — only the outer
    // safety fence renders. Invisible road-edge collision still stops karts
    // (see TrackWalls), and kart-vs-model-wall collision is handled by the
    // horizontal mesh-wall raycast in PlayerController.
    // Toggleable in the Map Editor (Track tab); owned by the root JSON.
    naturalWalls: shroomJson.naturalWalls ?? true,
    // Render every node (no sky domes in this export to exclude).
    // Every rendered mesh is named "ground*" so the existing wheel/wall
    // raycasts, BVH builder and dust logic work unchanged.
    explicitMeshes: null,
    excludeNodes: [],
    finishOffset: shroomJson.finishOffset ?? 20,
    // The road bends left through the finish area (road center ≈ world
    // x -8 at the line, asphalt spanning roughly x -14..-2), so the line is
    // shifted west to sit on the asphalt instead of the eastern hillside.
    lateralOffset: shroomJson.lateralOffset ?? -7,
    // Trigger half-width across the track (full width = 18).
    halfWidth: shroomJson.halfWidth ?? 9,
    // Line yaw in degrees (0 = perpendicular to -Z). Editable in the Map
    // Editor (drag/rotate the finish gizmo in the 3D viewport).
    finishRotationY: shroomJson.finishRotationY ?? 0,
    // No jumps on this course: no wall-free corridor needed, runoff stays
    // recoverable via Reset and outer walls outside it are kept.
    wallExclusion: shroomJson.wallExclusion ?? [],
    // No boost pads on the original DS layout.
    boostPads: shroomJson.boostPads ?? [],
    // Reset targets along the course (verified against the GLB geometry:
    // every point sits on solid road surface). A fallen kart respawns at
    // the nearest one with its heading. Extend/tune in the Map Editor.
    // rotationY is in degrees, 0 = facing race direction (-Z).
    checkpoints: shroomJson.checkpoints ?? [],
    // Starting grid following the opening left curve (verified against the
    // actual GLB geometry: every slot sits on solid road-level ground,
    // no voids or drops underneath). Headings face along the curve toward
    // the finish (rotationY in degrees, 0 = -Z).
    spawnSlots: shroomJson.spawnSlots ?? [],
  },
];

export const DEFAULT_TRACK_ID = "mario-circuit";

export const getTrack = (id) =>
  TRACKS.find((track) => track.id === id) ?? TRACKS[0];

export const isKnownTrackId = (id) => TRACKS.some((track) => track.id === id);

export const trackOffsetVector = (track) =>
  new THREE.Vector3(track.offset[0], track.offset[1], track.offset[2]);

/** Local -> world using a track's transform. */
export const trackToWorld = (track, lx, ly, lz) => ({
  x: lx * track.scale + track.offset[0],
  y: ly * track.scale + track.offset[1],
  z: lz * track.scale + track.offset[2],
});

const mergedRoadCache = new Map();

const stripToCoreAttributes = (geometry) => {
  const clone = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const kept = {};
  for (const name of ["position", "normal", "uv"]) {
    const attribute = clone.getAttribute(name);
    if (attribute) kept[name] = attribute;
  }
  const stripped = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(kept)) {
    stripped.setAttribute(name, attribute);
  }
  return stripped;
};

/**
 * Merged world-space road geometry for a track (walls, item boxes, reset,
 * minimap all build on this). Multi-part roads (Waluigi's two halves) are
 * welded first so the seam between parts cancels out instead of spawning
 * invisible walls across the driving line.
 */
export const getMergedRoadGeometry = (nodes, track) => {
  const cacheKey = track.id;
  const cached = mergedRoadCache.get(cacheKey);
  if (cached) return cached;

  const parts = [];
  for (const nodeName of track.roadNodes) {
    const node = nodes?.[nodeName];
    const geometry = node?.geometry;
    if (geometry) parts.push({ nodeName, geometry });
  }
  if (parts.length === 0) return null;

  let merged = null;
  try {
    const normalized = parts.map(({ geometry }) => {
      const stripped = stripToCoreAttributes(geometry);
      // Weld split-part seams (tolerance in local units, far below kart size).
      return mergeVertices(stripped, 0.25);
    });
    merged =
      normalized.length === 1
        ? normalized[0]
        : mergeGeometries(normalized, false);
  } catch (error) {
    console.warn(
      `[tracks] road merge failed for ${track.id}, using primary part`,
      error,
    );
    merged = stripToCoreAttributes(parts[0].geometry);
  }
  if (!merged) return null;

  // Kept in LOCAL coordinates: every consumer applies the track transform
  // (trackToWorld), exactly like the single-mesh road before it.
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  mergedRoadCache.set(cacheKey, merged);
  console.info(
    `[tracks] ${track.id}: merged road from ${parts.map((p) => p.nodeName).join("+")} ` +
      `(${(merged.index ? merged.index.count / 3 : merged.attributes.position.count / 3).toFixed(0)} tris)`,
  );
  return merged;
};

/** Clear the merged-road cache (used on full reload paths). */
export const clearMergedRoadCache = () => {
  for (const geometry of mergedRoadCache.values()) {
    try {
      geometry.dispose();
    } catch {
      // ignore
    }
  }
  mergedRoadCache.clear();
};

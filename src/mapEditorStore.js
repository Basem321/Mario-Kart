import { create } from "zustand";
import { getTrack, TRACKS } from "./tracks";
import { FINISH_LINE } from "./constants";

/** Deep-clone a plain object/array (JSON-safe). */
const clone = (v) => JSON.parse(JSON.stringify(v));

/** Max online players (and spawn slots). */
export const MAX_SPAWNS = 10;

/** Build a default spawn grid (2 columns, staggered rows). Road level is Y = -1.68. */
function defaultSpawnSlots() {
  const slots = [];
  for (let i = 0; i < MAX_SPAWNS; i++) {
    const lane = i % 2;
    const row = Math.floor(i / 2);
    slots.push({
      position: [lane === 0 ? -2.2 : 2.2, -1.68, row * 3.4],
      rotationY: 0,
      kartScale: 1,
    });
  }
  return slots;
}

/** Clamp a per-spawn kart scale to a sane drivable range. */
const clampKartScale = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 1;
  return Math.max(0.2, Math.min(3, num));
};

/** Build a fresh working copy from the code defaults for a given track. */
function defaultsFor(trackId) {
  const track = getTrack(trackId);
  const spawnSlots = clone(track.spawnSlots ?? defaultSpawnSlots());
  // Older configs lack per-spawn kart size — backfill so every slot edits it.
  for (const slot of spawnSlots) {
    if (!Number.isFinite(Number(slot.kartScale))) slot.kartScale = 1;
  }
  return {
    trackId: track.id,
    boostPads: clone(track.boostPads ?? []),
    finishOffset: track.finishOffset ?? FINISH_LINE.forwardOffset ?? 22,
    lateralOffset: track.lateralOffset ?? FINISH_LINE.lateralOffset ?? 0,
    halfWidth: track.halfWidth ?? FINISH_LINE.halfWidth ?? 12,
    finishRotationY: track.finishRotationY ?? 0,
    wallExclusion: clone(track.wallExclusion ?? []),
    offset: [...track.offset],
    scale: track.scale,
    naturalWalls: track.naturalWalls ?? false,
    spawnSlots,
    checkpoints: clone(track.checkpoints ?? []),
  };
}

export const useMapEditorStore = create((set, get) => ({
  /** Whether the editor panel is visible. */
  isOpen: false,
  /** Index of the currently selected boost pad (for highlighting). */
  selectedPadIndex: null,
  /** Index of the currently selected spawn slot. */
  selectedSpawnIndex: null,
  /** Index of the currently selected checkpoint. */
  selectedCheckpointIndex: null,
  /** Whether the finish-line gizmo is selected in the 3D viewport. */
  finishSelected: false,
  /** Working copy of the track config being edited. */
  editedConfig: null,
  /** Track id currently loaded in the editor. */
  loadedTrackId: null,
  /** Transform gizmo mode: "translate" | "rotate" */
  transformMode: "translate",
  /** Camera focus request: { position: [x,y,z], target: [x,y,z], id: number } */
  cameraFocusTarget: null,
  focusCamera: (position, target) => {
    set({ cameraFocusTarget: { position, target, id: Date.now() } });
  },

  // ────────────────── Editor lifecycle ──────────────────

  toggleEditor: (trackId) => {
    const state = get();
    if (state.isOpen) {
      set({ isOpen: false, selectedPadIndex: null, selectedSpawnIndex: null, selectedCheckpointIndex: null, finishSelected: false });
    } else {
      const tid = trackId ?? state.loadedTrackId;
      const config =
        state.editedConfig && state.loadedTrackId === tid
          ? state.editedConfig
          : defaultsFor(tid);
      set({ isOpen: true, editedConfig: config, loadedTrackId: tid });
    }
  },

  closeEditor: () => set({ isOpen: false, selectedPadIndex: null, selectedSpawnIndex: null, selectedCheckpointIndex: null, finishSelected: false }),

  /** Load config for a specific track (called when track changes). */
  loadTrack: (trackId) => {
    set({
      editedConfig: defaultsFor(trackId),
      loadedTrackId: trackId,
      selectedPadIndex: null,
      selectedSpawnIndex: null,
      selectedCheckpointIndex: null,
      finishSelected: false,
    });
  },

  setTransformMode: (mode) => set({ transformMode: mode }),

  // ────────────────── Boost Pads ──────────────────

  selectPad: (index) => set({ selectedPadIndex: index, selectedSpawnIndex: null, selectedCheckpointIndex: null, finishSelected: false }),

  updatePad: (index, field, value) => {
    const config = clone(get().editedConfig);
    if (!config || !config.boostPads || !config.boostPads[index]) return;
    // Handle position array fields: "positionX", "positionY", "positionZ"
    if (field.startsWith("position")) {
      const axis = { positionX: 0, positionY: 1, positionZ: 2 }[field];
      if (axis !== undefined) {
        config.boostPads[index].position[axis] = Number(value);
      }
    } else {
      config.boostPads[index][field] = Number(value);
    }
    set({ editedConfig: config });
  },

  setPadPosition: (index, position) => {
    const config = clone(get().editedConfig);
    if (!config || !config.boostPads || !config.boostPads[index]) return;
    config.boostPads[index].position = [
      Number(position[0]),
      Number(position[1]),
      Number(position[2]),
    ];
    set({ editedConfig: config });
  },

  addPad: (initialData) => {
    const config = clone(get().editedConfig);
    if (!config) return;
    config.boostPads = config.boostPads || [];
    const id = `pad-${Date.now().toString(36)}`;
    config.boostPads.push({
      id,
      position: initialData?.position ? [...initialData.position] : [0, 0, 0],
      width: initialData?.width ?? 18,
      length: initialData?.length ?? 4.5,
      speed: initialData?.speed ?? 60,
      launchVy: initialData?.launchVy ?? 10,
      duration: initialData?.duration ?? 2.0,
    });
    set({ editedConfig: config, selectedPadIndex: config.boostPads.length - 1 });
  },

  duplicatePad: (index) => {
    const config = clone(get().editedConfig);
    if (!config || !config.boostPads || !config.boostPads[index]) return;
    const original = config.boostPads[index];
    const copy = {
      ...clone(original),
      id: `pad-${Date.now().toString(36)}`,
      position: [
        original.position[0],
        original.position[1],
        original.position[2] + 5,
      ],
    };
    config.boostPads.splice(index + 1, 0, copy);
    set({ editedConfig: config, selectedPadIndex: index + 1 });
  },

  removePad: (index) => {
    const config = clone(get().editedConfig);
    if (!config || !config.boostPads) return;
    config.boostPads.splice(index, 1);
    set({ editedConfig: config, selectedPadIndex: null });
  },

  // ────────────────── Spawn Slots (up to 10) ──────────────────

  selectSpawn: (index) => set({ selectedSpawnIndex: index, selectedPadIndex: null, selectedCheckpointIndex: null, finishSelected: false }),

  setSpawnPosition: (index, position) => {
    const config = clone(get().editedConfig);
    if (!config?.spawnSlots?.[index]) return;
    config.spawnSlots[index].position = [
      Number(position[0]),
      Number(position[1]),
      Number(position[2]),
    ];
    set({ editedConfig: config });
  },

  setSpawnRotation: (index, rotationY) => {
    const config = clone(get().editedConfig);
    if (!config?.spawnSlots?.[index]) return;
    config.spawnSlots[index].rotationY = Number(rotationY);
    set({ editedConfig: config });
  },

  updateSpawn: (index, field, value) => {
    const config = clone(get().editedConfig);
    if (!config?.spawnSlots?.[index]) return;
    if (field.startsWith("position")) {
      const axis = { positionX: 0, positionY: 1, positionZ: 2 }[field];
      if (axis !== undefined) {
        config.spawnSlots[index].position[axis] = Number(value);
      }
    } else if (field === "rotationY") {
      config.spawnSlots[index].rotationY = Number(value);
    } else if (field === "kartScale") {
      config.spawnSlots[index].kartScale = clampKartScale(value);
    }
    set({ editedConfig: config });
  },

  // ────────────────── Checkpoints (reset targets) ──────────────────

  selectCheckpoint: (index) =>
    set({ selectedCheckpointIndex: index, selectedSpawnIndex: null, selectedPadIndex: null, finishSelected: false }),

  selectFinish: (selected = true) =>
    set({
      finishSelected: Boolean(selected),
      selectedPadIndex: null,
      selectedSpawnIndex: null,
      selectedCheckpointIndex: null,
    }),

  setCheckpointPosition: (index, position) => {
    const config = clone(get().editedConfig);
    if (!config?.checkpoints?.[index]) return;
    config.checkpoints[index].position = [
      Number(position[0]),
      Number(position[1]),
      Number(position[2]),
    ];
    set({ editedConfig: config });
  },

  setCheckpointRotation: (index, rotationY) => {
    const config = clone(get().editedConfig);
    if (!config?.checkpoints?.[index]) return;
    config.checkpoints[index].rotationY = Number(rotationY);
    set({ editedConfig: config });
  },

  updateCheckpoint: (index, field, value) => {
    const config = clone(get().editedConfig);
    if (!config?.checkpoints?.[index]) return;
    if (field.startsWith("position")) {
      const axis = { positionX: 0, positionY: 1, positionZ: 2 }[field];
      if (axis !== undefined) {
        config.checkpoints[index].position[axis] = Number(value);
      }
    } else if (field === "rotationY") {
      config.checkpoints[index].rotationY = Number(value);
    }
    set({ editedConfig: config });
  },

  addCheckpoint: (initialData) => {
    const config = clone(get().editedConfig);
    if (!config) return;
    config.checkpoints = config.checkpoints || [];
    config.checkpoints.push({
      id: `cp-${Date.now().toString(36)}`,
      position: initialData?.position ? [...initialData.position] : [0, -1.7, 0],
      rotationY: initialData?.rotationY ?? 0,
    });
    set({ editedConfig: config, selectedCheckpointIndex: config.checkpoints.length - 1 });
  },

  duplicateCheckpoint: (index) => {
    const config = clone(get().editedConfig);
    if (!config || !config.checkpoints || !config.checkpoints[index]) return;
    const original = config.checkpoints[index];
    const copy = {
      ...clone(original),
      id: `cp-${Date.now().toString(36)}`,
      position: [
        original.position[0],
        original.position[1],
        original.position[2] + 5,
      ],
    };
    config.checkpoints.splice(index + 1, 0, copy);
    set({ editedConfig: config, selectedCheckpointIndex: index + 1 });
  },

  removeCheckpoint: (index) => {
    const config = clone(get().editedConfig);
    if (!config || !config.checkpoints) return;
    config.checkpoints.splice(index, 1);
    set({ editedConfig: config, selectedCheckpointIndex: null });
  },

  // ────────────────── Finish Line ──────────────────

  updateFinish: (field, value) => {
    const config = clone(get().editedConfig);
    if (!config) return;
    config[field] = Number(value);
    set({ editedConfig: config });
  },

  // ────────────────── Wall Exclusion Zones ──────────────────

  addExclusion: (initial) => {
    const config = clone(get().editedConfig);
    if (!config) return;
    config.wallExclusion = config.wallExclusion || [];
    config.wallExclusion.push(
      initial
        ? { ...initial }
        : { minX: -20, maxX: 20, minZ: -20, maxZ: 20 }
    );
    set({ editedConfig: config });
  },

  removeExclusion: (index) => {
    const config = clone(get().editedConfig);
    if (!config || !config.wallExclusion) return;
    config.wallExclusion.splice(index, 1);
    set({ editedConfig: config });
  },

  updateExclusion: (index, field, value) => {
    const config = clone(get().editedConfig);
    if (!config || !config.wallExclusion || !config.wallExclusion[index]) return;
    config.wallExclusion[index][field] = Number(value);
    set({ editedConfig: config });
  },

  // ────────────────── Track Offset & Scale ──────────────────

  updateOffset: (axisIndex, value) => {
    const config = clone(get().editedConfig);
    config.offset[axisIndex] = Number(value);
    set({ editedConfig: config });
  },

  updateScale: (value) => {
    const config = clone(get().editedConfig);
    config.scale = Number(value);
    set({ editedConfig: config });
  },

  // ────────────────── Natural (model) walls ──────────────────

  setNaturalWalls: (value) => {
    const config = clone(get().editedConfig);
    if (!config) return;
    config.naturalWalls = Boolean(value);
    set({ editedConfig: config });
  },

  // ────────────────── Export / Reset ──────────────────

  exportConfig: () => {
    const config = get().editedConfig;
    if (!config) return;
    const json = JSON.stringify(config, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${config.trackId}-config.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  resetToDefaults: () => {
    const trackId = get().loadedTrackId;
    if (!trackId) return;
    set({
      editedConfig: defaultsFor(trackId),
      selectedPadIndex: null,
      selectedSpawnIndex: null,
      selectedCheckpointIndex: null,
      finishSelected: false,
    });
  },
}));

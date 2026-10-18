import { create } from "zustand";

// Kept outside the lobby component tree so 10–20 P2P position updates per
// second do not re-render the homepage, lobby, or WebGL canvas root.
export const useOnlineRaceStore = create((set) => ({
  remoteRacers: {},
  // Race-only state stays separate from transforms so a leaderboard update
  // cannot affect interpolation of a remote kart.
  remoteRaceProgress: {},
  // Odometers per remote racer (teleports capped out). Break lap ties.
  remoteDistances: {},
  // True on the lobby host: the host owns box spawn/respawn (item:boxes).
  isHost: false,
  setIsHost: (isHost) => set({ isHost: Boolean(isHost) }),
  // Asset-load gate before the shared countdown (race-go handshake).
  // `progress` is display-only (drei useProgress can dip as new assets enter
  // the queue); `loaded` is the explicit "track + walls committed" signal and
  // is latched — once true it never reverts, so a progress dip is harmless.
  loadProgress: {},
  setRemoteLoadProgress: (playerId, patch) =>
    set((state) => {
      if (!playerId) return state;
      const prev = state.loadProgress[playerId] ?? {};
      const rawProgress = Number(patch?.progress);
      const progress =
        Number.isFinite(rawProgress) ? Math.max(0, Math.min(100, rawProgress)) : prev.progress;
      // Latch: a stalled peer cannot "un-load" itself.
      const loaded = prev.loaded === true || Boolean(patch?.loaded);
      if (prev.progress === progress && prev.loaded === loaded) return state;
      return {
        loadProgress: {
          ...state.loadProgress,
          [playerId]: { progress, loaded },
        },
      };
    }),
  removeRemoteLoadProgress: (playerId) =>
    set((state) => {
      if (!state.loadProgress[playerId]) return state;
      const { [playerId]: _removed, ...loadProgress } = state.loadProgress;
      return { loadProgress };
    }),
  clearLoadGate: () =>
    set({ loadProgress: {}, raceGo: null, raceError: "", stalledIds: [] }),
  // Set once everyone finished loading: carries the final (possibly trimmed)
  // roster so every client starts the same countdown from the same roster.
  raceGo: null,
  setRaceGo: (go) => set({ raceGo: go }),
  // Fatal race-phase errors (kicked by host, host disconnected mid-load...).
  // LoadingScreen renders these with a way back home instead of freezing.
  raceError: "",
  setRaceError: (message) =>
    set({ raceError: typeof message === "string" ? message : "" }),
  // Player ids the host stalled out while still loading (host sees an
  // explicit "Start without X" choice; nothing is kicked silently).
  stalledIds: [],
  setStalledIds: (ids) => set({ stalledIds: Array.isArray(ids) ? ids : [] }),
  setRemoteRacer: (playerId, transform) =>
    set((state) => {
      const prev = state.remoteRacers[playerId];
      let dist = state.remoteDistances[playerId] || 0;
      if (
        prev &&
        Number.isFinite(prev.x) &&
        Number.isFinite(prev.z) &&
        Number.isFinite(transform?.x) &&
        Number.isFinite(transform?.z)
      ) {
        const d = Math.hypot(transform.x - prev.x, transform.z - prev.z);
        if (d > 0.001 && d < 30) dist += d;
      }
      // Anchor the sender's remaining invuln ms to the local clock (2.1 #10).
      const invulnMs = Number(transform?.invulnMs);
      const invulnUntilLocal =
        Number.isFinite(invulnMs) && invulnMs > 0
          ? performance.now() + Math.max(0, Math.min(4000, Math.round(invulnMs)))
          : 0;
      // Receipt clock for spin visuals (2.2 #11): never the sender wall clock.
      const animChanged =
        transform &&
        (transform.anim !== prev?.anim || transform.animAt !== prev?.animAt);
      const animRecvAt = animChanged ? performance.now() : (prev?.animRecvAt ?? 0);
      return {
        remoteRacers: {
          ...state.remoteRacers,
          [playerId]: {
            ...state.remoteRacers[playerId],
            ...transform,
            invulnUntilLocal,
            animRecvAt,
          },
        },
        remoteDistances: { ...state.remoteDistances, [playerId]: dist },
      };
    }),
  setRemoteRacerCarriedBomb: (playerId, carriedBomb) =>
    set((state) => ({
      remoteRacers: {
        ...state.remoteRacers,
        [playerId]: {
          ...state.remoteRacers[playerId],
          carriedBomb: Boolean(carriedBomb),
        },
      },
    })),
  setRemoteRacerCarriedItem: (playerId, item) =>
    set((state) => ({
      remoteRacers: {
        ...state.remoteRacers,
        [playerId]: {
          ...state.remoteRacers[playerId],
          carriedItem: item ?? null,
        },
      },
    })),
  setRemoteRacerBulletRide: (playerId, ride) =>
    set((state) => ({
      remoteRacers: {
        ...state.remoteRacers,
        [playerId]: {
          ...state.remoteRacers[playerId],
          bulletRide: ride ?? null,
        },
      },
    })),
  setRemoteRaceProgress: (playerId, progress) =>
    set((state) => {
      const previous = state.remoteRaceProgress[playerId];
      const nextCompletedLaps = Number(progress?.completedLaps);

      if (!Number.isInteger(nextCompletedLaps) || nextCompletedLaps < 0) {
        return state;
      }

      // Messages are reliable, but this keeps an older relay packet from
      // making a racer appear to lose a completed lap.
      if (previous && previous.completedLaps > nextCompletedLaps) {
        return state;
      }

      return {
        remoteRaceProgress: {
          ...state.remoteRaceProgress,
          [playerId]: {
            ...previous,
            ...progress,
            completedLaps: nextCompletedLaps,
          },
        },
      };
    }),
  removeRemoteRacer: (playerId) =>
    set((state) => {
      if (
        !state.remoteRacers[playerId] &&
        !state.remoteRaceProgress[playerId] &&
        !state.loadProgress[playerId]
      ) {
        return state;
      }
      const { [playerId]: _removed, ...remoteRacers } = state.remoteRacers;
      const { [playerId]: _removedProgress, ...remoteRaceProgress } = state.remoteRaceProgress;
      const { [playerId]: _removedDist, ...remoteDistances } = state.remoteDistances;
      const { [playerId]: _removedLoad, ...loadProgress } = state.loadProgress;
      return { remoteRacers, remoteRaceProgress, remoteDistances, loadProgress };
    }),
  clearRemoteRacers: () =>
    set({
      remoteRacers: {},
      remoteRaceProgress: {},
      remoteDistances: {},
      loadProgress: {},
      stalledIds: [],
    }),
}));

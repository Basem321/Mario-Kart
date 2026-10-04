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
      return {
        remoteRacers: {
          ...state.remoteRacers,
          [playerId]: {
            ...state.remoteRacers[playerId],
            ...transform,
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
      if (!state.remoteRacers[playerId] && !state.remoteRaceProgress[playerId]) return state;
      const { [playerId]: _removed, ...remoteRacers } = state.remoteRacers;
      const { [playerId]: _removedProgress, ...remoteRaceProgress } = state.remoteRaceProgress;
      const { [playerId]: _removedDist, ...remoteDistances } = state.remoteDistances;
      return { remoteRacers, remoteRaceProgress, remoteDistances };
    }),
  clearRemoteRacers: () => set({ remoteRacers: {}, remoteRaceProgress: {}, remoteDistances: {} }),
}));

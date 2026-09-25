import { create } from "zustand";

// Kept outside the lobby component tree so 10–20 P2P position updates per
// second do not re-render the homepage, lobby, or WebGL canvas root.
export const useOnlineRaceStore = create((set) => ({
  remoteRacers: {},
  // Race-only state stays separate from transforms so a leaderboard update
  // cannot affect interpolation of a remote kart.
  remoteRaceProgress: {},
  setRemoteRacer: (playerId, transform) =>
    set((state) => ({
      remoteRacers: {
        ...state.remoteRacers,
        [playerId]: {
          ...state.remoteRacers[playerId],
          ...transform,
        },
      },
    })),
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
      return { remoteRacers, remoteRaceProgress };
    }),
  clearRemoteRacers: () => set({ remoteRacers: {}, remoteRaceProgress: {} }),
}));

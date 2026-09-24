import { create } from "zustand";

// Kept outside the lobby component tree so 10–20 P2P position updates per
// second do not re-render the homepage, lobby, or WebGL canvas root.
export const useOnlineRaceStore = create((set) => ({
  remoteRacers: {},
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
  removeRemoteRacer: (playerId) =>
    set((state) => {
      if (!state.remoteRacers[playerId]) return state;
      const { [playerId]: _removed, ...remoteRacers } = state.remoteRacers;
      return { remoteRacers };
    }),
  clearRemoteRacers: () => set({ remoteRacers: {} }),
}));

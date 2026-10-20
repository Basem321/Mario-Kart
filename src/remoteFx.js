import { Quaternion, Vector3 } from "three";

// Per-remote-racer effect anchors, written by RemoteRacers every frame and
// read by the shared world-space effect systems (Flames, Skid). The local
// kart feeds those systems through useGameStore; remote karts cannot (that
// store is the local player's), so they publish here instead. Plain mutable
// objects: no per-frame allocation, no React state.
export const remoteFxSources = new Map();

export const getRemoteFxSource = (id) => {
  let src = remoteFxSources.get(id);
  if (!src) {
    src = {
      boosting: false,
      drifting: false,
      flameL: new Vector3(),
      flameR: new Vector3(),
      rearL: new Vector3(),
      rearR: new Vector3(),
      quat: new Quaternion(),
    };
    remoteFxSources.set(id, src);
  }
  return src;
};

export const dropRemoteFxSource = (id) => {
  remoteFxSources.delete(id);
};

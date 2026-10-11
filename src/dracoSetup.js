// MUST be the first import in main.jsx (before any component module).
// Module-level `useGLTF.preload()` calls inside Kart/Driver/Pickups/etc run
// at import time; if the decoder path is only set later in main.jsx body,
// those preloads fetch the Draco WASM from the Google CDN default and poison
// the drei cache. Setting it here guarantees the vendored /draco/ decoder
// (public/draco/) is used even when fully offline.
import { useGLTF } from "@react-three/drei";

useGLTF.setDecoderPath("/draco/");

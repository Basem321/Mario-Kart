/**
 * Mario Kart 8 inspired color presets for each track.
 * Balanced, vibrant, comfortable on the eyes, with authentic Nintendo warmth and tone mapping.
 */
export const TRACK_COLOR_PRESETS = {
  "mario-circuit": {
    redMix: "#FF0000",
    greenMix: "#00FF00",
    blueMix: "#0000FF",
    brightness: 0.02,
    contrast: 1.03,
    saturation: 0.14,
    vibrancy: 0.28,
    hueOffset: 0,
    gamma: 1.0,
    shadowTint: "#dad8d8",
    highlightTint: "#ffffff",
    splitToneBalance: 0.0,
    exposure: -0.4,
    kelvin: 5800,
    chromaticAberration: 0,
  },
  "waluigi-stadium": {
    redMix: "#FF0000",
    greenMix: "#00FF00",
    blueMix: "#0000FF",
    brightness: 0.01,
    contrast: 1.05,
    saturation: 0.18,
    vibrancy: 0.32,
    hueOffset: 0,
    gamma: 1.0,
    shadowTint: "#c8b8a8",
    highlightTint: "#fff8f0",
    splitToneBalance: 0.05,
    exposure: -0.45,
    kelvin: 5300,
    chromaticAberration: 0,
  },
  "ds-shroom-ridge": {
    redMix: "#FF0000",
    greenMix: "#00FF00",
    blueMix: "#0000FF",
    brightness: 0.02,
    contrast: 1.03,
    saturation: 0.15,
    vibrancy: 0.30,
    hueOffset: 0,
    gamma: 1.0,
    shadowTint: "#ccd5e0",
    highlightTint: "#ffffff",
    splitToneBalance: 0.0,
    exposure: -0.35,
    kelvin: 6100,
    chromaticAberration: 0,
  },
};

/** Shared ref holding real-time developer overrides from Leva when active */
export const liveDevGrading = { current: null };

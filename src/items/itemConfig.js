// Battle-items tuning surface. EVERY number the item system uses lives here
// (spec v3 §8 + §10.8 + §10.11). Logic files read these — no magic numbers.
//
// `unit` converts the spec's reference kart length (L = 2.4) to the real one:
// measured kart.glb is 2.91 long, so unit = 2.91 / 2.4 = 1.21.

export const itemConfig = {
  slots: 1,
  roulette: { durationMs: 2500 },
  boxRespawnMs: 3000,
  raceGraceMs: 10000, // only in position mode
  hitInvulnMs: 2000,
  usePositionWeights: false, // equal probabilities for now
  equalRows: [
    "mushroom1",
    "mushroom3",
    "golden",
    "red1",
    "red3",
    "blue",
    "bullet",
    "blooper",
    "bomb",
    "skid",
    "wind",
  ],
  positionWeights: {
    // used only when usePositionWeights = true
    front: {
      mushroom1: 38, mushroom3: 8, golden: 0, red1: 22, red3: 12,
      blue: 0, bullet: 0, blooper: 10, legacy: 10,
    },
    mid: {
      mushroom1: 20, mushroom3: 18, golden: 4, red1: 14, red3: 14,
      blue: 0, bullet: 4, blooper: 14, legacy: 12,
    },
    back: {
      mushroom1: 8, mushroom3: 20, golden: 14, red1: 5, red3: 8,
      blue: 10, bullet: 20, blooper: 3, legacy: 12,
    },
  },
  blueRules: { minRacers: 3, cooldownMs: 30000, maxInFlight: 1 },
  bulletRules: { minP: 0.3 },
  mushroom: { boostMs: 1200, speedMult: 1.5 },
  golden: { windowMs: 7000, boostMs: 1000, minGapMs: 350, speedMult: 1.5, tint: 0xffd23f },
  redShell: {
    speedMult: 1.6, lifetimeMs: 8000, lockRange: 60, lockConeDeg: 50,
    maxBounces: 3, spinMs: 1500, ownerGraceMs: 500,
  },
  blueShell: { speedMult: 2.2, altitude: 14, minFlightMs: 2000, radius: 8, spinMs: 2500 },
  bullet: { durationMs: 5000, speedMult: 1.6, rampOutMs: 600, hitSpinMs: 1000, endInvulnMs: 1000 },
  blooper: { durationMs: 5000, fadeInMs: 300, fadeOutMs: 1000, coverage: 0.6 },
  minUseGapMs: 350,
  unit: 1.21,
  // Sockets: kart-local units (kart length ≈ 2.4 reference units).
  sockets: {
    orbitCenter: [0, 0.6, 0],
    rack: [0, 0.55, -1.4],
    trailPoint: [0, 0.35, -2.5],
    muzzle: [0, 0.5, 2.8],
    aboveHead: [0, 1.4, 0],
  },
  miniScale: 0.35,
  tripleMushroomOffsets: [-0.45, 0, 0.45],
  popInMs: 250,
  popInOvershoot: 1.15,
  trailFollowK: 11,
  orbit: { radius: 1.7, degPerSec: 180, shellSpinDegPerSec: 90, bob: 0.05, respaceMs: 300 },
  redShellTrailSpinDegPerSec: 90,
  blueShellTrailSpinDegPerSec: 180,
  blueShellPulseHz: 1.5,
  throwForward: { totalMs: 550, releaseMs: 180 },
  throwBack: { totalMs: 400, releaseMs: 120 },
  throwUp: { totalMs: 800, releaseMs: 150 },
  castUp: { totalMs: 500, releaseMs: 300 },
  bulletTransform: { totalMs: 350, swapMs: 100, flashMs: 100 },
  hit: { lightMs: 1500, heavyMs: 2500, blinkHz: 8, blinkAlphaLow: 0.35 },
  fov: { boost: 8, bullet: 15 },
  sizes: {
    // ratios to kartLength — multiply by (kartLength) for game units
    mushroomFull: 0.42,
    mushroomHeld: 0.15,
    redShell: 0.29,
    blueShell: 0.42,
    bulletHeldLength: 0.38,
    bulletActiveLength: 1.25,
    bloopHeldHeight: 0.29,
    bloopCastHeight: 0.67,
    star: 0.06,
  },
};

// Model-native extents (local GLB units, measured 2026-10-04) used to derive
// render scales as targetSize / nativeSize. Kart itself is the reference.
export const modelNativeSizes = {
  kartLength: 2.91,
  mushroomWidth: 5.83,
  redShellDiameter: 62.66,
  blueShellOverall: 85.41,
  bulletLength: 1243.69,
  blooperHeight: 202.79,
};

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
  // TODO(decide): skid/wind roulette wins are both a mini-boost today.
  miniBoost: { boostMs: 800, speedMult: 1.5 },
  golden: {
    windowMs: 7000, boostMs: 1000, minGapMs: 350, speedMult: 1.5, tint: 0xffd23f,
    // Dedicated gold materials (T4.5): cap = metallic gold, no map;
    // spots + stem = pale gold; eyes untouched (separate mesh part).
    materials: {
      cap: { color: 0xffd23f, metalness: 0.85, roughness: 0.28, emissive: 0x6b4a00, emissiveIntensity: 0.35 },
      pale: { color: 0xfff2b0 },
    },
  },
  redShell: {
    speedMult: 1.6, lifetimeMs: 8000, lockRange: 60, lockConeDeg: 50,
    maxBounces: 3, spinMs: 1500, ownerGraceMs: 500,
    hitRadius: 3.4, maxTurnRad: 2.2,
  },
  blueShell: { speedMult: 2.2, altitude: 14, minFlightMs: 2000, radius: 8, spinMs: 2500 },
  bullet: { durationMs: 5000, speedMult: 1.6, rampOutMs: 600, hitSpinMs: 1000, endInvulnMs: 1000 },
  blooper: { durationMs: 5000, fadeInMs: 300, fadeOutMs: 1000, coverage: 0.6 },
  minUseGapMs: 350,
  unit: 1.21,
  // Sockets are stored PRE-SCALED to real world units: every value below is
  // the old 2.4-reference spec value x unit (1.21). Kart half-length is
  // 1.455 real units, so rack/trail sit correctly behind the tail.
  sockets: {
    orbitCenter: [0, 0.726, 0],
    rack: [0, 0.666, -1.694],
    trailPoint: [0, 0.424, -3.025],
    muzzle: [0, 0.605, 3.388],
    aboveHead: [0, 1.694, 0],
  },
  // Bullet nose axis: front/back gallery renders (t4-bullet-front/back.png)
  // prove the angry-eyes face looks toward -Z with rotY=-PI/2, i.e. the nose
  // is -X native (mesh POSITION misled; facing decides). rotY +PI/2 maps -X
  // onto kart-model +Z (travel). Belly down needs no extra rotation.
  modelOrientation: {
    bullet: { rotX: 0, rotY: Math.PI / 2, rotZ: 0 },
  },
  // Glove-hand rig (driver-local units, BEFORE the 0.7 kart scale; kart front
  // is +Z in driver space). Starting guesses 2026-10-06 — tune in the gallery
  // (?dev=items tuning panel), forward sign TBD visually. gloveRadius 0.23 =
  // 0.16 world: ~0.5x the widest held half-width (shells), same hand always.
  driverRig: {
    mario: {
      gloveRadius: 0.23,
      cuffColor: 0xd7263d,
      shoulder: [0.3, 0.4, 0],
      cuffLen: 0.38,
      handRest: [0.62, 0.15, 0.05],
      handWindup: [0.55, 0.45, -0.45],
      handForward: [0.35, 0.3, 0.75],
      handBack: [0.45, 0.2, -0.8],
      handUp: [0.5, 1.0, 0.1],
      handMouth: [0.1, 0.55, 0.3],
      handLeftRest: [-0.62, 0.15, 0.05],
      handLeftCast: [-0.5, 1.0, 0.1],
    },
    luigi: {
      gloveRadius: 0.23,
      cuffColor: 0x2e9e4f,
      shoulder: [0.3, 0.4, 0],
      cuffLen: 0.38,
      handRest: [0.62, 0.15, 0.05],
      handWindup: [0.55, 0.45, -0.45],
      handForward: [0.35, 0.3, 0.75],
      handBack: [0.45, 0.2, -0.8],
      handUp: [0.5, 1.0, 0.1],
      handMouth: [0.1, 0.55, 0.3],
      handLeftRest: [-0.62, 0.15, 0.05],
      handLeftCast: [-0.5, 1.0, 0.1],
    },
  },
  miniScale: 0.35,
  tripleMushroomOffsets: [-0.45, 0, 0.45],
  popInMs: 250,
  popInOvershoot: 1.15,
  trailFollowK: 11,
  // Orbit radius ~= 0.66 x real kart length (0.66 x 2.91 = 1.92): the widest
  // orbiting item's inner edge stays outside the 1.455 half-length.
  // Ground orbit (T4.3): slot height = wheel-bottom level + shell
  // half-height (wheels bottom at -0.49 body-local, shell half-height
  // ~0.285): -0.49 + 0.285 = -0.21, so shell bottoms ride the road.
  // lifts.* are per-kind offsets ABOVE the shell slot (mushroom half-height
  // 0.36 - shell 0.285 = 0.075 -> 0.08): mushroom bottoms land on the road
  // too. The orbit group is a body-mesh child, so pitch/roll follow the
  // kart automatically (orbit tilts with the body, bottoms stay planted).
  orbit: {
    radius: 1.92, height: -0.21, lifts: { shell: 0, mushroom: 0.08 },
    degPerSec: 180, shellSpinDegPerSec: 90, bob: 0.05, respaceMs: 300,
  },
  // Static glove hold lifts (T4b, world units): item center above the palm =
  // item half-height + small grip gap. Blooper hovers (no contact).
  hold: {
    lift: {
      mushroom: 0.45, golden: 0.45, red: 0.36, blue: 0.38,
      bullet: 0.26, blooper: 0.6, bomb: 0.55,
    },
  },
  redShellTrailSpinDegPerSec: 90,
  blueShellTrailSpinDegPerSec: 180,
  blueShellPulseHz: 1.5,
  throwForward: { totalMs: 550, releaseMs: 180 },
  throwBack: { totalMs: 400, releaseMs: 120 },
  throwUp: { totalMs: 800, releaseMs: 150 },
  castUp: { totalMs: 500, releaseMs: 300 },
  // Glove + body throw/receive/use timings (T6, §3.2). Blend 100ms in,
  // 150ms out lives in animBlend (animCurves.js). Bomb drop reuses the
  // throw_back timing (glove swings back, item leaves at release).
  receive: { totalMs: 400, from: [0.55, -0.3, -0.45] },
  useMushroom: { totalMs: 400, releaseMs: 150, shrinkMs: 100 },
  bulletTransform: { totalMs: 350, swapMs: 100, flashMs: 100 },
  hit: { lightMs: 1500, heavyMs: 2500, blinkHz: 8, blinkAlphaLow: 0.35 },
  fov: { boost: 8, bullet: 15 },
  sizes: {
    // ratios to kartLength — multiply by (kartLength) for game units.
    // Held mushroom reads as a carryable prop (wider than the driver's
    // head); held shells fit one hand (tune in the gallery).
    // redShellSingleMul: single-held + single-fired shells scale vs the
    // triple base (triple orbit + triple-fired stay 1x, no pop on launch).
    // blueShellMul: slider-only 1 (no value change).
    mushroomFull: 0.42,
    mushroomHeld: 0.26,
    redShell: 0.22,
    redShellSingleMul: 0.7,
    blueShell: 0.21,
    blueShellMul: 1,
    bulletHeldLength: 0.228,
    bulletActiveLength: 1.25,
    bloopHeldHeight: 0.29,
    bloopCastHeight: 0.67,
    star: 0.06,
  },
};

// Driver measurements (native driver-local units, pre-0.7 scale) from the
// gallery band slicer (?dev=items&measure=1, t5-driver-bands.json). Bands:
// wide dense low bands = seat/legs, dip = waist, dense 0.8+ = torso+arms,
// narrowing = neck, wide cap = head+cap tapering to the top. Head = the
// continuous region above the neck narrowing; shoulderY = widest torso band.
// Mario: neck ~0.0..0.17, head 0.09..0.84, shoulders ~-0.16.
// Luigi: neck ~0.0..0.09 (narrower), head 0.18..0.87, shoulders ~-0.17.
// Consequence: head width ~0.7 native (0.5 world) vs mushroom 0.76 world —
/// the held mushroom reads clearly bigger than the head, as specified.
export const driverSizes = {
  mario: { height: 1.67, headHeight: 0.75, headWidth: 0.73, shoulderWidth: 0.84, shoulderY: -0.16 },
  luigi: { height: 1.72, headHeight: 0.69, headWidth: 0.66, shoulderWidth: 0.83, shoulderY: -0.17 },
};

// Model-native extents (mesh-local GLB units along the reference axis,
// measured 2026-10-04, bullet axis re-measured 2026-10-06) used to derive
// render scales as targetSize / nativeSize. GLB ancestor scales that are
// matrix-encoded (invisible to accessor min/max — e.g. red-shell's "Shell"
// node at x2.65) are neutralized at load in useShadowingScene, so these
// numbers hold in-scene. Kart itself is the reference.
export const modelNativeSizes = {
  kartLength: 2.91,
  mushroomWidth: 5.83,
  redShellDiameter: 62.66,
  blueShellOverall: 85.41,
  bulletLength: 1243.69,
  blooperHeight: 202.79,
};

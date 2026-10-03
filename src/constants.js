export const kartSettings = {
  speed: {
    min: -10,
    max: 30,
    default: 0,
    timeTrialSpeedFactor: 1.5, // Increase speed in time trial mode
  },
  collision: {
    radius: 1.0, // Kart collision circle radius (world units)
    skin: 0.15, // Extra padding so the kart never visually clips a wall
    friction: 0.82, // Speed kept when scraping a wall
    headOnSlowdown: 0.45, // Speed kept on a head-on wall hit
  },
};

// Every online racer gets a deterministic grid slot based on their position
// in the lobby roster. The first pair starts side-by-side; following pairs
// are only one short kart row behind, so nobody gets a large head start.
export const getOnlineSpawnSlot = (playerIndex = 0, track = null) => {
  const safeIndex = Math.max(0, Math.floor(Number(playerIndex) || 0));

  // If the track has authored spawn slots (set in the Map Editor), use them.
  // NOTE: rotationY is stored in degrees in the editor, but three.js needs
  // radians, so convert here at the single consumption point.
  // NOTE: Y is always pinned to 0. The wheel rig assumes the player-group
  // origin stays at Y=0 with the road ~1.7 below it (wheel local coords are
  // treated as world coords). Spawning the group at road height sinks the
  // whole kart under the asphalt. The wheels find the real road height via
  // raycasts on the first frames, so only X/Z/heading come from the author.
  if (track && Array.isArray(track.spawnSlots) && track.spawnSlots[safeIndex]) {
    const slot = track.spawnSlots[safeIndex];
    const rawScale = Number(slot.kartScale);
    return {
      position: [slot.position[0], 0, slot.position[2]],
      rotationY: ((Number(slot.rotationY) || 0) * Math.PI) / 180,
      // Per-spawn kart size (editable in the Map Editor). Clamped so a
      // typo can never spawn an invisible or gigantic kart.
      kartScale:
        Number.isFinite(rawScale) ? Math.max(0.2, Math.min(3, rawScale)) : 1,
    };
  }

  const lane = safeIndex % 2;
  const row = Math.floor(safeIndex / 2);

  return {
    position: [lane === 0 ? -2.2 : 2.2, 0, row * 3.4],
    rotationY: 0,
    kartScale: 1,
  };
};

export const drifts = {
  level3: {
    name: "purple",
    threshold: 6,
    color: "#b100ff",
    nbParticles: 25,
    level: 3,
  },
  level2: {
    name: "yellow",
    threshold: 3,
    color: "#FFA22B",
    nbParticles: 5,
    level: 2,
  },
  level1: {
    name: "blue",
    threshold: 1,
    color: "#00ffff",
    nbParticles: 15,
    level: 1,
  },
};

const driftLevels = Object.values(drifts).sort(
  (a, b) => b.threshold - a.threshold,
);

export const getDriftLevel = (power) => {
  for (const level of driftLevels) {
    if (power >= level.threshold) {
      return level;
    }
  }

  return {
    name: "none",
    color: "#ffffff",
    nbParticles: 5,
    level: 0,
  };
};

// --- خط النهاية (تحت يافطة MARIO KART) ---
export const FINISH_LINE = {
  // نص عرض الخط (العرض الكلي = الضعف). خليه مغطي عرض الطريق
  halfWidth: 12,
  // أقل زمن للفة (مللي ثانية) عشان ما يحسبش لفتين ورا بعض بالغلط
  minLapMs: 3000,
  // لازم يبعد عن الخط المسافة دي (متر) قبل ما نحسب اللفة اللي بعدها
  minDist: 28,
  // الخط بيتحط على نص الطريق عند نقطة البداية، وبعدين يتزاح لقدام
  // (ناحية اليافطة) بالمسافة دي بالمتر. لو الخط لسه قبل/بعد اليافطة
  // غيّر الرقم ده بس: زوّده يروح لقدام، قلّله يرجع لورا.
  forwardOffset: 22,
  // إزاحة يمين/شمال (بالمتر). 0 = نص الطريق بالظبط
  lateralOffset: 0,
  // نطاق البحث عن حيطان الطريق حوالين نقطة البداية (متر)
  snapRadius: 50,
};

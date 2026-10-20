import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF, useTexture, useKeyboardControls } from "@react-three/drei";
import * as THREE from "three";
import { useGameStore, applySpin, absorbWithOrbit } from "./store";import { isRacerTargetable, useOnlineRaceStore } from "./onlineRaceStore";
import { ItemBoxModel, BombModel, RedShellModel, BlueShellModel, BlooperModel } from "./models/Pickups";
import {
  animDur,
} from "./items/animCurves.js";
import { getHandWorldPosition } from "./items/handAnchor.js";
import {
  BLOOPER_INK_MS,
  BLOOPER_SQUIRT_MS,
  BLUE_BLAST_RADIUS,
  BLUE_FLY_HEIGHT,
  BLUE_SPEED,
  BULLET_KNOCK_RADIUS,
  BULLET_RIDE_MS,
  bulletActive,
  bounceShell,
  blueShouldDive,
  canFireBlue,
  clampBombScale,
  clampShellMul,
  clampShellSpeed,
  coneLock,
  cruiseSettle,
  goldenWindowMs,
  hitApplies,
  hydrateRemoteShell,
  inkUntil,
  isAuthenticShellHit,
  isValidKnock,
  redReleaseMs,
  remoteShellExpired,
  resolveBlueBlast,
  retargetBlue,
  shouldApplyHit,
  shouldSkipVictim,
  spawnDue,
  steerShell,
  targetsAhead,
  wallHitNormal,
} from "./items/homing";
import {
  canGrant,
  commitRoulette,
  compareRacers,
  consumeUse,
  excludeImmune,
  nextBoostUntil,
  normalizeBoxList,
  pickupGrant,
  pressRedThrow,
  rankOf,
  refireAllowed,
  rollItem,
  rowToSlot,
  leaderOf,
} from "./items/itemWeights";
import {
  publishOnlineRaceEvent,
  subscribeOnlineRaceEvents,
} from "./onlineRaceTransport";
import { itemConfig } from "./items/itemConfig.js";
import { useGameManager } from "./gameManager";
import { kartSettings } from "./constants";
import { getMergedRoadGeometry, getTrack } from "./tracks";
import { sampleBlackRoadPoint, trackConfigToTransform } from "./trackRoad";

const BOX_COUNT = 3;
const PICKUP_RADIUS = 2.6;
const BOMB_ARM_SECONDS = 1.0;
const BOMB_TRIGGER_RADIUS = 3.4;
const EXPLOSION_LIFE = 1.05;
// Remote box-take plausibility: the taker must be within this XZ distance
// of the box. Generous on purpose (transforms stream at 10-20 Hz and karts
// are fast); a cross-map wipe is hostile and gets dropped.
const BOX_TAKE_VERIFY_RADIUS = 8;
// Same idea for bomb detonations: the detonator must touch the bomb unless
// it owns it. Generous for the same networking reasons.
const BOMB_EXPLODE_VERIFY_RADIUS = 10;

const snapRaycaster = new THREE.Raycaster();
const downDir = new THREE.Vector3(0, -1, 0);
let nextId = 1;
// Last committed item-use press (performance.now). Global min-use gap (§10.6).
let lastUseAt = 0;

// Shared sfx helper (2.2 #18): absolute path, respects sfxVolume, pooled
// elements instead of a new Audio per trigger, never throws into gameplay.
import { playSfx as playPooledSfx, startLoop, stopLoop } from "./audio.js";
const playSfx = (name, volumeMul = 1) => playPooledSfx(name, volumeMul);

// Item throw/receive/use anim (T6 §3.2): plays the glove + body anim and
// keeps a ghost of the consumed item visible through the throw window.
// Gameplay still commits at press; the projectile (or effect) materializes
// at release, so animation never delays or blocks gameplay.
const playItemAnim = (name, ghostItem = null) => {
  const st = useGameStore.getState();
  const now = performance.now();
  const totalMs = animDur(name);
  if (!(totalMs > 0)) return;
  st.setItemAnim({ name, start: now, totalMs });
  st.setAnimGhost(
    ghostItem ? { item: ghostItem, anim: name, start: now, totalMs } : null
  );
};

// Red throw, two-phase: the press consumes ONE use NOW (triple counts down,
// slot clears at zero), the shell spawns at the release time. The flying
// shell inherits its source size (single 0.7x, triple 1x) so launch has no
// size pop; the size crosses in shell:fired (clamped) for remotes.
const queueRedThrow = (backward, now) => {
  const st = useGameStore.getState();
  const fromTriple = st.carriedItem?.variant === "triple";
  const pressed = pressRedThrow(st.carriedItem);
  if (!pressed) return false;
  st.setCarriedItem(pressed.slot);
  publishCarried(pressed.slot);
  // Ghost ALWAYS shows the thrown single (T6): alongside the remaining
  // orbit for triples, alone for consumed singles.
  playItemAnim(backward ? "throw_back" : "throw_forward", { type: "red", variant: "single", usesLeft: 1, fromTriple });
  st.setPendingSpawns([
    ...st.pendingSpawns,
    {
      kind: "red",
      backward: Boolean(backward),
      fromTriple,
      pressAt: now,
      // Backward throws release on the throwBack timing (2.1 #4).
      releaseMs: redReleaseMs(backward),
    },
  ]);
  return true;
};

// Blue throw, two-phase: release at the throw-up apex. The slot is consumed
// Blue throw, two-phase: release at the throw-up apex. Works both offline and online.
const queueBlueThrow = (now) => {
  const st = useGameStore.getState();
  const held = st.carriedItem;
  st.setCarriedItem(null);
  // No publish at press (T6): remotes keep showing the shell through the
  // windup; the release publishes the final slot.
  playItemAnim("throw_up", held ? { ...held } : { type: "blue", variant: "single", usesLeft: 1 });
  st.setPendingSpawns([
    ...st.pendingSpawns,
    { kind: "blue", pressAt: now, releaseMs: itemConfig.throwUp.releaseMs, held },
  ]);
  return true;
};

// Bullet start, two-phase: mesh swap at 100ms (spec transform timing).
const queueBulletRide = (now) => {
  const st = useGameStore.getState();
  st.setCarriedItem(null);
  publishCarried(null);
  st.setPendingSpawns([
    ...st.pendingSpawns,
    { kind: "bullet", pressAt: now, releaseMs: itemConfig.bulletTransform.swapMs },
  ]);
};

const bombExplosionId = (bombId) => `explosion-${String(bombId)}`;

// Instant mini-boost for skid/wind roulette wins (TODO(decide): differentiate).
const fireMiniBoost = () => {
  window.dispatchEvent(
    new CustomEvent("mario-kart:boost", {
      detail: {
        duration: itemConfig.miniBoost.boostMs / 1000,
        speed: kartSettings.speed.max * itemConfig.miniBoost.speedMult,
        launchVy: 2,
      },
    })
  );
};

const publishCarried = (item) => {
  publishOnlineRaceEvent({
    type: "item:carried",
    itemType: item ? item.type : null,
    variant: item ? item.variant ?? "single" : null,
    // Remote visuals need counts + golden window (orbit + shrink). The
    // golden window crosses as REMAINING ms (2.1 #9): absolute
    // performance.now timestamps differ per browser clock.
    usesLeft: item && Number.isInteger(item.usesLeft) ? item.usesLeft : null,
    windowMs:
      item && item.type === "golden" && Number.isFinite(item.windowUntil)
        ? goldenWindowMs(item, performance.now())
        : null,
  });
};

// Host owns box positions: publishes the full list; guests apply it.
const publishBoxes = () => {
  publishOnlineRaceEvent({
    type: "item:boxes",
    boxes: useGameStore.getState().itemBoxes,
  });
};

// Local standing for the item roulette. Solo = 1 of 1. Online ranks by
// laps first, distance driven second (same rule as the HUD badge).
const getStanding = () => {
  const gm = useGameManager.getState();
  if (!gm.isOnlineRace || !gm.onlinePlayers?.length) {
    return {
      position: 1,
      totalRacers: 1,
      hasOpponents: false,
      hasOpponentsAhead: false,
    };
  }
  const ors = useOnlineRaceStore.getState();
  const gs = useGameStore.getState();
  const localCompleted = Array.isArray(gm.lapTimes) ? gm.lapTimes.length : 0;
  const rows = gm.onlinePlayers.map((p) => {
    const isSelf = p.id === gm.onlineSelfId;
    return {
      id: p.id,
      laps: isSelf
        ? localCompleted
        : Number(ors.remoteRaceProgress[p.id]?.completedLaps) || 0,
      dist: isSelf
        ? gs.selfDistance || 0
        : ors.remoteDistances[p.id] || 0,
    };
  });
  const selfRow = rows.find((r) => r.id === gm.onlineSelfId);
  const { position } = rankOf(rows, gm.onlineSelfId);
  const ahead = selfRow
    ? rows.filter((r) => compareRacers(r, selfRow) < 0).length
    : 0;
  return {
    position,
    totalRacers: rows.length,
    hasOpponents: rows.length > 1,
    hasOpponentsAhead: ahead > 0,
  };
};

// Golden re-fire (T6): personal effect, instant — no projectile, no pending.
// The slot persists, so no ghost is needed; the use_mushroom anim plays on
// the live item (which hops back to the glove afterwards).
const fireBoostInstant = (item) => {
  const st = useGameStore.getState();
  const now = performance.now();
  const r = consumeUse({ item, now });
  if (r.boosted) {
    st.setShroomUntil(nextBoostUntil(st.shroomUntil, now, itemConfig.golden.boostMs));
    playSfx("mushroom-boost.mp3");
  }
  st.setCarriedItem(r.item);
  publishCarried(r.item);
  playItemAnim("use_mushroom");
};

// Mushroom-single press (T6): commits the use now, boosts at the
// use_mushroom release (glove at the mouth, item shrunk away).
const queueMushroom = (item, now) => {
  const st = useGameStore.getState();
  const r = consumeUse({ item, now });
  if (!r.boosted) return false;
  st.setCarriedItem(r.item);
  // No publish/boost at press: the ghost shrinks through the use window.
  playItemAnim("use_mushroom", { type: "mushroom", variant: "single", usesLeft: 1 });
  st.setPendingSpawns([
    ...st.pendingSpawns,
    { kind: "mushroom", pressAt: now, releaseMs: itemConfig.useMushroom.releaseMs },
  ]);
  return true;
};

// Mushroom-single release: exact 1.5x-max window + remote slot sync.
const fireMushroomBoost = () => {
  const st = useGameStore.getState();
  const now = performance.now();
  st.setShroomUntil(nextBoostUntil(st.shroomUntil, now, itemConfig.mushroom.boostMs));
  playSfx("mushroom-boost.mp3");
  publishCarried(useGameStore.getState().carriedItem);
};

const myRacerId = () => useGameManager.getState().onlineSelfId ?? "local";

// Local vulnerability: hits pass through while invulnerable (v3 §5).
const myVulnerable = (now = performance.now()) =>
  hitApplies({ invulnUntil: useGameStore.getState().invulnUntil }, now);

// Late/duplicate P2P hits must never stun behind the results screen.
const raceLive = () => {
  const gm = useGameManager.getState();
  // A spectating (already finished) kart is parked: nothing may stun it.
  if (gm.isSpectating) return false;
  return shouldApplyHit({ gameStarted: gm.gameStarted, gameOver: gm.gameOver });
};

// The local race is over for me: results screen OR parked and spectating.
// Spectating keeps gameOver=false, so checking gameOver alone treated the
// spectator as the unfinished race leader (most laps) and blue shells
// retargeted onto the parked kart and vanished there.
const localFinished = () => {
  const gm = useGameManager.getState();
  return Boolean(gm.gameOver || gm.isSpectating);
};

const shellHitFxId = (shellId) => `shellhit-${String(shellId)}`;

// Stun the LOCAL kart from a shell hit + small burst. Remote victims apply
// this themselves when their shell:hit arrives (owner never stuns remotes).
const applyShellStun = ({ x, y, z, shellId, scale = 0.6, soft = false, stun = true, ms = null, heavy = false }) => {
  const st = useGameStore.getState();
  if (stun) applySpin({ victim: "self", heavy, ms, now: performance.now() });
  const fxId = shellHitFxId(shellId);
  if (!st.explosions.some((e) => e.id === fxId)) {
    st.setExplosions([
      ...st.explosions,
      { id: fxId, x, y, z, scale, soft, at: performance.now() },
    ]);
  }
  playSfx("shell-hit.mp3");
};

const addRemoteShell = (shell) => {
  const st = useGameStore.getState();
  const id = String(shell?.id ?? "");
  if (!id || st.activeShells.some((s) => s.id === id)) return false;
  // Hydrate the local clock + blue flight state (2.1 #6): the payload
  // carries no `at`, so a raw spread would never expire and never dive.
  const hydrated = hydrateRemoteShell(shell, performance.now());
  // Remotes derive the cruise height (spawn is always cruise + 1.2).
  st.setActiveShells([
    ...st.activeShells,
    { ...hydrated, id, owner: false, cruiseY: shell.y - 1.2 },
  ]);
  return true;
};

const onRemoteShellHit = (event) => {
  const st = useGameStore.getState();
  const shellId = String(event?.shellId ?? "");
  if (!shellId) return;
  const shell = st.activeShells.find((s) => s.id === shellId);
  // Forged hits are dropped (2.2 #16): only the shell OWNER may report it.
  // event.playerId is the authenticated sender (set by receiveOnlineRaceEvent).
  if (shell && !isAuthenticShellHit({ shellOwnerId: shell.ownerId, senderId: event.playerId })) {
    return;
  }
  st.setActiveShells(st.activeShells.filter((s) => s.id !== shellId));
  if (String(event?.victimId ?? "") === myRacerId() && shell && raceLive() && myVulnerable()) {
    // Triple orbit absorbs red shells instead of spinning (matrix §4.3).
    if (shell.kind !== "red" || !absorbWithOrbit("red")) {
      applyShellStun({ x: shell.x, y: shell.y, z: shell.z, shellId, soft: true });
    }
  }
};

const fireRedShell = (backward = false, fromTriple = false) => {
  const st = useGameStore.getState();
  const gm = useGameManager.getState();
  const playerPos = st.playerPosition;
  if (!playerPos) return false;
  const ry = st.playerRotationY || 0;
  const fx = -Math.sin(ry);
  const fz = -Math.cos(ry);
  // Backward throw (back held + use): straight back, no homing.
  const dx = backward ? -fx : fx;
  const dz = backward ? -fz : fz;
  const me = myRacerId();
  const gy = st.groundPosition ?? playerPos.y ?? 0;

  let targetId = null;
  if (gm.isOnlineRace && !backward) {
    const ors = useOnlineRaceStore.getState();
    const racers = Object.entries(ors.remoteRacers)
      .filter(([, r]) => isRacerTargetable(r))
      .map(([id, r]) => ({
      id,
      x: Number(r?.x) || 0,
      z: Number(r?.z) || 0,
    }));
    const target = coneLock(
      { id: me, x: playerPos.x, z: playerPos.z, fx, fz },
      racers,
      // Lock range scales with kart size (60 units dwarfs a 0.2-scale kart).
      itemConfig.redShell.lockRange * (st.kartScale ?? 1),
    );
    targetId = target ? target.id : null;
  }

  // Spawn AT the glove world position (T6 §3.2), falling back to the old
  // toss point when the rig is not mounted.
  const hand = getHandWorldPosition();
  // Flying shell inherits its source size (single 0.7x, triple 1x).
  const sizeMul = clampShellMul(fromTriple ? 1 : Number(itemConfig.sizes.redShellSingleMul ?? 0.7));
  // Cruise speed scales with the FIRING kart (mini karts on Shroom Ridge top
  // at 6 u/s — an unscaled 48 u/s shell is 8x faster than its owner). The
  // speed travels in the payload so every client simulates identically.
  const myScale = st.kartScale ?? 1;
  const shellSpeed = clampShellSpeed(itemConfig.redShell.speedMult * kartSettings.speed.max * myScale);
  const shell = {
    id: `shell-${me}-${Date.now().toString(36)}`,
    kind: "red",
    x: hand ? hand.x + dx * 0.5 : playerPos.x + dx * 2,
    y: hand ? hand.y + 0.6 : gy + 0.9 + 1.2,
    z: hand ? hand.z + dz * 0.5 : playerPos.z + dz * 2,
    cruiseY: gy + 0.9,
    dx,
    dz,
    targetId,
    homing: !backward && targetId !== null,
    bounces: itemConfig.redShell.maxBounces,
    ownerId: me,
    owner: true,
    sizeMul,
    speed: shellSpeed,
    at: performance.now(),
  };
  st.setActiveShells([...st.activeShells, shell]);
  // Release publish (2.1 #3 + T6): the press already sent the decremented
  // triple count; this syncs the FINAL slot (null when fully consumed) so
  // remotes never keep a stale shell through the follow-through.
  publishOnlineRaceEvent({
    type: "shell:fired",
    shell: {
      id: shell.id,
      kind: "red",
      x: shell.x,
      y: shell.y,
      z: shell.z,
      dx: shell.dx,
      dz: shell.dz,
      targetId,
      homing: shell.homing,
      bounces: shell.bounces,
      ownerId: me,
      sizeMul,
      speed: shellSpeed,
    },
  });
  playSfx("shell-fire.mp3");
  publishCarried(useGameStore.getState().carriedItem);
  return true;
};

// Bullet Bill: 5s self-drive. Start clears the slot; end adds a hop.
// Only the owner's client runs knock detection (victims apply on receipt).
const startBulletRide = () => {
  const st = useGameStore.getState();
  const me = myRacerId();
  const ride = {
    rideId: `ride-${me}-${Date.now().toString(36)}`,
    ownerId: me,
    until: performance.now() + BULLET_RIDE_MS,
    endingUntil: 0,
  };
  // Starting cancels any spin-out in progress (§4.4).
  st.setSpin(null);
  st.setStunUntil(0);
  st.setBulletRide(ride);
  st.setCarriedItem(null);
  publishOnlineRaceEvent({ type: "item:carried", itemType: null });
  publishOnlineRaceEvent({ type: "bullet:start", rideId: ride.rideId, playerId: me });
  playSfx("bullet-launch.mp3");
  return true;
};

// Blooper press (T6): commits the slot now, casts at the cast_up release.
const queueBlooper = (now) => {
  const st = useGameStore.getState();
  if (!st.playerPosition) return false;
  const held = st.carriedItem;
  st.setCarriedItem(null);
  // No publish at press: remotes see the blooper through the cast windup.
  playItemAnim("cast_up", held ? { ...held } : null);
  st.setPendingSpawns([
    ...st.pendingSpawns,
    { kind: "blooper", pressAt: now, releaseMs: itemConfig.castUp.releaseMs },
  ]);
  return true;
};

// Blooper release: squirt visual (~1s) + ink to whoever is ahead RIGHT NOW
// (computed at release, not press). Zero targets still consumes the item.
const fireBlooperRelease = () => {
  const st = useGameStore.getState();
  const gm = useGameManager.getState();
  const playerPos = st.playerPosition;
  if (!playerPos) return false;
  const ry = st.playerRotationY || 0;
  const fx = -Math.sin(ry);
  const fz = -Math.cos(ry);
  const me = myRacerId();
  const gy = st.groundPosition ?? playerPos.y ?? 0;

  let targetIds = [];
  if (gm.isOnlineRace) {
    const ors = useOnlineRaceStore.getState();
    const racers = Object.entries(ors.remoteRacers)
      .filter(([, r]) => isRacerTargetable(r))
      .map(([id, r]) => ({
      id,
      x: Number(r?.x) || 0,
      z: Number(r?.z) || 0,
      laps: Number(ors.remoteRaceProgress[id]?.completedLaps) || 0,
      bullet: Boolean(r?.bulletRide),
    }));
    const localCompleted = Array.isArray(gm.lapTimes) ? gm.lapTimes.length : 0;
    targetIds = targetsAhead(
      { id: me, x: playerPos.x, z: playerPos.z, laps: localCompleted, fx, fz },
      racers
    );
  }

  st.setBlooperSquirt({
    x: playerPos.x + fx * 1.5,
    y: gy + 1.2,
    z: playerPos.z + fz * 1.5,
    until: performance.now() + BLOOPER_SQUIRT_MS,
  });
  st.setCarriedItem(null);
  publishOnlineRaceEvent({ type: "item:carried", itemType: null });
  if (targetIds.length > 0) {
    publishOnlineRaceEvent({ type: "blooper:ink", targetIds });
  }
  playSfx("blooper-splash.mp3");
  return true;
};
const endBulletRide = (hop = true) => {
  const st = useGameStore.getState();
  if (!st.bulletRide || st.bulletRide.endingUntil) return;
  const now = performance.now();
  const ownerId = st.bulletRide.ownerId;
  // Ramp-out: keep the ride entry with an expired `until` so speed eases
  // over 600ms, then clear. Plus 1.0 s hit-invulnerability.
  st.setBulletRide({
    ...st.bulletRide,
    endingUntil: now + itemConfig.bullet.rampOutMs,
  });
  st.setInvulnUntil(now + itemConfig.bullet.endInvulnMs);
  publishOnlineRaceEvent({ type: "bullet:end", playerId: ownerId });
  if (hop) {
    const scale = useGameStore.getState().kartScale ?? 1;
    window.dispatchEvent(
      new CustomEvent("mario-kart:launch-jump", { detail: { launchVy: 6 * scale } })
    );
  }
};

let blueAlarmAudio = null;
let blueAlarmStartedAt = 0;
const startBlueAlarm = () => {
  blueAlarmStartedAt = performance.now();
  try {
    stopBlueAlarm();
    blueAlarmAudio = startLoop("blue-alarm.mp3", 0.6);
  } catch {
    blueAlarmAudio = null;
  }
};
const stopBlueAlarm = () => {
  stopLoop(blueAlarmAudio);
  blueAlarmAudio = null;
};

// Blue shell: targets whoever leads RIGHT NOW (including self if the owner
// took the lead after the pickup — MK-accurate). Refuses to fire solo.
// The slot was consumed at press: a failed fire refunds it (2.1 #5) via the
// pending `held` snapshot instead of eating the shell.
const fireBlueShell = (pending) => {
  const st = useGameStore.getState();
  const gm = useGameManager.getState();
  const playerPos = st.playerPosition;
  const refund = () => {
    if (pending?.held) {
      st.setCarriedItem(pending.held);
      publishCarried(pending.held);
    }
    return false;
  };
  if (!playerPos) return refund();
  const me = myRacerId();
  const ors = useOnlineRaceStore.getState();
  const localCompleted = Array.isArray(gm.lapTimes) ? gm.lapTimes.length : 0;
  const rows = [{ id: me, laps: localCompleted, finished: localFinished(), dist: st.selfDistance || 0 }];
  const remoteIds = new Set([
    ...Object.keys(ors.remoteRacers),
    ...Object.keys(ors.remoteRaceProgress),
    ...Object.keys(ors.remoteDistances),
    ...(gm.onlinePlayers ?? []).map((p) => p.id),
  ]);
  remoteIds.delete(me);
  for (const id of remoteIds) {
    // A racer that stopped sending (disconnected) and never finished must
    // not stay "the leader" the blue shell flies to.
    const live = ors.remoteRacers[id];
    if (live && live.finished !== true && !isRacerTargetable(live)) continue;
    const p = ors.remoteRaceProgress[id];
    rows.push({
      id,
      laps: Number(p?.completedLaps) || 0,
      finished: Boolean(p?.finished),
      dist: ors.remoteDistances[id] || 0,
    });
  }
  let leaderId = leaderOf(rows) || me;
  if (leaderId === me && remoteIds.size > 0) {
    // Shooter leads: target the BEST-ranked unfinished rival (laps, then
    // distance) — not just the first roster entry.
    let best = null;
    for (const r of rows) {
      if (r.id === me || r.finished) continue;
      if (
        !best ||
        r.laps > best.laps ||
        (r.laps === best.laps && (r.dist || 0) > (best.dist || 0))
      ) {
        best = r;
      }
    }
    if (best) leaderId = best.id;
    // Every rival already finished (or left): there is nothing to hit, and
    // targeting yourself would stun the shooter with their own shell.
    else return refund();
  }
  // Gate BEFORE firing: solo allows firing, online requires leader
  if (!canFireBlue({ isOnlineRace: gm.isOnlineRace, leaderId })) return refund();

  const gy = st.groundPosition ?? playerPos.y ?? 0;
  // Launch XZ from the glove (T6 §3.2); the climb to cruise altitude is
  // unchanged (flight starts low, rises to top). Top tracks target elevation + 14.
  const hand = getHandWorldPosition();
  const sizeMul = clampShellMul(Number(itemConfig.sizes.blueShellMul ?? 1));
  const leaderObj = leaderId === me ? playerPos : ors.remoteRacers[leaderId];
  // Remote r.y is the kart-group origin (always 0) — use the driving level.
  const leaderGroundY =
    leaderId === me
      ? gy
      : Number.isFinite(Number(leaderObj?.bodyY))
        ? Number(leaderObj.bodyY)
        : Number.isFinite(Number(leaderObj?.y)) && Number(leaderObj.y) !== 0
          ? Number(leaderObj.y)
          : gy;
  const targetY = leaderGroundY;
  const top = targetY + BLUE_FLY_HEIGHT;
  const blueSpeed = clampShellSpeed(BLUE_SPEED * (st.kartScale ?? 1));
  const shell = {
    id: `blue-${me}-${Date.now().toString(36)}`,
    kind: "blue",
    x: hand ? hand.x : playerPos.x,
    y: gy + 1,
    z: hand ? hand.z : playerPos.z,
    dx: 0,
    dz: 0,
    targetId: leaderId,
    top,
    phase: "fly",
    ownerId: me,
    owner: true,
    sizeMul,
    speed: blueSpeed,
    at: performance.now(),
  };
  st.setActiveShells([...st.activeShells, shell]);
  st.setCarriedItem(null);
  publishCarried(null);
  publishOnlineRaceEvent({
    type: "shell:fired",
    shell: {
      id: shell.id,
      kind: "blue",
      x: shell.x,
      y: shell.y,
      z: shell.z,
      dx: 0,
      dz: 0,
      targetId: leaderId,
      ownerId: me,
      sizeMul,
      speed: blueSpeed,
      top,
    },
  });
  publishOnlineRaceEvent({ type: "blue:incoming", leaderId });
  // Self-target (took the lead after pickup): the owner never processes its
  // own publish, so start the warning loop locally too.
  if (leaderId === me) startBlueAlarm();
  playSfx("shell-fire.mp3");
  return true;
};

const bombAgeMs = (bomb, now) => {
  // Prefer the LOCAL receipt clock (`at`, performance.now at add time):
  // createdAt crosses the network from the sender's wall clock, so a
  // skewed sender would arm the bomb instantly (or never). `at` is always
  // stamped locally in addDroppedBomb for local AND remote bombs.
  if (Number.isFinite(bomb?.at)) {
    return Math.max(0, now - bomb.at);
  }
  if (Number.isFinite(bomb?.createdAt)) {
    return Math.max(0, Date.now() - bomb.createdAt);
  }
  return 0;
};

const makeBombId = () => {
  const selfId = useGameManager.getState().onlineSelfId;
  const owner = String(selfId || "local")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 24) || "local";

  return `bomb-${owner}-${Date.now().toString(36)}-${nextId++}`;
};

const addDroppedBomb = (bomb, remote = false) => {
  const st = useGameStore.getState();
  const id = String(bomb?.id ?? "");
  if (!id || st.droppedBombs.some((entry) => entry.id === id)) return false;
  if (st.explosions.some((entry) => entry.id === bombExplosionId(id))) return false;

  // Bombs keep their owner's kart size so a mini kart drops a mini bomb.
  // Remote bombs anchor the arm delay at RECEIPT, never at the sender's wall
  // clock (Date.now differs per device — a skewed sender would arm instantly).
  st.setDroppedBombs([
    ...st.droppedBombs,
    {
      id,
      x: bomb.x,
      y: bomb.y,
      z: bomb.z,
      scale: clampBombScale(bomb?.scale),
      // Owner of the bomb (host-stamped peer id for remote bombs, local
      // racer id for our own). Explosions must come from this owner.
      ownerId:
        typeof bomb?.ownerId === "string" && bomb.ownerId
          ? bomb.ownerId.slice(0, 64)
          : null,
      createdAt: remote || !Number.isFinite(bomb.createdAt) ? Date.now() : bomb.createdAt,
      at: performance.now(),
    },
  ]);
  return true;
};

const triggerBombExplosion = (bomb, { broadcast = false } = {}) => {
  const st = useGameStore.getState();
  const id = String(bomb?.id ?? "");
  if (!id) return false;

  const explosionId = bombExplosionId(id);
  if (st.explosions.some((entry) => entry.id === explosionId)) return false;

  st.setDroppedBombs(st.droppedBombs.filter((entry) => entry.id !== id));
  st.setExplosions([
    ...st.explosions,
    {
      id: explosionId,
      x: bomb.x,
      y: bomb.y,
      z: bomb.z,
      // The blast renders at its owner's kart size (mini bomb, mini boom).
      scale: Number.isFinite(Number(bomb?.scale)) ? bomb.scale : 1,
      at: performance.now(),
    },
  ]);

  playSfx("explosion.mp3", 1);

  if (broadcast) {
    publishOnlineRaceEvent({
      type: "bomb:explode",
      bombId: id,
      x: bomb.x,
      y: bomb.y,
      z: bomb.z,
      scale: Number.isFinite(Number(bomb?.scale)) ? bomb.scale : 1,
      // Ownership proof: the host relay overwrites this with the
      // authenticated sender id; receivers drop mismatches.
      ownerId: myRacerId(),
    });
  }

  return true;
};

function ExplosionFx({ data }) {
  const tex = useTexture("/textures/explosion.jpg");
  const pointsRef = useRef(null);
  const flashRef = useRef(null);
  const flashMatRef = useRef(null);
  const pointsMatRef = useRef(null);
  const lightRef = useRef(null);
  const tRef = useRef(0);

  const { positions, velocities } = useMemo(() => {
    const N = 150;
    const positions = new Float32Array(N * 3);
    const velocities = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 4 + Math.random() * 7;
      velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
      velocities[i * 3 + 1] =
        Math.abs(Math.cos(phi)) * speed * 0.9 + 2 + Math.random() * 4;
      velocities[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed;
    }
    return { positions, velocities };
  }, []);

  useFrame((_, delta) => {
    const t = (tRef.current += Math.min(delta, 0.05));
    if (t >= EXPLOSION_LIFE) {
      const rest = useGameStore
        .getState()
        .explosions.filter((e) => e.id !== data.id);
      useGameStore.getState().setExplosions(rest);
      return;
    }
    const pos = pointsRef.current?.geometry.attributes.position;
    if (pos) {
      const arr = pos.array;
      for (let i = 0; i < arr.length / 3; i++) {
        velocities[i * 3 + 1] -= 11 * delta;
        arr[i * 3] += velocities[i * 3] * delta;
        arr[i * 3 + 1] += velocities[i * 3 + 1] * delta;
        arr[i * 3 + 2] += velocities[i * 3 + 2] * delta;
        if (arr[i * 3 + 1] < 0.05) arr[i * 3 + 1] = 0.05;
      }
      pos.needsUpdate = true;
    }
    const fade = 1 - t / EXPLOSION_LIFE;
    if (pointsMatRef.current) pointsMatRef.current.opacity = fade * 0.9;    if (flashRef.current) {
      // Small flash on purpose: a big additive sphere swallows the camera
      // and turns the whole screen white.
      const s = 1 + (t / EXPLOSION_LIFE) * 3;
      flashRef.current.scale.set(s, s, s);
    }
    if (flashMatRef.current) flashMatRef.current.opacity = fade * 0.4;
    if (lightRef.current) lightRef.current.intensity = fade * 45 * (data.scale ?? 1);
  });

  return (
    <group position={[data.x, data.y + 1, data.z]} scale={data.scale ?? 1}>
      <points ref={pointsRef} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          ref={pointsMatRef}
          map={tex}
          size={1.9}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          color="#ffca7a"
          sizeAttenuation
        />
      </points>
      <mesh ref={flashRef}>
        <sphereGeometry args={[1, 20, 20]} />
        <meshBasicMaterial
          ref={flashMatRef}
          color="#ffe3a3"
          transparent
          opacity={0.65}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <pointLight ref={lightRef} color="#ffb14e" intensity={45} distance={22 * (data.scale ?? 1)} decay={2} />
    </group>
  );
}

// Ground ring under the blue shell's target (all peers see it). Shrinks as
// the shell approaches: full radius far away, tight at impact.
function BlueTargetRing({ shell }) {
  const playerPosition = useGameStore((s) => s.playerPosition);
  const remoteRacers = useOnlineRaceStore((s) => s.remoteRacers);
  const me = myRacerId();
  const target =
    shell.targetId === me
      ? { x: playerPosition?.x ?? shell.x, y: playerPosition?.y ?? shell.y, z: playerPosition?.z ?? shell.z }
      : remoteRacers[shell.targetId];
  if (!target) return null;
  const distXZ = Math.hypot((target.x ?? shell.x) - shell.x, (target.z ?? shell.z) - shell.z);
  const scale = Math.max(0.15, Math.min(1, distXZ / 60)) * itemConfig.blueShell.radius;
  return (
    <group position={[target.x ?? shell.x, (target.y ?? shell.y) + 0.15, target.z ?? shell.z]}>
      <mesh rotation-x={-Math.PI / 2} scale={scale}>
        <ringGeometry args={[0.9, 1, 40]} />
        <meshBasicMaterial color="#ff3b30" transparent opacity={0.8} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

export function ItemBoxes() {  const selectedTrackId = useGameManager((s) => s.selectedTrackId);
  const activeTrack = getTrack(selectedTrackId);
  const { nodes } = useGLTF(activeTrack.glb);
  const scene = useThree((s) => s.scene);
  const [, getKeys] = useKeyboardControls();
  const collidersRef = useRef(null);
  const boxNodesRef = useRef(new Map());
  const dropHeldRef = useRef(false);
  const goldenLastRef = useRef(0);
  const knockedRef = useRef({ rideId: null, ids: new Set() });
  const boxSyncRef = useRef(0);
  // Race-start timestamp for position-mode age rules (performance.now clock).
  const matchStartRef = useRef(0);
  const tickAudioRef = useRef(null);
  const blackRoadGeometry = getMergedRoadGeometry(nodes, activeTrack);
  const roadTransform = trackConfigToTransform(activeTrack);

  const itemBoxes = useGameStore((s) => s.itemBoxes);
  const droppedBombs = useGameStore((s) => s.droppedBombs);
  const explosions = useGameStore((s) => s.explosions);
  const activeShells = useGameStore((s) => s.activeShells);
  const blooperSquirt = useGameStore((s) => s.blooperSquirt);
  const carriedBomb = useGameStore((s) => s.carriedBomb);
  // Pickups render at the local kart's size so a mini kart meets a mini box.
  const boxVisualScale = useGameStore((s) => s.kartScale) ?? 1;

  // Apply reliable gameplay events received from another racer. The local
  // player is excluded by the P2P layer, so these never duplicate their own
  // drop/explosion action.
  useEffect(
    () =>
      subscribeOnlineRaceEvents((event) => {
        if (!event || typeof event !== "object") return;

        if (event.type === "bomb:dropped" && event.bomb) {
          addDroppedBomb(event.bomb, true);
          return;
        }

        if (event.type === "bomb:explode" && event.bombId) {
          // Detonation must be legitimate: EITHER the bomb owner ends it
          // (host stamps ownerId with the authenticated peer id) OR the
          // sender touches the bomb (every client simulates every bomb, so
          // a victim legitimately detonates on contact and broadcasts).
          // A forged explode at a far-away victim's position is dropped.
          const stored = useGameStore.getState().droppedBombs.find(
            (entry) => entry.id === event.bombId
          );
          if (event.ownerId && event.ownerId !== event.playerId) return;
          const ownerEnds =
            Boolean(stored?.ownerId) && event.ownerId === stored.ownerId;
          // Touch proof uses the EVENT coordinates (a forged bombId has no
          // stored position to check against): the sender must stand next
          // to the blast. Unknown sender position fails closed — a fake
          // bombId at a victim's position must never detonate.
          let touchEnds = false;
          if (
            !ownerEnds &&
            Number.isFinite(event.x) &&
            Number.isFinite(event.z)
          ) {
            const touchPos =
              useOnlineRaceStore.getState().remoteRacers[event.playerId];
            if (
              Number.isFinite(touchPos?.x) &&
              Number.isFinite(touchPos?.z) &&
              Math.hypot(touchPos.x - event.x, touchPos.z - event.z) <=
                BOMB_EXPLODE_VERIFY_RADIUS
            ) {
              touchEnds = true;
            }
          }
          if (!ownerEnds && !touchEnds) return;
          triggerBombExplosion(
            {
              id: event.bombId,
              x: event.x,
              y: event.y,
              z: event.z,
              scale: event.scale,
            },
            { broadcast: false },
          );
          return;
        }

        if (event.type === "shell:fired" && event.shell) {
          addRemoteShell(event.shell);
          return;
        }

        if (event.type === "item:boxes" && event.boxes) {
          const clean = normalizeBoxList(event.boxes);
          if (clean) useGameStore.getState().setItemBoxes(clean);
          return;
        }

        if (event.type === "item:boxTaken" && Number.isInteger(event.boxId)) {
          const st4 = useGameStore.getState();
          // The taker must be near the box: a remote peer wiping boxes
          // across the map is hostile (or very laggy). Sender transforms
          // stream at 10-20 Hz, so the radius is generous; unknown sender
          // position fails open to avoid false desyncs on join.
          const box = st4.itemBoxes.find((o) => o.id === event.boxId);
          const senderPos =
            useOnlineRaceStore.getState().remoteRacers[event.playerId];
          if (
            box &&
            Number.isFinite(senderPos?.x) &&
            Number.isFinite(senderPos?.z) &&
            Math.hypot(senderPos.x - box.x, senderPos.z - box.z) >
              BOX_TAKE_VERIFY_RADIUS
          ) {
            return;
          }
          st4.setItemBoxes(
            st4.itemBoxes.map((o) =>
              o.id === event.boxId && o.active
                ? {
                    ...o,
                    active: false,
                    respawnAt: performance.now() + itemConfig.boxRespawnMs,
                  }
                : o
            )
          );
          return;
        }

        if (event.type === "shell:hit" && event.shellId) {
          onRemoteShellHit(event);
          return;
        }

        if (event.type === "blue:incoming" && event.leaderId) {
          // Alarm loops ONLY on the targeted client, per spec.
          if (event.leaderId === myRacerId()) {
            startBlueAlarm();
            useGameStore.getState().setBlueWarning({ since: performance.now() });
          }
          return;
        }

        if (event.type === "bullet:start" && event.playerId) {
          useOnlineRaceStore
            .getState()
            .setRemoteRacerBulletRide(event.playerId, {
              rideId: event.rideId,
              ownerId: event.playerId,
              until: performance.now() + BULLET_RIDE_MS,
            });
          return;
        }

        if (event.type === "bullet:end" && event.playerId) {
          const cur = useOnlineRaceStore.getState().remoteRacers[event.playerId];
          if (cur?.bulletRide) {
            useOnlineRaceStore.getState().setRemoteRacerBulletRide(event.playerId, null);
          }
          return;
        }

        if (event.type === "bullet:knock" && event.victimId) {
          // Sender must own that exact live ride — otherwise anyone could
          // stun anyone at any range with a forged event.
          const senderRide =
            useOnlineRaceStore.getState().remoteRacers[event.playerId]?.bulletRide;
          if (
            event.victimId === myRacerId() &&
            raceLive() &&
            myVulnerable() &&
            isValidKnock({ senderRide, rideId: event.rideId, now: performance.now() })
          ) {
            const p = useGameStore.getState().playerPosition;
            applyShellStun({
              x: p?.x ?? 0,
              y: p?.y ?? 0,
              z: p?.z ?? 0,
              shellId: `knock-${event.rideId}`,
              scale: 0.8,
              soft: true,
              ms: itemConfig.bullet.hitSpinMs,
            });
          }
          return;
        }

        if (event.type === "blooper:ink" && Array.isArray(event.targetIds)) {
          // Never ink behind the results screen (2.2 #14).
          if (!raceLive()) return;
          // Bullet riders are immune (§4.5).
          const myRide = useGameStore.getState().bulletRide;
          const immune =
            myRide &&
            myRide.ownerId === myRacerId() &&
            bulletActive(myRide, performance.now());
          if (!immune && event.targetIds.includes(myRacerId())) {
            useGameStore.getState().setBlooperUntil(inkUntil(performance.now()));
            playSfx("blooper-splash.mp3");
          }
        }

        if (event.type === "blue:explode" && Number.isFinite(event.x)) {
          // Only the shell owner (host-stamped) may end the blue shell.
          // A forged explode would clear everyone's shell + force a blast
          // check at an attacker's coordinates.
          if (event.ownerId && event.ownerId !== event.playerId) return;
          stopBlueAlarm();
          useGameStore.getState().setBlueWarning(null);
          const st2 = useGameStore.getState();
          st2.setActiveShells(
            st2.activeShells.filter((s) => s.kind !== "blue")
          );
          if (!event.fizzle) {
            const me2 = myRacerId();
            const p2 = st2.playerPosition;
            // Bullet riders are immune to the blast (alarm already stopped).
            const myRide = st2.bulletRide;
            const immune =
              myRide &&
              myRide.ownerId === me2 &&
              bulletActive(myRide, performance.now());
          // The shell's target is always hit (the owner stamped targetId and
          // was authenticated above); everyone else only inside the blast.
          const isTarget = event.targetId === me2;
          if (
            !immune &&
            raceLive() &&
            myVulnerable() &&
            (isTarget ||
              (p2 &&
                resolveBlueBlast([{ id: me2, x: p2.x, z: p2.z }], event).includes(me2)))
          ) {
              applyShellStun({
                x: event.x,
                y: event.y,
                z: event.z,
                shellId: `blue-${event.x}-${event.z}`,
                scale: 1.2,
                heavy: true,
                soft: true,
              });
            }
          }
        }
      }),
    [],
  );

  const getColliders = () => {
    if (!collidersRef.current) {
      const list = [];
      scene.traverse((obj) => {
        if (obj.isMesh && obj.name.includes("ground")) list.push(obj);
      });
      collidersRef.current = list;
    }
    return collidersRef.current;
  };

  const snapToGround = (x, z) => {
    snapRaycaster.set(new THREE.Vector3(x, 60, z), downDir);
    snapRaycaster.far = 200;
    snapRaycaster.firstHitOnly = true;
    const hits = snapRaycaster.intersectObjects(getColliders(), false);
    const g = hits.find((h) => h.object.name.includes("ground"));
    return g ? g.point.y : null;
  };

  const randomBoxSpot = () => {
    // Sample the actual road triangles. The prior bounding
    // box + general ground ray could resolve to grass, barriers or scenery.
    const point = sampleBlackRoadPoint(blackRoadGeometry, roadTransform);
    if (!point) return null;
    // Hover height follows the local kart size so a mini box hugs the road
    // instead of floating a full kart-height above it. Stored per box so
    // respawns and bobbing stay consistent even if the scale changes.
    const s = useGameStore.getState().kartScale ?? 1;
    return { x: point.x, y: point.y + 1.1 * s, z: point.z, s };
  };

  // Initial spawn. Solo + host generate spots; guests wait for the host's
  // item:boxes (plus the 2s heartbeat below, which heals late joins).
  useEffect(() => {
    if (useGameStore.getState().itemBoxes.length > 0) return;
    const gm = useGameManager.getState();
    const ownsBoxes =
      !gm.isOnlineRace || useOnlineRaceStore.getState().isHost === true;
    if (!ownsBoxes) return;
    const spots = [];
    for (let i = 0; i < BOX_COUNT; i++) {
      const s = randomBoxSpot();
      if (s) spots.push({ id: nextId++, ...s, active: true, respawnAt: 0 });
    }
    if (spots.length > 0) useGameStore.getState().setItemBoxes(spots);
    if (gm.isOnlineRace) publishBoxes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, scene, selectedTrackId]);

  // Blue alarm is module-level audio: always stop on unmount (exit) so it
  // never loops into the menu or the next race.
  useEffect(() => () => stopBlueAlarm(), []);
  // A race reset while a blue is airborne must also kill the loop: the
  // fizzle explode never fires once activeShells is cleared.
  const raceRunning = useGameManager((s) => s.gameStarted);
  useEffect(() => {
    if (!raceRunning) {
      stopBlueAlarm();
      useGameStore.getState().setBlueWarning(null);
    }
  }, [raceRunning]);

  // Ticking loop while carrying the bomb.
  useEffect(() => {
    if (carriedBomb) {
      const audio = startLoop("explosion.mp3", 0.35);
      tickAudioRef.current = audio;
    } else if (tickAudioRef.current) {
      stopLoop(tickAudioRef.current);
      tickAudioRef.current = null;
    }
    return () => {
      // Always stop on unmount (exit) — otherwise the loop keeps playing
      // and a second loop starts on re-entry while still carrying.
      if (tickAudioRef.current) {
        stopLoop(tickAudioRef.current);
        tickAudioRef.current = null;
      }
    };
  }, [carriedBomb]);

  useFrame((state, delta) => {
    if (useGameManager.getState().isPaused) return;
    const st = useGameStore.getState();
    const playerPos = st.playerPosition;
    const now = performance.now();
    const t = state.clock.elapsedTime;

    // Spin + bob living boxes (bob amplitude follows each box's scale).
    for (const b of st.itemBoxes) {
      const g = boxNodesRef.current.get(b.id);
      if (!g || !b.active) continue;
      g.rotation.y = t * 2 + b.id;
      g.position.y = b.y + Math.sin(t * 2.2 + b.id * 1.7) * 0.3 * (b.s ?? 1);
    }

    if (!playerPos) return;
    const px = playerPos.x;
    const pz = playerPos.z;
    // Radii follow the local kart size (clamped so mini karts can still
    // grab boxes without pixel-perfect driving). At scale=1 unchanged.
    const myScale = useGameStore.getState().kartScale ?? 1;
    const pickupRadius = Math.max(1.2, PICKUP_RADIUS * myScale);
    const triggerRadius = Math.max(1.2, BOMB_TRIGGER_RADIUS * myScale);

    // Pickup: a box touch ALWAYS consumes the box (even with a full slot —
    // then the player gets nothing). A free slot starts the roulette; the
    // bomb legacy path grants at lock like every other row.
    const slotFree = canGrant({
      carriedBomb: st.carriedBomb,
      carriedItem: st.carriedItem,
      roulette: st.roulette,
    });
    for (const b of st.itemBoxes) {
      if (!b.active) continue;
      const d = Math.hypot(px - b.x, pz - b.z);
      // Level gate: boxes on another deck (bridges, stacked switchbacks)
      // don't trigger from above/below. Tolerates jumps (4u).
      const dyBox = Math.abs((st.groundPosition ?? 0) - (Number(b.y) || 0));
      if (d < pickupRadius && dyBox < 4) {
        st.setItemBoxes(
          st.itemBoxes.map((o) =>
            o.id === b.id
              ? { ...o, active: false, respawnAt: now + itemConfig.boxRespawnMs }
              : o
          )
        );
        // Tell everyone the box is gone (offline publish is a no-op).
        publishOnlineRaceEvent({ type: "item:boxTaken", boxId: b.id });
        // Free slot → roulette; full slot → consumed, player gets nothing.
        if (pickupGrant({ occupied: !slotFree, row: "roulette" }).grant) {
          playSfx("collecting_box.mp3");
          const activeBlue = st.activeShells.some((s) => s.kind === "blue");
          if (useGameManager.getState().gameStarted && !matchStartRef.current) {
            matchStartRef.current = now;
          }
          st.setRoulette({
            type: rollItem({
              ...getStanding(),
              activeBlue,
              raceAgeMs: now - matchStartRef.current,
            }),
            startedAt: now,
          });
        }
        break;
      }
    }

    // Respawn collected boxes. ONLY the owner (solo/host) rolls new spots —
    // guests apply the host's list, so positions stay identical everywhere.
    // Re-read after the pickup write above (2.1 #8): the stale `st` snapshot
    // would otherwise resurrect a box that was just taken.
    const gmFrame = useGameManager.getState();
    const orsFrame = useOnlineRaceStore.getState();
    const ownsBoxes = !gmFrame.isOnlineRace || orsFrame.isHost === true;
    let needsRespawn = false;
    const freshBoxes = useGameStore.getState().itemBoxes;
    let next = freshBoxes;
    if (ownsBoxes) {
      next = freshBoxes.map((b) => {
        if (!b.active && b.respawnAt > 0 && now >= b.respawnAt) {
          const s = randomBoxSpot();
          needsRespawn = true;
          if (s) return { ...b, ...s, active: true, respawnAt: 0 };
          return { ...b, respawnAt: now + 2000 };
        }
        return b;
      });
      if (needsRespawn) {
        st.setItemBoxes(next);
        if (gmFrame.isOnlineRace) publishBoxes();
      }
    }

    // Host heartbeat: full list every 2s heals late joins and lost packets.
    if (gmFrame.isOnlineRace && orsFrame.isHost === true) {
      if (now - boxSyncRef.current > 2000) {
        boxSyncRef.current = now;
        publishBoxes();
      }
    }

    // Bomb press (T6): commits now (carried off, tick stops), drops at the
    // throw_back release from the glove world position. Publishes move to
    // the release so remotes see the bomb through the swing-back.
    const queueBombDrop = (pressAt) => {
      const gs = useGameStore.getState();
      gs.setCarriedBomb(false);
      playItemAnim("throw_back", { bomb: true });
      gs.setPendingSpawns([
        ...gs.pendingSpawns,
        { kind: "bomb", pressAt, releaseMs: itemConfig.throwBack.releaseMs },
      ]);
    };
    const fireBombDrop = () => {
      const gs = useGameStore.getState();
      const myScale = gs.kartScale ?? 1;
      const hand = getHandWorldPosition();
      const ry = gs.playerRotationY || 0;
      const fx = -Math.sin(ry);
      const fz = -Math.cos(ry);
      const dropBack = 2.6 * Math.max(0.5, myScale);
      const bx = hand ? hand.x : px - fx * dropBack;
      const bz = hand ? hand.z : pz - fz * dropBack;
      const gy = snapToGround(bx, bz) ?? (gs.groundPosition ?? 0);
      const bomb = {
        id: makeBombId(),
        x: bx,
        y: gy + 0.9 * myScale,
        z: bz,
        scale: myScale,
        createdAt: Date.now(),
      };
      addDroppedBomb({ ...bomb, ownerId: myRacerId() });
      publishOnlineRaceEvent({ type: "bomb:carried", carried: false });
      publishOnlineRaceEvent({
        type: "bomb:dropped",
        ownerId: myRacerId(),
        bomb: { ...bomb, ownerId: myRacerId() },
      });
    };
    // Drop with G or E (edge trigger). Spin-out and the global use gap
    // gate every use (§10.6); lastUseAt is stamped on any committed press.
    // A live pending spawn also gates: the press commits once, the effect
    // lands at release, and the anim never double-fires.
    const keys = getKeys();
    // E/G keyboard, B touch button, X/LB gamepad — one edge-triggered path.
    const dropDown = Boolean(keys?.dropBomb || keys?.useItem || st.useItemPressed);
    const spinningNow = st.spin && now < st.spin.until;
    const gapOk = now - lastUseAt >= itemConfig.minUseGapMs;
    const spawnBusy = st.pendingSpawns.length > 0;
    if (dropDown && !dropHeldRef.current && st.carriedBomb && !spinningNow && gapOk && !spawnBusy) {
      lastUseAt = now;
      queueBombDrop(now);
    }
    // Roulette lock: commit while racing, drop post-race (never grant or
    // publish after gameOver).
    const pending = st.roulette;
    const verdict = commitRoulette({ pending, raceLive: raceLive(), now });
    if (verdict?.action === "drop") {
      st.setRoulette(null);
    } else if (verdict?.action === "commit") {
      st.setRoulette(null);
      const slot = rowToSlot(pending.type, now);
      if (slot.bomb) {
        st.setCarriedBomb(true);
        publishOnlineRaceEvent({ type: "bomb:carried", carried: true });
        playItemAnim("item_got");
      } else if (slot.type === "skid" || slot.type === "wind") {
        fireMiniBoost();
      } else {
        st.setCarriedItem(slot);
        publishCarried(slot);
        // Fresh golden has no window yet — allow immediate first use.
        if (slot.type === "golden") goldenLastRef.current = 0;
        playItemAnim("item_got");
      }
    }

    // Mushroom-family use. Singles/triples fire on edge; golden re-fires
    // while held (GOLDEN_REUSE_MS) and expires on the performance.now clock.
    // Edge is computed BEFORE dropHeldRef updates below. Spin-out blocks
    // every use; presses closer than minUseGapMs are ignored (§10.6).
    const spinning = spinningNow;
    // Bullet Bill active: no item use at all, slot kept (§10.6).
    const myBulletRide =
      st.bulletRide &&
      st.bulletRide.ownerId === myRacerId() &&
      bulletActive(st.bulletRide, now);
    const edgeDown =
      dropDown && !dropHeldRef.current && !spinning && !myBulletRide && gapOk && !spawnBusy;
    const heldItem = st.carriedItem;
    if (edgeDown && (st.carriedBomb || heldItem)) lastUseAt = now;
    if (heldItem && heldItem.type === "red") {
      if (edgeDown) queueRedThrow(Boolean(keys?.backward), now);
    } else if (heldItem && heldItem.type === "blue") {
      if (edgeDown) queueBlueThrow(now);
    } else if (heldItem && heldItem.type === "bullet") {
      if (edgeDown) queueBulletRide(now);
    } else if (heldItem && heldItem.type === "blooper") {
      if (edgeDown) queueBlooper(now);
    } else if (
      heldItem &&
      (heldItem.type === "mushroom" || heldItem.type === "golden")
    ) {
      // §4.2: windowUntil null = window not yet opened → never expires.
      // NOTE: Number(null) is 0 (finite!) so the null check must come first.
      if (
        heldItem.type === "golden" &&
        heldItem.windowUntil != null &&
        Number.isFinite(Number(heldItem.windowUntil)) &&
        now >= Number(heldItem.windowUntil)
      ) {
        st.setCarriedItem(null);
        publishCarried(null);
      } else if (heldItem.type === "golden") {
        if (
          dropDown &&
          !spinning &&
          !myBulletRide &&
          refireAllowed(goldenLastRef.current, now, itemConfig.golden.minGapMs)
        ) {
          goldenLastRef.current = now;
          fireBoostInstant(useGameStore.getState().carriedItem);
        }
      } else if (edgeDown) {
        queueMushroom(heldItem, now);
      }
    }

    dropHeldRef.current = dropDown;

    // Release-time spawns: committed presses materialize at release.
    const due = st.pendingSpawns.filter((p) => spawnDue(p, now));
    if (due.length > 0) {
      st.setPendingSpawns(st.pendingSpawns.filter((p) => !spawnDue(p, now)));
      for (const p of due) {
        if (p.kind === "red") fireRedShell(p.backward, p.fromTriple);
        else if (p.kind === "blue") fireBlueShell(p);
        else if (p.kind === "bullet") startBulletRide();
        else if (p.kind === "blooper") fireBlooperRelease(p);
        else if (p.kind === "bomb") fireBombDrop(p);
        else if (p.kind === "mushroom") fireMushroomBoost(p);
      }
    }

    // Live bombs explode when the kart touches them (after arm time).
    // Never behind the results screen. Level-gated like pickups: a bomb on
    // another deck can't catch the kart from above/below.
    for (const bomb of [...st.droppedBombs]) {
      if (bombAgeMs(bomb, now) < BOMB_ARM_SECONDS * 1000) continue;
      if (!raceLive()) continue;
      const d = Math.hypot(px - bomb.x, pz - bomb.z);
      const dyBomb = Math.abs((st.groundPosition ?? 0) - (Number(bomb.y) || 0));
      if (d < triggerRadius && dyBomb < 3.5) triggerBombExplosion(bomb, { broadcast: true });
    }
    // Bullet Bill expiry (owner ends with a hop) + knock detection.
    // Only the owner's client detects knocks; victims apply on receipt.
    // Knocks run during the full ride only — never on the ramp.
    const ride = st.bulletRide;
    if (ride && ride.endingUntil && now >= ride.endingUntil) {
      st.setBulletRide(null);
    } else if (ride && !bulletActive(ride, now) && !ride.endingUntil) {
      endBulletRide(true);
    } else if (ride && ride.ownerId === myRacerId() && bulletActive(ride, now)) {
      if (knockedRef.current.rideId !== ride.rideId) {
        knockedRef.current = { rideId: ride.rideId, ids: new Set() };
      }
      const orsRide = useOnlineRaceStore.getState();
      for (const [id, r] of Object.entries(orsRide.remoteRacers)) {
        if (!isRacerTargetable(r)) continue;
        const d = Math.hypot(px - (Number(r?.x) || 0), pz - (Number(r?.z) || 0));
        const knockRadius = Math.max(1, BULLET_KNOCK_RADIUS * (st.kartScale ?? 1));
        if (d < knockRadius && !knockedRef.current.ids.has(id)) {
          knockedRef.current.ids.add(id);
          publishOnlineRaceEvent({
            type: "bullet:knock",
            rideId: ride.rideId,
            victimId: id,
          });
        }
      }
    }

    // Blooper squirt visual expires after ~1s.
    if (st.blooperSquirt && now >= st.blooperSquirt.until) {
      st.setBlooperSquirt(null);
    }

    // Homing shells: every client moves every shell the same way (owner and
    // remotes share constants); ONLY the owner detects hits and broadcasts.
    // Re-read the store: `st` was taken at the top of the frame, and the
    // release-time spawns above (fireRedShell / fireBlueShell) have already
    // appended a shell since. Looping the stale list and writing it back
    // deleted the shell fired this very frame whenever any other shell was
    // in flight (2nd/3rd shell of a triple, or any remote shell): it stayed
    // visible to remotes but could never hit anyone.
    const liveShells = useGameStore.getState().activeShells;
    // Safety net: the alarm/warning normally stop on blue:explode, but a shell
    // can also vanish without one (12 s expiry, fizzle on a non-owner client,
    // lost packet). With no blue shell left in flight the warning must not
    // outlive it. Small grace so blue:incoming arriving a hair before the
    // hydrated shell does not cancel itself.
    if (
      (blueAlarmAudio || useGameStore.getState().blueWarning) &&
      now - blueAlarmStartedAt > 1500 &&
      !liveShells.some((s) => s.kind === "blue")
    ) {
      stopBlueAlarm();
      useGameStore.getState().setBlueWarning(null);
    }
    if (liveShells.length > 0) {
      const step = Math.min(delta, 0.05);
      const me = myRacerId();
      const ors = useOnlineRaceStore.getState();
      const victimsAll = [
        {
          id: me,
          x: px,
          z: pz,
          y: st.groundPosition ?? 0,
          invulnUntil: st.invulnUntil || 0,
          anim:
            st.spin && now < st.spin.until
              ? "spin_hit_light"
              : undefined,
          bullet:
            st.bulletRide &&
            st.bulletRide.ownerId === me &&
            bulletActive(st.bulletRide, now),
        },
        ...Object.entries(ors.remoteRacers)
      .filter(([, r]) => isRacerTargetable(r))
      .map(([id, r]) => ({
          id,
          x: Number(r?.x) || 0,
          z: Number(r?.z) || 0,
          // bodyY is the remote's driving level; r.y is the kart-group
          // origin (always 0) and sends the shell to the wrong deck.
          y: Number(r?.bodyY ?? r?.y) || 0,
          invulnUntil: Number(r?.invulnUntilLocal) || 0,
          anim: r?.anim,
          bullet: Boolean(r?.bulletRide),
        })),
      ];
      // A finished/spectating local kart is parked: it is no longer a target,
      // a blast victim or a leader candidate.
      const meDone = localFinished();
      const victims = meDone ? victimsAll.filter((v) => v.id !== me) : victimsAll;
      // Red shells cannot touch bullet riders (§4.4): filter before searching.
      // Invulnerable / already-spinning racers are skipped by the owner too
      // (2.1 #10); the victim keeps its own check as final authority.
      const hittable = excludeImmune(victims).filter(
        (v) => !shouldSkipVictim(v, now)
      );
      const next = [];
      for (const shell of liveShells) {
        // Hydrated remotes carry a real `at` (2.1 #6); NaN lifetimes expire.
        if (remoteShellExpired(shell, now)) continue;
        if (shell.kind === "blue") {
          // Stable re-target: switch only on laps-greater or +5 dist, so ties
          // never flap the target (and the alarm) every frame.
          const orsB = useOnlineRaceStore.getState();
          const rows = victims.map((v) => ({
            id: v.id,
            laps:
              v.id === me
                ? Array.isArray(useGameManager.getState().lapTimes)
                  ? useGameManager.getState().lapTimes.length
                  : 0
                : Number(orsB.remoteRaceProgress[v.id]?.completedLaps) || 0,
            dist:
              v.id === me
                ? useGameStore.getState().selfDistance || 0
                : orsB.remoteDistances[v.id] || 0,
            // BUG-3 fix: include finished state so retargetBlue does not target finished racers
            finished:
              v.id === me
                ? localFinished()
                : Boolean(
                    orsB.remoteRaceProgress[v.id]?.finished ||
                    orsB.remoteRacers[v.id]?.finished
                  ),
          }));
          const leaderId = retargetBlue(shell.targetId, rows);
          if (leaderId !== shell.targetId) shell.targetId = leaderId;
          // Leader gone or finished → fizzle (alarm stops via explode).
          // Self-targets finish locally: remoteRaceProgress never holds self.
          const leader = victims.find((v) => v.id === shell.targetId);
          const leaderProg = ors.remoteRaceProgress[shell.targetId];
          const selfDone = shell.targetId === me && meDone;
          // BUG-4 fix: check targetability rather than bare existence in remoteRacers
          // so disconnected ghosts trigger fizzle if no alternative target exists.
          const targetConnected =
            Boolean(leader) ||
            (shell.targetId === me
              ? !selfDone
              : isRacerTargetable(ors.remoteRacers[shell.targetId]));
          if (!targetConnected || leaderProg?.finished || selfDone) {
            if (shell.owner) {
              publishOnlineRaceEvent({
                type: "blue:explode",
                x: shell.x,
                y: shell.y,
                z: shell.z,
                fizzle: true,
                // Ownership proof (host relay overwrites with sender id).
                ownerId: myRacerId(),
              });
              // Owner never receives its own publish: stop the local alarm
              // when WE were the target, otherwise it loops forever (solo /
              // self-target bug). Shell already drops via `continue` below.
              if (shell.targetId === me) {
                stopBlueAlarm();
                useGameStore.getState().setBlueWarning(null);
              }
            }
            continue;
          }
          const tx = leader?.x ?? shell.x;
          const tz = leader?.z ?? shell.z;
          const dxl = tx - shell.x;
          const dzl = tz - shell.z;
          const distXZ = Math.hypot(dxl, dzl) || 1;
          const diving =
            shell.phase === "drop" ||
            blueShouldDive({ distXZ, flightMs: now - shell.at });
          const phase = diving ? "drop" : "fly";
          let moved;
          if (phase === "fly") {
            const targetY = Number.isFinite(Number(leader?.y))
              ? Number(leader.y)
              : Number(shell.top) - BLUE_FLY_HEIGHT;
            const targetTop = targetY + BLUE_FLY_HEIGHT;
            const blueSpeed = Number.isFinite(Number(shell.speed))
              ? clampShellSpeed(shell.speed)
              : BLUE_SPEED;
            moved = {
              ...shell,
              phase,
              top: targetTop,
              x: shell.x + (dxl / distXZ) * blueSpeed * step,
              y: shell.y + (targetTop - shell.y) * Math.min(1, 2 * step),
              z: shell.z + (dzl / distXZ) * blueSpeed * step,
            };
          } else {
            // Dive onto the TARGET's ground height (2.1 #7), not the local
            // player's: every client tracks every victim's y in the rows.
            const targetGround = Number.isFinite(Number(leader?.y))
              ? Number(leader.y)
              : Number.isFinite(Number(shell.top))
              ? Number(shell.top) - BLUE_FLY_HEIGHT
              : st.groundPosition ?? 0;
            const ground = targetGround;
            moved = {
              ...shell,
              phase,
              x: tx,
              z: tz,
              y: shell.y - 45 * step,
            };
            if (moved.y <= ground) {
              // Bullet-immune target: harmless pop, nobody spins.
              const targetRide =
                shell.targetId === me
                  ? st.bulletRide
                  : ors.remoteRacers[shell.targetId]?.bulletRide;
              const immune =
                targetRide && bulletActive(targetRide, now);
              if (shell.owner) {
                // The explode carries targetId: the targeted racer is hit
                // regardless of where it is by the time this arrives (remote
                // positions here are ~100+ ms old, so a distance-only check on
                // the victim could miss a moving leader).
                publishOnlineRaceEvent({
                  type: "blue:explode",
                  x: tx,
                  y: ground,
                  z: tz,
                  targetId: shell.targetId,
                  fizzle: Boolean(immune),
                  // Ownership proof (host relay overwrites with sender id).
                  ownerId: myRacerId(),
                });
                // Owner never receives its own explode: stop the local alarm
                // + clear the warning when WE were the target. The shell drops
                // via `continue` below, and applyShellStun plays shell-hit.mp3.
                if (shell.targetId === me) {
                  stopBlueAlarm();
                  useGameStore.getState().setBlueWarning(null);
                }
                if (immune) {
                  applyShellStun({
                    x: moved.x, y: ground, z: moved.z,
                    shellId: shell.id, scale: 0.5, soft: true, stun: false,
                  });
                } else {
                  const hitIds = resolveBlueBlast(victims, {
                    x: moved.x,
                    z: moved.z,
                  }, Math.max(1.5, BLUE_BLAST_RADIUS * (st.kartScale ?? 1)));
                  if (hitIds.includes(me) && raceLive() && myVulnerable(now)) {
                    applyShellStun({
                      x: moved.x,
                      y: ground,
                      z: moved.z,
                      shellId: shell.id,
                      scale: 1.2,
                      heavy: true,
                    });
                  }
                }
              }
              continue;
            }
          }
          next.push(moved);
          continue;
        }
        let { dx, dz } = shell;
        let bounces = shell.bounces ?? itemConfig.redShell.maxBounces;
        // Homing steers only with a live target; backward/untargeted fly straight.
        if (shell.homing && shell.targetId) {
          const target = victims.find((v) => v.id === shell.targetId);
          if (target) {
            const steered = steerShell({
              dir: { x: dx, z: dz },
              toTarget: { x: target.x - shell.x, z: target.z - shell.z },
              maxTurn: itemConfig.redShell.maxTurnRad,
              dt: step,
            });
            dx = steered.x;
            dz = steered.z;
          }
        }
        const shellSpeed =
          Number.isFinite(Number(shell.speed))
            ? clampShellSpeed(shell.speed)
            : itemConfig.redShell.speedMult * kartSettings.speed.max;
        const moved = {
          ...shell,
          x: shell.x + dx * shellSpeed * step,
          y: cruiseSettle(shell.y, shell.cruiseY ?? shell.y, step),
          z: shell.z + dz * shellSpeed * step,
          dx,
          dz,
        };
        // Wall bounce (up to maxBounces, then the shell drops).
        const wallN = wallHitNormal(moved.x, moved.z, st.wallSegments, 1);
        if (wallN) {
          const bounced = bounceShell({ x: dx, z: dz }, wallN, bounces);
          if (!bounced) continue;
          moved.dx = bounced.dx;
          moved.dz = bounced.dz;
          moved.bounces = bounced.left;
        }
        if (shell.owner) {
          // First racer TOUCHED (nearest in radius), owner grace 0.5 s.
          // Bullet riders are already filtered out of hittable (§4.4).
          // Radius follows kart size (3.4 dwarfs a 0.2-scale kart).
          const hitRadius = Math.max(0.8, itemConfig.redShell.hitRadius * (st.kartScale ?? 1));
          let hit = null;
          let hitDist = Infinity;
          for (const v of hittable) {
            if (v.id === me && now - shell.at < itemConfig.redShell.ownerGraceMs) {
              continue;
            }
            const d = Math.hypot(v.x - moved.x, v.z - moved.z);
            if (d < hitRadius && d < hitDist) {
              hit = v;
              hitDist = d;
            }
          }
          if (hit) {
            publishOnlineRaceEvent({
              type: "shell:hit",
              shellId: shell.id,
              victimId: hit.id,
              x: moved.x,
              y: moved.y,
              z: moved.z,
            });
            if (hit.id === me) {
              // Triple orbit absorbs instead of spinning (matrix §4.3).
              if (raceLive() && myVulnerable(now) && !absorbWithOrbit("red")) {
                applyShellStun({ x: moved.x, y: moved.y, z: moved.z, shellId: shell.id, soft: true });
              }
            } else {
              // Owner-side visual only (soft + no stun — the victim applies
              // their own precise stun on receipt).
              applyShellStun({ x: moved.x, y: moved.y, z: moved.z, shellId: shell.id, soft: true, stun: false });
            }
            continue;
          }
        }
        next.push(moved);
      }
      if (next.length !== liveShells.length) st.setActiveShells(next);
      else if (next.some((s, i) => s.x !== liveShells[i].x)) {
        st.setActiveShells(next);
      }
    }

    void delta;
  });

  return (
    <>
      {itemBoxes.map(
        (b) =>
          b.active && (
            <group
              key={b.id}
              ref={(g) => {
                if (g) boxNodesRef.current.set(b.id, g);
                else boxNodesRef.current.delete(b.id);
              }}
              position={[b.x, b.y, b.z]}
            >
              <group scale={boxVisualScale}>
                <ItemBoxModel />
              </group>
            </group>
          )
      )}
      {droppedBombs.map((b) => (
        <group key={b.id} position={[b.x, b.y, b.z]} scale={0.75 * (b.scale ?? 1)}>
          <BombModel />
        </group>
      ))}
      {activeShells.map((s) => (
        <group key={s.id} position={[s.x, s.y, s.z]}>
          {s.kind === "red" && <RedShellModel sizeMul={clampShellMul(s.sizeMul ?? 1)} />}
          {s.kind === "blue" && <BlueShellModel sizeMul={clampShellMul(s.sizeMul ?? 1)} />}
        </group>
      ))}
      {activeShells
        .filter((s) => s.kind === "blue")
        .map((s) => (
          <BlueTargetRing key={`ring-${s.id}`} shell={s} />
        ))}
      {blooperSquirt && (
        <group position={[blooperSquirt.x, blooperSquirt.y, blooperSquirt.z]}>
          {/* Cast moment = configured cast height via sizeMul (never raw scale). */}
          <BlooperModel
            sizeMul={
              itemConfig.sizes.bloopCastHeight / itemConfig.sizes.bloopHeldHeight
            }
          />
        </group>
      )}
      {explosions.map((e) => (
        <ExplosionFx key={e.id} data={e} />
      ))}
    </>
  );
}


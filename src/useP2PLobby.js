import { useCallback, useEffect, useRef, useState } from "react";
import { Peer } from "peerjs";
import { useOnlineRaceStore } from "./onlineRaceStore";
import { receiveOnlineRaceEvent, setOnlineRaceTransport } from "./onlineRaceTransport";
import { DEFAULT_TRACK_ID, isKnownTrackId } from "./tracks";
import { normalizeBoxList } from "./items/itemWeights";
import { clampShellMul, clampShellSpeed } from "./items/homing.js";
import { MAX_LOBBY_PLAYERS, PEER_CONFIG, shouldDropFlood } from "./p2pConfig.js";

const LOBBY_ID_PREFIX = "mario-kart-3js-";
const LOBBY_CODE_LENGTH = 6;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DRIVER_IDS = new Set(["mario", "luigi"]);

const emptyLobby = () => ({
  status: "idle", // idle | creating | joining | connected | error
  lobbyCode: "",
  isHost: false,
  self: null,
  players: [],
  error: "",
});

const normaliseName = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20);

export const normalizeLobbyCode = (value) =>
  String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, LOBBY_CODE_LENGTH);

const makeLobbyCode = () => {
  const bytes = new Uint32Array(LOBBY_CODE_LENGTH);

  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < LOBBY_CODE_LENGTH; index += 1) {
      bytes[index] = Math.floor(Math.random() * 0xffffffff);
    }
  }

  return Array.from(bytes, (value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join("");
};

const lobbyPeerId = (code) => `${LOBBY_ID_PREFIX}${code}`;

const toPlayer = (candidate, fallbackId) => {
  const id = typeof fallbackId === "string" ? fallbackId : candidate?.id;

  if (typeof id !== "string" || !id) {
    return null;
  }

  return {
    id,
    name: normaliseName(candidate?.name) || "Player",
    driver: DRIVER_IDS.has(candidate?.driver) ? candidate.driver : null,
  };
};

const ANIM_STATES = new Set([
  "drive",
  "spin_hit_light",
  "spin_hit_heavy",
  "bullet",
  "boost_lean",
  "hold_item",
  "item_got",
  "throw_forward",
  "throw_back",
  "throw_up",
  "cast_up",
  "use_mushroom",
]);

// Strict numeric read: `Number(null)`, `Number("")`, `Number([])` and
// `Number(true)` all coerce to 0/1 and would pass `Number.isFinite`, so a
// hostile packet could silently place a kart at the origin. Only real finite
// numbers (or numeric strings from older peers) are accepted.
const strictNumber = (value) => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return NaN;
};

// Shortest believable lap/segment time for host-side progress plausibility.
const MIN_LAP_PLAUSIBLE_MS = 5000;

const toRaceTransform = (candidate) => {
  const x = strictNumber(candidate?.x);
  const y = strictNumber(candidate?.y);
  const z = strictNumber(candidate?.z);
  const rotationYRaw = strictNumber(candidate?.rotationY);
  const bodyY = strictNumber(candidate?.bodyY);

  if (![x, y, z, rotationYRaw].every(Number.isFinite)) {
    return null;
  }
  // Yaw only matters modulo 2PI (receivers use the shortest arc); an
  // unbounded value like 1e308 would make the angle maths meaningless.
  if (Math.abs(rotationYRaw) > 1e6) {
    return null;
  }
  const rotationY = rotationYRaw;

  // Ignore corrupt/hostile P2P packets that would place a visual kart far
  // outside the map or create a broken Three.js transform.
  if (Math.abs(x) > 2500 || Math.abs(y) > 500 || Math.abs(z) > 2500) {
    return null;
  }

  // Item animation state (v3 §10.7): enum + wall-clock start. Unknown values
  // fall back to drive so a hostile packet only freezes a flourish.
  const anim =
    typeof candidate?.anim === "string" && ANIM_STATES.has(candidate.anim)
      ? candidate.anim
      : "drive";
  // Only compared for change on the receiver; bounded to a sane epoch-ms
  // range so a hostile value cannot be a 1e308 sentinel.
  const animAtRaw = strictNumber(candidate?.animAt);
  const animAt =
    Number.isFinite(animAtRaw) && animAtRaw > 0 && animAtRaw < 1e14 ? animAtRaw : 0;

  // Remaining hit-invulnerability ms (2.1 #10): clamped, anchored locally on
  // receipt so the owner can skip invulnerable victims without trusting clocks.
  const invulnMs = strictNumber(candidate?.invulnMs);
  return {
    x,
    y,
    z,
    rotationY,
    // Set once the sender crossed its final line: receivers hide the kart and
    // stop treating it as an item target (it keeps publishing its last pose).
    finished: candidate?.finished === true,
    // Same bounds as `y`: an unclamped bodyY from a hostile peer would put
    // the remote kart's visual (and the homing/shell maths that reads it)
    // arbitrarily far from the track.
    bodyY: Number.isFinite(bodyY) ? Math.max(-500, Math.min(500, bodyY)) : 0,
    anim,
    animAt,
    invulnMs:
      Number.isFinite(invulnMs) && invulnMs > 0
        ? Math.max(0, Math.min(4000, Math.round(invulnMs)))
        : 0,
  };
};

const toRacePosition = (candidate) => {
  const x = Number(candidate?.x);
  const y = Number(candidate?.y);
  const z = Number(candidate?.z);

  if (![x, y, z].every(Number.isFinite)) return null;
  if (Math.abs(x) > 2500 || Math.abs(y) > 500 || Math.abs(z) > 2500) return null;

  return { x, y, z };
};

// Load-state for the race-go handshake. `progress` is display-only (drei's
// useProgress legitimately dips as new assets enter the queue) so it is only
// clamped to 0..100 — no monotonic rule that would reject honest reports.
// `loaded` is the explicit readiness signal from the receiver's track+walls
// commit; the per-player store latches it, so false after true is ignored.
const toLoadProgress = (candidate) => {
  if (!candidate || typeof candidate !== "object") return null;

  const progress = Number(candidate.progress);
  if (!Number.isFinite(progress)) return null;

  return {
    progress: Math.max(0, Math.min(100, progress)),
    loaded: Boolean(candidate.loaded),
  };
};

// P2P peers are untrusted inputs, so only a compact whitelist of gameplay
// actions reaches the Three.js scene. Movement has its own validator above.
const toRaceEvent = (candidate, maxLapCount = 5) => {
  if (!candidate || typeof candidate !== "object") return null;

  if (candidate.type === "bomb:carried") {
    return { type: "bomb:carried", carried: Boolean(candidate.carried) };
  }

  if (candidate.type === "bomb:dropped") {
    const id = String(candidate.bomb?.id ?? "").slice(0, 120);
    const position = toRacePosition(candidate.bomb);
    const createdAt = Number(candidate.bomb?.createdAt);
    const rawScale = Number(candidate.bomb?.scale);
    // Bomb owner. Declared by the sender, OVERWRITTEN by the host relay
    // with the authenticated connection id (same pattern as shell:fired).
    const ownerId =
      typeof candidate.ownerId === "string" && candidate.ownerId
        ? candidate.ownerId.slice(0, 64)
        : typeof candidate.bomb?.ownerId === "string" && candidate.bomb.ownerId
          ? candidate.bomb.ownerId.slice(0, 64)
          : null;

    if (!id || !position) return null;
    return {
      type: "bomb:dropped",
      ...(ownerId ? { ownerId } : {}),
      bomb: {
        id,
        ...position,
        createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
        // Remote mini bombs render at the owner's kart size (2.2 #15).
        scale: Number.isFinite(rawScale)
          ? Math.max(0.2, Math.min(3, rawScale))
          : 1,
        ...(ownerId ? { ownerId } : {}),
      },
    };
  }

  if (candidate.type === "bomb:explode") {
    const bombId = String(candidate.bombId ?? "").slice(0, 120);
    const position = toRacePosition(candidate);
    if (!bombId || !position) return null;
    const rawScale = Number(candidate.scale);
    // Owner of the bomb that exploded. Declared by the sender, OVERWRITTEN
    // by the host relay with the authenticated connection id (never trust
    // the payload — a forged explode at a victim's position is a stun-lock).
    const ownerId =
      typeof candidate.ownerId === "string" && candidate.ownerId
        ? candidate.ownerId.slice(0, 64)
        : null;

    return {
      type: "bomb:explode",
      bombId,
      ...position,
      scale: Number.isFinite(rawScale)
        ? Math.max(0.2, Math.min(3, rawScale))
        : 1,
      ...(ownerId ? { ownerId } : {}),
    };
  }

  if (candidate.type === "item:carried") {
    const itemType =
      candidate.itemType == null ? null : String(candidate.itemType).slice(0, 20);
    const variant =
      candidate.variant == null ? null : String(candidate.variant).slice(0, 10);
    if (
      itemType !== null &&
      !["mushroom", "golden", "red", "blue", "bullet", "blooper", "bomb"].includes(itemType)
    ) {
      return null;
    }
    if (variant !== null && variant !== "single" && variant !== "triple") {
      return null;
    }
    const usesLeft = Number(candidate.usesLeft);
    // Golden window crosses as remaining ms (2.1 #9), never absolute.
    // Unopened window (null) stays null — Number(null) is 0, which would
    // fake an instantly-expired window on the remote.
    const windowMs = candidate.windowMs == null ? null : Number(candidate.windowMs);
    return {
      type: "item:carried",
      itemType,
      variant,
      usesLeft: Number.isInteger(usesLeft) && usesLeft >= -1 && usesLeft <= 3 ? usesLeft : null,
      windowMs:
        windowMs != null && Number.isFinite(windowMs) && windowMs >= 0
          ? Math.max(0, Math.min(7000, Math.round(windowMs)))
          : null,
    };
  }

  if (candidate.type === "item:boxes") {
    const boxes = normalizeBoxList(candidate.boxes);
    if (!boxes || boxes.length === 0) return null;
    return { type: "item:boxes", boxes };
  }

  if (candidate.type === "item:boxTaken") {
    const boxId = Number(candidate.boxId);
    if (!Number.isInteger(boxId)) return null;
    return { type: "item:boxTaken", boxId };
  }

  if (candidate.type === "shell:fired") {
    const shell = candidate.shell;
    if (!shell || typeof shell !== "object") return null;
    const shellId = String(shell.id ?? "").slice(0, 120);
    const kind = String(shell.kind ?? "");
    const position = toRacePosition(shell);
    const dx = Number(shell.dx);
    const dz = Number(shell.dz);
    const ownerId = String(shell.ownerId ?? "").slice(0, 64);
    const targetId =
      shell.targetId == null ? null : String(shell.targetId).slice(0, 64);
    const bounces = Number(shell.bounces);
    const homing = shell.homing !== false;
    // Flying shell size inherits its source (single 0.7x, triple 1x);
    // clamped 0.2..3, missing (old clients) stays 1.
    const sizeMul = clampShellMul(shell.sizeMul ?? 1);
    if (
      !shellId ||
      (kind !== "red" && kind !== "blue") ||
      !position ||
      !Number.isFinite(dx) ||
      !Number.isFinite(dz) ||
      // Reject degenerate / hostile direction vectors (NaN/Infinity floods).
      Math.abs(dx) > 500 ||
      Math.abs(dz) > 500 ||
      (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) ||
      !ownerId
    ) {
      return null;
    }
    const top = Number(shell.top);
    // Shell arc height must stay sane; clamp rather than trust the sender.
    const saneTop = Number.isFinite(top) ? Math.max(-50, Math.min(120, top)) : undefined;
    return {
      type: "shell:fired",
      shell: {
        id: shellId, kind, ...position, dx, dz, targetId, ownerId,
        homing,
        bounces: Number.isInteger(bounces) ? Math.max(0, Math.min(3, bounces)) : 3,
        sizeMul,
        // Cruise speed is owner-kartScale-relative; clamped so hostile
        // payloads can't inject warp-speed shells.
        speed: clampShellSpeed(shell.speed ?? (kind === "blue" ? 66 : 48)),
        ...(saneTop !== undefined ? { top: saneTop } : {}),
      },
    };
  }

  if (candidate.type === "shell:hit") {
    const shellId = String(candidate.shellId ?? "").slice(0, 120);
    const victimId = String(candidate.victimId ?? "").slice(0, 64);
    const position = toRacePosition(candidate);
    if (!shellId || !victimId || !position) return null;
    return { type: "shell:hit", shellId, victimId, ...position };
  }

  if (candidate.type === "blue:incoming") {
    const leaderId = String(candidate.leaderId ?? "").slice(0, 64);
    if (!leaderId) return null;
    return { type: "blue:incoming", leaderId };
  }

  if (candidate.type === "blue:explode") {
    const position = toRacePosition(candidate);
    if (!position) return null;
    // Blue-shell owner. Declared by the sender, OVERWRITTEN by the host
    // relay with the authenticated connection id.
    const ownerId =
      typeof candidate.ownerId === "string" && candidate.ownerId
        ? candidate.ownerId.slice(0, 64)
        : null;
    return {
      type: "blue:explode",
      ...position,
      fizzle: Boolean(candidate.fizzle),
      ...(ownerId ? { ownerId } : {}),
    };
  }

  if (candidate.type === "bullet:start") {
    const playerId = String(candidate.playerId ?? "").slice(0, 64);
    const rideId = String(candidate.rideId ?? "").slice(0, 120);
    if (!playerId || !rideId) return null;
    return { type: "bullet:start", playerId, rideId };
  }

  if (candidate.type === "bullet:end") {
    const playerId = String(candidate.playerId ?? "").slice(0, 64);
    if (!playerId) return null;
    return { type: "bullet:end", playerId };
  }

  if (candidate.type === "bullet:knock") {
    const victimId = String(candidate.victimId ?? "").slice(0, 64);
    const rideId = String(candidate.rideId ?? "").slice(0, 120);
    if (!victimId || !rideId) return null;
    return { type: "bullet:knock", victimId, rideId };
  }

  if (candidate.type === "blooper:ink") {
    if (!Array.isArray(candidate.targetIds) || candidate.targetIds.length > 8) {
      return null;
    }
    const targetIds = [];
    for (const id of candidate.targetIds) {
      if (typeof id !== "string" || !id) return null;
      targetIds.push(id.slice(0, 64));
    }
    return { type: "blooper:ink", targetIds };
  }

  if (candidate.type === "race:progress") {
    const lapLimit = Math.min(5, Math.max(1, Math.floor(Number(maxLapCount) || 3)));
    const completedLaps = Number(candidate.completedLaps);
    const currentLap = Number(candidate.currentLap);
    const finished = Boolean(candidate.finished);
    const completedAt = Number(candidate.completedAt);

    if (
      !Number.isInteger(completedLaps) ||
      !Number.isInteger(currentLap) ||
      completedLaps < 0 ||
      completedLaps > lapLimit ||
      currentLap < 1 ||
      currentLap > lapLimit
    ) {
      return null;
    }

    // A completion message must describe a coherent post-finish lap state.
    const expectedCurrentLap = completedLaps === lapLimit ? lapLimit : completedLaps + 1;
    if (currentLap !== expectedCurrentLap || finished !== (completedLaps === lapLimit)) {
      return null;
    }

    return {
      type: "race:progress",
      completedLaps,
      currentLap,
      finished,
      ...(Number.isFinite(completedAt) && completedAt > 0 ? { completedAt } : {}),
    };
  }

  return null;
};

// The lobby host is the relay for race events. It supplies the timestamp used
// for deterministic same-lap ordering instead of trusting a guest's clock.
const stampRaceProgress = (event) =>
  event.type === "race:progress" ? { ...event, completedAt: Date.now() } : event;

const upsertPlayer = (players, player) => {
  const existingIndex = players.findIndex(({ id }) => id === player.id);

  if (existingIndex === -1) {
    return [...players, player];
  }

  return players.map((existing) => (existing.id === player.id ? player : existing));
};

const peerErrorMessage = (error, lobbyCode) => {
  switch (error?.type) {
    case "peer-unavailable":
      return `Lobby ${lobbyCode} was not found. Check the code and try again.`;
    case "network":
    case "socket-error":
    case "socket-closed":
      return "Couldn't reach the P2P service. Check your internet connection and retry.";
    case "webrtc":
      return "A direct connection could not be made. Try again from a different network.";
    case "invalid-id":
      return "This lobby code is not valid.";
    default:
      return "We couldn't connect to this lobby. Please try again.";
  }
};

export const useP2PLobby = () => {
  const [lobby, setLobby] = useState(emptyLobby);
  const [raceStart, setRaceStart] = useState(null);
  // Course for the next online race. Chosen by the host in the lobby and
  // broadcast with the shared race-start event so every browser loads it.
  const [raceTrackId, setRaceTrackIdState] = useState(DEFAULT_TRACK_ID);
  const raceTrackRef = useRef(DEFAULT_TRACK_ID);
  const peerRef = useRef(null);
  const guestConnectionRef = useRef(null);
  const hostConnectionsRef = useRef(new Map());
  const hostRef = useRef(false);
  const selfRef = useRef(null);
  const playersRef = useRef([]);
  const activeRaceRef = useRef(null);
  const loadMoveAtRef = useRef(new Map());
  const maxProgressRef = useRef(new Map());
  const stallTimerRef = useRef(null);

  const clearStallTimer = useCallback(() => {
    if (stallTimerRef.current) {
      window.clearInterval(stallTimerRef.current);
      stallTimerRef.current = null;
    }
  }, []);

  const recordLoadMove = useCallback((playerId) => {
    if (playerId) loadMoveAtRef.current.set(playerId, Date.now());
  }, []);

  const isLoadPhase = useCallback(() => {
    const activeRace = activeRaceRef.current;
    return Boolean(activeRace && !useOnlineRaceStore.getState().raceGo);
  }, []);

  const openRaceGate = useCallback((payload) => {
    clearStallTimer();
    useOnlineRaceStore.getState().setStalledIds([]);
    useOnlineRaceStore.getState().setRaceGo({
      raceId: payload.raceId,
      playerIds: payload.playerIds,
      players: payload.players,
      sentAt: typeof payload.sentAt === "number" ? payload.sentAt : Date.now(),
    });
  }, [clearStallTimer]);

  // Host-authoritative trim: whenever a roster drop happens during the load
  // phase every client must converge on the same final roster, including
  // dropping the state of removed players.
  const trimRosterToIds = useCallback((roster, playerIds) => {
    const keep = new Set(playerIds);
    const dropped = roster.players.filter((player) => !keep.has(player.id));
    dropped.forEach((player) => {
      useOnlineRaceStore.getState().removeRemoteRacer(player.id);
    });
    return {
      ...roster,
      playerIds: [...playerIds],
      players: roster.players.filter((player) => keep.has(player.id)),
    };
  }, []);

  const applyPlayers = useCallback((nextPlayers) => {
    playersRef.current = nextPlayers;
    const currentSelf = selfRef.current;
    const syncedSelf = currentSelf
      ? nextPlayers.find(({ id }) => id === currentSelf.id) ?? currentSelf
      : null;

    if (syncedSelf) {
      selfRef.current = syncedSelf;
    }

    setLobby((current) => ({
      ...current,
      players: nextPlayers,
      self: syncedSelf ?? current.self,
    }));
  }, []);

  const broadcastLobbyState = useCallback(() => {
    const message = {
      type: "lobby:state",
      players: playersRef.current,
      trackId: raceTrackRef.current,
    };

    hostConnectionsRef.current.forEach((connection) => {
      if (connection.open) {
        try {
          connection.send(message);
        } catch {
          // The close handler will remove any connection that has gone stale.
        }
      }
    });
  }, []);

  const broadcastRaceTransform = useCallback((message) => {
    hostConnectionsRef.current.forEach((connection) => {
      if (!connection.open) return;

      try {
        connection.send(message);
      } catch {
        // A stale connection is cleaned up by its close handler.
      }
    });
  }, []);

  const applyIncomingRaceEvent = useCallback((playerId, event) => {
    // Authenticated sender guard: explosion events only apply when the
    // stamped owner matches the stamped sender. Guests relay through the
    // host, so `playerId` here is already the host-stamped sender and
    // `ownerId` was overwritten by the relay (never the payload). A forged
    // explode at a victim's position would otherwise be a remote stun-lock.
    if (event.type === "bomb:explode" || event.type === "blue:explode") {
      if (event.ownerId && event.ownerId !== playerId) return;
    }
    if (event.type === "item:boxes" && Array.isArray(event.boxes) && event.boxes.length === 0) {
      // Defensive: validator already rejects empty lists; never wipe boxes.
      return;
    }
    if (event.type === "item:boxTaken" && typeof event.boxId !== "number") return;
    if (event.type === "bomb:carried") {
      useOnlineRaceStore.getState().setRemoteRacerCarriedBomb(playerId, event.carried);
    }

    if (event.type === "item:carried") {
      // windowMs (remaining) anchors to the LOCAL clock (2.1 #9).
      // Null = unopened window → stays null (Number(null) is 0, which
      // would fake an instantly-expired window).
      const windowMs = event.windowMs == null ? null : Number(event.windowMs);
      useOnlineRaceStore.getState().setRemoteRacerCarriedItem(
        playerId,
        event.itemType
          ? {
              type: event.itemType,
              variant: event.variant ?? "single",
              usesLeft: event.usesLeft,
              windowUntil:
                windowMs != null && Number.isFinite(windowMs) && windowMs >= 0
                  ? performance.now() +
                    Math.max(0, Math.min(7000, Math.round(windowMs)))
                  : null,
            }
          : null
      );
    }

    // NOTE (2.2 #16): bullet:start/end are applied once in ItemBoxes from the
    // authenticated sender (receiveOnlineRaceEvent forwards playerId below).
    // Handling them here too created two truths; the direct writes are gone.

    if (event.type === "race:progress") {
      useOnlineRaceStore.getState().setRemoteRaceProgress(playerId, event);
    }

    receiveOnlineRaceEvent({ ...event, playerId });
  }, []);

  const publishRaceTransform = useCallback(
    (candidate) => {
      const activeRace = activeRaceRef.current;
      const self = selfRef.current;
      const transform = toRaceTransform(candidate);

      if (!activeRace || !self?.id || !transform || !activeRace.playerIds.includes(self.id)) {
        return;
      }

      if (hostRef.current) {
        broadcastRaceTransform({
          type: "lobby:race-state",
          raceId: activeRace.raceId,
          playerId: self.id,
          state: transform,
        });
        return;
      }

      const connection = guestConnectionRef.current;
      if (!connection?.open) return;

      try {
        connection.send({
          type: "race:state",
          raceId: activeRace.raceId,
          state: transform,
        });
      } catch {
        // Connection errors are surfaced by PeerJS's close/error handlers.
      }
    },
    [broadcastRaceTransform],
  );

  const publishRaceEvent = useCallback(
    (candidate) => {
      const activeRace = activeRaceRef.current;
      const self = selfRef.current;
      const event = toRaceEvent(candidate, activeRace?.lapCount);

      if (!activeRace || !self?.id || !event || !activeRace.playerIds.includes(self.id)) {
        return;
      }

      if (hostRef.current) {
        let relayedEvent = stampRaceProgress(event);
        // The host's own bombs/shells carry its id as owner, exactly like
        // the relay stamps for guests above.
        if (
          relayedEvent.type === "bomb:dropped" ||
          relayedEvent.type === "bomb:explode" ||
          relayedEvent.type === "blue:explode"
        ) {
          relayedEvent = { ...relayedEvent, ownerId: self.id };
          if (relayedEvent.type === "bomb:dropped" && relayedEvent.bomb) {
            relayedEvent = {
              ...relayedEvent,
              bomb: { ...relayedEvent.bomb, ownerId: self.id },
            };
          }
        }
        // The host's own progress must also land in the local store with the
        // same host-stamped completedAt every guest sees — otherwise the
        // host's own results row sorts as Infinity and always loses ties.
        // (Other event types stay broadcast-only: the host already applied
        // its own action locally when performing it.)
        if (relayedEvent.type === "race:progress") {
          useOnlineRaceStore.getState().setRemoteRaceProgress(self.id, relayedEvent);
        }
        broadcastRaceTransform({
          type: "lobby:race-event",
          raceId: activeRace.raceId,
          playerId: self.id,
          event: relayedEvent,
        });
        return;
      }

      const connection = guestConnectionRef.current;
      if (!connection?.open) return;

      try {
        connection.send({
          type: "race:event",
          raceId: activeRace.raceId,
          event,
        });
      } catch {
        // Connection errors are surfaced by PeerJS's close/error handlers.
      }
    },
    [broadcastRaceTransform],
  );

  const checkLoadGate = useCallback(() => {
    const activeRace = activeRaceRef.current;
    if (!activeRace || !hostRef.current) return;
    if (useOnlineRaceStore.getState().raceGo) return;

    const loadProgress = useOnlineRaceStore.getState().loadProgress;
    const allLoaded = activeRace.playerIds.every(
      (id) => loadProgress[id]?.loaded === true,
    );
    if (!allLoaded) return;

    const payload = {
      type: "lobby:race-go",
      raceId: activeRace.raceId,
      playerIds: activeRace.playerIds,
      players: activeRace.players,
      sentAt: Date.now(),
    };
    broadcastRaceTransform(payload);
    openRaceGate(payload);
  }, [broadcastRaceTransform, openRaceGate]);

  const applyRemoteLoadProgress = useCallback(
    (playerId, state) => {
      if (!playerId || !state || !activeRaceRef.current) return;
      if (!activeRaceRef.current.playerIds.includes(playerId)) return;

      const store = useOnlineRaceStore.getState();
      const before = store.loadProgress[playerId];
      store.setRemoteLoadProgress(playerId, state);

      // Stall tracking: only increasing progress or newly achieving loaded:true
      // counts as valid forward progress. A fluctuating peer (1, 2, 1, 2)
      // will not re-arm the stall timer.
      const after = useOnlineRaceStore.getState().loadProgress[playerId];
      const prevMax = maxProgressRef.current.get(playerId) ?? -1;
      const progressIncreased = after && after.progress > prevMax;
      const newlyLoaded = before?.loaded !== true && after?.loaded === true;

      if (progressIncreased || newlyLoaded) {
        if (progressIncreased) {
          maxProgressRef.current.set(playerId, after.progress);
        }
        recordLoadMove(playerId);
      }

      if (hostRef.current) checkLoadGate();
    },
    [checkLoadGate, recordLoadMove],
  );

  const publishLoadProgress = useCallback(
    (candidate) => {
      const activeRace = activeRaceRef.current;
      const self = selfRef.current;
      const state = toLoadProgress(candidate);

      if (!activeRace || !self?.id || !state || !activeRace.playerIds.includes(self.id)) {
        return;
      }

      applyRemoteLoadProgress(self.id, state);

      const message = {
        type: "race:load",
        raceId: activeRace.raceId,
        progress: state.progress,
        loaded: state.loaded,
      };

      if (hostRef.current) {
        broadcastRaceTransform({
          type: "lobby:race-load",
          raceId: activeRace.raceId,
          playerId: self.id,
          progress: state.progress,
          loaded: state.loaded,
        });
        return;
      }

      const connection = guestConnectionRef.current;
      if (!connection?.open) return;

      try {
        connection.send(message);
      } catch {
        // Connection errors surface through PeerJS's close/error handlers.
      }
    },
    [applyRemoteLoadProgress, broadcastRaceTransform],
  );

  const setRaceTrackId = useCallback((trackId) => {
    if (!isKnownTrackId(trackId)) return;
    raceTrackRef.current = trackId;
    setRaceTrackIdState(trackId);
    // Host shares the pick live so guests see (and preload) the same course.
    if (hostRef.current) broadcastLobbyState();
  }, [broadcastLobbyState]);

  const destroyTransport = useCallback(() => {
    const peer = peerRef.current;
    peerRef.current = null;
    hostRef.current = false;
    clearStallTimer();
    loadMoveAtRef.current = new Map();
    maxProgressRef.current = new Map();

    if (guestConnectionRef.current) {
      try {
        guestConnectionRef.current.close();
      } catch {
        // The connection may already be closed.
      }
      guestConnectionRef.current = null;
    }

    hostConnectionsRef.current.forEach((connection) => {
      try {
        connection.close();
      } catch {
        // The connection may already be closed.
      }
    });
    hostConnectionsRef.current.clear();

    if (peer) {
      try {
        peer.destroy();
      } catch {
        // PeerJS can throw if a failed peer was already destroyed.
      }
    }

    selfRef.current = null;
    playersRef.current = [];
    activeRaceRef.current = null;
    useOnlineRaceStore.getState().clearRemoteRacers();
  }, [clearStallTimer]);

  const leaveLobby = useCallback(() => {
    destroyTransport();
    setLobby(emptyLobby());
    setRaceStart(null);
  }, [destroyTransport]);

  const createLobby = useCallback(
    (displayName) => {
      const name = normaliseName(displayName);

      if (!name) {
        setLobby({
          ...emptyLobby(),
          status: "error",
          error: "Enter a display name before creating a lobby.",
        });
        return;
      }

      destroyTransport();
      setRaceStart(null);
      hostRef.current = true;

      const createHostPeer = (attempt = 1) => {
        const code = makeLobbyCode();
        const pendingHost = { id: "host-pending", name, driver: null };
        const peer = new Peer(lobbyPeerId(code), PEER_CONFIG);
        let didOpen = false;

        peerRef.current = peer;
        selfRef.current = pendingHost;
        playersRef.current = [pendingHost];
        setLobby({
          status: "creating",
          lobbyCode: code,
          isHost: true,
          self: pendingHost,
          players: [pendingHost],
          error: "",
        });

        const sendState = (connection) => {
          if (!connection.open) return;

          try {
            connection.send({
              type: "lobby:state",
              players: playersRef.current,
              trackId: raceTrackRef.current,
            });
          } catch {
            // The close event handles failed data connections.
          }
        };

        const removePlayer = (peerId) => {
          if (peerRef.current !== peer) return;

          hostConnectionsRef.current.delete(peerId);
          // Mid-race the racer's last transform, laps and distance must
          // survive the disconnect: wiping them snapped the kart back to its
          // grid slot and dropped a racer who already finished to 0 laps in
          // the host's standings (guests never wipe, so views disagreed).
          // The store is cleared at race start, so lobby-phase removal is
          // the only case that still needs it.
          if (!activeRaceRef.current) {
            useOnlineRaceStore.getState().removeRemoteRacer(peerId);
          }
          const nextPlayers = playersRef.current.filter(({ id }) => id !== peerId);
          applyPlayers(nextPlayers);
          broadcastLobbyState();
        };

        const setupConnection = (connection) => {
          const isCurrentHost = () => peerRef.current === peer && hostRef.current;

          const receiveLobbyMessage = (message) => {
            if (!isCurrentHost() || !message || typeof message !== "object") return;

            if (message.type === "lobby:join") {
              const joiningPlayer = toPlayer(message.player, connection.peer);
              if (!joiningPlayer) return;
              // Cap the room at MAX_LOBBY_PLAYERS (spawn slots = 10) and
              // refuse joins once a race is running.
              if (playersRef.current.length >= MAX_LOBBY_PLAYERS) {
                try {
                  connection.send({ type: "lobby:error", message: "This lobby is full (10 players max)." });
                } catch { /* peer already gone */ }
                return;
              }
              if (activeRaceRef.current) {
                try {
                  connection.send({ type: "lobby:error", message: "A race is already running. Please wait for the next one." });
                } catch { /* peer already gone */ }
                return;
              }

              const nextPlayers = upsertPlayer(playersRef.current, joiningPlayer);
              applyPlayers(nextPlayers);
              sendState(connection);
              broadcastLobbyState();
            }

            if (message.type === "lobby:update-player") {
              const updatedPlayer = toPlayer(message.player, connection.peer);
              if (!updatedPlayer) return;

              const nextPlayers = upsertPlayer(playersRef.current, updatedPlayer);
              applyPlayers(nextPlayers);
              broadcastLobbyState();
            }

            if (message.type === "race:state") {
              // Honest clients send ~15/s (10-17 with frame quantisation).
              // Every accepted packet is re-broadcast to all other peers, so
              // an unbounded sender would amplify into a flood.
              if (shouldDropFlood(connection.peer, "state", 40)) return;
              const activeRace = activeRaceRef.current;
              const transform = toRaceTransform(message.state);

              if (
                !activeRace ||
                message.raceId !== activeRace.raceId ||
                !activeRace.playerIds.includes(connection.peer) ||
                !transform
              ) {
                return;
              }

              useOnlineRaceStore.getState().setRemoteRacer(connection.peer, transform);
              broadcastRaceTransform({
                type: "lobby:race-state",
                raceId: activeRace.raceId,
                playerId: connection.peer,
                state: transform,
              });
            }

            if (message.type === "race:event") {
              const activeRace = activeRaceRef.current;
              let event = toRaceEvent(message.event, activeRace?.lapCount);

              if (
                !activeRace ||
                message.raceId !== activeRace.raceId ||
                !activeRace.playerIds.includes(connection.peer) ||
                !event
              ) {
                return;
              }

              // Sender must own what it claims (shell / bullet / bomb).
              if (event.type === "shell:fired" && event.shell.ownerId !== connection.peer) {
                return;
              }
              if (event.type === "bullet:start" && event.playerId !== connection.peer) {
                return;
              }
              // Explosions are stamped with the authenticated sender as
              // owner (payload ownerId is never trusted). Guests receiving
              // the relay check ownerId === playerId before applying.
              if (
                event.type === "bomb:dropped" ||
                event.type === "bomb:explode" ||
                event.type === "blue:explode"
              ) {
                event = { ...event, ownerId: connection.peer };
                if (event.type === "bomb:dropped" && event.bomb) {
                  event = {
                    ...event,
                    bomb: { ...event.bomb, ownerId: connection.peer },
                  };
                }
              }
              // bullet:knock is relayed (not dropped): only the ride owner's
              // client detects knocks, so dropping every guest knock meant a
              // guest's Bullet Bill never hit anyone. The victim still
              // validates it (isValidKnock: the authenticated sender must own
              // that exact live ride), and the flood guard below bounds it.
              if (event.type === "item:boxes") {
                // Box spawn/respawn is host-authoritative. Guests already
                // reject relayed item:boxes that don't come from the host;
                // the host must refuse them at the source too, otherwise any
                // guest could overwrite the host's boxes locally.
                return;
              }
              // Flood guard: one hostile peer must not grow activeShells /
              // droppedBombs arrays until the game freezes.
              if (
                (event.type === "shell:fired" && shouldDropFlood(connection.peer, "shell", 6)) ||
                (event.type === "bomb:dropped" && shouldDropFlood(connection.peer, "bomb", 4)) ||
                (event.type === "bomb:explode" && shouldDropFlood(connection.peer, "bombExplode", 4)) ||
                (event.type === "blue:explode" && shouldDropFlood(connection.peer, "blueExplode", 2)) ||
                (event.type === "item:boxTaken" && shouldDropFlood(connection.peer, "boxTaken", 8)) ||
                (event.type === "blooper:ink" && shouldDropFlood(connection.peer, "blooper", 2)) ||
                // One knock per victim per ride (max 9 victims in a lobby of 10).
                (event.type === "bullet:knock" && shouldDropFlood(connection.peer, "knock", 12)) ||
                (event.type === "bullet:start" && shouldDropFlood(connection.peer, "bulletStart", 2)) ||
                (event.type === "bullet:end" && shouldDropFlood(connection.peer, "bulletEnd", 2)) ||
                (event.type === "shell:hit" && shouldDropFlood(connection.peer, "shellHit", 10)) ||
                (event.type === "blue:incoming" && shouldDropFlood(connection.peer, "blueIncoming", 2)) ||
                (event.type === "item:carried" && shouldDropFlood(connection.peer, "itemCarried", 20)) ||
                (event.type === "bomb:carried" && shouldDropFlood(connection.peer, "bombCarried", 10))
              ) {
                return;
              }
              // Plausibility: lap progress is client-reported, so the host
              // only accepts it one lap at a time (a guest cannot jump 0 -> 3
              // laps / "finished" in one message) and only if enough time has
              // passed since the race start and since that racer's last lap.
              if (event.type === "race:progress") {
                const prev = useOnlineRaceStore.getState().remoteRaceProgress[connection.peer];
                const prevLaps = Number(prev?.completedLaps) || 0;
                if (event.completedLaps !== prevLaps + 1) return;
                const nowMs = Date.now();
                const raceAgeMs = nowMs - (activeRace.startedAt ?? nowMs);
                if (raceAgeMs < event.completedLaps * MIN_LAP_PLAUSIBLE_MS) return;
                if (
                  Number.isFinite(prev?.completedAt) &&
                  nowMs - prev.completedAt < MIN_LAP_PLAUSIBLE_MS
                ) {
                  return;
                }
              }
              // Progress is published on lap completion only — a peer sending
              // it several times a second is hostile or buggy; drop the flood.
              if (event.type === "race:progress" && shouldDropFlood(connection.peer, "progress", 2)) {
                return;
              }

              const relayedEvent = stampRaceProgress(event);
              applyIncomingRaceEvent(connection.peer, relayedEvent);
              broadcastRaceTransform({
                type: "lobby:race-event",
                raceId: activeRace.raceId,
                playerId: connection.peer,
                event: relayedEvent,
              });
            }

            if (message.type === "race:load") {
              const activeRace = activeRaceRef.current;
              const state = toLoadProgress(message);

              if (
                !activeRace ||
                message.raceId !== activeRace.raceId ||
                !activeRace.playerIds.includes(connection.peer) ||
                !state
              ) {
                return;
              }
              // ~2 reports/sec client-side; a hostile burst beyond that is noise.
              if (shouldDropFlood(connection.peer, "load", 15)) return;

              applyRemoteLoadProgress(connection.peer, state);
              broadcastRaceTransform({
                type: "lobby:race-load",
                raceId: activeRace.raceId,
                playerId: connection.peer,
                progress: state.progress,
                loaded: state.loaded,
              });
            }
          };

          connection.on("data", receiveLobbyMessage);
          connection.on("close", () => removePlayer(connection.peer));
          connection.on("error", () => removePlayer(connection.peer));

          const markConnected = () => {
            if (!isCurrentHost()) return;
            hostConnectionsRef.current.set(connection.peer, connection);
          };

          if (connection.open) {
            markConnected();
          } else {
            connection.on("open", markConnected);
          }
        };

        peer.on("open", (id) => {
          if (peerRef.current !== peer) return;

          didOpen = true;
          const host = { id, name, driver: null };
          selfRef.current = host;
          playersRef.current = [host];
          setLobby({
            status: "connected",
            lobbyCode: code,
            isHost: true,
            self: host,
            players: [host],
            error: "",
          });
        });

        peer.on("connection", setupConnection);
        peer.on("error", (error) => {
          if (peerRef.current !== peer) return;

          if (!didOpen && error?.type === "unavailable-id" && attempt < 5) {
            peerRef.current = null;
            try {
              peer.destroy();
            } catch {
              // A collision can close the peer before it is destroyed here.
            }
            createHostPeer(attempt + 1);
            return;
          }

          setLobby((current) => ({
            ...current,
            status: "error",
            error: peerErrorMessage(error, code),
          }));
        });

        // Signaling dropped but WebRTC data channels may survive; ask PeerJS
        // to re-attach to the cloud so new guests can still find the room.
        peer.on("disconnected", () => {
          if (peerRef.current !== peer) return;
          setLobby((current) => ({
            ...current,
            error: current.error || "Signaling connection lost — reconnecting…",
          }));
          try {
            peer.reconnect();
          } catch {
            // Reconnect failures surface through the error handler above.
          }
        });
      };

      createHostPeer();
    },
    [
      applyIncomingRaceEvent,
      applyPlayers,
      applyRemoteLoadProgress,
      broadcastLobbyState,
      broadcastRaceTransform,
      destroyTransport,
    ],
  );

  const joinLobby = useCallback(
    (displayName, rawLobbyCode, driver) => {
      const name = normaliseName(displayName);
      const code = normalizeLobbyCode(rawLobbyCode);

      if (!name || code.length !== LOBBY_CODE_LENGTH) {
        setLobby({
          ...emptyLobby(),
          status: "error",
          error: "Enter your name and a valid 6-character lobby code.",
        });
        return;
      }

      destroyTransport();
      setRaceStart(null);
      const peer = new Peer(PEER_CONFIG);
      peerRef.current = peer;
      hostRef.current = false;
      const selectedDriver = DRIVER_IDS.has(driver) ? driver : null;

      setLobby({
        status: "joining",
        lobbyCode: code,
        isHost: false,
        self: { id: "", name, driver: selectedDriver },
        players: [],
        error: "",
      });

      peer.on("open", (id) => {
        if (peerRef.current !== peer) return;

        const self = { id, name, driver: selectedDriver };
        selfRef.current = self;
        setLobby((current) => ({ ...current, self }));

        const connection = peer.connect(lobbyPeerId(code), {
          reliable: true,
          serialization: "json",
        });
        guestConnectionRef.current = connection;

        connection.on("data", (message) => {
          if (peerRef.current !== peer || !message || typeof message !== "object") return;

          if (message.type === "lobby:state" && Array.isArray(message.players)) {
            const nextPlayers = message.players
              .map((player) => toPlayer(player))
              .filter(Boolean);

            applyPlayers(nextPlayers);
            // Host's course pick arrives with every lobby snapshot.
            if (isKnownTrackId(message.trackId)) {
              setRaceTrackId(message.trackId);
            }
            setLobby((current) => ({ ...current, status: "connected", error: "" }));
          }

          if (message.type === "lobby:race-start" && Array.isArray(message.playerIds)) {
            const playerIds = message.playerIds.filter((id) => typeof id === "string");
            const players = Array.isArray(message.players)
              ? message.players.map((player) => toPlayer(player)).filter(Boolean)
              : [];

            const hasMatchingRoster =
              players.length === playerIds.length &&
              players.every((player, index) => player.id === playerIds[index]);

            if (playerIds.includes(selfRef.current?.id) && hasMatchingRoster) {
              const race = {
                raceId: typeof message.raceId === "string" ? message.raceId : String(Date.now()),
                playerIds,
                players,
                startedAt: Date.now(),
                lapCount: Math.min(5, Math.max(1, Math.floor(Number(message.lapCount) || 3))),
                trackId: isKnownTrackId(message.trackId) ? message.trackId : DEFAULT_TRACK_ID,
              };
              activeRaceRef.current = race;
              loadMoveAtRef.current = new Map();
              useOnlineRaceStore.getState().clearLoadGate();
              useOnlineRaceStore.getState().clearRemoteRacers();
              useOnlineRaceStore.getState().setIsHost(false);
              setRaceStart(race);
            }
          }

          if (message.type === "lobby:race-state") {
            const activeRace = activeRaceRef.current;
            const transform = toRaceTransform(message.state);

            if (
              activeRace &&
              message.raceId === activeRace.raceId &&
              typeof message.playerId === "string" &&
              message.playerId !== selfRef.current?.id &&
              activeRace.playerIds.includes(message.playerId) &&
              transform
            ) {
              useOnlineRaceStore.getState().setRemoteRacer(message.playerId, transform);
            }
          }

          if (message.type === "lobby:race-event") {
            const activeRace = activeRaceRef.current;
            const event = toRaceEvent(message.event, activeRace?.lapCount);
            const isOwnProgressEcho =
              event?.type === "race:progress" &&
              typeof message.playerId === "string" &&
              message.playerId === selfRef.current?.id;

            if (
              activeRace &&
              message.raceId === activeRace.raceId &&
              typeof message.playerId === "string" &&
              (message.playerId !== selfRef.current?.id || isOwnProgressEcho) &&
              activeRace.playerIds.includes(message.playerId) &&
              event
            ) {
              // Box-state resets are host-authoritative: only accept them
              // when relayed from the roster head (the host).
              if (event.type === "item:boxes" && message.playerId !== activeRace.playerIds[0]) {
                return;
              }
              // Own progress echo carries the host-stamped completedAt, which
              // is the only finish timestamp comparable across clocks.
              if (isOwnProgressEcho) {
                useOnlineRaceStore.getState().setRemoteRaceProgress(message.playerId, event);
                return;
              }
              applyIncomingRaceEvent(message.playerId, event);
            }
          }

          if (message.type === "lobby:race-load") {
            const activeRace = activeRaceRef.current;
            const state = toLoadProgress(message);

            if (
              !activeRace ||
              message.raceId !== activeRace.raceId ||
              typeof message.playerId !== "string" ||
              // Own state is applied locally on send; echoes are noise.
              message.playerId === selfRef.current?.id ||
              !activeRace.playerIds.includes(message.playerId) ||
              !state
            ) {
              return;
            }

            useOnlineRaceStore.getState().setRemoteLoadProgress(message.playerId, state);
          }

          if (message.type === "lobby:race-go" && Array.isArray(message.playerIds)) {
            const activeRace = activeRaceRef.current;

            if (!activeRace || message.raceId !== activeRace.raceId || !Array.isArray(message.players)) {
              return;
            }

            const playerIds = message.playerIds.filter((id) => typeof id === "string");
            const players = message.players.map((player) => toPlayer(player)).filter(Boolean);

            if (players.length !== playerIds.length || !playerIds.includes(selfRef.current?.id)) {
              // The host trimmed us out entirely (Start-without-X).
              useOnlineRaceStore.getState().setRaceError("The race started without you — your browser was still loading when the host gave up on it.");
              return;
            }

            // Converge on the host's final roster (dropped players' state goes
            // with it), then open the shared gate.
            const trimmedRace = trimRosterToIds(activeRace, playerIds);
            activeRaceRef.current = trimmedRace;
            openRaceGate({
              raceId: activeRace.raceId,
              playerIds,
              players: trimmedRace.players,
              sentAt: message.sentAt,
            });
          }

          if (message.type === "lobby:error" && typeof message.message === "string") {
            setLobby((current) => ({ ...current, status: "error", error: message.message }));
            if (isLoadPhase()) {
              useOnlineRaceStore.getState().setRaceError(message.message);
            }
          }
        });

        connection.on("open", () => {
          if (peerRef.current !== peer) return;

          try {
            connection.send({ type: "lobby:join", player: selfRef.current });
          } catch {
            setLobby((current) => ({
              ...current,
              status: "error",
              error: "The lobby host closed the connection before you could join.",
            }));
          }

          if (isLoadPhase() && activeRaceRef.current) {
            const selfId = selfRef.current?.id;
            const currentLoad = useOnlineRaceStore.getState().loadProgress[selfId];
            if (currentLoad) {
              try {
                connection.send({
                  type: "race:load",
                  raceId: activeRaceRef.current.raceId,
                  progress: currentLoad.progress ?? 0,
                  loaded: Boolean(currentLoad.loaded),
                });
              } catch {
                // ignore
              }
            }
          }
        });

        connection.on("close", () => {
          if (peerRef.current !== peer) return;

          setLobby((current) => ({
            ...current,
            status: "error",
            error: "The lobby host disconnected.",
          }));
          // During the load phase the whole race endpoint is gone for this
          // browser: the canvas is up with no way forward. Surface it as a
          // recoverable race error (LoadingScreen overlay) instead of a
          // frozen white screen. A kicked guest's lobby:error already set a
          // clearer message — keep whichever came first.
          if (isLoadPhase()) {
            const store = useOnlineRaceStore.getState();
            store.setRaceError(
              store.raceError ||
                "The lobby host discontinued while everyone was still loading. Start a new lobby.",
            );
          } else if (activeRaceRef.current) {
            // Mid-race: the host owns item boxes and relays every transform,
            // so the race can't continue meaningfully. GameUI renders this as
            // a banner with a way back to the menu instead of a silent freeze.
            const store = useOnlineRaceStore.getState();
            store.setRaceError(
              store.raceError ||
                "The lobby host left the race. Other racers and item boxes are no longer updating.",
            );
          }
        });

        connection.on("error", (error) => {
          if (peerRef.current !== peer) return;

          setLobby((current) => ({
            ...current,
            status: "error",
            error: peerErrorMessage(error, code),
          }));
        });
      });

      peer.on("error", (error) => {
        if (peerRef.current !== peer) return;

        setLobby((current) => ({
          ...current,
          status: "error",
          error: peerErrorMessage(error, code),
        }));
      });

      peer.on("disconnected", () => {
        if (peerRef.current !== peer) return;
        setLobby((current) => ({
          ...current,
          error: current.error || "Signaling connection lost — reconnecting…",
        }));
        try {
          peer.reconnect();
        } catch {
          // Reconnect failures surface through the error handler above.
        }
      });
    },
    [
      applyIncomingRaceEvent,
      applyPlayers,
      destroyTransport,
      isLoadPhase,
      openRaceGate,
      setRaceTrackId,
      trimRosterToIds,
    ],
  );

  const updateDriver = useCallback(
    (driver) => {
      if (!DRIVER_IDS.has(driver) || !selfRef.current) return;

      const updatedSelf = { ...selfRef.current, driver };
      selfRef.current = updatedSelf;
      const nextPlayers = upsertPlayer(playersRef.current, updatedSelf);
      applyPlayers(nextPlayers);

      if (hostRef.current) {
        broadcastLobbyState();
        return;
      }

      const connection = guestConnectionRef.current;
      if (connection?.open) {
        try {
          connection.send({ type: "lobby:update-player", player: updatedSelf });
        } catch {
          setLobby((current) => ({
            ...current,
            status: "error",
            error: "Your driver change could not be sent to the host.",
          }));
        }
      }
    },
    [applyPlayers, broadcastLobbyState],
  );

  // Stall watchdog (host): flags peers whose load report has been frozen for
  // over 25 s. Never auto-kicks — the host chooses "Start without X" from the
  // loading screen, so a slow phone is never robbed of its race, but a dead
  // one can't lock everyone out forever either.
  const startStallWatcher = useCallback(() => {
    clearStallTimer();
    stallTimerRef.current = window.setInterval(() => {
      const activeRace = activeRaceRef.current;
      if (!activeRace || !hostRef.current) {
        clearStallTimer();
        return;
      }
      if (useOnlineRaceStore.getState().raceGo) {
        clearStallTimer();
        return;
      }

      const loadProgress = useOnlineRaceStore.getState().loadProgress;
      const now = Date.now();
      const stalled = activeRace.playerIds.filter((id) => {
        if (loadProgress[id]?.loaded) return false;
        const lastMove = loadMoveAtRef.current.get(id) ?? activeRace.startedAt;
        const raceAge = now - (activeRace.startedAt ?? now);
        return now - lastMove > 25000 || raceAge > 90000;
      });
      const current = useOnlineRaceStore.getState().stalledIds;
      if (stalled.join("\n") !== (current ?? []).join("\n")) {
        useOnlineRaceStore.getState().setStalledIds(stalled);
      }
    }, 5000);
  }, [clearStallTimer]);

  const startRace = useCallback((requestedLapCount = 3) => {
    const players = playersRef.current;
    const lapCount = Math.min(5, Math.max(1, Math.floor(Number(requestedLapCount) || 3)));

    if (!hostRef.current) return;

    if (players.length < 2) {
      setLobby((current) => ({
        ...current,
        error: "At least two players are needed to start an online race.",
      }));
      return;
    }

    if (players.some((player) => !DRIVER_IDS.has(player.driver))) {
      setLobby((current) => ({
        ...current,
        error: "Every player must choose a driver before the race can start.",
      }));
      return;
    }

    // Base timestamp for plausibility checks (anti-instant-finish) and for
    // guests to measure the countdown relative to receipt, not the host clock.
    const now = Date.now();
    const payload = {
      type: "lobby:race-start",
      raceId: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      playerIds: players.map((player) => player.id),
      players: players.map((player) => ({ ...player })),
      lapCount,
      trackId: raceTrackRef.current,
      sentAt: now,
    };

    const race = {
      raceId: payload.raceId,
      playerIds: payload.playerIds,
      players: payload.players,
      startedAt: now,
      lapCount: payload.lapCount,
      trackId: payload.trackId,
    };
    activeRaceRef.current = race;
    loadMoveAtRef.current = new Map();
    maxProgressRef.current = new Map();
    useOnlineRaceStore.getState().clearLoadGate();
    useOnlineRaceStore.getState().clearRemoteRacers();
    useOnlineRaceStore.getState().setIsHost(hostRef.current);
    setRaceStart(race);
    broadcastRaceTransform(payload);
    // Host-only watchdog: if a peer's load state freezes mid-gate the host
    // (and only the host) gets the explicit "Start without X" option.
    if (hostRef.current) startStallWatcher();
  }, [broadcastRaceTransform, startStallWatcher]);

  const startWithoutStalled = useCallback(() => {
    const activeRace = activeRaceRef.current;
    if (!activeRace || !hostRef.current) return;
    if (useOnlineRaceStore.getState().raceGo) return;

    const stalled = new Set(useOnlineRaceStore.getState().stalledIds);
    if (stalled.size === 0) return;

    const keptIds = activeRace.playerIds.filter((id) => !stalled.has(id));
    // Preserve the same two-participant minimum a lobby race is built on.
    if (keptIds.length < 2) {
      const msg = "Cannot start race: at least 2 players are required, but not enough players loaded. Returning to lobby.";
      hostConnectionsRef.current.forEach((connection) => {
        try {
          connection.send({
            type: "lobby:error",
            message: msg,
          });
        } catch {
          // ignore
        }
      });
      setLobby((current) => ({
        ...current,
        status: "error",
        error: msg,
      }));
      useOnlineRaceStore.getState().setRaceError(msg);
      clearStallTimer();
      return;
    }

    hostConnectionsRef.current.forEach((connection, peerId) => {
      if (!stalled.has(peerId)) return;
      try {
        connection.send({
          type: "lobby:error",
          message: "The race started without you — your connection stalled while loading.",
        });
      } catch {
        // The peer may already be gone.
      }
      try {
        connection.close();
      } catch {
        // The connection may already be closed.
      }
    });
    hostConnectionsRef.current.forEach((connection, peerId) => {
      if (stalled.has(peerId)) hostConnectionsRef.current.delete(peerId);
    });

    const payload = {
      type: "lobby:race-go",
      raceId: activeRace.raceId,
      playerIds: keptIds,
      players: activeRace.players.filter((player) => keptIds.includes(player.id)),
      sentAt: Date.now(),
    };

    const trimmedRace = trimRosterToIds(activeRace, keptIds);
    activeRaceRef.current = trimmedRace;
    playersRef.current = trimmedRace.players;
    applyPlayers(trimmedRace.players);
    broadcastLobbyState();
    broadcastRaceTransform(payload);
    openRaceGate(payload);
  }, [applyPlayers, broadcastLobbyState, broadcastRaceTransform, clearStallTimer, openRaceGate, trimRosterToIds]);

  const clearRaceStart = useCallback(() => setRaceStart(null), []);

  useEffect(
    () =>
      setOnlineRaceTransport({
        publishTransform: publishRaceTransform,
        publishEvent: publishRaceEvent,
        publishLoad: publishLoadProgress,
      }),
    [publishLoadProgress, publishRaceEvent, publishRaceTransform],
  );
  useEffect(() => () => destroyTransport(), [destroyTransport]);

  return {
    lobby,
    raceStart,
    raceTrackId,
    setRaceTrackId,
    createLobby,
    joinLobby,
    updateDriver,
    startRace,
    startWithoutStalled,
    clearRaceStart,
    leaveLobby,
  };
};

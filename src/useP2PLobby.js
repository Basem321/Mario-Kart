import { useCallback, useEffect, useRef, useState } from "react";
import { Peer } from "peerjs";
import { useOnlineRaceStore } from "./onlineRaceStore";
import { receiveOnlineRaceEvent, setOnlineRaceTransport } from "./onlineRaceTransport";

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

const toRaceTransform = (candidate) => {
  const x = Number(candidate?.x);
  const y = Number(candidate?.y);
  const z = Number(candidate?.z);
  const rotationY = Number(candidate?.rotationY);
  const bodyY = Number(candidate?.bodyY);

  if (![x, y, z, rotationY].every(Number.isFinite)) {
    return null;
  }

  // Ignore corrupt/hostile P2P packets that would place a visual kart far
  // outside the map or create a broken Three.js transform.
  if (Math.abs(x) > 2500 || Math.abs(y) > 500 || Math.abs(z) > 2500) {
    return null;
  }

  return {
    x,
    y,
    z,
    rotationY,
    bodyY: Number.isFinite(bodyY) ? bodyY : 0,
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

    if (!id || !position) return null;
    return {
      type: "bomb:dropped",
      bomb: {
        id,
        ...position,
        createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
      },
    };
  }

  if (candidate.type === "bomb:explode") {
    const bombId = String(candidate.bombId ?? "").slice(0, 120);
    const position = toRacePosition(candidate);
    if (!bombId || !position) return null;

    return { type: "bomb:explode", bombId, ...position };
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
  const peerRef = useRef(null);
  const guestConnectionRef = useRef(null);
  const hostConnectionsRef = useRef(new Map());
  const hostRef = useRef(false);
  const selfRef = useRef(null);
  const playersRef = useRef([]);
  const activeRaceRef = useRef(null);

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
    const message = { type: "lobby:state", players: playersRef.current };

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
    if (event.type === "bomb:carried") {
      useOnlineRaceStore.getState().setRemoteRacerCarriedBomb(playerId, event.carried);
    }

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
        const relayedEvent = stampRaceProgress(event);
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

  const destroyTransport = useCallback(() => {
    const peer = peerRef.current;
    peerRef.current = null;
    hostRef.current = false;

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
  }, []);

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
        const peer = new Peer(lobbyPeerId(code));
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
            connection.send({ type: "lobby:state", players: playersRef.current });
          } catch {
            // The close event handles failed data connections.
          }
        };

        const removePlayer = (peerId) => {
          if (peerRef.current !== peer) return;

          hostConnectionsRef.current.delete(peerId);
          useOnlineRaceStore.getState().removeRemoteRacer(peerId);
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
              const event = toRaceEvent(message.event, activeRace?.lapCount);

              if (
                !activeRace ||
                message.raceId !== activeRace.raceId ||
                !activeRace.playerIds.includes(connection.peer) ||
                !event
              ) {
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
      };

      createHostPeer();
    },
    [
      applyIncomingRaceEvent,
      applyPlayers,
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
      const peer = new Peer();
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
                startsAt: Number.isFinite(message.startsAt) ? message.startsAt : Date.now(),
                lapCount: Math.min(5, Math.max(1, Math.floor(Number(message.lapCount) || 3))),
              };
              activeRaceRef.current = race;
              useOnlineRaceStore.getState().clearRemoteRacers();
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

            if (
              activeRace &&
              message.raceId === activeRace.raceId &&
              typeof message.playerId === "string" &&
              message.playerId !== selfRef.current?.id &&
              activeRace.playerIds.includes(message.playerId) &&
              event
            ) {
              applyIncomingRaceEvent(message.playerId, event);
            }
          }

          if (message.type === "lobby:error" && typeof message.message === "string") {
            setLobby((current) => ({ ...current, status: "error", error: message.message }));
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
        });

        connection.on("close", () => {
          if (peerRef.current !== peer) return;

          setLobby((current) => ({
            ...current,
            status: "error",
            error: "The lobby host disconnected.",
          }));
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
    },
    [applyIncomingRaceEvent, applyPlayers, destroyTransport],
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

    const payload = {
      type: "lobby:race-start",
      raceId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      playerIds: players.map((player) => player.id),
      players: players.map((player) => ({ ...player })),
      lapCount,
      // Gives every browser a short window to mount the scene before the
      // shared 3-2-1 countdown begins.
      startsAt: Date.now() + 900,
    };

    const race = {
      raceId: payload.raceId,
      playerIds: payload.playerIds,
      players: payload.players,
      startsAt: payload.startsAt,
      lapCount: payload.lapCount,
    };
    activeRaceRef.current = race;
    useOnlineRaceStore.getState().clearRemoteRacers();
    setRaceStart(race);
    broadcastRaceTransform(payload);
  }, [broadcastRaceTransform]);

  const clearRaceStart = useCallback(() => setRaceStart(null), []);

  useEffect(
    () =>
      setOnlineRaceTransport({
        publishTransform: publishRaceTransform,
        publishEvent: publishRaceEvent,
      }),
    [publishRaceEvent, publishRaceTransform],
  );
  useEffect(() => () => destroyTransport(), [destroyTransport]);

  return {
    lobby,
    raceStart,
    createLobby,
    joinLobby,
    updateDriver,
    startRace,
    clearRaceStart,
    leaveLobby,
  };
};

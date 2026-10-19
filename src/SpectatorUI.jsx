import { useEffect, useMemo, useCallback } from "react";
import { useGameManager } from "./gameManager";
import { useOnlineRaceStore } from "./onlineRaceStore";
import "./SpectatorUI.css";

const DRIVER_AVATARS = {
  mario: "/images/mario.jpg",
  luigi: "/images/luigi.jpg",
};

export const SpectatorUI = () => {
  const isSpectating = useGameManager((s) => s.isSpectating);
  const spectateTargetId = useGameManager((s) => s.spectateTargetId);
  const cycleSpectateTarget = useGameManager((s) => s.cycleSpectateTarget);
  const onlinePlayers = useGameManager((s) => s.onlinePlayers);
  const onlineSelfId = useGameManager((s) => s.onlineSelfId);
  const totalLaps = useGameManager((s) => s.totalLaps);

  const remoteRaceProgress = useOnlineRaceStore((s) => s.remoteRaceProgress);
  const remoteRacers = useOnlineRaceStore((s) => s.remoteRacers);

  // Available remote racers to spectate (excluding self)
  const spectatablePlayers = useMemo(() => {
    if (!onlinePlayers?.length) return [];
    return onlinePlayers.filter((p) => p.id !== onlineSelfId);
  }, [onlinePlayers, onlineSelfId]);

  // Current spectated player object
  const currentTarget = useMemo(() => {
    if (!spectatablePlayers.length) return null;
    return (
      spectatablePlayers.find((p) => p.id === spectateTargetId) ||
      spectatablePlayers[0]
    );
  }, [spectatablePlayers, spectateTargetId]);

  const currentIndex = useMemo(() => {
    if (!currentTarget) return 0;
    const idx = spectatablePlayers.findIndex((p) => p.id === currentTarget.id);
    return idx === -1 ? 0 : idx;
  }, [spectatablePlayers, currentTarget]);

  // Target progress & status
  const targetProgress = currentTarget ? remoteRaceProgress[currentTarget.id] : null;
  const isTargetFinished = Boolean(
    targetProgress?.finished || (Number(targetProgress?.completedLaps) >= totalLaps)
  );
  const targetLaps = Math.min(
    totalLaps,
    Math.max(1, (Number(targetProgress?.completedLaps) || 0) + 1)
  );

  const handleNext = useCallback(() => {
    cycleSpectateTarget(1);
  }, [cycleSpectateTarget]);

  const handlePrev = useCallback(() => {
    cycleSpectateTarget(-1);
  }, [cycleSpectateTarget]);

  // Keyboard navigation: Space or Arrow keys
  useEffect(() => {
    if (!isSpectating) return;

    const handleKeyDown = (e) => {
      // Prevent default scrolling for arrows & space
      if (
        e.code === "Space" ||
        e.key === " " ||
        e.code === "ArrowRight" ||
        e.code === "ArrowDown"
      ) {
        e.preventDefault();
        handleNext();
      } else if (e.code === "ArrowLeft" || e.code === "ArrowUp") {
        e.preventDefault();
        handlePrev();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSpectating, handleNext, handlePrev]);

  // Auto-switch to an active unfinished racer if current target is finished/disconnected
  useEffect(() => {
    if (!isSpectating || !currentTarget) return;

    const isCurrentDisconnected = remoteRacers[currentTarget.id]?.disconnected;
    if (isTargetFinished || isCurrentDisconnected) {
      // Check if there's any racer still unfinished
      const unfinished = spectatablePlayers.find((p) => {
        const prog = remoteRaceProgress[p.id];
        const racer = remoteRacers[p.id];
        return !prog?.finished && !racer?.disconnected;
      });
      if (unfinished && unfinished.id !== currentTarget.id) {
        useGameManager.getState().setSpectateTargetId?.(unfinished.id);
      }
    }
  }, [
    isSpectating,
    currentTarget,
    isTargetFinished,
    remoteRacers,
    spectatablePlayers,
    remoteRaceProgress,
  ]);

  if (!isSpectating || !currentTarget) return null;

  const driverKey = currentTarget.driver?.toLowerCase();
  const avatarSrc = DRIVER_AVATARS[driverKey];

  return (
    <div className="spectator-hud" role="region" aria-label="Spectator Mode">
      <div className="spectator-header">
        <div className="spectator-badge">
          <span className="spectator-badge-dot" />
          <span>Spectator Mode</span>
        </div>

        <div className="spectator-card">
          {avatarSrc ? (
            <img
              src={avatarSrc}
              alt={currentTarget.name}
              className="spectator-avatar"
              draggable={false}
            />
          ) : (
            <div className="spectator-avatar-fallback">🏎️</div>
          )}

          <div className="spectator-info">
            <div className="spectator-name-row">
              <span className="spectator-name" title={currentTarget.name}>
                {currentTarget.name}
              </span>
              <span className="spectator-driver-tag">
                {currentTarget.driver || "Racer"}
              </span>
            </div>

            <div className="spectator-meta">
              {isTargetFinished ? (
                <span className="spectator-status-finished">🏁 FINISHED</span>
              ) : (
                <span className="spectator-lap">
                  Lap {targetLaps} / {totalLaps}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="spectator-footer">
        <div className="spectator-controls">
          <button
            type="button"
            className="spectator-nav-btn"
            onClick={handlePrev}
            title="Previous Racer (Arrow Left / Up)"
          >
            ◀ Prev
          </button>

          <span className="spectator-count">
            {currentIndex + 1} / {spectatablePlayers.length}
          </span>

          <button
            type="button"
            className="spectator-nav-btn"
            onClick={handleNext}
            title="Next Racer (Space / Arrow Right / Down)"
          >
            Next ▶
          </button>
        </div>

        <div className="spectator-hint">
          <span>Switch:</span>
          <span className="spectator-key-badge">SPACE</span>
          <span>or</span>
          <span className="spectator-key-badge">ARROWS</span>
          <span>• Waiting for all racers to finish</span>
        </div>
      </div>
    </div>
  );
};

export default SpectatorUI;

import { useEffect, useMemo, useState, useRef } from "react";
import { useGameManager } from "./gameManager";
import { useGameStore } from "./store";
import { useOnlineRaceStore } from "./onlineRaceStore";
import { MiniMap } from "./MiniMap";
import { OnlineRaceLeaderboard } from "./OnlineRaceLeaderboard";
import { RaceResults } from "./RaceResults";
import gsap from "gsap";
import "./GameUI.css";

const ordinalShort = (n) => {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
};

const GameUI = () => {
  const {
    isTimeTrial,
    gameStarted,
    gameOver,
    currentLap,
    totalLaps,
    bestLapTime,
    currentLapTime,
    totalTime,
    formatTime,
    returnToHomepage,
    musicVolume,
    sfxVolume,
    setMusicVolume,
    setSfxVolume,
  } = useGameManager();

  const [showGameOver, setShowGameOver] = useState(false);
  const [isPauseMenuOpen, setIsPauseMenuOpen] = useState(false);
  const [pauseTab, setPauseTab] = useState("menu"); // "menu" | "settings"

  // Force refresh for timer updates
  const [refreshKey, setRefreshKey] = useState(0);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (gameOver) {
      setIsPauseMenuOpen(false);
      const timer = setTimeout(() => {
        setShowGameOver(true);
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      setShowGameOver(false);
    }
  }, [gameOver]);

  useEffect(() => {
    if (gameStarted) {
      gsap.from(".game-ui", {
        y: -50,
        opacity: 0,
        duration: 0.5,
        ease: "power2.out",
      });
    }
  }, [gameStarted]);

  // Set up a timer to refresh the UI periodically
  useEffect(() => {
    if (gameStarted && !gameOver) {
      intervalRef.current = setInterval(() => {
        setRefreshKey((prev) => prev + 1);
      }, 100);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [gameStarted, gameOver]);

  // ESC key opens / closes the pause menu
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" || e.code === "Escape") {
        if (!gameStarted || gameOver) return;
        setIsPauseMenuOpen((prev) => {
          if (prev) {
            setPauseTab("menu");
            return false;
          }
          return true;
        });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [gameStarted, gameOver]);

  // Boost wind overlay + live online position (no extra re-render cost:
  // isBoosting/speed come from the lightweight game store).
  const isBoosting = useGameStore((s) => s.isBoosting);
  const boostSpeed = useGameStore((s) => s.speed);
  const isOnlineRace = useGameManager((s) => s.isOnlineRace);
  const onlinePlayers = useGameManager((s) => s.onlinePlayers);
  const onlineSelfId = useGameManager((s) => s.onlineSelfId);
  const lapTimesLive = useGameManager((s) => s.lapTimes);
  const remoteRaceProgress = useOnlineRaceStore((s) => s.remoteRaceProgress);

  const livePosition = useMemo(() => {
    if (!isOnlineRace || !onlinePlayers?.length) return null;
    const localCompleted = Array.isArray(lapTimesLive) ? lapTimesLive.length : 0;
    const rows = onlinePlayers
      .map((player, rosterIndex) => {
        const isSelf = player.id === onlineSelfId;
        const remote = remoteRaceProgress[player.id];
        const completed = isSelf
          ? localCompleted
          : Number(remote?.completedLaps) || 0;
        const finished = isSelf
          ? false
          : Boolean(remote?.finished);
        return { id: player.id, isSelf, rosterIndex, completed, finished };
      })
      .sort((a, b) => {
        if (b.completed !== a.completed) return b.completed - a.completed;
        if (a.finished !== b.finished) return Number(b.finished) - Number(a.finished);
        return a.rosterIndex - b.rosterIndex;
      });
    const rank = rows.findIndex((r) => r.isSelf) + 1;
    return rank > 0 ? { rank, total: rows.length } : null;
  }, [isOnlineRace, lapTimesLive, onlinePlayers, onlineSelfId, remoteRaceProgress]);

  const showWind = Boolean(isBoosting || (boostSpeed ?? 0) > 55);

  const requestReset = () => {
    window.dispatchEvent(new CustomEvent("mario-kart:reset"));
  };

  if (!gameStarted && !gameOver) return null;

  return (
    <>
      {/* Boost wind-screen overlay: vignette + speed streaks */}
      <div
        className={`boost-wind-overlay${showWind ? " active" : ""}`}
        aria-hidden="true"
      >
        <div className="wind-vignette" />
        <div className="wind-streaks" />
      </div>

      {isTimeTrial && gameStarted && !gameOver && (
        <div className="game-ui time-trial">
          <div className="time-container">
            <div className="lap-info">
              <span>LAP</span>
              <span className="lap-counter">
                {currentLap}/{totalLaps}
              </span>
            </div>
            <div className="time-item">
              <span>Lap Time:</span>
              <span className="time" key={`lap-${refreshKey}`}>
                {formatTime(currentLapTime)}
              </span>
            </div>
            <div className="time-item">
              <span>Best Lap:</span>
              <span className="time best" key={`best-${refreshKey}`}>
                {bestLapTime ? formatTime(bestLapTime) : "--:--:--"}
              </span>
            </div>
            <div className="time-item">
              <span>Total Time:</span>
              <span className="time" key={`total-${refreshKey}`}>
                {formatTime(totalTime)}
              </span>
            </div>
          </div>
          <div className="hud-corner-controls">
            <button
              type="button"
              className="esc-hud-btn"
              onClick={() => {
                setPauseTab("menu");
                setIsPauseMenuOpen(true);
              }}
              title="Pause Menu (ESC)"
            >
              <span className="esc-key-badge">ESC</span>
              <span>Menu</span>
            </button>
          </div>
        </div>
      )}

      {!isTimeTrial && gameStarted && !gameOver && (
        <div className="game-ui regular-mode">
          <div className="game-info">
            {livePosition && (
              <div className={`live-position pos-${livePosition.rank}`}>
                <span className="position-label">POS</span>
                <span className="position-value">
                  {ordinalShort(livePosition.rank)}
                  <span className="position-total">/{livePosition.total}</span>
                </span>
              </div>
            )}
            <div className="position">
              <span className="position-label">LAP</span>
              <span className="position-value">
                {currentLap}/{totalLaps}
              </span>
            </div>
            <div className="total-time">
              <span>Time</span>
              <span className="time" key={`regular-total-${refreshKey}`}>
                {formatTime(totalTime)}
              </span>
            </div>
            <div className="total-time">
              <span>Lap Time</span>
              <span className="time" key={`regular-lap-${refreshKey}`}>
                {formatTime(currentLapTime)}
              </span>
            </div>
          </div>
          <div className="hud-corner-controls">
            <button
              type="button"
              className="esc-hud-btn"
              onClick={() => {
                setPauseTab("menu");
                setIsPauseMenuOpen(true);
              }}
              title="Pause Menu (ESC)"
            >
              <span className="esc-key-badge">ESC</span>
              <span>Menu</span>
            </button>
          </div>
        </div>
      )}

      {gameStarted && !gameOver && (
        <>
          <MiniMap />
          <OnlineRaceLeaderboard />
        </>
      )}

      {/* ESC Pause & Settings Menu */}
      {isPauseMenuOpen && !gameOver && (
        <div
          className="pause-menu-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsPauseMenuOpen(false);
              setPauseTab("menu");
            }
          }}
        >
          <div className="pause-menu-modal" role="dialog" aria-modal="true">
            {pauseTab === "menu" ? (
              <>
                <div className="pause-menu-header">
                  <span className="pause-menu-kicker">GAME PAUSED</span>
                  <h2>PAUSE MENU</h2>
                  <p>Press ESC to resume</p>
                </div>
                <div className="pause-menu-actions">
                  <button
                    type="button"
                    className="pause-menu-btn resume"
                    onClick={() => setIsPauseMenuOpen(false)}
                  >
                    Resume Race
                  </button>
                  <button
                    type="button"
                    className="pause-menu-btn reset-kart"
                    onClick={() => {
                      requestReset();
                      setIsPauseMenuOpen(false);
                    }}
                  >
                    Reset Kart to Track (R)
                  </button>
                  <button
                    type="button"
                    className="pause-menu-btn settings"
                    onClick={() => setPauseTab("settings")}
                  >
                    Audio Settings
                  </button>
                  <button
                    type="button"
                    className="pause-menu-btn exit"
                    onClick={returnToHomepage}
                  >
                    Exit to Main Menu
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="pause-menu-header">
                  <span className="pause-menu-kicker">CONFIGURATION</span>
                  <h2>AUDIO SETTINGS</h2>
                  <p>Adjust music & sound volumes</p>
                </div>
                <div className="pause-settings-content">
                  <div className="settings-slider-group">
                    <div className="settings-slider-header">
                      <span>🎵 Music Volume</span>
                      <span className="volume-val">
                        {Math.round((musicVolume ?? 0.35) * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={Math.round((musicVolume ?? 0.35) * 100)}
                      onChange={(e) => setMusicVolume(Number(e.target.value) / 100)}
                      className="pause-volume-slider"
                    />
                  </div>

                  <div className="settings-slider-group">
                    <div className="settings-slider-header">
                      <span>🔊 Sound Effects (SFX)</span>
                      <span className="volume-val">
                        {Math.round((sfxVolume ?? 0.7) * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={Math.round((sfxVolume ?? 0.7) * 100)}
                      onChange={(e) => setSfxVolume(Number(e.target.value) / 100)}
                      className="pause-volume-slider"
                    />
                  </div>

                  <div className="settings-quick-actions">
                    <button
                      type="button"
                      className="pause-menu-btn secondary"
                      onClick={() => setMusicVolume((musicVolume ?? 0) > 0 ? 0 : 0.35)}
                    >
                      {(musicVolume ?? 0) > 0 ? "Mute Music" : "Unmute Music"}
                    </button>
                    <button
                      type="button"
                      className="pause-menu-btn secondary"
                      onClick={() => setSfxVolume((sfxVolume ?? 0) > 0 ? 0 : 0.7)}
                    >
                      {(sfxVolume ?? 0) > 0 ? "Mute SFX" : "Unmute SFX"}
                    </button>
                  </div>

                  <button
                    type="button"
                    className="pause-menu-btn back"
                    onClick={() => setPauseTab("menu")}
                  >
                    ← Back to Pause Menu
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showGameOver && <RaceResults />}
    </>
  );
};

export default GameUI;

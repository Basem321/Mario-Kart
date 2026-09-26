import { useEffect, useState, useRef } from "react";
import { useGameManager } from "./gameManager";
import { MiniMap } from "./MiniMap";
import { OnlineRaceLeaderboard } from "./OnlineRaceLeaderboard";
import gsap from "gsap";
import "./GameUI.css";

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

  const requestReset = () => {
    window.dispatchEvent(new CustomEvent("mario-kart:reset"));
  };

  if (!gameStarted && !gameOver) return null;

  return (
    <>
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

      {showGameOver && (
        <div className="game-over-modal">
          <div className="game-over-content">
            <h2>Game Over</h2>
            {isTimeTrial && (
              <div className="time-trial-results">
                <p className="total-time-result">
                  Total Time: <span>{formatTime(totalTime)}</span>
                </p>
                {bestLapTime && (
                  <p className="best-lap-result">
                    Best Lap: <span>{formatTime(bestLapTime)}</span>
                  </p>
                )}
              </div>
            )}
            <div className="game-over-buttons">
              <button className="retry-btn">Retry</button>
              <button className="home-btn" onClick={returnToHomepage}>
                Return to Homepage
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default GameUI;

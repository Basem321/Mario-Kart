import { useEffect, useState, useRef } from "react";
import { useGameManager } from "./gameManager";
import { useGameStore } from "./store";
import { useOnlineRaceStore } from "./onlineRaceStore";
import { ROULETTE_MS, rankOf, rouletteFrame, rowToSlot } from "./items/itemWeights";
import { itemConfig } from "./items/itemConfig.js";
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

// Roulette rows (v3 §3). PNGs exist for the models; bomb/skid/wind fall back
// to emoji until real icons land (TODO(decide) with the win effects).
const ITEM_ICON_ORDER = [
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
];

const ITEM_ICON_SRC = {
  mushroom1: "/images/items/mushroom.png",
  mushroom3: "/images/items/mushroom.png",
  golden: "/images/items/mushroom.png",
  red1: "/images/items/red-shell.png",
  red3: "/images/items/red-shell.png",
  blue: "/images/items/blue-shell.png",
  bullet: "/images/items/bullet-bill.png",
  blooper: "/images/items/blooper.png",
  bomb: null,
  skid: null,
  wind: null,
};

const ITEM_ICON_EMOJI = {
  bomb: "💣",
  skid: "🛞",
  wind: "💨",
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

  // Live position: laps first, distance driven breaks ties. Distances are
  // read unsubscribed (they change every frame); this component already
  // re-renders at 10Hz via refreshKey, so ties resolve live for free.
  const livePosition = (() => {
    if (!isOnlineRace || !onlinePlayers?.length) return null;
    const localCompleted = Array.isArray(lapTimesLive) ? lapTimesLive.length : 0;
    const gs = useGameStore.getState();
    const ors = useOnlineRaceStore.getState();
    const rows = onlinePlayers.map((player) => {
      const isSelf = player.id === onlineSelfId;
      return {
        id: player.id,
        laps: isSelf
          ? localCompleted
          : Number(ors.remoteRaceProgress[player.id]?.completedLaps) || 0,
        dist: isSelf
          ? gs.selfDistance || 0
          : ors.remoteDistances[player.id] || 0,
      };
    });
    const { position } = rankOf(rows, onlineSelfId);
    return position > 0 ? { rank: position, total: rows.length } : null;
  })();

  const showWind = Boolean(isBoosting || (boostSpeed ?? 0) > 55);

  // Blooper ink: 5s splat (0.3s in, hold, 1.0s out), ~60% coverage.
  // Visual only — aiming never changes, exactly like the wind overlay.
  const blooperUntil = useGameStore((s) => s.blooperUntil);
  const showInk = blooperUntil > performance.now();

  // Blue-shell warning: flashing icon while the target-only alarm loops.
  const blueWarning = useGameStore((s) => s.blueWarning);

  // Battle-item slot: Mario-Kart-style roulette. While a spin is active the
  // icons cycle fast→slow for ROULETTE_MS; the item appears (HUD + kart +
  // usable) only after the lock commits it to carriedItem.
  // Keyed on the spin identity — never on charges, so triple ticks don't replay.
  const carriedItem = useGameStore((s) => s.carriedItem);
  const roulette = useGameStore((s) => s.roulette);
  const spinKey = roulette
    ? `spin:${roulette.type}:${roulette.startedAt}`
    : `locked:${carriedItem?.type ?? ""}`;
  const [rouletteIcon, setRouletteIcon] = useState(null);
  useEffect(() => {
    const spin = useGameStore.getState().roulette;
    if (!spin) {
      setRouletteIcon(useGameStore.getState().carriedItem?.type ?? null);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = () => {
      const elapsed = performance.now() - start;
      if (elapsed >= ROULETTE_MS) {
        setRouletteIcon(spin.type);
        return;
      }
      setRouletteIcon(ITEM_ICON_ORDER[rouletteFrame(elapsed, ITEM_ICON_ORDER.length)]);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spinKey]);

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

      {/* Blooper ink overlay: 5s splat with fades */}
      {showInk && (
        <div className="blooper-ink-overlay" aria-hidden="true">
          <img src="/textures/ink-splat.png" alt="" draggable={false} />
        </div>
      )}

      {/* Blue-shell incoming warning (target client only) */}
      {blueWarning && (
        <div className="blue-warning" aria-live="assertive" title="Blue shell incoming!">
          <img src="/images/items/blue-shell.png" alt="Blue shell incoming!" draggable={false} />
        </div>
      )}

      {/* DEV-ONLY instant item grant (hidden in production builds) */}
      {import.meta.env.DEV && gameStarted && !gameOver && (
        <div className="item-dev-panel" aria-label="DEV item grants">
          {[
            "mushroom1", "mushroom3", "golden", "red1", "red3",
            "blue", "bullet", "blooper", "bomb",
          ].map((row) => (
            <button
              key={row}
              type="button"
              onClick={() => {
                const st = useGameStore.getState();
                if (row === "bomb") {
                  st.setCarriedBomb(true);
                  st.setCarriedItem(null);
                  return;
                }
                st.setCarriedBomb(false);
                st.setCarriedItem(rowToSlot(row, performance.now()));
              }}
            >
              {row}
            </button>
          ))}
        </div>
      )}

      {/* Battle-item slot: roulette cycling, then the locked item */}
      {rouletteIcon && (
        <div className={`item-slot${roulette ? " spinning" : ""}`} aria-live="polite">
          {ITEM_ICON_SRC[rouletteIcon] ? (
            <img
              key={rouletteIcon}
              src={ITEM_ICON_SRC[rouletteIcon]}
              alt={rouletteIcon}
              draggable={false}
              className={`item-pop${rouletteIcon === "golden" ? " gold" : ""}`}
            />
          ) : (
            <span className="item-emoji" role="img" aria-label={rouletteIcon}>
              {ITEM_ICON_EMOJI[rouletteIcon] ?? "❓"}
            </span>
          )}
          {carriedItem?.type === "mushroom" && carriedItem?.variant === "triple" && (
            <span className="item-charges">×{carriedItem.usesLeft}</span>
          )}
          {carriedItem?.type === "golden" && (
            <span className="item-charges">
              {carriedItem.windowUntil == null
                ? `${Math.ceil(itemConfig.golden.windowMs / 1000)}s`
                : `${Math.max(0, Math.ceil((carriedItem.windowUntil - performance.now()) / 1000))}s`}
            </span>
          )}
        </div>
      )}

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

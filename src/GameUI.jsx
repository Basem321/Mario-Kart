import { useEffect, useState, useRef } from "react";
import { useGameManager } from "./gameManager";
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
  } = useGameManager();

  const [showGameOver, setShowGameOver] = useState(false);

  // Force refresh for timer updates
  const [refreshKey, setRefreshKey] = useState(0);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (gameOver) {
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
        ease: "power2.out"
      });
    }
  }, [gameStarted]);

  // Set up a timer to refresh the UI periodically
  useEffect(() => {
    if (gameStarted && !gameOver) {
      // Refresh UI every 100ms to ensure timers update
      intervalRef.current = setInterval(() => {
        setRefreshKey(prev => prev + 1);
      }, 100);
    }
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [gameStarted, gameOver]);

  if (!gameStarted && !gameOver) return null;

  return (
    <>
      {isTimeTrial && gameStarted && !gameOver && (
        <div className="game-ui time-trial">
          <div className="time-container">
            <div className="lap-info">
              <span>LAP</span>
              <span className="lap-counter">{currentLap}/{totalLaps}</span>
            </div>
            <div className="time-item">
              <span>Lap Time:</span>
              <span className="time" key={`lap-${refreshKey}`}>{formatTime(currentLapTime)}</span>
            </div>
            <div className="time-item">
              <span>Best Lap:</span>
              <span className="time best" key={`best-${refreshKey}`}>{bestLapTime ? formatTime(bestLapTime) : "--:--:--"}</span>
            </div>
            <div className="time-item">
              <span>Total Time:</span>
              <span className="time" key={`total-${refreshKey}`}>{formatTime(totalTime)}</span>
            </div>
          </div>
          <div className="game-controls">
            <button className="game-btn" onClick={returnToHomepage}>Exit</button>
            <button className="game-btn reset">Reset</button>
          </div>
        </div>
      )}

      {!isTimeTrial && gameStarted && !gameOver && (
        <div className="game-ui regular-mode">
          <div className="game-info">
            <div className="position">
              <span className="position-label">LAP</span>
              <span className="position-value">{currentLap}/{totalLaps}</span>
            </div>
            <div className="total-time">
              <span>Time</span>
              <span className="time" key={`regular-total-${refreshKey}`}>{formatTime(totalTime)}</span>
            </div>
            <div className="total-time">
              <span>Lap Time</span>
              <span className="time" key={`regular-lap-${refreshKey}`}>{formatTime(currentLapTime)}</span>
            </div>
          </div>
          <div className="game-controls">
            <button className="game-btn" onClick={returnToHomepage}>Exit</button>
            <button className="game-btn reset">Reset</button>
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

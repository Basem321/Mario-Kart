import { useEffect, useMemo, useRef } from "react";
import { useGameManager } from "./gameManager";
import { useOnlineRaceStore } from "./onlineRaceStore";
import "./RaceResults.css";

const ordinal = (n) => {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
};

const medal = (n) => {
  if (n === 1) return "🥇";
  if (n === 2) return "🥈";
  if (n === 3) return "🥉";
  return "🏁";
};

export function RaceResults() {
  const isOnlineRace = useGameManager((s) => s.isOnlineRace);
  const isTimeTrial = useGameManager((s) => s.isTimeTrial);
  const totalLaps = useGameManager((s) => s.totalLaps);
  const lapTimes = useGameManager((s) => s.lapTimes);
  const bestLapTime = useGameManager((s) => s.bestLapTime);
  const totalTime = useGameManager((s) => s.totalTime);
  const formatTime = useGameManager((s) => s.formatTime);
  const returnToHomepage = useGameManager((s) => s.returnToHomepage);
  const players = useGameManager((s) => s.onlinePlayers);
  const selfId = useGameManager((s) => s.onlineSelfId);
  const gameOver = useGameManager((s) => s.gameOver);
  const remoteRaceProgress = useOnlineRaceStore((s) => s.remoteRaceProgress);

  const standings = useMemo(() => {
    if (!isOnlineRace || !players?.length) return null;
    const localCompleted = Array.isArray(lapTimes) ? lapTimes.length : 0;
    return players
      .map((player, rosterIndex) => {
        const isSelf = player.id === selfId;
        const remote = remoteRaceProgress[player.id];
        const progress = isSelf
          ? {
              completedLaps: localCompleted,
              finished: gameOver && localCompleted >= totalLaps,
            }
          : (remote ?? { completedLaps: 0, finished: false });
        return {
          id: player.id,
          name: player.name || "Player",
          driver: player.driver,
          isSelf,
          rosterIndex,
          completedLaps: Math.min(
            totalLaps,
            Math.max(0, Number(progress.completedLaps) || 0),
          ),
          finished: Boolean(progress.finished),
          completedAt: Number.isFinite(progress.completedAt)
            ? progress.completedAt
            : Infinity,
        };
      })
      .sort((a, b) => {
        if (b.completedLaps !== a.completedLaps)
          return b.completedLaps - a.completedLaps;
        if (a.finished !== b.finished)
          return Number(b.finished) - Number(a.finished);
        if (a.completedAt !== b.completedAt)
          return a.completedAt - b.completedAt;
        return a.rosterIndex - b.rosterIndex;
      });
  }, [gameOver, isOnlineRace, lapTimes, players, remoteRaceProgress, selfId, totalLaps]);

  const selfRank = standings
    ? standings.findIndex((r) => r.isSelf) + 1
    : 1;

  // Result jingle: top 3 hear the winning sound, everyone below hears the
  // losing sound. Plays once when the results appear.
  const resultSoundPlayedRef = useRef(false);
  useEffect(() => {
    if (resultSoundPlayedRef.current) return;
    resultSoundPlayedRef.current = true;
    const gm = useGameManager.getState();
    const rawVol = Number(gm.sfxVolume);
    const vol = Number.isFinite(rawVol) ? Math.max(0, Math.min(1, rawVol)) : 0.7;
    const topThree = selfRank >= 1 && selfRank <= 3;
    const sound =
      (topThree ? gm.winningSound : gm.gameOverSound) ??
      new Audio(topThree ? "./music/winning_sound.mp3" : "./music/game-over.wav");
    try {
      sound.volume = vol;
      sound.currentTime = 0;
      sound.play().catch(() => {});
    } catch {
      // ignore — missing codec / autoplay block must not break results
    }
    return () => {
      try {
        sound.pause();
      } catch {
        // ignore
      }
    };
  }, [selfRank]);

  const handleRetry = () => {
    // Stop the result jingle if the player retries while it's still playing.
    const gmState = useGameManager.getState();
    try {
      gmState.winningSound?.pause();
      gmState.gameOverSound?.pause();
    } catch {
      // ignore
    }
    // Offline only: restart the same mode instantly.
    // Online races are host-driven, so retry returns to menu.
    if (isOnlineRace) {
      returnToHomepage();
      return;
    }
    const gm = useGameManager.getState();
    gm.startGame(isTimeTrial);
    window.setTimeout(() => gm.startCountdown(), 100);
  };

  const title = isOnlineRace
    ? selfRank === 1
      ? "VICTORY!"
      : `FINISHED ${ordinal(selfRank).toUpperCase()}`
    : isTimeTrial
      ? "TIME TRIAL COMPLETE!"
      : "RACE COMPLETE!";

  const subtitle = isOnlineRace
    ? `You finished ${ordinal(selfRank)} of ${standings?.length ?? 1}`
    : `${totalLaps} ${totalLaps === 1 ? "lap" : "laps"} completed`;

  return (
    <div className="race-results-backdrop" role="dialog" aria-modal="true" aria-label="Race results">
      <div className="race-results-modal">
        <div className="race-results-header">
          <span className="race-results-kicker">
            {isOnlineRace ? "ONLINE RACE • FINAL STANDINGS" : isTimeTrial ? "TIME TRIAL • FINAL RESULTS" : "RACE • FINAL RESULTS"}
          </span>
          <div className={`race-results-place pos-${selfRank}`}>
            <span className="place-medal">{medal(selfRank)}</span>
            <span className="place-ordinal">{ordinal(selfRank)}</span>
            {isOnlineRace && <span className="place-of">/ {standings?.length ?? 1}</span>}
          </div>
          <h2 className={`race-results-title rank-${selfRank}`}>{title}</h2>
          <p className="race-results-subtitle">{subtitle}</p>
        </div>

        <div className="race-results-stats">
          <div className="rr-stat">
            <span className="rr-stat-label">Total Time</span>
            <span className="rr-stat-value">{formatTime(totalTime)}</span>
          </div>
          <div className="rr-stat highlight">
            <span className="rr-stat-label">Best Lap</span>
            <span className="rr-stat-value">
              {bestLapTime ? formatTime(bestLapTime) : "--:--.--"}
            </span>
          </div>
          <div className="rr-stat">
            <span className="rr-stat-label">Laps</span>
            <span className="rr-stat-value">
              {lapTimes?.length ?? 0}/{totalLaps}
            </span>
          </div>
        </div>

        {isOnlineRace && standings ? (
          <ol className="race-results-standings">
            {standings.map((racer, index) => (
              <li
                key={racer.id}
                className={`rr-row pos-${index + 1}${racer.isSelf ? " self" : ""}`}
              >
                <span className="rr-pos">{ordinal(index + 1)}</span>
                <span className="rr-medal">{medal(index + 1)}</span>
                <span className="rr-name" title={racer.name}>
                  {racer.name}
                  {racer.isSelf && <span className="rr-you">YOU</span>}
                </span>
                <span className="rr-laps">
                  {racer.finished ? (
                    <span className="rr-finished">FINISHED</span>
                  ) : (
                    `${racer.completedLaps}/${totalLaps}`
                  )}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          lapTimes?.length > 0 && (
            <ol className="race-results-laps">
              {lapTimes.map((t, i) => (
                <li key={i} className={`rr-lap-row${t === bestLapTime ? " best" : ""}`}>
                  <span className="rr-lap-label">LAP {i + 1}</span>
                  <span className="rr-lap-time">{formatTime(t)}</span>
                  {t === bestLapTime && <span className="rr-best-badge">BEST</span>}
                </li>
              ))}
            </ol>
          )
        )}

        <div className="race-results-actions">
          {!isOnlineRace && (
            <button type="button" className="rr-btn retry" onClick={handleRetry}>
              ↻ Race Again
            </button>
          )}
          <button type="button" className="rr-btn home" onClick={returnToHomepage}>
            {isOnlineRace ? "Back to Menu" : "Return to Homepage"}
          </button>
        </div>
        {isOnlineRace && (
          <p className="race-results-note">Ask the host to start a new race from the lobby.</p>
        )}
      </div>
    </div>
  );
}

export default RaceResults;

import { useMemo } from "react";
import { useGameManager } from "./gameManager";
import { useOnlineRaceStore } from "./onlineRaceStore";
import "./OnlineRaceLeaderboard.css";

const completedLapCount = (lapTimes) =>
  Array.isArray(lapTimes) ? lapTimes.length : 0;

const lapLabel = (count) => `${count} ${count === 1 ? "lap" : "laps"}`;

/**
 * Online-only race standings. Lap completions arrive through the reliable P2P
 * event channel; transforms remain independent so this never affects kart
 * interpolation or the game loop.
 */
export function OnlineRaceLeaderboard() {
  const isOnlineRace = useGameManager((state) => state.isOnlineRace);
  const gameStarted = useGameManager((state) => state.gameStarted);
  const totalLaps = useGameManager((state) => state.totalLaps);
  const currentLap = useGameManager((state) => state.currentLap);
  const lapTimes = useGameManager((state) => state.lapTimes);
  const gameOver = useGameManager((state) => state.gameOver);
  const selfId = useGameManager((state) => state.onlineSelfId);
  const players = useGameManager((state) => state.onlinePlayers);
  const remoteRaceProgress = useOnlineRaceStore((state) => state.remoteRaceProgress);

  const standings = useMemo(() => {
    const localCompletedLaps = completedLapCount(lapTimes);

    return players
      .map((player, rosterIndex) => {
        const isSelf = player.id === selfId;
        const remote = remoteRaceProgress[player.id];
        const progress = isSelf
          ? {
              completedLaps: localCompletedLaps,
              currentLap,
              finished: gameOver && localCompletedLaps >= totalLaps,
            }
          : remote ?? { completedLaps: 0, currentLap: 1, finished: false };

        return {
          id: player.id,
          name: player.name || "Player",
          isSelf,
          rosterIndex,
          completedLaps: Math.min(totalLaps, Math.max(0, Number(progress.completedLaps) || 0)),
          finished: Boolean(progress.finished),
          completedAt: Number.isFinite(progress.completedAt) ? progress.completedAt : Infinity,
        };
      })
      .sort((a, b) => {
        if (b.completedLaps !== a.completedLaps) return b.completedLaps - a.completedLaps;
        if (a.finished !== b.finished) return Number(b.finished) - Number(a.finished);
        if (a.completedAt !== b.completedAt) return a.completedAt - b.completedAt;
        return a.rosterIndex - b.rosterIndex;
      });
  }, [currentLap, gameOver, lapTimes, players, remoteRaceProgress, selfId, totalLaps]);

  if (!isOnlineRace || !gameStarted || standings.length === 0) return null;

  return (
    <aside className="online-leaderboard" aria-label="Online race leaderboard">
      <div className="online-leaderboard-heading">
        <span className="online-leaderboard-kicker">Online race</span>
        <h2>Leaderboard</h2>
      </div>
      <ol className="online-leaderboard-list">
        {standings.map((racer, index) => (
          <li
            key={racer.id}
            className={`online-leaderboard-row ${index === 0 ? "leader" : ""} ${
              racer.isSelf ? "self" : ""
            }`}
          >
            <span className="online-leaderboard-place">{index + 1}</span>
            <span className="online-leaderboard-name" title={racer.name}>
              {racer.name}
              {racer.isSelf && <small>You</small>}
            </span>
            <span className="online-leaderboard-laps">
              {lapLabel(racer.completedLaps)}{racer.finished ? " ✓" : ""}
            </span>
          </li>
        ))}
      </ol>
      <p className="online-leaderboard-footer">Completed laps / {totalLaps}</p>
    </aside>
  );
}

export default OnlineRaceLeaderboard;

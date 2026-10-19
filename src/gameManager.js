import { create } from "zustand";
import { useGameStore } from "./store";
import { useOnlineRaceStore } from "./onlineRaceStore";

// Helper to determine if all online racers have finished or disconnected
export const checkAllOnlineRacersFinished = ({
  onlinePlayers,
  onlineSelfId,
  localCompletedLaps,
  totalLaps,
}) => {
  if (!onlinePlayers || onlinePlayers.length === 0) return true;
  const remoteProgress = useOnlineRaceStore.getState().remoteRaceProgress;
  const remoteRacers = useOnlineRaceStore.getState().remoteRacers;

  for (const player of onlinePlayers) {
    if (player.id === onlineSelfId) {
      if (localCompletedLaps < totalLaps) return false;
    } else {
      const racer = remoteRacers[player.id];
      if (racer?.disconnected) continue;
      const prog = remoteProgress[player.id];
      const isFinished = Boolean(prog?.finished) || (Number(prog?.completedLaps) >= totalLaps);
      if (!isFinished) return false;
    }
  }
  return true;
};

// One shared AudioContext for all sessions. Creating a new context per
// entry leaks them (browsers cap ~6) and eventually kills all audio.
let sharedAudioContext = null;
const ensureAudioContext = () => {
  try {
    if (!sharedAudioContext || sharedAudioContext.state === "closed") {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      sharedAudioContext = new AC();
    }
    // Resume on user interaction (required by some browsers)
    if (sharedAudioContext.state === "suspended") {
      sharedAudioContext.resume().catch(() => {});
    }
  } catch {
    console.warn("Web Audio API not supported in this browser");
  }
  return sharedAudioContext;
};

// Countdown timers live at module level so a restart ("Race Again") or the
// end of a race can cancel them. Without this a stale 3-2-1 from the previous
// session keeps ticking and can start a second countdown / flip gameStarted
// behind the results screen.
let countdownTimers = { poll: null, interval: null, go: null, verify: null };
const clearCountdownTimers = () => {
  window.clearTimeout(countdownTimers.poll);
  window.clearInterval(countdownTimers.interval);
  window.clearTimeout(countdownTimers.go);
  window.clearTimeout(countdownTimers.verify);
  countdownTimers = { poll: null, interval: null, go: null, verify: null };
};

export const useGameManager = create((set, get) => ({
  // Game state
  isPlaying: false,
  isTimeTrial: false,
  gameStarted: false,
  gameOver: false,
  // Spectator mode for online races
  isSpectating: false,
  spectateTargetId: null,
  startSpectating: (targetId = null) => {
    const { onlinePlayers, onlineSelfId } = get();
    const otherPlayers = onlinePlayers.filter((p) => p.id !== onlineSelfId);
    const remoteProgress = useOnlineRaceStore.getState().remoteRaceProgress;
    const remoteRacers = useOnlineRaceStore.getState().remoteRacers;

    let picked = null;
    if (targetId && otherPlayers.some((p) => p.id === targetId)) {
      picked = targetId;
    } else {
      const unfinished = otherPlayers.find((p) => {
        const prog = remoteProgress[p.id];
        const racer = remoteRacers[p.id];
        return !prog?.finished && !racer?.disconnected;
      });
      picked = unfinished ? unfinished.id : (otherPlayers[0]?.id ?? null);
    }

    set({
      isSpectating: true,
      spectateTargetId: picked,
    });
  },
  stopSpectating: () => {
    set({
      isSpectating: false,
      spectateTargetId: null,
    });
  },
  // Used by SpectatorUI to auto-switch when the watched racer finishes or
  // disconnects. Only known remote players are accepted.
  setSpectateTargetId: (targetId) => {
    const { onlinePlayers, onlineSelfId } = get();
    if (
      onlinePlayers.some((p) => p.id === targetId && p.id !== onlineSelfId)
    ) {
      set({ spectateTargetId: targetId });
    }
  },
  cycleSpectateTarget: (direction = 1) => {
    const { onlinePlayers, onlineSelfId, spectateTargetId } = get();
    const otherPlayers = onlinePlayers.filter((p) => p.id !== onlineSelfId);
    if (otherPlayers.length === 0) return;

    const currentIndex = otherPlayers.findIndex((p) => p.id === spectateTargetId);
    let nextIndex;
    if (currentIndex === -1) {
      nextIndex = 0;
    } else {
      nextIndex = (currentIndex + direction + otherPlayers.length) % otherPlayers.length;
    }
    set({ spectateTargetId: otherPlayers[nextIndex].id });
  },
  returnToLobby: () => {
    const { backgroundMusic, winningSound, gameOverSound } = get();
    try {
      backgroundMusic?.pause();
      if (backgroundMusic) backgroundMusic.currentTime = 0;
      winningSound?.pause();
      gameOverSound?.pause();
    } catch {
      // ignore pause errors if audio was never started
    }

    useGameStore.getState().resetBattleState();
    useOnlineRaceStore.getState().clearLoadGate();
    useOnlineRaceStore.getState().clearRemoteRacers();

    set({
      isPlaying: false,
      gameStarted: false,
      gameOver: false,
      isPaused: false,
      showHomepage: true,
      isSpectating: false,
      spectateTargetId: null,
      currentLapTime: 0,
      currentLap: 1,
      totalTime: 0,
      lapTimes: [],
      bestLapTime: null,
    });
  },
  // Bumped every startGame: physics/visuals re-seat the kart on the grid so
  // "Race Again" never inherits the previous run's position, speed or drift.
  sessionId: 0,
  // True pause (offline only): freezes physics, items, timers and lap clock
  // while the pause menu is open. Online races never pause — the menu there
  // is informational and the race continues for everyone.
  isPaused: false,
  setPaused: (isPaused) => set({ isPaused: Boolean(isPaused) }),
  showHomepage: true,
  countdown: 3,
  // Chosen driver: 'mario' | 'luigi' (picked on the character screen)
  selectedDriver: 'mario',
  setDriver: (selectedDriver) => set({ selectedDriver }),
  // Chosen course id (see tracks.js). Picked on the track screen / lobby.
  selectedTrackId: 'mario-circuit',
  setTrackId: (selectedTrackId) => {
    if (typeof selectedTrackId === 'string' && selectedTrackId) {
      set({ selectedTrackId });
    }
  },
  // Online race settings are assigned by the lobby host's shared start event.
  isOnlineRace: false,
  onlineSpawnIndex: 0,
  onlinePlayerIds: [],
  onlineSelfId: "",
  onlinePlayers: [],
  onlineRaceId: null,
  
  // Audio
  backgroundMusic: null,
  gameStartSound: null,
  gameOverSound: null,
  winningSound: null,
  musicVolume: 0.35,
  sfxVolume: 0.7,
  setMusicVolume: (volume) => {
    const nextVolume = Math.max(0, Math.min(1, Number(volume) || 0));
    set({ musicVolume: nextVolume });
    const bgm = get().backgroundMusic;
    if (bgm) {
      bgm.volume = nextVolume;
    }
  },
  setSfxVolume: (volume) => {
    const nextVolume = Math.max(0, Math.min(1, Number(volume) || 0));
    set({ sfxVolume: nextVolume });
  },
  
  // Time trial data
  lapTimes: [],
  bestLapTime: null,
  currentLapTime: 0,
  currentLap: 0,
  totalLaps: 3,
  totalTime: 0,
  
  // Direct setters for emergency use
  setGameStarted: () => set({ gameStarted: true, countdown: -1 }),
  
  // Game control functions
  startGame: (isTimeTrial = false, onlineOptions = {}) => {
    // A previous session's countdown must never tick into this one.
    clearCountdownTimers();
    // Fresh battle state every run (boxes/bombs/explosions/stun).
    useGameStore.getState().resetBattleState();
    // Stop the previous session's tracks: startGame used to leak 4 new
    // Audio elements per call, stacking background music on every retry.
    for (const key of ["backgroundMusic", "gameStartSound", "gameOverSound", "winningSound"]) {
      try {
        get()[key]?.pause();
      } catch {
        // ignore — element may already be gone
      }
    }
    const currentMusicVolume = get().musicVolume ?? 0.35;
    const currentSfxVolume = get().sfxVolume ?? 0.7;

    // Preload audio files (absolute paths — relative ./music/ breaks under
    // nested routes and duplicates cache entries).
    const backgroundMusic = new Audio('/music/Mario Kart Wii OST.mp3');
    backgroundMusic.loop = true;
    backgroundMusic.volume = currentMusicVolume;
    // Preload audio to prevent delayed playback
    backgroundMusic.preload = 'auto';
    backgroundMusic.load();
    
    const gameStartSound = new Audio('/music/level-completed.wav');
    gameStartSound.volume = Math.max(0, Math.min(1, 0.5 * currentSfxVolume));
    gameStartSound.preload = 'auto';
    gameStartSound.load();
    
    const gameOverSound = new Audio('/music/game-over.wav');
    gameOverSound.volume = Math.max(0, Math.min(1, 0.5 * currentSfxVolume));
    gameOverSound.preload = 'auto';
    gameOverSound.load();

    const winningSound = new Audio('/music/winning_sound.mp3');
    winningSound.volume = Math.max(0, Math.min(1, currentSfxVolume));
    winningSound.preload = 'auto';
    winningSound.load();
    
    // Add event listeners to handle audio playback issues
    backgroundMusic.addEventListener('canplaythrough', () => {
      if (import.meta.env.DEV) console.log('Background music ready to play');
    });
    
    gameStartSound.addEventListener('canplaythrough', () => {
      if (import.meta.env.DEV) console.log('Start sound ready to play');
    });
    
    // Setup audio context to ensure audio can play (fixes iOS/Safari issues)
    ensureAudioContext();
    
    const isOnlineRace = Boolean(onlineOptions?.online);
    const onlineSpawnIndex = Number.isInteger(onlineOptions?.spawnIndex)
      ? Math.max(0, onlineOptions.spawnIndex)
      : 0;
    const onlinePlayerIds = Array.isArray(onlineOptions?.playerIds)
      ? onlineOptions.playerIds.filter((id) => typeof id === 'string')
      : [];
    const onlineSelfId = typeof onlineOptions?.selfId === 'string'
      ? onlineOptions.selfId
      : '';
    const onlineRaceId = typeof onlineOptions?.raceId === 'string'
      ? onlineOptions.raceId
      : null;
    const onlinePlayers = Array.isArray(onlineOptions?.players)
      ? onlineOptions.players.filter(
          (player) =>
            player &&
            typeof player.id === 'string' &&
            typeof player.name === 'string' &&
            (player.driver === 'mario' || player.driver === 'luigi'),
        )
      : [];
    const requestedLapCount = Math.floor(Number(onlineOptions?.lapCount) || 3);
    const totalLaps = Math.min(5, Math.max(1, requestedLapCount));

    // Apply performance optimizations for time trial mode
    if (import.meta.env.DEV) console.log(`Starting game in ${isOnlineRace ? 'Online Race' : isTimeTrial ? 'Time Trial' : 'Regular'} mode`);
    
    set({
      isPlaying: true,
      isTimeTrial, 
      gameStarted: false,
      gameOver: false,
      isPaused: false,
      sessionId: get().sessionId + 1,
      showHomepage: false,
      countdown: 3,
      backgroundMusic,
      gameStartSound,
      gameOverSound,
      winningSound,
      totalTime: 0,
      currentLapTime: 0,
      currentLap: 1,
      totalLaps,
      lapTimes: [],
      isSpectating: false,
      spectateTargetId: null,
      // Add specific time trial performance settings
      timeTrialPerformanceMode: isTimeTrial,
      isOnlineRace,
      onlineSpawnIndex,
      onlinePlayerIds,
      onlineSelfId,
      onlinePlayers,
      onlineRaceId,
    });
  },
  
  startCountdown: () => {
    clearCountdownTimers();
    set({ countdown: 3 });
  },
  
  endGame: () => {
    clearCountdownTimers();
    const { backgroundMusic } = get();

    if (backgroundMusic) {
      backgroundMusic.pause();
      backgroundMusic.currentTime = 0;
    }

    // Result jingle is played by RaceResults based on final position:
    // top 3 hear winning_sound, the rest hear game-over.
    set({
      gameOver: true,
      isPlaying: false,
      isSpectating: false,
      spectateTargetId: null,
    });
  },
  
  returnToHomepage: () => {
    // Full page refresh: guarantees a clean slate (fresh WebGL context,
    // GPU memory, JS heap) so re-entering never inherits a degraded state.
    window.location.reload();
  },
  
  // Time trial functions
  startLap: () => {
    set({
      currentLapTime: 0,
      currentLap: get().currentLap + 1
    });
  },
  
  endLap: (lapTime) => {
    const { lapTimes, bestLapTime } = get();
    
    // Ensure lapTime is valid
    if (isNaN(lapTime) || lapTime <= 0) {
      console.warn("Invalid lap time:", lapTime);
      return;
    }
    
    const newLapTimes = [...lapTimes, lapTime];
    
    set({
      lapTimes: newLapTimes,
      bestLapTime: bestLapTime === null || lapTime < bestLapTime ? lapTime : bestLapTime
    });
  },

  // FinishLine calls this single action instead of chaining endLap() and
  // startLap(). Keeping the result in one Zustand update prevents a frame
  // from observing a recorded lap while the counter is still unchanged.
  completeLap: (lapTime) => {
    const state = get();
    const validLapTime = Number(lapTime);

    if (!state.gameStarted || state.gameOver || !Number.isFinite(validLapTime) || validLapTime <= 0) {
      return { counted: false, finished: false };
    }

    const completedLap = state.currentLap;
    const nextLapTimes = [...state.lapTimes, validLapTime];
    const finished = completedLap >= state.totalLaps;

    set({
      lapTimes: nextLapTimes,
      bestLapTime:
        state.bestLapTime === null || validLapTime < state.bestLapTime
          ? validLapTime
          : state.bestLapTime,
      currentLap: finished ? completedLap : completedLap + 1,
      currentLapTime: 0,
    });

    if (finished) {
      if (state.isOnlineRace) {
        const allDone = checkAllOnlineRacersFinished({
          onlinePlayers: state.onlinePlayers,
          onlineSelfId: state.onlineSelfId,
          localCompletedLaps: nextLapTimes.length,
          totalLaps: state.totalLaps,
        });
        if (allDone) {
          get().endGame();
        } else {
          get().startSpectating();
        }
      } else {
        get().endGame();
      }
    }

    return { counted: true, completedLap, finished };
  },
  
  updateLapTime: (delta) => {
    if (get().gameStarted && !get().gameOver && !get().isPaused) {
      // Ensure delta is a valid number
      const validDelta = isNaN(delta) ? 0 : delta;
      
      if (validDelta < 0) {
        return; // Don't update with negative values
      }
      
      // Update lap times with validated delta
      set(state => ({
        currentLapTime: state.currentLapTime + validDelta,
        totalTime: state.totalTime + validDelta
      }));
    }
  },
  
  formatTime: (milliseconds) => {
    // Ensure milliseconds is a valid number
    const validMs = isNaN(milliseconds) ? 0 : milliseconds;
    
    const totalSeconds = Math.floor(validMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const ms = Math.floor((validMs % 1000) / 10);
    
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  }
}));

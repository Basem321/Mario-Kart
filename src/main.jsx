import "./dracoSetup.js";
import { useEffect, useState, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from './ErrorBoundary.jsx'
import './index.css'
import { WebGPUCanvas } from './WebGPUCanvas.jsx'
import { MobileControls } from './mobile/MobileControls.jsx'
import { LoadingScreen } from './LoadingScreen.jsx'
import HomePage from './HomePage.jsx'
import CharacterSelect from './CharacterSelect.jsx'
import TrackSelect from './TrackSelect.jsx'
import LobbyScreen from './LobbyScreen.jsx'
import GameUI from './GameUI.jsx'
import GameReadyCheck from './GameReadyCheck.jsx'
import { PwaUpdateToast } from './PwaUpdateToast.jsx'
import { useGameManager } from './gameManager.js'
import { useP2PLobby } from './useP2PLobby.js'
import { useOnlineRaceStore } from './onlineRaceStore.js'
import { useGameStore } from './store.js'
import { publishOnlineRaceEvent } from './onlineRaceTransport.js'
import { isKnownTrackId } from './tracks.js'

// DEV-ONLY online debug handle for the two-player Playwright check
// (scripts/online-two-player.mjs): lets the script read zustand state and
// publish through the REAL transport (validators + receivers stay in the
// path). Never ships — import.meta.env.DEV is false in production builds.
if (import.meta.env.DEV) {
  window.__onlineRace = {
    selfId: () => useGameManager.getState().onlineSelfId,
    remoteRacers: () => useOnlineRaceStore.getState().remoteRacers,
    remoteRaceProgress: () => useOnlineRaceStore.getState().remoteRaceProgress,
    remoteDistances: () => useOnlineRaceStore.getState().remoteDistances,
    carriedItem: () => useGameStore.getState().carriedItem,
    setCarriedItem: (item) => useGameStore.getState().setCarriedItem(item),
    activeShells: () => useGameStore.getState().activeShells,
    blueWarning: () => useGameStore.getState().blueWarning,
    spin: () => useGameStore.getState().spin,
    publish: publishOnlineRaceEvent,
  };
}

// Decoder path is configured in ./dracoSetup.js (first import above) so that
// module-level preloads use the vendored /draco/ WASM even offline.

const Root = () => {
  // Selectors only: a full-store subscription re-renders the entire root
  // (homepage + canvas container) on every lap-timer tick, i.e. 60fps.
  const showHomepage = useGameManager((s) => s.showHomepage);
  const startGame = useGameManager((s) => s.startGame);
  const startCountdown = useGameManager((s) => s.startCountdown);
  const gameStarted = useGameManager((s) => s.gameStarted);
  const setDriver = useGameManager((s) => s.setDriver);
  const setTrackId = useGameManager((s) => s.setTrackId);
  // Pre-race load gate: the shared 3-2-1 may only begin once race-go says
  // every browser finished loading the course (or the host started anyway).
  const raceGo = useOnlineRaceStore((s) => s.raceGo);

  // Chosen right after the homepage countdown, before the race starts.
  const [pendingMode, setPendingMode] = useState(null); // null | 'regular' | 'trial'
  // Course picker shown before the character screen (offline modes only;
  // online races use the host's lobby track instead).
  const [pendingTrackFor, setPendingTrackFor] = useState(null); // null | 'regular' | 'trial'
  const [onlineLobbyOpen, setOnlineLobbyOpen] = useState(false);
  const [onlinePlayerIntent, setOnlinePlayerIntent] = useState(null);
  const p2pLobby = useP2PLobby();

  // The host broadcasts this one shared event. Every browser starts its own
  // local race with the same roster order, so each player receives a fair,
  // nearby starting-grid slot.
  useEffect(() => {
    const raceStart = p2pLobby.raceStart;
    const self = p2pLobby.lobby.self;

    if (!raceStart || !self?.id) return;

    const spawnIndex = raceStart.playerIds.indexOf(self.id);
    if (spawnIndex === -1) {
      p2pLobby.clearRaceStart();
      return;
    }

    setDriver(self.driver ?? 'mario');
    // Every browser loads the host's course so spawns, walls and laps match.
    if (isKnownTrackId(raceStart.trackId)) {
      setTrackId(raceStart.trackId);
    }
    startGame(false, {
      online: true,
      spawnIndex,
      playerIds: raceStart.playerIds,
      selfId: self.id,
      players: raceStart.players,
      raceId: raceStart.raceId,
      lapCount: raceStart.lapCount,
    });
    p2pLobby.clearRaceStart();
  // Deliberately field-level deps: p2pLobby itself is a fresh object every
  // render, so depending on it would re-fire the race start endlessly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    p2pLobby.raceStart,
    p2pLobby.lobby.self?.id,
    p2pLobby.lobby.self?.driver,
    p2pLobby.clearRaceStart,
    setDriver,
    setTrackId,
    startGame,
  ]);

  // Countdown opens only on race-go — never on a timer. Offline flows call
  // startCountdown themselves; the online handshake reaches here.
  useEffect(() => {
    if (!raceGo) return;
    startCountdown();
  }, [raceGo, startCountdown]);

  // Initialize audio context on user interaction
  useEffect(() => {
    // Create a function to initialize audio
    const initAudio = () => {
      try {
        // Create audio context to unlock audio on iOS/Safari
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          const audioCtx = new AudioContext();
          // Create and play a silent buffer to unlock audio
          const buffer = audioCtx.createBuffer(1, 1, 22050);
          const source = audioCtx.createBufferSource();
          source.buffer = buffer;
          source.connect(audioCtx.destination);
          source.start(0);
          
          // Resume audio context if suspended
          if (audioCtx.state === 'suspended') {
            audioCtx.resume();
          }
        }
      } catch {
        // Web Audio API not supported — game continues muted
      }
      
      // Remove event listeners once audio is initialized
      document.removeEventListener('click', initAudio);
      document.removeEventListener('touchstart', initAudio);
      document.removeEventListener('keydown', initAudio);
    };
    
    // Add event listeners for user interaction
    document.addEventListener('click', initAudio);
    document.addEventListener('touchstart', initAudio);
    document.addEventListener('keydown', initAudio);
    
    return () => {
      // Clean up listeners
      document.removeEventListener('click', initAudio);
      document.removeEventListener('touchstart', initAudio);
      document.removeEventListener('keydown', initAudio);
    };
  }, []);

  const handlePickDriver = (driver) => {
    if (pendingMode === 'online') {
      setDriver(driver);
      if (onlinePlayerIntent?.type === 'join') {
        p2pLobby.joinLobby(onlinePlayerIntent.name, onlinePlayerIntent.code, driver);
      } else {
        p2pLobby.updateDriver(driver);
      }

      setPendingMode(null);
      setOnlinePlayerIntent(null);
      return;
    }

    const isTrial = pendingMode === 'trial';
    setDriver(driver);
    setPendingMode(null);
    startGame(isTrial);
  };

  const requestJoinLobby = ({ name, code }) => {
    setOnlinePlayerIntent({ type: 'join', name, code });
    setPendingMode('online');
  };

  const requestDriverChoice = () => {
    setOnlinePlayerIntent({ type: 'edit' });
    setPendingMode('online');
  };

  const leaveLobby = () => {
    p2pLobby.leaveLobby();
    setOnlinePlayerIntent(null);
    setOnlineLobbyOpen(false);
  };

  const handlePickTrack = (trackId) => {
    if (!isKnownTrackId(trackId)) return;
    setTrackId(trackId);
    setPendingMode(pendingTrackFor);
    setPendingTrackFor(null);
  };

  return (
    <>
      {/* PWA update toast: lives above every screen, never blocks gameplay */}
      <PwaUpdateToast />
      {showHomepage ? (
        pendingTrackFor ? (
          <TrackSelect
            onPick={handlePickTrack}
            onBack={() => setPendingTrackFor(null)}
          />
        ) : pendingMode ? (
          <CharacterSelect
            mode={pendingMode}
            onPick={handlePickDriver}
            onBack={() => {
              // Step back to the course picker for offline modes.
              if (pendingMode === 'regular' || pendingMode === 'trial') {
                setPendingTrackFor(pendingMode);
              }
              setPendingMode(null);
              setOnlinePlayerIntent(null);
            }}
          />
        ) : onlineLobbyOpen ? (
          <LobbyScreen
            lobby={p2pLobby.lobby}
            raceTrackId={p2pLobby.raceTrackId}
            onSelectTrack={p2pLobby.setRaceTrackId}
            onCreateLobby={p2pLobby.createLobby}
            onRequestJoin={requestJoinLobby}
            onChooseDriver={requestDriverChoice}
            onStartRace={p2pLobby.startRace}
            onLeaveLobby={leaveLobby}
            onBack={() => setOnlineLobbyOpen(false)}
          />
        ) : (
          <HomePage
            onStartGame={() => setPendingTrackFor('regular')}
            onTimeTrial={() => setPendingTrackFor('trial')}
            onOpenLobby={() => setOnlineLobbyOpen(true)}
          />
        )
      ) : (
        <div className='canvas-container'>
          <MobileControls />
          <ErrorBoundary>
            <Suspense fallback={false}>
              <WebGPUCanvas />
            </Suspense>
          </ErrorBoundary>
          <LoadingScreen onStartWithoutStalled={p2pLobby.startWithoutStalled} />
          {/* Only show GameUI when game has actually started */}
          {gameStarted && <GameUI />}
          {/* Safety mechanism to ensure game starts */}
          <GameReadyCheck />
          <div className="version">v0.4.0</div>
        </div>
      )}
    </>
  );
};

createRoot(document.getElementById('root')).render(<Root />)

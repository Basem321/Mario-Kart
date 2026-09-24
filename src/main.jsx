import { useEffect, useState, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { WebGPUCanvas } from './WebGPUCanvas.jsx'
import { MobileControls } from './mobile/MobileControls.jsx'
import { LoadingScreen } from './LoadingScreen.jsx'
import HomePage from './HomePage.jsx'
import CharacterSelect from './CharacterSelect.jsx'
import LobbyScreen from './LobbyScreen.jsx'
import GameUI from './GameUI.jsx'
import GameReadyCheck from './GameReadyCheck.jsx'
import { useGameManager } from './gameManager.js'
import { useP2PLobby } from './useP2PLobby.js'

const Root = () => {
  const {
    showHomepage,
    isPlaying,
    startGame,
    startCountdown,
    gameStarted,
    setDriver
  } = useGameManager();

  // Chosen right after the homepage countdown, before the race starts.
  const [pendingMode, setPendingMode] = useState(null); // null | 'regular' | 'trial'
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
    startGame(false, {
      online: true,
      spawnIndex,
      playerIds: raceStart.playerIds,
      selfId: self.id,
      players: raceStart.players,
      raceId: raceStart.raceId,
      lapCount: raceStart.lapCount,
    });
    const countdownDelay = Math.max(0, (raceStart.startsAt ?? Date.now()) - Date.now());
    window.setTimeout(() => startCountdown(), countdownDelay);
    p2pLobby.clearRaceStart();
  }, [
    p2pLobby.raceStart,
    p2pLobby.lobby.self?.id,
    p2pLobby.lobby.self?.driver,
    p2pLobby.clearRaceStart,
    setDriver,
    startGame,
    startCountdown,
  ]);

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
          
          console.log('Audio initialized');
        }
      } catch (e) {
        console.warn('Web Audio API not supported');
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
    setTimeout(() => {
      startCountdown(); // Start the countdown after state update completes
    }, 100);
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

  return (
    <>
      {showHomepage ? (
        pendingMode ? (
          <CharacterSelect
            mode={pendingMode}
            onPick={handlePickDriver}
            onBack={() => {
              setPendingMode(null);
              setOnlinePlayerIntent(null);
            }}
          />
        ) : onlineLobbyOpen ? (
          <LobbyScreen
            lobby={p2pLobby.lobby}
            onCreateLobby={p2pLobby.createLobby}
            onRequestJoin={requestJoinLobby}
            onChooseDriver={requestDriverChoice}
            onStartRace={p2pLobby.startRace}
            onLeaveLobby={leaveLobby}
            onBack={() => setOnlineLobbyOpen(false)}
          />
        ) : (
          <HomePage
            onStartGame={() => setPendingMode('regular')}
            onTimeTrial={() => setPendingMode('trial')}
            onOpenLobby={() => setOnlineLobbyOpen(true)}
          />
        )
      ) : (
        <div className='canvas-container'>
          <MobileControls />
          <Suspense fallback={false}>
            <WebGPUCanvas />
          </Suspense>
          {/* Always show LoadingScreen initially; it will handle its own visibility */}
          <LoadingScreen />
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

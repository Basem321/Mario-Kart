import { useEffect } from 'react';
import { useGameManager } from './gameManager';

// This component serves as a safety mechanism to ensure the game starts
// even if there's an issue with the countdown process
const GameReadyCheck = () => {
  const { gameStarted, countdown, isPlaying } = useGameManager();
  const setGameStarted = useGameManager((state) => state.setGameStarted);
  
  // If we're still showing the GO screen after 3 seconds, force game to start
  useEffect(() => {
    if (isPlaying && countdown === 0 && !gameStarted) {
      const safetyTimer = setTimeout(() => {
        console.log("Safety mechanism: Force starting game after countdown");
        setGameStarted();
      }, 3000);
      
      return () => clearTimeout(safetyTimer);
    }
  }, [isPlaying, countdown, gameStarted, setGameStarted]);
  
  return null; // This is a utility component, it doesn't render anything
};

export default GameReadyCheck;

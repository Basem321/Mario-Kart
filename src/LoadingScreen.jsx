import { useGSAP } from "@gsap/react";
import { useProgress } from "@react-three/drei";
import { useRef, useEffect } from "react";
import gsap from "gsap";
import { useGameManager } from "./gameManager";

const BUTTON_TEXT = "Loading...";

export const LoadingScreen = () => {
  const containerRef = useRef(null);
  const backgroundRef = useRef(null);
  const screenRef = useRef(null);
  const { progress } = useProgress();
  const { countdown, gameStarted } = useGameManager();

  console.log("LoadingScreen render - gameStarted:", gameStarted, "countdown:", countdown);
  
  const characters = BUTTON_TEXT.split("");
  const charactersWithoutSpaces = characters.filter((c) => !/\s/.test(c));
  let charIndex = 1;
  
  useGSAP(() => {
    if(progress === 100){
      gsap.to(backgroundRef.current,{
        filter: "blur(0px)",
        duration: 1,
        delay: 1,
        onComplete:() => {
          gsap.to(screenRef.current,{
            autoAlpha: 0,
            duration: 0.5
          })
        }
      })
    }
    
  }, [progress])
  
  useEffect(() => {
    if (countdown !== null && countdown >= 0 && countdown <= 3) {
      const countdownEl = document.getElementById('countdown-number');
      if (countdownEl) {
        // Animate the countdown number
        gsap.fromTo(countdownEl, 
          { scale: 2, autoAlpha: 0 },
          { scale: 1, autoAlpha: 1, duration: 0.5, ease: "back.out" }
        );
      }
    }
  }, [countdown]);
  
  // Handle transitions when game state changes
  useEffect(() => {
    // When game has started, remove the loading screen completely
    if (gameStarted) {
      console.log("Game started, hiding loading screen");
      gsap.to(screenRef.current, {
        autoAlpha: 0, // Make it completely transparent
        duration: 0.5,
        ease: "power2.out",
        onComplete: () => {
          // After fading out, remove it from the layout
          if (screenRef.current) {
            screenRef.current.style.display = 'none';
            console.log("Loading screen hidden completely");
          }
        }
      });
    }
    // Handle countdown animations
    else if (countdown === 0) {
      console.log("Countdown reached GO!");
      // Make the GO text visible with animation
      const goTextEl = document.getElementById('countdown-number');
      if (goTextEl) {
        gsap.fromTo(goTextEl,
          { scale: 0.5, autoAlpha: 0 },
          { 
            scale: 1, 
            autoAlpha: 1, 
            duration: 0.6, 
            ease: "back.out(1.7)",
            onComplete: () => {
              // Ensure we transition to the game after GO animation
              setTimeout(() => {
                // Double-check we're still at GO and game hasn't started
                if (!gameStarted && countdown === 0) {
                  console.log("Manually triggering game start from GO animation");
                  // Force game to start if it hasn't yet
                  useGameManager.getState().setGameStarted();
                }
              }, 1200);
            }
          }
        );
      }
    }
  }, [gameStarted, countdown]);

  return (
    <div 
      className="loading-screen" 
      ref={screenRef}
    >
      {progress < 100 ? (
        <>
          {/* Initial loading screen */}
          <div className="loading" ref={containerRef}>
            {characters.map((char, i) => {
              if (!/\s/.test(char)) {
                const delay = `calc(2s / ${charactersWithoutSpaces.length} * ${charIndex} * 0.5)`;
                charIndex++;
                return (
                  <span
                    key={i}
                    className="button-text-character"
                    style={{ "--delay": delay }}
                  >
                    {char}
                  </span>
                );
              } else {
                return (
                  <span key={i} className="button-text-space">
                    {char}
                  </span>
                );
              }
            })}
          </div>
          
          <div className="mention">
            The following is a non-profit, fan-based project, <br/>
            and is in no way affiliated with <strong>NINTENDO CO. LTD.</strong>
            
            The <strong>Mario Kart</strong> intellectual property is owned by <strong>NINTENDO</strong>
          </div>
          <img
            ref={backgroundRef}
            className="background"
            src={"./snes.webp"}
            style={{ filter: "blur(100px)"}}
          />
        </>
      ) : (
        <>
          {/* Game countdown overlay - Only show during countdown, hide after GO */}
          {(!gameStarted && countdown >= 0) && (
            <div 
              className="countdown-overlay"
            >
              {countdown > 0 ? (
                <div className="countdown-number" id="countdown-number">{countdown}</div>
              ) : (
                <div className="go-text" id="countdown-number">GO!</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
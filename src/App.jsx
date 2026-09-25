import { Bvh, OrbitControls, KeyboardControls, Preload, useTexture,} from "@react-three/drei";
import { Suspense, useEffect, useRef } from "react";
import { TrackScene } from "./TrackScene";
import { Lighting } from "./misc/Lighting";
import VFXParticles from "./wawa-vfx/VFXParticles";
import { Composer } from "./Composer";
import { useThree, useFrame } from "@react-three/fiber";
import { Skid } from "./particles/drift/Skid";
import { Leva } from "leva";
import { useGameStore } from "./store";
import { useGameManager } from "./gameManager";

export const App = () => {
  const controls = [
    { name: "forward", keys: ["ArrowUp", "KeyW"] },
    { name: "backward", keys: ["ArrowDown", "KeyS"] },
    { name: "left", keys: ["ArrowLeft", "KeyA"] },
    { name: "right", keys: ["ArrowRight", "KeyD"] },
    { name: "jump", keys: ["Space"] },
    { name: "useItem", keys: ["KeyE"] },
    { name: "dropBomb", keys: ["KeyG"] },
    { name: "reset", keys: ["KeyR"] },
    { name: "lookBehind", keys: ["KeyQ"] },
  ];
  
  const smokeTexture = useTexture('./textures/particles/smoke.png');
  const noiseTexture = useTexture('./textures/noise.png');
  
  const setNoiseTexture = useGameStore((state) => state.setNoiseTexture);
  const {camera} = useThree();
  
  // Selective subscriptions: subscribing to the whole store re-rendered
  // this entire tree (particles, composer, track…) every single frame.
  // (Mode is read via getState inside useFrame, so no subscription needed.)
  const gameStarted = useGameManager((state) => state.gameStarted);
  
  // Update time in both game modes
  const lastLogTimeRef = useRef(0);
  
  useFrame((state, delta) => {
    if (gameStarted) {
      // Ensure delta is positive and not too large to prevent weird jumps
      const validDelta = Math.max(0, Math.min(delta, 0.1));

      // Convert to milliseconds for time display
      const deltaMs = validDelta * 1000;

      // Update time for both time trial and regular mode
      // (via getState: no re-render, no new subscription)
      const manager = useGameManager.getState();
      manager.updateLapTime(deltaMs);

      // Log timer updates occasionally (every 2 seconds) to avoid console spam
      const now = performance.now();
      if (now - lastLogTimeRef.current > 2000) {
        lastLogTimeRef.current = now;
        console.log(
          `Timer update: total=${manager.formatTime(manager.totalTime)}, lap=${
            manager.isTimeTrial
              ? manager.formatTime(manager.currentLapTime)
              : "N/A"
          }`
        );
      }
    }
  });

  useEffect(() => {
    if(camera){
      camera.layers.enable(1);
      if(noiseTexture){
        setNoiseTexture(noiseTexture);
      }
    }
  }, [camera, noiseTexture, setNoiseTexture])

  return (

      <>
                <VFXParticles
            name="confettis"
            geometry={<boxGeometry args={[0.5, 1, 0.01]} />}
            settings={{
              fadeAlpha: [0, 1],
              fadeSize: [1, 0],
              intensity: 3,
              nbParticles: 10000,
              renderMode: "mesh",
              gravity: [0, 0, 0],
              frustumCulled: false,
            }}
            // alphaMap={smokeTexture}
          />

          <VFXParticles
            name="smoke"
            settings={{
              fadeAlpha: [1, 0],
              fadeSize: [0.5, 1],
              intensity: 0.5,
              nbParticles: 100,
              renderMode: "billboard",
              gravity: [0, 0, 0],
              frustumCulled: false,
            }}
            alphaMap={smokeTexture}
          />
          <VFXParticles
            name="dust"
            settings={{
              fadeAlpha: [1, 0],
              fadeSize: [0, 1],
              intensity: 10,
              nbParticles: 1000,
              renderMode: "billboard",
              gravity: [0, 1, 0],
              frustumCulled: false,
            }}
            alphaMap={smokeTexture}
          />
          {/* <Skid/> */}
          <KeyboardControls map={controls}>
                <TrackScene />
                
              <Lighting />
          </KeyboardControls>

        <Composer/>
        <Leva
          fill // default = false,  true makes the pane fill the parent dom node it's rendered in
          flat // default = false,  true removes border radius and shadow
          oneLineLabels // default = false, alternative layout for labels, with labels and fields on separate rows
          hideTitleBar // default = false, hides the GUI header
          collapsed // default = false, when true the GUI is collpased
          hidden // def
        />
      </>
  );
};

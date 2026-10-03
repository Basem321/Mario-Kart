import { Environment, Lightformer, Sky } from "@react-three/drei";
import { useRef } from "react";
import { useGameStore } from "../store";
import { useGameManager } from "../gameManager";
import { useFrame } from "@react-three/fiber";
import { EnvironmentSphere } from "./EnvironmentSphere";
import { Helper } from "@react-three/drei";
import { CameraHelper } from "three";

export const Lighting = () => {
  const directionalLight = useRef(null)
  // Per-track lighting: mario-circuit = normal (original), others = bright (as-is)
  const selectedTrackId = useGameManager((s) => s.selectedTrackId);
  const isMarioCircuit = (selectedTrackId ?? "mario-circuit") === "mario-circuit";
  
  useFrame(() => {

        const playerPosition = useGameStore.getState().playerPosition;
        if (!playerPosition && !directionalLight.current) return;
    
        if(playerPosition){
        directionalLight.current.position.x = playerPosition.x + 2;
        directionalLight.current.target.position.x = playerPosition.x;
    
        directionalLight.current.position.y = playerPosition.y + 5;
        directionalLight.current.target.position.y = playerPosition.y;
    
        directionalLight.current.position.z = playerPosition.z + 2 ;
        directionalLight.current.target.position.z = playerPosition.z;
    
        directionalLight.current.target.updateMatrixWorld();
        }
  })
  
  return (
    <>
      {isMarioCircuit ? (
        <>
          {/* Mario Circuit: normal/original lighting */}
          <directionalLight
            castShadow
            ref={directionalLight}
            position={[0, 0, 0]}
            intensity={3}
            color={"#FFffff"}
            shadow-bias={-0.0001}
            shadow-mapSize={[2048, 2048]}
          >
            <orthographicCamera
              attach="shadow-camera"
              near={1}
              far={20}
              top={5}
              left={-5}
              right={5}
              bottom={-5}
            />
          </directionalLight>
          <EnvironmentSphere />
        </>
      ) : (
        <>
          {/* Other tracks (Waluigi Stadium, ...): keep current bright lighting as-is */}
          <ambientLight intensity={1.6} color={"#ffffff"} />
          <hemisphereLight
            skyColor={"#cce7ff"}
            groundColor={"#6d5538"}
            intensity={1.2}
          />
          <directionalLight
            castShadow
            ref={directionalLight}
            position={[0, 0, 0]}
            intensity={2.5}
            color={"#fff6e8"}
            shadow-bias={-0.0001}
            shadow-mapSize={[2048, 2048]}
          >
            <orthographicCamera
              attach="shadow-camera"
              near={1}
              far={35}
              top={15}
              left={-15}
              right={15}
              bottom={-15}
            />
          </directionalLight>
          {/* Stadium sun directional light for consistent global lighting across the entire track */}
          <directionalLight
            position={[150, 200, -100]}
            intensity={1.8}
            color={"#fff0d4"}
          />
          <EnvironmentSphere />
        </>
      )}
    </>
  );
};

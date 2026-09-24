import { useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { App } from "./App";
import { Bvh, Preload } from "@react-three/drei";
import { NoToneMapping } from "three";

// Releases the WebGL context + all GPU resources when exiting to the
// homepage. Without this, every re-entry keeps the old context alive
// (2+ live contexts / GPU memory pile-up) and the game crawls.
const ContextReleaser = () => {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    return () => {
      try {
        gl.dispose();
        if (typeof gl.forceContextLoss === "function") {
          gl.forceContextLoss();
        }
      } catch {
        // ignore — canvas is going away anyway
      }
    };
  }, [gl]);
  return null;
};

export const WebGPUCanvas = () => {

  return (
    <Canvas shadows dpr={1} gl={{ depth: false, alpha: false, antialias: false, stencil: false, toneMapping: NoToneMapping }} camera={{far: 2500}} >

          <Bvh >
            <App/>
            <Preload all/>
          </Bvh>
          <ContextReleaser />

    </Canvas>
  );
}

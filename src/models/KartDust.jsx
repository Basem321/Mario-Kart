import { Dust } from "../particles/Dust";
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGameStore } from "../store";

export const KartDust = ({ wheelStates }) => {
  const dustRefs = useRef([null, null, null, null]);

  useFrame(() => {
    // Any wheel kicking dirt means the kart is on dirt (the old per-wheel
    // set in the loop kept only the LAST wheel's value).
    try {
      useGameStore.getState().setIsOnDirt(wheelStates.some((w) => w?.shouldEmit));
    } catch {
      // ignore — store write must never break the frame
    }
    wheelStates.forEach((wheel, i) => {
      const ref = dustRefs.current[i];
      if (!ref) return;

      const position = wheel.position;

      ref.setPosition(position);
      if (wheel.shouldEmit) {
        ref.start();
      } else {
        ref.stop();
      }
    });
  })

  return (
    <>
    <group layers={1} position-y={0.5}>
            {wheelStates.map((wheel, i) => (
        <Dust key={i} ref={(el) => (dustRefs.current[i] = el)} />
      ))}
    </group>
    </>
  );
};


import { InstancedMesh2 } from '@three.ez/instanced-mesh';
import { extend, useFrame } from '@react-three/fiber';
import { useRef, useMemo, useEffect } from 'react';
import { PlaneGeometry, Vector3, Quaternion, MeshBasicMaterial, DoubleSide } from 'three';
import { useGameStore } from '../../store';
import { useGameManager } from '../../gameManager';

extend({ InstancedMesh2 });

export const Skid = () => {
  const ref = useRef(null);
  const lifeTime = 9;
  const size = 0.34;
  const minDistance = 0.12;

  const lastLeftPos = useRef(new Vector3());
  const lastRightPos = useRef(new Vector3());
  const wasSpinning = useRef(false);

  const geometry = useMemo(() => new PlaneGeometry(size, size * 1.6), [size]);
  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        color: 0x1a1a1e,
        side: DoubleSide,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    [],
  );

  // Free GPU resources on unmount (exit to menu) so re-entry stays clean.
  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  // Clear stale marks when a new race mounts.
  const gameStarted = useGameManager((s) => s.gameStarted);
  const onlineRaceId = useGameManager((s) => s.onlineRaceId);
  useEffect(() => {
    wasSpinning.current = false;
    if (!ref.current) return;
    try {
      ref.current.clearInstances?.();
    } catch {
      // ignore — instance list may already be empty
    }
  }, [gameStarted, onlineRaceId]);

  useFrame((state, delta) => {
    if (!ref.current) return;
    const wheelPositions = useGameStore.getState().wheelPositions
    if (!wheelPositions || wheelPositions.length < 5) return;
    const leftPos = wheelPositions[2];
    const rightPos = wheelPositions[3]
    const body = wheelPositions[4];
    if (!leftPos || !rightPos || !body?.getWorldQuaternion) return;
    const worldQuat = body.getWorldQuaternion(new Quaternion());

    const isSpinning = Boolean(body.isDrifting);
    // Rear wheels differ slightly on slopes — only skip wild mismatches.
    if (Math.abs(leftPos.y - rightPos.y) > 0.6) {
      wasSpinning.current = false;
      return;
    }

    if (isSpinning) {
      if (!wasSpinning.current) {
        lastLeftPos.current.copy(leftPos);
        lastRightPos.current.copy(rightPos);
      }

      const leftDistance = leftPos.distanceTo(lastLeftPos.current);
      const rightDistance = rightPos.distanceTo(lastRightPos.current);
      const maxDist = Math.max(leftDistance, rightDistance);

      if (maxDist > minDistance) {
        const steps = Math.min(8, Math.ceil(maxDist / minDistance));
        for (let i = 0; i < steps; i++) {
          const factor = (i + 1) / steps;
          const interpolatedLeft = lastLeftPos.current.clone().lerp(leftPos, factor);
          const interpolatedRight = lastRightPos.current.clone().lerp(rightPos, factor);

          ref.current.addInstances(2, (obj, index) => {
            obj.position.copy(index % 2 === 0 ? interpolatedLeft : interpolatedRight);
            // Sit just above the road surface to avoid z-fighting.
            obj.position.y += 0.03;
            obj.position.y -= 0.22;
            obj.quaternion.copy(worldQuat);
            obj.rotateX(-Math.PI / 2);

            obj.currentTime = 0;
          });
        }
      }

      lastLeftPos.current.copy(leftPos);
      lastRightPos.current.copy(rightPos);
      wasSpinning.current = true;
    } else {
      wasSpinning.current = false;
    }


    ref.current.updateInstances((obj) => {
      obj.currentTime += delta;
      if (obj.currentTime >= lifeTime) obj.remove();
    });
  });

  return <instancedMesh2 layers={1} renderOrder={1} ref={ref} args={[geometry, material, { createEntities: true }]} frustumCulled={false} />;
};
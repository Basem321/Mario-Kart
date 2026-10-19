import { InstancedMesh2 } from '@three.ez/instanced-mesh';
import { extend, useFrame } from '@react-three/fiber';
import { useRef, useMemo, useEffect } from 'react';
import { PlaneGeometry, Vector3, Quaternion, MeshBasicMaterial, DoubleSide } from 'three';
import { useGameStore } from '../../store';
import { useGameManager } from '../../gameManager';
import { remoteFxSources } from '../../remoteFx';

extend({ InstancedMesh2 });

// Scratch quaternion for the per-frame body orientation (copied into each
// instance below, never retained) — avoids one allocation per frame.
const _worldQuat = new Quaternion();

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

  // Per-remote-racer last rear-wheel positions (same stamping rules as the
  // local kart, driven by positions RemoteRacers publishes in remoteFxSources).
  const remoteTrail = useRef(new Map());

  // Stamp skid quads for one kart between its last and current rear-wheel
  // positions. `st` = { left, right, was } scratch state for that kart.
  const stamp = (st, leftPos, rightPos, quat, drifting) => {
    // Rear wheels differ slightly on slopes — only skip wild mismatches.
    if (Math.abs(leftPos.y - rightPos.y) > 0.6) {
      st.was = false;
      return;
    }

    if (drifting) {
      if (!st.was) {
        st.left.copy(leftPos);
        st.right.copy(rightPos);
      }

      const leftDistance = leftPos.distanceTo(st.left);
      const rightDistance = rightPos.distanceTo(st.right);
      const maxDist = Math.max(leftDistance, rightDistance);

      if (maxDist > minDistance) {
        const steps = Math.min(8, Math.ceil(maxDist / minDistance));
        for (let i = 0; i < steps; i++) {
          const factor = (i + 1) / steps;
          const interpolatedLeft = st.left.clone().lerp(leftPos, factor);
          const interpolatedRight = st.right.clone().lerp(rightPos, factor);

          ref.current.addInstances(2, (obj, index) => {
            obj.position.copy(index % 2 === 0 ? interpolatedLeft : interpolatedRight);
            // Sit just above the road surface to avoid z-fighting.
            obj.position.y += 0.03;
            obj.position.y -= 0.22;
            obj.quaternion.copy(quat);
            obj.rotateX(-Math.PI / 2);

            obj.currentTime = 0;
          });
        }
      }

      st.left.copy(leftPos);
      st.right.copy(rightPos);
      st.was = true;
    } else {
      st.was = false;
    }
  };

  const localTrail = useRef({ left: lastLeftPos.current, right: lastRightPos.current, was: false });

  useFrame((state, delta) => {
    if (!ref.current) return;
    const wheelPositions = useGameStore.getState().wheelPositions
    if (wheelPositions && wheelPositions.length >= 5) {
      const leftPos = wheelPositions[2];
      const rightPos = wheelPositions[3]
      const body = wheelPositions[4];
      if (leftPos && rightPos && body?.getWorldQuaternion) {
        const worldQuat = body.getWorldQuaternion(_worldQuat);
        localTrail.current.was = wasSpinning.current;
        stamp(localTrail.current, leftPos, rightPos, worldQuat, Boolean(body.isDrifting));
        wasSpinning.current = localTrail.current.was;
      }
    }

    // Remote karts drifting.
    for (const [id, src] of remoteFxSources) {
      let st = remoteTrail.current.get(id);
      if (!st) {
        st = { left: new Vector3(), right: new Vector3(), was: false };
        remoteTrail.current.set(id, st);
      }
      stamp(st, src.rearL, src.rearR, src.quat, src.drifting);
    }
    // Drop trail state of racers that left.
    if (remoteTrail.current.size > remoteFxSources.size) {
      for (const id of remoteTrail.current.keys()) {
        if (!remoteFxSources.has(id)) remoteTrail.current.delete(id);
      }
    }

    ref.current.updateInstances((obj) => {
      obj.currentTime += delta;
      if (obj.currentTime >= lifeTime) obj.remove();
    });
  });

  return <instancedMesh2 layers={1} renderOrder={1} ref={ref} args={[geometry, material, { createEntities: true }]} frustumCulled={false} />;
};
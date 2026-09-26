import { Kart } from "./models/Kart";
import { useGLTF, useKeyboardControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Vector3, Raycaster } from "three";
import { damp } from "three/src/math/MathUtils.js";
import { getOnlineSpawnSlot, kartSettings } from "./constants";
import { useGameStore } from "./store";
import gsap from "gsap";
import { useTouchScreen } from "./hooks/useTouchScreen";
import VFXEmitter from "./wawa-vfx/VFXEmitter";
import { useGameManager } from "./gameManager";
import { publishOnlineRaceTransform } from "./onlineRaceTransport";
import {
  resolveWallCollision,
  wallSpeedFactor,
  KART_RADIUS,
  WALL_SKIN,
} from "./collision";
import { findNearestBlackRoadPoint, getBlackRoadGeometry } from "./trackRoad";

// Horizontal ray vs the visible track meshes (barriers included).
// Catches real walls even where the precomputed segments have gaps.
const wallRaycaster = new Raycaster();
wallRaycaster.firstHitOnly = true;

export const PlayerController = () => {
  const rbRef = useRef(null);
  const playerRef = useRef(null);
  const cameraGroupRef = useRef(null);
  const cameraLookAtRef = useRef(null);
  const cameraFrontRef = useRef(null);
  const rearLookRef = useRef(null);
  const lookingBackRef = useRef(0);
  const kartRef = useRef(null);
  const jumpIsHeld = useRef(false);
  const driftDirections = {
    none: 0,
    left: 1.4,
    right: -1.4,
  };
  const jumpOffset = useRef(0);
  const driftDirection = useRef(driftDirections.none);
  const driftPower = useRef(0);
  const turbo = useRef(0);
  const isJumping = useRef(false);
  const backWheelOffset = useRef({
    left: 0,
    right: 0,
  });
  const gamepadRef = useRef(null);
  const inputTurn = useRef(0);
  const lastExplosionIdRef = useRef(0);
  const lastNetworkSyncRef = useRef(-Infinity);
  const resetHeldRef = useRef(false);
  const resetRequestedRef = useRef(false);
  const honkHeldRef = useRef(false);
  const isOnlineRace = useGameManager((state) => state.isOnlineRace);
  const onlineSpawnIndex = useGameManager((state) => state.onlineSpawnIndex);
  const spawnSlot = isOnlineRace
    ? getOnlineSpawnSlot(onlineSpawnIndex)
    : { position: [0, 0, 0], rotationY: 0 };

  // Blast reaction: if a new explosion appeared near the kart, shove the
  // kart away, kill its speed and stun the throttle briefly.
  function reactToExplosions(player) {
    const st = useGameStore.getState();
    const list = st.explosions;
    if (!list || list.length === 0) return;
    const latest = list[list.length - 1];
    if (latest.id === lastExplosionIdRef.current) return;
    lastExplosionIdRef.current = latest.id;
    const dx = player.position.x - latest.x;
    const dz = player.position.z - latest.z;
    const d = Math.hypot(dx, dz);
    const BLAST_RADIUS = 12;
    if (d > BLAST_RADIUS) return;
    const push = (1 - d / BLAST_RADIUS) * 6;
    const nx = d > 1e-4 ? dx / d : 0;
    const nz = d > 1e-4 ? dz / d : 1;
    const segs = st.wallSegments;
    const resolved = resolveWallCollision(
      player.position.x,
      player.position.z,
      player.position.x + nx * push,
      player.position.z + nz * push,
      segs && segs.length > 0 ? segs : [],
      KART_RADIUS
    );
    player.position.x = resolved.x;
    player.position.z = resolved.z;
    // Full stop + 3s stun (throttle dead, see updateSpeed) + spin sound.
    speedRef.current = 0;
    setSpeed(speedRef.current);
    st.setStunUntil(performance.now() + 3000);
    const spin = new Audio("/music/spin.mp3");
    spin.loop = true;
    spin.volume = 0.9;
    spin.play().catch(() => {});
    setTimeout(() => {
      spin.pause();
    }, 3000);
  }

  const [, get] = useKeyboardControls();

  const speedRef = useRef(0);
  const rotationSpeedRef = useRef(0);
  const smoothedDirectionRef = useRef(new Vector3(0, 0, -1));

  const isTouchScreen = useTouchScreen();

  const setPlayerPosition = useGameStore((state) => state.setPlayerPosition);
  const setIsBoosting = useGameStore((state) => state.setIsBoosting);
  const setSpeed = useGameStore((state) => state.setSpeed);
  const setGamepad = useGameStore((state) => state.setGamepad);

  const scene = useThree((s) => s.scene);
  const { nodes: trackNodes } = useGLTF("./models/mario-circuit-test-transformed.glb");
  const blackRoadGeometry = getBlackRoadGeometry(trackNodes);
  const meshCollidersRef = useRef(null);

  // The HUD uses this event so its Reset button and the R key share exactly
  // the same physics-safe recovery path.  Keeping the request in a ref lets
  // the actual teleport happen inside the next Three.js frame.
  useEffect(() => {
    const requestReset = () => {
      resetRequestedRef.current = true;
    };

    window.addEventListener("mario-kart:reset", requestReset);
    return () => window.removeEventListener("mario-kart:reset", requestReset);
  }, []);

  const resetToNearestBlackRoad = (player) => {
    if (!useGameManager.getState().gameStarted) return false;

    const point = findNearestBlackRoadPoint(
      blackRoadGeometry,
      player.position.x,
      player.position.z,
    );
    if (!point) return false;

    // The kart chassis follows its wheels' ground ray. Keep its current Y
    // baseline and only recover the X/Z position onto the black road.
    player.position.x = point.x;
    player.position.z = point.z;
    speedRef.current = 0;
    rotationSpeedRef.current = 0;
    driftDirection.current = driftDirections.none;
    driftPower.current = 0;
    turbo.current = 0;
    smoothedDirectionRef.current.set(
      -Math.sin(player.rotation.y),
      0,
      -Math.cos(player.rotation.y),
    );
    setSpeed(0);
    useGameStore.getState().setPlayerPosition(player.position);
    useGameStore.getState().setPlayerRotationY(player.rotation.y);

    // Let an online peer publish the corrected position on this same frame.
    lastNetworkSyncRef.current = -Infinity;
    return true;
  };

  // Visible track meshes (road + barriers — everything named "ground").
  // Collected once; our own "wall-barrier" mesh is excluded by name.
  const getMeshColliders = () => {
    if (!meshCollidersRef.current) {
      const list = [];
      scene.traverse((obj) => {
        if (obj.isMesh && obj.name.includes("ground")) list.push(obj);
      });
      meshCollidersRef.current = list;
    }
    return meshCollidersRef.current;
  };

  // Second wall layer: horizontal ray from the kart against the real
  // track geometry. Only steep faces count as walls (floor is skipped).
  // The track group has no rotation (translation + uniform scale only),
  // so the object-space face normal is also the world normal direction.
  function resolveMeshWalls(prevX, prevZ, inX, inZ) {
    const colliders = getMeshColliders();
    if (!colliders || colliders.length === 0) {
      return { x: inX, z: inZ, hit: false, nx: 0, nz: 0 };
    }
    const dx = inX - prevX;
    const dz = inZ - prevZ;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-6) {
      return { x: inX, z: inZ, hit: false, nx: 0, nz: 0 };
    }
    const originY = (useGameStore.getState().groundPosition ?? 0) + 0.25;
    wallRaycaster.set(
      new Vector3(prevX, originY, prevZ),
      new Vector3(dx / dist, 0, dz / dist)
    );
    wallRaycaster.far = dist + KART_RADIUS + WALL_SKIN;
    const hits = wallRaycaster.intersectObjects(colliders, false);
    for (const h of hits) {
      const n = h.face?.normal;
      if (!n || Math.abs(n.y) > 0.5) continue; // floor/ceiling, not a wall
      const nl = Math.hypot(n.x, n.z);
      if (nl < 1e-4) continue;
      let nx = n.x / nl;
      let nz = n.z / nl;
      // Face the kart: normal must point from wall toward the kart.
      let ox = inX - h.point.x;
      let oz = inZ - h.point.z;
      let d = ox * nx + oz * nz;
      if (d < 0) {
        nx = -nx;
        nz = -nz;
        d = -d;
      }
      const minD = KART_RADIUS + WALL_SKIN;
      if (d >= minD) {
        return { x: inX, z: inZ, hit: false, nx: 0, nz: 0 };
      }
      return {
        x: inX + nx * (minD - d),
        z: inZ + nz * (minD - d),
        hit: true,
        nx,
        nz,
      };
    }
    return { x: inX, z: inZ, hit: false, nx: 0, nz: 0 };
  }

  const getGamepad = () => {
    if (navigator.getGamepads) {
      const gamepads = navigator.getGamepads();
      if (gamepads.length > 0) {
        gamepadRef.current = gamepads[0];
        setGamepad(gamepadRef.current);
      }
    }
  };

  const jumpAnim = () => {
    gsap.to(jumpOffset, {
      current: 0.3,
      duration: 0.125,
      ease: "power2.out",
      yoyo: true,
      repeat: 1,
      onComplete: () => {
        isJumping.current = false;
        setTimeout(() => {
          if (driftDirection.current !== 0) {
            gsap.killTweensOf(backWheelOffset.current);
            gsap.to(backWheelOffset.current, {
              left: driftDirection.current === driftDirections.left ? 0.4 : 0,
              right: driftDirection.current === driftDirections.right ? 0.4 : 0,
              duration: 0.3,
              ease: "power4.out",
              onComplete: () => {
                gsap.to(backWheelOffset.current, {
                  left: 0,
                  right: 0,
                  duration: 0.8,
                  ease: "bounce.out",
                });
              },
            });
          }
        }, 100);
      },
    });
  };

  function updateSpeed(forward, backward, delta) {
    // Stunned by an explosion: no throttle, speed collapses.
    if (performance.now() < useGameStore.getState().stunUntil) {
      speedRef.current = damp(speedRef.current, 0, 6, delta);
      setSpeed(speedRef.current);
      return;
    }
    // Apply time trial speed factor if in time trial mode
    const isTimeTrialMode = useGameManager.getState().isTimeTrial;
    const speedFactor = isTimeTrialMode ? kartSettings.timeTrialSpeedFactor || 1.5 : 1.0;
    
    // Adjust max speed for time trial mode
    const baseMaxSpeed = kartSettings.speed.max;
    const maxSpeed = (baseMaxSpeed * speedFactor) + (turbo.current > 0 ? 40 : 0);

    // Boost flag drives flames + FOV kick + wind overlay. It must reflect an
    // actual mini-turbo, not the higher time-trial cruising speed.
    turbo.current > 0 ? setIsBoosting(true) : setIsBoosting(false);

    const gamepadButtons = {
      forward: false,
      backward: false,
    };

    if (gamepadRef.current) {
      gamepadButtons.forward = gamepadRef.current.buttons[0].pressed;
      gamepadButtons.backward = gamepadRef.current.buttons[1].pressed;
    }
    const forwardAccel = Number(
      (isTouchScreen && !gamepadRef.current) ||
        forward ||
        gamepadButtons.forward
    );

    // Make the damping more responsive in time trial mode
    const dampingFactor = isTimeTrialMode ? 2.5 : 1.5;
    
    speedRef.current = damp(
      speedRef.current,
      maxSpeed * forwardAccel +
        kartSettings.speed.min * Number(backward || gamepadButtons.backward),
      dampingFactor,
      delta
    );
    setSpeed(speedRef.current);
    if (speedRef.current < 20) {
      driftDirection.current = driftDirections.none;
      driftPower.current = 0;
    }
    turbo.current -= delta;
  }

  function rotatePlayer(left, right, player, joystickX, delta) {
    // Apply time trial mode handling adjustments
    const isTimeTrialMode = useGameManager.getState().isTimeTrial;
    const handlingFactor = isTimeTrialMode ? 1.5 : 1.0;
    
    const gamepadJoystick = {
      x: 0,
    };

    if (gamepadRef.current) {
      gamepadJoystick.x = gamepadRef.current.axes[0];
    }

    // Make turning more responsive in time trial mode
    const turnSensitivity = isTimeTrialMode ? 0.15 : 0.1;
    
    inputTurn.current =
      (-gamepadJoystick.x -
        joystickX +
        (Number(left) - Number(right)) +
        driftDirection.current) *
      turnSensitivity;

    // Faster rotation response in time trial mode
    const rotationDampFactor = isTimeTrialMode ? 6 : 4;
    
    rotationSpeedRef.current = damp(
      rotationSpeedRef.current,
      inputTurn.current,
      rotationDampFactor,
      delta
    );
    
    const targetRotation =
      player.rotation.y +
      ((rotationSpeedRef.current *
        (speedRef.current > 40 ? 40 : speedRef.current)) /
        kartSettings.speed.max) * handlingFactor;

    // More responsive rotation damping in time trial mode
    const finalDampFactor = isTimeTrialMode ? 12 : 8;
    player.rotation.y = damp(player.rotation.y, targetRotation, finalDampFactor, delta);
  }

  function jumpPlayer(spaceKey, left, right, joystickX) {
    if (spaceKey && !jumpIsHeld.current && !isJumping.current) {
      // rb.applyImpulse({ x: 0, y: 45, z: 0 }, true);

      jumpAnim();
      isJumping.current = true;
      jumpIsHeld.current = true;
      driftDirection.current =
        left || joystickX < 0
          ? driftDirections.left
          : right || joystickX > 0
          ? driftDirections.right
          : driftDirections.none;
    }

    if (!spaceKey) {
      jumpIsHeld.current = false;
      if (turbo.current <= 0) {
        turbo.current = useGameStore.getState().boostPower
          ? useGameStore.getState().boostPower
          : 0;
      }
      driftDirection.current = driftDirections.none;
      driftPower.current = 0;
    }
  }

  function driftPlayer(delta) {
    if (driftDirection.current !== driftDirections.none) {
      driftPower.current += delta;
    }
  }

  function updatePlayer(player, speed, camera, kart, delta) {
    // Apply time trial specific adjustments
    const isTimeTrialMode = useGameManager.getState().isTimeTrial;
    const movementFactor = isTimeTrialMode ? 1.5 : 1.0;
    
    const desiredDirection = new Vector3(
      -Math.sin(player.rotation.y),
      0,
      -Math.cos(player.rotation.y)
    );

    // More responsive direction change in time trial mode
    const directionLerpFactor = isTimeTrialMode ? 18 : 12;
    smoothedDirectionRef.current.lerp(desiredDirection, directionLerpFactor * delta);
    const dir = smoothedDirectionRef.current;

    const angle = Math.atan2(
      desiredDirection.x * dir.z - desiredDirection.z * dir.x,
      desiredDirection.x * dir.x + desiredDirection.z * dir.z
    );

    // More responsive kart rotation in time trial mode
    const kartRotationDampFactor = isTimeTrialMode ? 9 : 6;
    kart.rotation.y = damp(
      kart.rotation.y,
      angle * 1.3 + driftDirection.current * 0.1,
      kartRotationDampFactor,
      delta
    );

    // Camera responsiveness in time trial mode
    const cameraLerpFactor = isTimeTrialMode ? 12 : 8;
    // R = look behind: blend from the normal chase cam to a front cam
    // that looks backwards. lookingBackRef 0→1 makes it smooth both ways.
    const lookT = lookingBackRef.current;
    const camTargetPos = cameraGroupRef.current.getWorldPosition(new Vector3());
    const camTargetLook = cameraLookAtRef.current.getWorldPosition(new Vector3());
    if (lookT > 0.001 && cameraFrontRef.current && rearLookRef.current) {
      const rearPos = cameraFrontRef.current.getWorldPosition(new Vector3());
      const rearLook = rearLookRef.current.getWorldPosition(new Vector3());
      camTargetPos.lerp(rearPos, lookT);
      camTargetLook.lerp(rearLook, lookT);
    }
    camera.lookAt(camTargetLook);
    camera.position.lerp(camTargetPos, cameraLerpFactor * delta);

    // const body = useGameStore.getState().body;
    // if(body){
    //   cameraGroupRef.current.position.y = lerp(cameraGroupRef.current.position.y, body.position.y + 2, 8 * delta);
    //   cameraLookAtRef.current.position.y = body.position.y;
    // }
    const direction = smoothedDirectionRef.current;

    // Desired movement for this frame (before walls).
    const prevX = player.position.x;
    const prevZ = player.position.z;
    const desiredX = prevX + direction.x * speed * delta * movementFactor;
    const desiredZ = prevZ + direction.z * speed * delta * movementFactor;

    // --- Wall physics: the kart slides along walls and can never pass through.
    // Layer 1: cheap precomputed segments (road edge + outer fence).
    const wallSegments = useGameStore.getState().wallSegments;
    let wallX = desiredX;
    let wallZ = desiredZ;
    let wallHit = false;
    let wallNX = 0;
    let wallNZ = 0;
    if (wallSegments && wallSegments.length > 0) {
      const resolved = resolveWallCollision(
        prevX,
        prevZ,
        desiredX,
        desiredZ,
        wallSegments,
        KART_RADIUS
      );
      wallX = resolved.x;
      wallZ = resolved.z;
      wallHit = resolved.hit;
      wallNX = resolved.nx;
      wallNZ = resolved.nz;
    }
    // Layer 2: horizontal ray vs the visible track walls (candy barriers…).
    // Catches real geometry even where segments have gaps.
    const meshResolved = resolveMeshWalls(prevX, prevZ, wallX, wallZ);
    wallX = meshResolved.x;
    wallZ = meshResolved.z;
    if (meshResolved.hit) {
      wallHit = true;
      wallNX = meshResolved.nx;
      wallNZ = meshResolved.nz;
    }
    player.position.x = wallX;
    player.position.z = wallZ;
    if (wallHit) {
      const motionX = desiredX - prevX;
      const motionZ = desiredZ - prevZ;
      const factor = wallSpeedFactor(motionX, motionZ, wallNX, wallNZ);
      // Scrub speed on impact so grinding a wall doesn't keep full pace.
      // Head-on hits lose more than gentle scrapes (see collision.js).
      speedRef.current *= factor;
      setSpeed(speedRef.current);
    }

    setPlayerPosition(player.position);
  }

  useFrame((state, delta) => {
    if (!playerRef.current && !rbRef.current) return;
    const player = playerRef.current;
    const cameraGroup = cameraGroupRef.current;
    const kart = kartRef.current;
    const camera = state.camera;

    if (!player || !cameraGroup || !kart) return;
    
    // Get time trial status from the game manager
    const isTimeTrial = useGameManager.getState().isTimeTrial;
    
    // Use a smaller delta cap for time trial mode to ensure fast responses
    // This ensures physics updates are more consistent and responsive 
    const maxDelta = isTimeTrial ? 0.05 : 0.1;
    const cappedDelta = Math.min(delta, maxDelta);

    const joystick = useGameStore.getState().joystick;
    const jumpButtonPressed = useGameStore.getState().jumpButtonPressed;

    const { forward, backward, left, right, jump, reset, lookBehind, honk } = get();

    const gamepadButtons = {
      jump: false,
      x: 0,
    };

    if (gamepadRef.current) {
      gamepadButtons.jump =
        gamepadRef.current.buttons[5].pressed ||
        gamepadRef.current.buttons[7].pressed;
      gamepadButtons.x = gamepadRef.current.axes[0];
    }
    // Reset is edge-triggered so holding R cannot repeatedly teleport the
    // kart. The screen button queues the same request through CustomEvent.
    const resetDown = Boolean(reset);
    if ((resetDown && !resetHeldRef.current) || resetRequestedRef.current) {
      resetRequestedRef.current = false;
      resetToNearestBlackRoad(player);
    }
    resetHeldRef.current = resetDown;

    // H = honk (edge-triggered so holding H plays the horn once).
    const honkDown = Boolean(honk);
    if (honkDown && !honkHeldRef.current) {
      try {
        const rawVol = Number(useGameManager.getState().sfxVolume);
        const vol = Number.isFinite(rawVol) ? Math.max(0, Math.min(1, rawVol)) : 0.7;
        const horn = new Audio("./music/car-honk.mp3");
        horn.volume = vol;
        horn.play().catch(() => {});
      } catch {
        // ignore — audio must never break the physics loop
      }
    }
    honkHeldRef.current = honkDown;

    updateSpeed(forward, backward, cappedDelta);
    rotatePlayer(left, right, player, joystick.x, cappedDelta);
    // Q = look behind while held, smooth back to the chase camera on release.
    lookingBackRef.current = damp(
      lookingBackRef.current,
      lookBehind ? 1 : 0,
      10,
      cappedDelta
    );
    updatePlayer(player, speedRef.current, camera, kart, cappedDelta);
    // Share heading for item drops + react to new explosions (blast+stun).
    const storeState = useGameStore.getState();
    if (storeState.setPlayerRotationY) {
      storeState.setPlayerRotationY(player.rotation.y);
    }
    reactToExplosions(player);
    const isJumpPressed = jumpButtonPressed || jump || gamepadButtons.jump;
    jumpPlayer(isJumpPressed, left, right, joystick.x || gamepadButtons.x);
    driftPlayer(cappedDelta);
    getGamepad();

    // Send a compact transform about 15 times/sec. Rendering of remote karts
    // smooths the received states, which keeps traffic low while making the
    // side-by-side starting grid and race movement visible to everyone.
    const now = performance.now();
    if (
      isOnlineRace &&
      useGameManager.getState().gameStarted &&
      now - lastNetworkSyncRef.current >= 66
    ) {
      lastNetworkSyncRef.current = now;
      publishOnlineRaceTransform({
        x: player.position.x,
        y: player.position.y,
        z: player.position.z,
        rotationY: player.rotation.y,
        bodyY: useGameStore.getState().groundPosition ?? 0,
      });
    }
  });

  return (
    <>
      <group></group>
      <group ref={playerRef} position={spawnSlot.position} rotation-y={spawnSlot.rotationY}>
        <group ref={cameraGroupRef} position={[0, 2, 5]}></group>

        <group ref={kartRef}>
          <VFXEmitter
            emitter="confettis"
            settings={{
              duration: 0.5,
              delay: 0.1,
              nbParticles: 1000,
              spawnMode: "time",
              loop: true,
              startPositionMin: [-100, 0, -100],
              startPositionMax: [100, 10, 100],
              startRotationMin: [-1, -1, -1],
              startRotationMax: [1, 1, 1],
              particlesLifetime: [3, 4],
              speed: [1, 3],
              colorStart: [
                "#FF3F3F",
                "#FF9A00",
                "#FFE600",
                "#32FF6A",
                "#00E5FF",
                "#6A5CFF",
                "#FF5CFF",
                "#FF66B3",
                "#00FFB3",
                "#FFD700",
              ],
              directionMin: [-1, -1, -1],
              directionMax: [1, 0, 1],
              rotationSpeedMin: [-10, -10, -10],
              rotationSpeedMax: [10, 10, 10],
              size: [0.5, 1],
            }}
          />

          <Kart
            speed={speedRef}
            driftDirection={driftDirection}
            driftPower={driftPower}
            jumpOffset={jumpOffset}
            backWheelOffset={backWheelOffset}
            inputTurn={inputTurn}
          />

          <group ref={cameraLookAtRef} position={[0, -2, -9]}></group>
          {/* Look-behind mounts: camera jumps to the front, looks backwards */}
          <group ref={cameraFrontRef} position={[0, 2.2, -6.5]}></group>
          <group ref={rearLookRef} position={[0, 0.2, 10]}></group>
        </group>
      </group>

      {/* <OrbitControls/> */}
    </>
  );
};

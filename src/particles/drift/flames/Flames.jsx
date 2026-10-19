import { extend, useFrame } from "@react-three/fiber";
import { InstancedMesh2 } from "@three.ez/instanced-mesh";
import { useMemo, useRef, useEffect } from "react";
import { ShaderMaterial, PlaneGeometry, Vector3, Color, Quaternion, Euler} from "three";
import { memo } from "react";
import fragmentShader from "./fragment.glsl";
import vertexShader from "./vertex.glsl";
import { useGameStore } from "../../../store";
import { remoteFxSources } from "../../../remoteFx";

extend({ InstancedMesh2 });

// Module scratch: updateInstances runs per flame per frame — allocating
// Vector3/Quaternion/Euler there churns GC every frame (AGENTS.md: no
// per-frame allocations). These are used synchronously, never retained.
const _growTarget = new Vector3();
const _camPos = new Vector3();
const _toCam = new Vector3();
const _zAxis = new Vector3(0, 0, 1);
const _q1 = new Quaternion();
const _q2 = new Quaternion();
const _eul = new Euler();

// One flame sprite at `pos` (module-level: no per-frame closure allocation).
const spawnFlame = (mesh, pos, scale) => {
  mesh.addInstances(1, (obj) => {
    obj.position.set(pos.x, pos.y - 0.1, pos.z);
    obj.currentTime = 0;
    obj.setUniform('uCurrentTime', 0);
    obj.setUniform('uTimeOffset', Math.random());
    obj.scale.set(scale, scale, scale);
  });
};

export const Flames = () => {
  const ref = useRef();

  const geometry = useMemo(() => new PlaneGeometry(1.5, 1.5), []);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { 
          uCurrentTime: { value: 0 },
          color: { value: new Color(0xFFA22B).multiplyScalar(4)},
          uTimeOffset: { value: 0 },
          noiseTexture: { value: null }
        },        
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        transparent: true,
        depthWrite: false,
        defines: {
          USE_INSTANCING_INDIRECT: true,
        },
      }),
    []
  );

  useEffect(() => {
    if (ref.current) {

      ref.current.initUniformsPerInstance({ fragment: { uCurrentTime: "float", uTimeOffset: "float" } });
    }
  }, [material.uniforms.noiseTexture]);

  // Geometry + material are passed via args (not declarative) so R3F
  // won't dispose them — free them or every session leaks GPU memory.
  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  const lastFiredTimeRef = useRef(0);
  const addInterval = 0.03;
  const scaleTarget = 2;

  useFrame((state, delta) => {
    if (!ref.current) return;
    const camera = state.camera;
    const flamePositions = useGameStore.getState().flamePositions;
    const isBoosting = useGameStore.getState().isBoosting;
    // Boost flames live in world space (positions come from the store), so
    // their size/rise must scale with the kart explicitly — otherwise a mini
    // kart blows full-size flames. At scale=1 identical to before.
    const ks = useGameStore.getState().kartScale ?? 1;
    const spawnScale = 0.7 * ks;
    const fireDue = state.clock.getElapsedTime() - lastFiredTimeRef.current >= addInterval;
    if (fireDue) {
      let fired = false;
      if (flamePositions && isBoosting) {
        const noiseTexture = useGameStore.getState().noiseTexture;
        material.uniforms.noiseTexture.value = noiseTexture;
        const [left, right] = flamePositions;
        spawnFlame(ref.current, left, spawnScale);
        spawnFlame(ref.current, right, spawnScale);
        fired = true;
      }
      // Remote karts boosting: same flames at their exhausts (positions are
      // published by RemoteRacers; the scale follows the local kart size like
      // the local flames do).
      if (remoteFxSources.size > 0) {
        for (const src of remoteFxSources.values()) {
          if (!src.boosting) continue;
          if (!fired) {
            material.uniforms.noiseTexture.value = useGameStore.getState().noiseTexture;
          }
          spawnFlame(ref.current, src.flameL, spawnScale);
          spawnFlame(ref.current, src.flameR, spawnScale);
          fired = true;
        }
      }
      if (fired) lastFiredTimeRef.current = state.clock.getElapsedTime();
    }

    ref.current.updateInstances((obj) => {
      obj.currentTime += delta;
      obj.setUniform('uCurrentTime', obj.currentTime);
      obj.scale.lerp(_growTarget.set(scaleTarget * ks, scaleTarget * 2 * ks, scaleTarget * ks), 1 * delta);
      obj.position.y += delta * 13 * ks;

      camera.getWorldPosition(_camPos);
      _toCam.subVectors(_camPos, obj.position).normalize();


      _q1.setFromUnitVectors(_zAxis, _toCam);

      _q2.setFromEuler(_eul.set(0, 0, obj.randomZRotation));
      // (Dead shrink removed: the old `lerp(obj.scale, 0, delta*30)` passed
      // alpha=0, i.e. it never did anything. Growth above is the behavior.)

      _q1.multiply(_q2);

      obj.quaternion.copy(_q1);
      

      if (obj.currentTime > .5) {
        obj.remove();
      }
    });
  });

  return (
    <instancedMesh2
      ref={ref}
      args={[geometry, material, { createEntities: true }]}
      frustumCulled={false}
    />
  );
};

export default memo(Flames);

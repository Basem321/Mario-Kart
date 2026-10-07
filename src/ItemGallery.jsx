// DEV-ONLY item gallery (?dev=items). Never shipped: Root mounts it only
// when import.meta.env.DEV is true. Every visual state gets a stable URL so
// headless Chrome can screenshot it: ?dev=items&driver=mario&item=red3&
// pose=held&view=chase&guides=1&remote=1
//
// Tuning panel (T3): sliders for sizes + orbit radius + glove coords apply
// LIVE through sizeMul/radius props (same math as the game). "Copy config
// JSON" emits only the changed keys in itemConfig shape — paste them back
// into src/items/itemConfig.js.
//
// Headless readiness: <GalleryReady/> sets window.__galleryReady = true once
// the drei loading manager reports 100% (all GLBs decoded, Draco from the
// vendored /draco/ path). Screenshot scripts must wait for that flag.
import { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF, useProgress } from "@react-three/drei";
import * as THREE from "three";
import { Driver } from "./models/Driver";
import {
  BombModel,
  MushroomModel,
  RedShellModel,
  BlueShellModel,
  BulletModel,
  BlooperModel,
  RedTripleOrbit,
  GoldenSparkles,
  GoldenMushroom,
  ItemOrbit,
} from "./models/Pickups";
import { DriverSpace, GloveHand } from "./models/GloveHand";
import { itemConfig } from "./items/itemConfig.js";
import { animBlend, animDur, bodyPose, spinPose } from "./items/animCurves.js";

useGLTF.setDecoderPath("/draco/");

const GLOVE_POSES = [
  "handRest",
  "handWindup",
  "handForward",
  "handBack",
  "handUp",
  "handMouth",
  "handLeftRest",
  "handLeftCast",
];

const SCRUB_ANIMS = [
  "none",
  "item_got",
  "throw_forward",
  "throw_back",
  "throw_up",
  "cast_up",
  "use_mushroom",
  "spin_hit_light",
  "spin_hit_heavy",
];

function useGalleryParams() {
  return useMemo(() => {
    const q = new URLSearchParams(window.location.search);
    const at = Number(q.get("at"));
    return {
      driver: q.get("driver") || "mario",
      item: q.get("item") || "none",
      pose: q.get("pose") || "held",
      view: q.get("view") || "orbit",
      guides: q.get("guides") === "1",
      remote: q.get("remote") === "1",
      measure: q.get("measure") === "1",
      anim: q.get("anim") || "none",
      at: Number.isFinite(at) ? Math.max(0, Math.min(1, at)) : null,
      goldenPhase: q.get("goldenPhase") || "held",
    };
  }, []);
}

// Exposes the R3F camera/scene for headless probing (dev only).
function R3FExpose() {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    window.__r3f = { camera, scene };
  }, [camera, scene]);
  return null;
}

function GalleryReady() {
  const { progress } = useProgress();
  useEffect(() => {
    if (Number(progress) >= 100) {
      window.__galleryReady = true;
      // DOM-visible twin of the flag: headless --dump-dom can assert it.
      document.title = "__galleryReady";
    }
  }, [progress]);
  return null;
}

// Slice driver vertices into Y bands: head width/height, shoulder width.
// Displayed as text + console (drives item sizes in §1.1).
function DriverMeasure({ character, onDone }) {
  const { scene } = useGLTF(
    character === "luigi" ? "/models/luigi-driver.glb" : "/models/mario-driver.glb"
  );
  const report = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const bands = {};
    const step = size.y / 20;
    scene.updateWorldMatrix(true, true);
    const pts = [];
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position;
      const m = o.matrixWorld;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i += 4) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m);
        pts.push([v.x, v.y, v.z]);
      }
    });
    for (let b = 0; b < 20; b += 1) {
      const lo = box.min.y + b * step;
      const hi = lo + step;
      const inBand = pts.filter((p) => p[1] >= lo && p[1] < hi);
      if (inBand.length === 0) continue;
      const xs = inBand.map((p) => p[0]);
      bands[b] = {
        y: lo.toFixed(2),
        width: (Math.max(...xs) - Math.min(...xs)).toFixed(2),
        n: inBand.length,
      };
    }
    const out = { size: size.toArray().map((v) => +v.toFixed(2)), bands };
    console.log(`[gallery-measure] ${character}`, JSON.stringify(out));
    return out;
  }, [scene, character]);
  useMemo(() => onDone && onDone(report), [report, onDone]);
  return null;
}

function CameraRig({ view }) {
  const camera = useThree((s) => s.camera);
  useMemo(() => {
    if (view === "chase") {
      // True chase: tail side (-Z, where the rack lives), slight right
      // offset so the glove marker + held item read past the body.
      camera.position.set(3.8, 2.6, -7.8);
      camera.lookAt(0, 0.6, -0.3);
    } else {
      camera.position.set(4.2, 2.6, 4.2);
      camera.lookAt(0, 0.5, 0);
    }
  }, [camera, view]);
  return view === "orbit" ? <OrbitControls target={[0, 0.5, 0]} /> : null;
}

// Held preview mirrors the game HeldItems: singles in the glove (same
// GloveHand), triples in the shared ItemOrbit. Tune ratios apply live.
// animName/animT scrub the throw (frozenT) with the same curves as the game.
function HeldPreview({
  item,
  tune,
  driver,
  glovePose,
  animName = null,
  animT = null,
  goldenPhase = "held",
}) {
  const mul = (key) => tune.sizes[key] / itemConfig.sizes[key];
  const L = itemConfig.hold.lift;
  const scrub = animName && animName !== "none" && animT != null;
  const glove = (lift, node, isGolden = false) => (
    <DriverSpace>
      <GloveHand
        driver={driver}
        pose={glovePose}
        lift={lift}
        animName={scrub ? animName : null}
        animStart={0}
        animDur={scrub ? 1 : 0}
        frozenT={scrub ? animT : null}
        isGolden={isGolden}
      >
        {node}
      </GloveHand>
    </DriverSpace>
  );
  if (item === "none") return null;
  if (item === "mushroom")
    return glove(L.mushroom, <MushroomModel sizeMul={mul("mushroomHeld")} />);
  if (item === "mushroom3")
    return (
      <ItemOrbit
        count={3}
        radius={tune.orbitRadius}
        y={tune.orbitHeight}
        lift={itemConfig.orbit.lifts.mushroom}
      >
        {[0, 1, 2].map((i) => (
          <MushroomModel key={i} sizeMul={mul("mushroomHeld")} />
        ))}
      </ItemOrbit>
    );
  if (item === "golden") {
    const windowUntil =
      goldenPhase === "used"
        ? (typeof performance !== "undefined" ? performance.now() : 0) + 3500
        : goldenPhase === "preend"
        ? (typeof performance !== "undefined" ? performance.now() : 0) + 800
        : null;
    return glove(
      L.golden,
      <GoldenMushroom
        windowUntil={windowUntil}
        sizeMul={mul("mushroomHeld")}
      />,
      true
    );
  }
  if (item === "red")
    return glove(L.red, <RedShellModel sizeMul={mul("redShell") * tune.sizes.redShellSingleMul} />);
  if (item === "red3")
    return (
      <RedTripleOrbit
        count={3}
        radius={tune.orbitRadius}
        y={tune.orbitHeight}
        shellMul={mul("redShell")}
      />
    );
  if (item === "blue")
    return glove(L.blue, <BlueShellModel sizeMul={mul("blueShell") * tune.sizes.blueShellMul} />);
  if (item === "bullet")
    return glove(
      L.bullet,
      <BulletModel
        sizeMul={
          itemConfig.sizes.bulletHeldLength / itemConfig.sizes.bulletActiveLength
        }
      />
    );
  if (item === "blooper")
    return glove(
      L.blooper,
      <BlooperModel sizeMul={mul("bloopHeldHeight")} />
    );
  if (item === "bomb")
    return glove(
      L.bomb,
      <group scale={0.5}>
        <BombModel />
      </group>
    );
  return null;
}

function KartPreview({ driver, animName = null, animT = null }) {
  const { scene } = useGLTF("/models/kart.glb");
  const isSpin = animName === "spin_hit_light" || animName === "spin_hit_heavy";
  const spin = useMemo(() => {
    if (!isSpin || animT == null) return { pitch: 0, yaw: 0, roll: 0, hop: 0 };
    return spinPose(animName.includes("heavy") ? "heavy" : "light", animT);
  }, [isSpin, animName, animT]);
  // Scrubbed whole-body pose (T6): same bodyPose curves as the game.
  const bodyRot = useMemo(() => {
    if (isSpin || !animName || animName === "none" || animT == null) return [0, 0, 0];
    const pose = bodyPose(animName, animT);
    const b = animBlend(animT, animDur(animName));
    return [pose.pitch * b, pose.yaw * b, pose.roll * b];
  }, [isSpin, animName, animT]);
  const model = useMemo(() => {
    const clone = scene.clone();
    // kart.glb's "root" node carries an authoring scale of exactly 10
    // (verified from the GLB chunk). The game renders raw node geometries
    // (Kart.jsx meshes reach past the ancestors), so neutralize that node
    // here — otherwise the gallery kart is 10x game size. Geometry and
    // translations then match the game 1:1.
    clone.traverse((o) => {
      if (o.name === "root") o.scale.setScalar(1);
    });
    return clone;
  }, [scene]);
  return (
    <group
      name="spinGroup"
      position={[0, spin.hop, 0]}
      rotation={[spin.pitch, spin.yaw, spin.roll]}
    >
      <primitive object={model} />
      <group position={[0, 0.45, -0.1]} scale={0.7} rotation={bodyRot}>
        <Driver character={driver} />
      </group>
    </group>
  );
}



const BTN = {
  fontSize: "11px",
  padding: "2px 8px",
  margin: "2px",
  cursor: "pointer",
};

const SLIDER = { width: "110px", verticalAlign: "middle" };

function Slider({ label, value, min, max, step, onChange }) {
  return (
    <label style={{ display: "block", fontSize: 11 }}>
      {label} <b>{Number(value).toFixed(2)}</b>
      <input
        type="range"
        style={SLIDER}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export default function ItemGallery() {
  const params = useGalleryParams();
  const [measure, setMeasure] = useState(null);
  const [tuneJson, setTuneJson] = useState("");
  const [glovePose, setGlovePose] = useState("handRest");
  // Anim scrub (T6): freeze any throw/receive/use at time t.
  const [scrubAnim, setScrubAnim] = useState("none");
  const [scrubT, setScrubT] = useState(0.5);
  // Live tuning state, seeded from itemConfig.
  const [tune, setTune] = useState(() => ({
    sizes: {
      mushroomHeld: itemConfig.sizes.mushroomHeld,
      redShell: itemConfig.sizes.redShell,
      redShellSingleMul: itemConfig.sizes.redShellSingleMul ?? 0.7,
      blueShell: itemConfig.sizes.blueShell,
      blueShellMul: itemConfig.sizes.blueShellMul ?? 1,
      bloopHeldHeight: itemConfig.sizes.bloopHeldHeight,
    },
    orbitRadius: itemConfig.orbit.radius,
    orbitHeight: itemConfig.orbit.height,
    glove: {
      ...(itemConfig.driverRig[params.driver] ?? itemConfig.driverRig.mario),
    },
  }));
  useEffect(() => {
    window.__galleryReady = false;
  }, []);
  const setParam = (k, v) => {
    const q = new URLSearchParams(window.location.search);
    q.set(k, v);
    window.location.search = q.toString();
  };
  const setSize = (k, v) =>
    setTune((t) => ({ ...t, sizes: { ...t.sizes, [k]: v } }));
  const setGloveAxis = (i, v) => {
    const cur = [...(tune.glove[glovePose] ?? [0, 0, 0])];
    cur[i] = Math.round(v * 100) / 100;
    setTune((t) => ({ ...t, glove: { ...t.glove, [glovePose]: cur } }));
  };
  const copyConfigJson = () => {
    const out = {};
    const sizes = {};
    for (const k of Object.keys(tune.sizes)) {
      if (tune.sizes[k] !== itemConfig.sizes[k]) sizes[k] = tune.sizes[k];
    }
    if (Object.keys(sizes).length > 0) out.sizes = sizes;
    if (
      tune.orbitRadius !== itemConfig.orbit.radius ||
      tune.orbitHeight !== itemConfig.orbit.height
    ) {
      out.orbit = {};
      if (tune.orbitRadius !== itemConfig.orbit.radius) {
        out.orbit.radius = tune.orbitRadius;
      }
      if (tune.orbitHeight !== itemConfig.orbit.height) {
        out.orbit.height = tune.orbitHeight;
      }
    }
    const baseRig =
      itemConfig.driverRig[params.driver] ?? itemConfig.driverRig.mario;
    const rig = {};
    for (const k of Object.keys(tune.glove)) {
      const a = tune.glove[k];
      const b = baseRig[k];
      if (JSON.stringify(a) !== JSON.stringify(b)) rig[k] = a;
    }
    if (Object.keys(rig).length > 0) {
      out.driverRig = { [params.driver]: rig };
    }
    const text = JSON.stringify(out, null, 2);
    setTuneJson(text);
    try {
      navigator.clipboard?.writeText(text)?.catch?.(() => {});
    } catch {
      // clipboard unavailable headless — the <pre> below still shows it
    }
  };
  const items = [
    "none", "mushroom", "mushroom3", "golden", "red", "red3",
    "blue", "bullet", "blooper", "bomb",
  ];
  return (
    <div style={{ width: "100vw", height: "100vh", background: "#14161c", color: "#fff" }}>
      <div style={{ position: "absolute", zIndex: 10, padding: 10, maxWidth: 360, maxHeight: "100vh", overflowY: "auto" }}>
        <div>
          driver:
          {["mario", "luigi"].map((d) => (
            <button key={d} style={BTN} onClick={() => setParam("driver", d)}>{d}</button>
          ))}
        </div>
        <div>
          item:
          {items.map((i) => (
            <button key={i} style={BTN} onClick={() => setParam("item", i)}>{i}</button>
          ))}
        </div>
        {params.item === "golden" && (
          <div style={{ margin: "4px 0", background: "#332a10", padding: 4, borderRadius: 4 }}>
            golden phase:
            {["held", "used", "preend"].map((p) => (
              <button
                key={p}
                style={{
                  ...BTN,
                  background: (params.goldenPhase || "held") === p ? "#f59e0b" : undefined,
                  color: (params.goldenPhase || "held") === p ? "#000" : undefined,
                  fontWeight: (params.goldenPhase || "held") === p ? "bold" : undefined,
                }}
                onClick={() => setParam("goldenPhase", p)}
              >
                {p}
              </button>
            ))}
          </div>
        )}
        <div>
          view:
          <button style={BTN} onClick={() => setParam("view", "orbit")}>orbit</button>
          <button style={BTN} onClick={() => setParam("view", "chase")}>chase</button>
          <button style={BTN} onClick={() => setParam("guides", params.guides ? "0" : "1")}>
            guides:{params.guides ? "on" : "off"}
          </button>
          <button style={BTN} onClick={() => setParam("remote", params.remote ? "0" : "1")}>
            remote:{params.remote ? "on" : "off"}
          </button>
        </div>
        <div style={{ marginTop: 8, borderTop: "1px solid #555", paddingTop: 6 }}>
          <b style={{ fontSize: 12 }}>tuning (live)</b>
          <Slider label="mushroomHeld" value={tune.sizes.mushroomHeld} min={0.1} max={0.4} step={0.01} onChange={(v) => setSize("mushroomHeld", v)} />
          <Slider label="redShell" value={tune.sizes.redShell} min={0.08} max={0.3} step={0.01} onChange={(v) => setSize("redShell", v)} />
          <Slider label="redShellSingleMul" value={tune.sizes.redShellSingleMul} min={0.3} max={1.2} step={0.05} onChange={(v) => setSize("redShellSingleMul", v)} />
          <Slider label="blueShell" value={tune.sizes.blueShell} min={0.1} max={0.35} step={0.01} onChange={(v) => setSize("blueShell", v)} />
          <Slider label="blueShellMul" value={tune.sizes.blueShellMul} min={0.5} max={1.5} step={0.05} onChange={(v) => setSize("blueShellMul", v)} />
          <Slider label="bloopHeld" value={tune.sizes.bloopHeldHeight} min={0.15} max={0.5} step={0.01} onChange={(v) => setSize("bloopHeldHeight", v)} />
          <Slider label="orbit.radius" value={tune.orbitRadius} min={1.2} max={2.6} step={0.05} onChange={(v) => setTune((t) => ({ ...t, orbitRadius: Math.round(v * 100) / 100 }))} />
          <Slider label="orbit.height" value={tune.orbitHeight} min={-0.8} max={0.6} step={0.05} onChange={(v) => setTune((t) => ({ ...t, orbitHeight: Math.round(v * 100) / 100 }))} />
          <div style={{ fontSize: 11, marginTop: 4 }}>
            glove pose:
            <select value={glovePose} onChange={(e) => setGlovePose(e.target.value)}>
              {GLOVE_POSES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          {(tune.glove[glovePose] ?? []).map((v, i) => (
            <Slider
              key={`${glovePose}-${i}`}
              label={`${glovePose}[${"xyz"[i]}]`}
              value={v}
              min={i === 1 ? -0.5 : -1}
              max={i === 1 ? 1.5 : 1}
              step={0.05}
              onChange={(nv) => setGloveAxis(i, nv)}
            />
          ))}
          {(tune.glove.shoulder ?? []).map((v, i) => (
            <Slider
              key={`shoulder-${i}`}
              label={`shoulder[${"xyz"[i]}]`}
              value={v}
              min={-1}
              max={1}
              step={0.05}
              onChange={(nv) => {
                const cur = [...(tune.glove.shoulder ?? [0, 0, 0])];
                cur[i] = Math.round(nv * 100) / 100;
                setTune((t) => ({ ...t, glove: { ...t.glove, shoulder: cur } }));
              }}
            />
          ))}
          <Slider
            label="cuffLen"
            value={Number(tune.glove.cuffLen ?? 0.38)}
            min={0.1}
            max={0.8}
            step={0.02}
            onChange={(nv) => setTune((t) => ({ ...t, glove: { ...t.glove, cuffLen: Math.round(nv * 100) / 100 } }))}
          />
          <div style={{ fontSize: 11, marginTop: 4 }}>
            scrub anim:
            <select value={scrubAnim} onChange={(e) => setScrubAnim(e.target.value)}>
              {SCRUB_ANIMS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
          {scrubAnim !== "none" && (
            <Slider label={`t (${scrubAnim})`} value={scrubT} min={0} max={1} step={0.05} onChange={setScrubT} />
          )}
          <button style={{ ...BTN, marginTop: 6 }} onClick={copyConfigJson}>
            Copy config JSON
          </button>
          {tuneJson && (
            <pre style={{ fontSize: 10, background: "#0008", padding: 6, overflow: "auto", maxHeight: 200 }}>
              {tuneJson}
            </pre>
          )}
        </div>
        {params.measure && measure && (
          <pre style={{ fontSize: 10, background: "#0008", padding: 6, overflow: "auto", maxHeight: 300 }}>
            {JSON.stringify(measure, null, 1)}
          </pre>
        )}
        {params.remote && (
          <div style={{ fontSize: 11, color: "#ffd54a" }}>
            remote view: same HeldItems path as RemoteRacers (shared component from T3)
          </div>
        )}
      </div>
      <Canvas camera={{ fov: 50 }}>
        <color attach="background" args={["#232838"]} />
        <Suspense fallback={null}>
          <GalleryReady />
          <R3FExpose />
          <ambientLight intensity={0.9} />
          <directionalLight position={[5, 8, 5]} intensity={1.6} />
          <gridHelper args={[12, 12, 0x444444, 0x222222]} />
          {params.guides && (
            <>
              {/* kart-length ruler: 2.91 long box */}
              <mesh position={[0, 0.45, 0]}>
                <boxGeometry args={[1.4, 0.9, 2.91]} />
                <meshBasicMaterial color="#3af" wireframe transparent opacity={0.5} />
              </mesh>
              {/* orbit ring at the live tuning radius + plane height */}
              <mesh
                position={[itemConfig.sockets.orbitCenter[0], tune.orbitHeight, itemConfig.sockets.orbitCenter[2]]}
                rotation-x={-Math.PI / 2}
              >
                <ringGeometry args={[tune.orbitRadius - 0.03, tune.orbitRadius + 0.03, 64]} />
                <meshBasicMaterial color="#ffd54a" transparent opacity={0.7} side={THREE.DoubleSide} depthWrite={false} />
              </mesh>
            </>
          )}
          <KartPreview
            driver={params.driver}
            animName={scrubAnim !== "none" ? scrubAnim : params.anim}
            animT={scrubAnim !== "none" ? scrubT : params.at}
          />
          <HeldPreview
            item={params.item}
            tune={tune}
            driver={params.driver}
            glovePose={glovePose}
            animName={scrubAnim !== "none" ? scrubAnim : params.anim}
            animT={scrubAnim !== "none" ? scrubT : params.at}
            goldenPhase={params.goldenPhase}
          />
          {params.measure && (
            <DriverMeasure character={params.driver} onDone={setMeasure} />
          )}
          <CameraRig view={params.view} />
        </Suspense>
      </Canvas>
    </div>
  );
}

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
} from "./models/Pickups";
import { itemConfig } from "./items/itemConfig.js";

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

function useGalleryParams() {
  return useMemo(() => {
    const q = new URLSearchParams(window.location.search);
    return {
      driver: q.get("driver") || "mario",
      item: q.get("item") || "none",
      pose: q.get("pose") || "held",
      view: q.get("view") || "orbit",
      guides: q.get("guides") === "1",
      remote: q.get("remote") === "1",
      measure: q.get("measure") === "1",
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

const RACK = [0, 0.55, -1.4];

function HeldPreview({ item, tune }) {
  const mul = (key) => tune.sizes[key] / itemConfig.sizes[key];
  if (item === "none") return null;
  if (item === "mushroom")
    return (
      <group position={RACK}>
        <MushroomModel sizeMul={mul("mushroomHeld")} />
      </group>
    );
  if (item === "mushroom3")
    return (
      <group position={RACK}>
        {[-0.45, 0, 0.45].map((x) => (
          <group key={x} position={[x, 0, 0]}>
            <MushroomModel sizeMul={mul("mushroomHeld")} />
          </group>
        ))}
      </group>
    );
  if (item === "golden")
    return (
      <group position={RACK}>
        <MushroomModel gold sizeMul={mul("mushroomHeld")} />
      </group>
    );
  if (item === "red")
    return (
      <group position={[0, 0.35, -2.5]}>
        <RedShellModel sizeMul={mul("redShell")} />
      </group>
    );
  if (item === "red3")
    return (
      <RedTripleOrbit
        count={3}
        radius={tune.orbitRadius}
        shellMul={mul("redShell")}
      />
    );
  if (item === "blue")
    return (
      <group position={[0, 0.35, -2.5]}>
        <BlueShellModel sizeMul={mul("blueShell")} />
      </group>
    );
  if (item === "bullet") return <BulletModel />;
  if (item === "blooper")
    return (
      <group position={[0, 1.6, -1.4]}>
        <BlooperModel sizeMul={mul("bloopHeldHeight")} />
      </group>
    );
  if (item === "bomb")
    return (
      <group position={RACK}>
        <BombModel />
      </group>
    );
  return null;
}

function KartPreview({ driver }) {
  const { scene } = useGLTF("/models/kart.glb");
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
    <group>
      <primitive object={model} />
      <group position={[0, 0.45, -0.1]} scale={0.7}>
        <Driver character={driver} />
      </group>
    </group>
  );
}

// Glove-pose marker (T3): white sphere at the tuned driver-local pose so the
// hand position reads against driver + held item. The full GloveHand lands
// in T6; the coordinates tuned here feed driverRig directly.
function GloveMarker({ driver, pose, pos }) {
  const rig = itemConfig.driverRig[driver] ?? itemConfig.driverRig.mario;
  const radius = (rig.gloveRadius ?? 0.11) * 0.7;
  const p = pos ?? rig[pose] ?? rig.handRest;
  const kartLocal = [0.7 * p[0], 0.45 + 0.7 * p[1], -0.1 + 0.7 * p[2]];
  return (
    <group position={kartLocal}>
      <mesh>
        <sphereGeometry args={[radius, 20, 20]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.85} depthTest={false} />
      </mesh>
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
  // Live tuning state, seeded from itemConfig.
  const [tune, setTune] = useState(() => ({
    sizes: {
      mushroomHeld: itemConfig.sizes.mushroomHeld,
      redShell: itemConfig.sizes.redShell,
      blueShell: itemConfig.sizes.blueShell,
      bloopHeldHeight: itemConfig.sizes.bloopHeldHeight,
    },
    orbitRadius: itemConfig.orbit.radius,
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
    if (tune.orbitRadius !== itemConfig.orbit.radius) {
      out.orbit = { radius: tune.orbitRadius };
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
          <Slider label="blueShell" value={tune.sizes.blueShell} min={0.1} max={0.35} step={0.01} onChange={(v) => setSize("blueShell", v)} />
          <Slider label="bloopHeld" value={tune.sizes.bloopHeldHeight} min={0.15} max={0.5} step={0.01} onChange={(v) => setSize("bloopHeldHeight", v)} />
          <Slider label="orbit.radius" value={tune.orbitRadius} min={1.2} max={2.6} step={0.05} onChange={(v) => setTune((t) => ({ ...t, orbitRadius: Math.round(v * 100) / 100 }))} />
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
              {/* orbit ring at the live tuning radius */}
              <mesh
                position={[itemConfig.sockets.orbitCenter[0], itemConfig.sockets.orbitCenter[1], itemConfig.sockets.orbitCenter[2]]}
                rotation-x={-Math.PI / 2}
              >
                <ringGeometry args={[tune.orbitRadius - 0.03, tune.orbitRadius + 0.03, 64]} />
                <meshBasicMaterial color="#ffd54a" transparent opacity={0.7} side={THREE.DoubleSide} depthWrite={false} />
              </mesh>
            </>
          )}
          <KartPreview driver={params.driver} />
          <HeldPreview item={params.item} tune={tune} />
          <GloveMarker driver={params.driver} pose={glovePose} pos={tune.glove[glovePose]} />
          {params.measure && (
            <DriverMeasure character={params.driver} onDone={setMeasure} />
          )}
          <CameraRig view={params.view} />
        </Suspense>
      </Canvas>
    </div>
  );
}

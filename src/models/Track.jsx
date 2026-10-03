import { useGLTF } from "@react-three/drei";
import { getTrack } from "../tracks";
import { useGameManager } from "../gameManager";
import { useMapEditorStore } from "../mapEditorStore";
import * as THREE from "three";

const prepareSingleMaterial = (mat) => {
  if (!mat) return mat;
  if (!mat.userData?.configured) {
    mat.userData = mat.userData || {};
    mat.userData.configured = true;
    // Double-sided rendering so underside of bridges, tunnels, and terrain facets are never black or culled
    mat.side = THREE.DoubleSide;
    // Always write to depth so ground and roads are never invisible or sorted behind backdrops
    mat.depthWrite = true;

    // Disabling faulty baked vertex colors prevents black patches on imported models
    if (mat.vertexColors) {
      mat.vertexColors = false;
      mat.needsUpdate = true;
    }

    // Sketchfab exports often mark opaque surfaces as transparent with alphaMode BLEND.
    // Disabling transparency on near-opaque materials eliminates depth-sorting glitches.
    if (mat.transparent && (mat.opacity === undefined || mat.opacity >= 0.95) && !mat.alphaMap) {
      mat.transparent = false;
      mat.needsUpdate = true;
    }

    if (mat.roughness !== undefined && mat.roughness < 0.4) {
      mat.roughness = 0.6;
    }
    if (mat.metalness !== undefined && mat.metalness > 0.1) {
      mat.metalness = 0.05;
    }
  }
  return mat;
};

const prepareMaterial = (mat) => {
  if (!mat) return mat;
  if (Array.isArray(mat)) {
    return mat.map(prepareSingleMaterial);
  }
  return prepareSingleMaterial(mat);
};

/**
 * Course renderer driven by the active track (see tracks.js).
 * Mario Circuit keeps its exact hand-picked mesh list; other courses render
 * every node except configured exclusions (sky domes, paint decals covered
 * by virtual markings). Every rendered mesh is named "ground*" so the
 * existing wheel/wall raycasts, BVH builder and dust logic work unchanged.
 */
export function Track({ trackId: propTrackId, ...props }) {
  const gmTrackId = useGameManager((s) => s.selectedTrackId);
  const trackId = propTrackId ?? gmTrackId;
  const track = getTrack(trackId);
  const { nodes, materials } = useGLTF(track.glb, "/draco/");

  const editorOpen = useMapEditorStore((s) => s.isOpen);
  const editorOffset = useMapEditorStore((s) => s.editedConfig?.offset);
  const editorScale = useMapEditorStore((s) => s.editedConfig?.scale);

  const effectiveOffset = editorOpen && editorOffset ? editorOffset : track.offset;
  const effectiveScale = editorOpen && editorScale !== undefined ? editorScale : track.scale;

  if (track.explicitMeshes) {
    return (
      <group {...props} dispose={null} position={effectiveOffset} scale={effectiveScale}>
        {track.explicitMeshes.map(([nodeName, meshName, materialKey]) => {
          const node = nodes[nodeName];
          const material = materials[materialKey];
          if (!node || !material) return null;
          return (
            <mesh
              key={nodeName}
              name={meshName}
              receiveShadow
              geometry={node.geometry}
              material={prepareMaterial(material)}
            />
          );
        })}
      </group>
    );
  }

  const dirtSet = new Set(track.dirtNodes ?? []);
  const excludeSet = new Set(track.excludeNodes ?? []);
  // Some exports list every mesh twice (identical geometry + material under
  // two node names). The repeat draws nothing new — skip it to halve draw
  // calls, raycast targets and BVH memory.
  const seenGeometries = new Set();

  return (
    <group {...props} dispose={null} position={effectiveOffset} scale={effectiveScale}>
      {Object.entries(nodes).map(([nodeName, node]) => {
        if (!node || !node.geometry || excludeSet.has(nodeName)) return null;
        if (seenGeometries.has(node.geometry)) return null;
        seenGeometries.add(node.geometry);
        return (
          <mesh
            key={nodeName}
            name={dirtSet.has(nodeName) ? "ground dirt" : "ground"}
            receiveShadow
            geometry={node.geometry}
            material={prepareMaterial(node.material)}
          />
        );
      })}
    </group>
  );
}

useGLTF.preload("/models/mario-circuit-test-transformed.glb", "/draco/");
useGLTF.preload("/models/waluigi-stadiumMap.glb", "/draco/");
useGLTF.preload("/models/ds-shroom-ridge.glb", "/draco/");


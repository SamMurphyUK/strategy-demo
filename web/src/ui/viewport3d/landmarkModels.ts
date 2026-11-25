// The landmark models in assets/models/landmarks, turned into board props.
//
// Each file is a glTF with its colour in the vertices and no textures. A board prop is the same
// thing: flat faces, a colour and a part number per vertex, standing on z = 0. So a landmark is
// loaded, stood up (glTF is y-up, the board is z-up), given flat faces, and drawn by the same
// instanced prop material as a tree, with the sun, the shadows, and the grade all agreeing.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { LANDMARKS } from "./placements";
import { PART_FIXED } from "./propMeshes";

const urls = import.meta.glob("../../../assets/models/landmarks/landmark_*_solo.glb", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

function urlOf(id: string): string | null {
  const hit = Object.keys(urls).find((path) => path.endsWith(`landmark_${id}_solo.glb`));
  return hit ? urls[hit] : null;
}

/** A glTF vertex colour is linear and the board's are not. */
function toBoardColor(value: number): number {
  return THREE.MathUtils.clamp(Math.pow(value, 1 / 2.2), 0, 1);
}

/** One mesh as a board part: world-space, y-up turned to z-up, flat faces, colour and part per vertex. */
function boardPart(mesh: THREE.Mesh): THREE.BufferGeometry {
  let geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  if (geometry.index) {
    geometry = geometry.toNonIndexed();
  }
  const position = geometry.getAttribute("position");
  const count = position.count;
  const stored = geometry.getAttribute("color");
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const base = (material as THREE.MeshStandardMaterial | undefined)?.color ?? new THREE.Color(0.6, 0.6, 0.6);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = toBoardColor(stored ? stored.getX(i) : base.r);
    colors[i * 3 + 1] = toBoardColor(stored ? stored.getY(i) : base.g);
    colors[i * 3 + 2] = toBoardColor(stored ? stored.getZ(i) : base.b);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(new Float32Array(position.array), 3));
  out.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  out.setAttribute("aPart", new THREE.BufferAttribute(new Float32Array(count).fill(PART_FIXED), 1));
  out.rotateX(Math.PI / 2);
  out.computeVertexNormals();
  geometry.dispose();
  return out;
}

const cache = new Map<string, Promise<THREE.BufferGeometry | null>>();

/** One landmark as a prop model, or null when its file is missing or will not load. */
export function loadLandmark(id: string): Promise<THREE.BufferGeometry | null> {
  const known = cache.get(id);
  if (known) {
    return known;
  }
  const url = urlOf(id);
  const pending = url
    ? new GLTFLoader()
        .loadAsync(url)
        .then((gltf) => {
          gltf.scene.updateMatrixWorld(true);
          const parts: THREE.BufferGeometry[] = [];
          gltf.scene.traverse((node) => {
            if ((node as THREE.Mesh).isMesh) {
              parts.push(boardPart(node as THREE.Mesh));
            }
          });
          const merged = parts.length > 0 ? mergeGeometries(parts, false) : null;
          parts.forEach((part) => part.dispose());
          merged?.computeBoundingSphere();
          return merged;
        })
        .catch(() => null)
    : Promise.resolve(null);
  cache.set(id, pending);
  return pending;
}

/** Every landmark's model, as each one loads. */
export async function loadLandmarks(): Promise<Record<string, THREE.BufferGeometry>> {
  const loaded = await Promise.all(LANDMARKS.map(async (spec) => [spec.id, await loadLandmark(spec.id)] as const));
  const out: Record<string, THREE.BufferGeometry> = {};
  for (const [id, geometry] of loaded) {
    if (geometry) {
      out[id] = geometry;
    }
  }
  return out;
}

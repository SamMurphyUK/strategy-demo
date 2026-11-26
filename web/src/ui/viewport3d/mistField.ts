// The mist: a pool of soft flat ribbons, drawn as one instanced mesh and respent each frame on the sites nearest the
// camera. They drift on a curl field, fade in with the close zoom, and are never tone mapped, so their colour is the
// palette's own (see CLAUDE.md). The ribbons write no depth and cast no shadow.
import * as THREE from "three";
import { MIST_POOL, nearestSites, type MistSite } from "./mistPlacement";

/** Greatest alpha a ribbon reaches at full weight. Kept under 1 so the ground and the peaks read through. */
const MAX_ALPHA = 0.5;
/** How far from the camera's target a site may be, in world units, to be given a ribbon. */
const REACH = 70;

export interface MistParams {
  /** Where the camera looks, in map coordinates. */
  x: number;
  y: number;
  /** 0 to 1: the close-zoom fade (uMicroAlpha). */
  micro: number;
  /** The slider. */
  weight: number;
  /** The slider for the monsoon mist over Southeast Asia. */
  monsoon: number;
  /** How high the canopy stands over the ground, in world units. */
  canopy: number;
  seconds: number;
  /** The height the ground stands at a map point, in world units. */
  groundAt: (x: number, y: number) => number;
}

export interface MistField {
  mesh: THREE.InstancedMesh;
  update(params: MistParams, sites: readonly MistSite[]): void;
  dispose(): void;
}

export function createMist(): MistField {
  const quad = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute("position", quad.getAttribute("position"));
  geometry.setAttribute("uv", quad.getAttribute("uv"));
  // kind (0 valley, 1 jungle), seed, and the ribbon's own fade.
  const mist = new THREE.InstancedBufferAttribute(new Float32Array(MIST_POOL * 3), 3);
  mist.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("aMist", mist);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      uTime: { value: 0 },
      uMicroAlpha: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aMist;
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vMist;
      varying vec2 vDrift;
      void main() {
        vUv = uv;
        vMist = aMist;
        vec4 centre = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        // A curl of a slow stream function: the ribbons swirl without gathering or thinning.
        float t = uTime * (0.08 + aMist.y * 0.05);
        vec2 q = centre.xy * 0.21 + aMist.y * 9.0;
        // Two octaves of the curl: the slow swirl, and a finer billow riding on it.
        vec2 q2 = centre.xy * 0.55 + aMist.y * 4.0;
        vec2 curl = vec2(
          cos(q.y + t) * cos(q.x * 0.8 - t * 0.7) * 0.8 + cos(q2.y * 1.3 - t * 1.6) * sin(q2.x + t * 1.2) * 0.35,
          sin(q.x * 0.8 - t * 0.7) * sin(q.y + t) * 0.8 + sin(q2.x * 1.1 + t * 1.4) * cos(q2.y - t) * 0.35
        );
        vDrift = curl;
        vec4 world = instanceMatrix * vec4(position, 1.0);
        world.xy += curl * 2.2;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uMicroAlpha;
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vMist;
      varying vec2 vDrift;
      float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        vec2 c = vUv * 2.0 - 1.0;
        float soft = 1.0 - smoothstep(0.25, 1.0, length(c));
        float wisp = 0.55 + 0.45 * vn(vUv * vec2(5.0, 2.0) + vDrift * 1.5 + uTime * 0.04 + vMist.y * 20.0);
        float a = soft * wisp * vMist.z * uMicroAlpha * ${MAX_ALPHA.toFixed(2)};
        // Cool grey-blue in the valleys, a warm damp cream over the jungle, and over the monsoon jungles a thick humid olive-parchment (#D6DEC8).
        // Held at 0.88 or under, so the bloom never lights a ribbon.
        vec3 tint = mix(vec3(0.80, 0.87, 0.93), vec3(0.93, 0.89, 0.74), min(vMist.x, 1.0));
        tint = mix(tint, vec3(0.839, 0.871, 0.784), step(1.5, vMist.x));
        gl_FragColor = vec4(min(tint, vec3(0.88)), a);
      }
    `,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, MIST_POOL);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 4;
  const matrix = new THREE.Matrix4();
  const size = new THREE.Vector3(1, 1, 1);
  return {
    mesh,
    update(params, sites) {
      const alpha = params.micro * Math.max(params.weight, params.monsoon);
      material.uniforms.uTime.value = params.seconds;
      material.uniforms.uMicroAlpha.value = alpha;
      if (alpha <= 0.004 || sites.length === 0) {
        mesh.count = 0;
        return;
      }
      const picked = nearestSites(sites, params.x, params.y, MIST_POOL, REACH);
      mesh.count = picked.length;
      picked.forEach((site, i) => {
        const jungle = site.kind === "jungle";
        const dense = site.dense === true;
        const ground = params.groundAt(site.x, site.y);
        // Valley mist lies on the trough floor so the ridges stand out of it; jungle mist hangs a little over the canopy, and the monsoon mist
        // hugs just above the tree tops, on the ground's own height.
        const z = dense ? Math.max(0, ground) + params.canopy + site.seed * 0.25 : jungle ? 0.85 + site.seed * 0.2 : Math.max(0, ground) + 0.5 + site.seed * 0.4;
        const width = (dense ? 21 : jungle ? 16 : 11) * (0.8 + site.seed * 0.6);
        size.set(width, width * (0.32 + site.seed * 0.12), 1);
        matrix.makeRotationZ((site.seed - 0.5) * 1.2).scale(size).setPosition(site.x, -site.y, z);
        mesh.setMatrixAt(i, matrix);
        const edge = 1 - Math.min(1, Math.hypot(site.x - params.x, site.y - params.y) / REACH);
        mist.setXYZ(i, dense ? 2 : jungle ? 1 : 0, site.seed, Math.min(1, edge * 2.2) * (dense ? Math.min(1.6, params.monsoon) : 1));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mist.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}

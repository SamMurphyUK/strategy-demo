// Powder blown off the crests: golden sand spindrift off dune ridges, fine white snow off winter hills and mountain ridges. A pooled
// THREE.Points, anchored along the high-slope crests near the camera's target, streaming leeward along the wind, always above the ground,
// faded in by uMicroAlpha. The crests are found by sampling the ground's height (hills and ranges), keeping the points that are steep and
// stand higher than their surroundings. Never tone mapped; the colours are held under the bloom.
import * as THREE from "three";

export const POWDER_POOL = 240;
/** How many crest points the pool is spread over. */
const ANCHORS = 48;
/** How far round the target the crests are looked for, in world units. */
const REACH = 38;
/** Samples a search tries, and how often it is made, in seconds. */
const SAMPLES = 260;
const SEARCH_EVERY = 1.4;

export type PowderKind = "sand" | "snow" | null;

export const SAND_COLOUR: readonly [number, number, number] = [0.9, 0.76, 0.42];
export const SNOW_COLOUR: readonly [number, number, number] = [0.89, 0.91, 0.92];

function hash(i: number, salt: number): number {
  const s = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * How steep the ground is at a point and whether it stands on a crest: the height gradient over a small step, and how far the point rises
 * over the mean of a ring of points a few units round it. A crest is both steep and high.
 */
export function crestAt(groundAt: (x: number, y: number) => number, x: number, y: number): { slope: number; ridge: number } {
  const e = 1.1;
  const gx = (groundAt(x + e, y) - groundAt(x - e, y)) / (2 * e);
  const gy = (groundAt(x, y + e) - groundAt(x, y - e)) / (2 * e);
  const ring = 3.2;
  const around =
    (groundAt(x + ring, y) + groundAt(x - ring, y) + groundAt(x, y + ring) + groundAt(x, y - ring) + groundAt(x + ring * 0.7, y + ring * 0.7) + groundAt(x - ring * 0.7, y - ring * 0.7)) / 6;
  return { slope: Math.hypot(gx, gy), ridge: groundAt(x, y) - around };
}

export interface PowderParams {
  x: number;
  y: number;
  /** uMicroAlpha times the slider. */
  alpha: number;
  seconds: number;
  dt: number;
  /** The wind, along map x and y, in world units a second. */
  windX: number;
  windY: number;
  groundAt(x: number, y: number): number;
  /** What blows off the crest at a point: sand over desert, snow over winter ground, or nothing. */
  kindAt(x: number, y: number): PowderKind;
  /** The slope a crest must have, in world units of rise per unit. */
  threshold: number;
}

export interface CrestPowder {
  points: THREE.Points;
  update(params: PowderParams): void;
  dispose(): void;
}

interface Anchor {
  x: number;
  y: number;
  z: number;
  kind: Exclude<PowderKind, null>;
}

export function createPowder(): CrestPowder {
  const positions = new Float32Array(POWDER_POOL * 3);
  const colours = new Float32Array(POWDER_POOL * 4);
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(positions, 3);
  const colour = new THREE.BufferAttribute(colours, 4);
  position.setUsage(THREE.DynamicDrawUsage);
  colour.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", position);
  geometry.setAttribute("aColour", colour);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    vertexShader: /* glsl */ `
      attribute vec4 aColour;
      varying vec4 vColour;
      void main() {
        vColour = aColour;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 2.0;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec4 vColour;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        gl_FragColor = vec4(min(vColour.rgb, vec3(0.92)), (1.0 - smoothstep(0.3, 1.0, d)) * vColour.a);
      }
    `,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false;
  points.renderOrder = 5;
  let anchors: Anchor[] = [];
  let sinceSearch = 99;
  let searchedAt = { x: Number.NaN, y: Number.NaN };
  let round = 0;
  return {
    points,
    update(params) {
      if (params.alpha <= 0.01) {
        points.visible = false;
        return;
      }
      sinceSearch += params.dt;
      const moved = Math.hypot(params.x - searchedAt.x, params.y - searchedAt.y) > 14 || Number.isNaN(searchedAt.x);
      if (sinceSearch > SEARCH_EVERY && (moved || sinceSearch > SEARCH_EVERY * 4)) {
        sinceSearch = 0;
        searchedAt = { x: params.x, y: params.y };
        round += 1;
        const found: Anchor[] = [];
        for (let i = 0; i < SAMPLES && found.length < ANCHORS; i++) {
          const angle = hash(i + round * 977, 1) * Math.PI * 2;
          const reach = Math.sqrt(hash(i + round * 977, 2)) * REACH;
          const x = params.x + Math.cos(angle) * reach;
          const y = params.y + Math.sin(angle) * reach;
          const kind = params.kindAt(x, y);
          if (!kind) {
            continue;
          }
          const crest = crestAt(params.groundAt, x, y);
          if (crest.slope > params.threshold && crest.ridge > 0) {
            found.push({ x, y, z: params.groundAt(x, y), kind });
          }
        }
        anchors = found;
      }
      if (anchors.length === 0) {
        points.visible = false;
        return;
      }
      points.visible = true;
      const speed = Math.hypot(params.windX, params.windY) || 1;
      const ux = params.windX / speed;
      const uy = params.windY / speed;
      for (let i = 0; i < POWDER_POOL; i++) {
        const anchor = anchors[i % anchors.length];
        const life = 3.2 + hash(i, 4) * 2.4;
        const age = ((params.seconds + hash(i, 5) * life) % life) / life;
        // Streams leeward off the crest, spreading a little and lifting as it goes, then thinning out.
        const travel = age * (5 + hash(i, 6) * 5) * Math.max(0.4, speed * 0.6);
        const spread = (hash(i, 7) - 0.5) * 2.2 * age;
        const x = anchor.x + ux * travel - uy * spread;
        const y = anchor.y + uy * travel + ux * spread;
        const z = Math.max(params.groundAt(x, y), anchor.z) + 0.35 + age * 1.4 + hash(i, 8) * 0.4;
        positions[i * 3] = x;
        positions[i * 3 + 1] = -y;
        positions[i * 3 + 2] = z;
        const rgb = anchor.kind === "sand" ? SAND_COLOUR : SNOW_COLOUR;
        const fade = Math.sin(age * Math.PI);
        colours[i * 4] = rgb[0];
        colours[i * 4 + 1] = rgb[1];
        colours[i * 4 + 2] = rgb[2];
        colours[i * 4 + 3] = fade * params.alpha;
      }
      position.needsUpdate = true;
      colour.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

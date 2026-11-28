// Wind-swept snow flurries: a pool of points that drift round the camera's target over snow, and fade in with the close zoom and the
// weather's snow share. They stand above the ground (never under it), are never tone mapped, and cost one draw call.
import * as THREE from "three";

/** The pool: 700 flakes, up from 320 by a half and then by 45% again, so the powder is thick at the closest zoom. */
export const FLURRY_POOL = 700;

/** How strong a flake is at a point of the view. 1 at the middle, weak at the edge, never a hard cut. */
export function flurryEdgeFade(nx: number, ny: number): number {
  const edge = Math.min(1, Math.hypot(nx, ny));
  const t = Math.min(1, Math.max(0, (edge - 0.55) / 0.45));
  const s = t * t * (3 - 2 * t);
  return 1 - 0.8 * s;
}

export interface FlurryParams {
  /** Where the camera looks, in map coordinates. */
  x: number;
  y: number;
  /** Half the view, in world units, so the flakes cover the screen and not a fixed patch. */
  reachX: number;
  reachY: number;
  /** 0 to 1: the close-zoom fade times the snow share and the slider. */
  alpha: number;
  seconds: number;
  /** The wind, in world units a second along map x and y (see windStrength). */
  windX: number;
  windY: number;
  /** The ground's height at a map point, in world units. Flakes never go below it. */
  groundAt: (x: number, y: number) => number;
}

export interface Flurries {
  points: THREE.Points;
  update(params: FlurryParams): void;
  dispose(): void;
}

function hash(i: number, salt: number): number {
  const s = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

export function createFlurries(): Flurries {
  const positions = new Float32Array(FLURRY_POOL * 3);
  const fades = new Float32Array(FLURRY_POOL);
  const geometry = new THREE.BufferGeometry();
  const attribute = new THREE.BufferAttribute(positions, 3);
  attribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", attribute);
  const fadeAttribute = new THREE.BufferAttribute(fades, 1);
  fadeAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("aFade", fadeAttribute);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    uniforms: { uAlpha: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aFade;
      varying float vFade;
      void main() {
        vFade = aFade;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 3.0;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uAlpha;
      varying float vFade;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        gl_FragColor = vec4(0.93, 0.95, 0.97, (1.0 - smoothstep(0.4, 1.0, d)) * uAlpha * vFade * 0.8);
      }
    `,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false;
  points.renderOrder = 5;
  return {
    points,
    update(params) {
      material.uniforms.uAlpha.value = params.alpha;
      points.visible = params.alpha > 0.01;
      if (!points.visible) {
        return;
      }
      const reachX = Math.max(params.reachX, 1);
      const reachY = Math.max(params.reachY, 1);
      for (let i = 0; i < FLURRY_POOL; i++) {
        // Each flake has its own fall, drift, and phase, and wraps across the view so the screen stays covered.
        const speed = 0.6 + hash(i, 1) * 0.9;
        const u = hash(i, 2);
        const v = hash(i, 3);
        const wrap = (value: number, reach: number) => ((value % (reach * 2)) + reach * 2) % (reach * 2) - reach;
        const x = params.x + wrap((u * 2 - 1) * reachX + params.windX * params.seconds * speed + Math.sin(params.seconds * 0.7 + i) * 0.8, reachX);
        const y = params.y + wrap((v * 2 - 1) * reachY + params.windY * params.seconds * speed + Math.cos(params.seconds * 0.6 + i * 1.7) * 0.8, reachY);
        const fall = ((hash(i, 4) * 8 + params.seconds * (0.5 + speed * 0.6)) % 8);
        const z = Math.max(params.groundAt(x, y), 0) + 0.4 + (8 - fall);
        positions[i * 3] = x;
        positions[i * 3 + 1] = -y;
        positions[i * 3 + 2] = z;
        fades[i] = flurryEdgeFade((x - params.x) / reachX, (y - params.y) / reachY);
      }
      attribute.needsUpdate = true;
      fadeAttribute.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

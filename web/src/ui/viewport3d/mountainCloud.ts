// Soft clouds that float down from the mountains. A pool of flat, soft ribbons: each is born on a high point near the camera's target,
// drifts downhill with the slope, thickens and thins over its life, and is let go; its slot is then given a new high point. A slot keeps
// its anchor for its whole life and only the alpha moves, so nothing pops in or out as the camera zooms or pans: the clouds fade with
// uMicroAlpha and with their own age. Never tone mapped, held at 0.88 so the bloom never lights them.
import * as THREE from "three";

export const CLOUD_POOL = 28;
/** How far from the camera's target a cloud may be born, in world units. */
const REACH = 62;
const SEARCH_EVERY = 1.6;

function hash(i: number, salt: number): number {
  const s = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

export interface CloudParams {
  x: number;
  y: number;
  /** uMicroAlpha times the slider. */
  alpha: number;
  seconds: number;
  dt: number;
  groundAt(x: number, y: number): number;
}

export interface MountainClouds {
  mesh: THREE.InstancedMesh;
  update(params: CloudParams): void;
  dispose(): void;
}

interface Slot {
  ax: number;
  ay: number;
  dx: number;
  dy: number;
  age: number;
  life: number;
  speed: number;
  active: boolean;
}

/** The unit direction a cloud drifts at a point: down the slope, or along a default when the ground is flat there. */
export function downhill(groundAt: (x: number, y: number) => number, x: number, y: number, fallback: { x: number; y: number }): { x: number; y: number } {
  const e = 1.2;
  const gx = (groundAt(x + e, y) - groundAt(x - e, y)) / (2 * e);
  const gy = (groundAt(x, y + e) - groundAt(x, y - e)) / (2 * e);
  const length = Math.hypot(gx, gy);
  if (length < 0.004) {
    return fallback;
  }
  return { x: -gx / length, y: -gy / length };
}

export function createClouds(): MountainClouds {
  const quad = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute("position", quad.getAttribute("position"));
  geometry.setAttribute("uv", quad.getAttribute("uv"));
  quad.dispose();
  // per cloud: seed and alpha.
  const cloud = new THREE.InstancedBufferAttribute(new Float32Array(CLOUD_POOL * 2), 2);
  cloud.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("aCloud", cloud);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec2 aCloud;
      varying vec2 vUv;
      varying vec2 vCloud;
      void main() {
        vUv = uv;
        vCloud = aCloud;
        gl_Position = projectionMatrix * viewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying vec2 vCloud;
      float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        vec2 c = vUv * 2.0 - 1.0;
        // A soft body with a billowing edge: the outline is broken by two scales of noise that turn slowly with the cloud's seed.
        float edge = length(c * vec2(1.0, 1.25)) + (vn(vUv * 4.0 + vCloud.x * 31.0 + uTime * 0.05) - 0.5) * 0.5 + (vn(vUv * 9.0 + vCloud.x * 7.0) - 0.5) * 0.18;
        float body = 1.0 - smoothstep(0.15, 1.0, edge);
        float a = body * vCloud.y * 0.46;
        gl_FragColor = vec4(min(vec3(0.86, 0.88, 0.9), vec3(0.88)), a);
      }
    `,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, CLOUD_POOL);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  const slots: Slot[] = Array.from({ length: CLOUD_POOL }, (_, i) => ({ ax: 0, ay: 0, dx: 1, dy: 0, age: hash(i, 1) * 20, life: 18 + hash(i, 2) * 10, speed: 1.4 + hash(i, 3) * 1.1, active: false }));
  let candidates: { x: number; y: number }[] = [];
  let searched = { x: Number.NaN, y: Number.NaN };
  let since = 99;
  let round = 0;
  let spawns = 0;
  const matrix = new THREE.Matrix4();
  const size = new THREE.Vector3(1, 1, 1);
  return {
    mesh,
    update(params) {
      material.uniforms.uTime.value = params.seconds;
      if (params.alpha <= 0.004) {
        mesh.count = 0;
        return;
      }
      since += params.dt;
      const moved = Math.hypot(params.x - searched.x, params.y - searched.y) > 16 || Number.isNaN(searched.x);
      if (since > SEARCH_EVERY && (moved || since > SEARCH_EVERY * 5)) {
        since = 0;
        searched = { x: params.x, y: params.y };
        round += 1;
        const found: { x: number; y: number; h: number }[] = [];
        for (let i = 0; i < 340; i++) {
          const angle = hash(i + round * 733, 1) * Math.PI * 2;
          const reach = Math.sqrt(hash(i + round * 733, 2)) * REACH;
          const x = params.x + Math.cos(angle) * reach;
          const y = params.y + Math.sin(angle) * reach;
          found.push({ x, y, h: params.groundAt(x, y) });
        }
        const top = Math.max(...found.map((item) => item.h), 0);
        // Born high: on the upper part of whatever range is near, and only where there is a range.
        candidates = top > 0.8 ? found.filter((item) => item.h > top * 0.55).sort((a, b) => b.h - a.h).slice(0, 48) : [];
      }
      let count = 0;
      const wind = { x: 0.9, y: 0.35 };
      slots.forEach((slot, i) => {
        if (!slot.active || slot.age >= slot.life) {
          if (candidates.length === 0) {
            slot.active = false;
            return;
          }
          // A new life, from a high point; the slot waits out its old fade before taking it, so nothing jumps.
          const pick = candidates[Math.floor(hash(spawns++ + i * 7, 5) * candidates.length)];
          slot.ax = pick.x;
          slot.ay = pick.y;
          const way = downhill(params.groundAt, pick.x, pick.y, wind);
          slot.dx = way.x;
          slot.dy = way.y;
          slot.age = 0;
          slot.life = 18 + hash(spawns, 9) * 10;
          slot.speed = 1.4 + hash(spawns, 11) * 1.1;
          slot.active = true;
        }
        slot.age += params.dt;
        const t = slot.age / slot.life;
        const travel = slot.age * slot.speed;
        // Down the slope, bending a little as it goes.
        const bend = Math.sin(t * Math.PI * 1.3 + i) * 2.4;
        const x = slot.ax + slot.dx * travel - slot.dy * bend;
        const y = slot.ay + slot.dy * travel + slot.dx * bend;
        const away = Math.hypot(x - params.x, y - params.y);
        const life = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t))), 1.4);
        const fade = life * Math.min(1, Math.max(0, (REACH * 1.15 - away) / 14)) * Math.min(1, params.alpha);
        const width = (28 + hash(i, 13) * 14) * (0.7 + 0.5 * life);
        size.set(width, width * 0.42, 1);
        const z = Math.max(0, params.groundAt(x, y)) + 1.2 + hash(i, 14) * 0.9;
        matrix.makeRotationZ(-Math.atan2(slot.dy, slot.dx)).scale(size).setPosition(x, -y, z);
        mesh.setMatrixAt(count, matrix);
        cloud.setXY(count, hash(i, 15), fade);
        count += 1;
      });
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      cloud.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}

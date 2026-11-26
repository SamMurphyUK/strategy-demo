// Bird flocks over the close-up board: a pooled InstancedMesh of small flat birds with a flap in the vertex shader, in the board's pixel
// style (flat colour, never tone mapped). Two or three flocks of eight to twelve birds spawn upwind just outside the camera's target
// when the micro tier is in (uMicroAlpha above 0.25), glide across the scene on a 3D curl-noise flow field, stay clear above the ground
// and the peaks, fade out as they leave or as the camera pulls back, and come again after a cooldown. Pale gulls near a coast, dark
// silhouettes inland. The simulation is pure, apart from the mesh it writes into; nothing here touches React.
import * as THREE from "three";

/** Flocks the pool holds: three is the usual, and over Africa twice as many fly. */
export const BASE_FLOCKS = 3;
export const FLOCKS = BASE_FLOCKS * 2;
export const BIRDS_PER_FLOCK = 10;
export const BIRD_POOL = FLOCKS * BIRDS_PER_FLOCK;
/** How far from the camera's target a flock may stray before it is let go, in world units. */
export const FLOCK_REACH = 70;
/** Birds fly at least this far above the ground, in world units. */
export const CLEARANCE = 3.5;

export const GULL: readonly [number, number, number] = [0.9, 0.9, 0.88];
export const CROW: readonly [number, number, number] = [0.2, 0.19, 0.23];

function hash(i: number, salt: number): number {
  const s = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * A smooth, divergence-free flow in 3D: the curl of a slowly turning vector potential. Components are in world units a second, about
 * one in size, so a flock is swung along its way and never bunched up or drained.
 */
export function curlFlow(x: number, y: number, z: number, t: number): { x: number; y: number; z: number } {
  const a = x * 0.07 + t * 0.11;
  const b = y * 0.07 - t * 0.09;
  const c = z * 0.12 + t * 0.07;
  // Potential P = (sin(b + c), sin(c + a), sin(a + b)); curl P = (dPz/dy - dPy/dz, dPx/dz - dPz/dx, dPy/dx - dPx/dy).
  return {
    x: (Math.cos(a + b) * 0.07 - Math.cos(c + a) * 0.12) * 9,
    y: (Math.cos(b + c) * 0.12 - Math.cos(a + b) * 0.07) * 9,
    z: (Math.cos(c + a) * 0.07 - Math.cos(b + c) * 0.07) * 9,
  };
}

/** A point upwind of the target, just outside the view: `reach` units against the wind, with a lateral scatter. */
export function spawnPoint(target: { x: number; y: number }, wind: { x: number; y: number }, reach: number, scatter: number): { x: number; y: number } {
  const length = Math.hypot(wind.x, wind.y) || 1;
  const ux = wind.x / length;
  const uy = wind.y / length;
  return { x: target.x - ux * reach + -uy * scatter, y: target.y - uy * reach + ux * scatter };
}

interface Flock {
  active: boolean;
  /** Seconds until it may spawn, when it is not active. */
  cooldown: number;
  age: number;
  life: number;
  fade: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  seed: number;
  /** The colour a flock keeps for its whole flight: set where it spawned, never changed after. */
  gull: boolean;
}

export interface BirdParams {
  /** Where the camera looks, in map coordinates. */
  x: number;
  y: number;
  /** uMicroAlpha. */
  micro: number;
  /** The slider: 0 none, 1 three flocks, above 1 the flocks are louder. */
  weight: number;
  seconds: number;
  dt: number;
  /** The wind, in world units a second along map x and y. */
  windX: number;
  windY: number;
  /** Height of the ground (hills, ranges, lowered islands) at a map point. */
  groundAt(x: number, y: number): number;
  /** True where land is near water: the gulls' place. Asked once, where a flock spawns. */
  coastAt(x: number, y: number): boolean;
  /** How many times the usual flocks fly here: 2 over Africa, else 1. */
  boost: number;
}

export interface BirdFlocks {
  mesh: THREE.InstancedMesh;
  update(params: BirdParams): void;
  dispose(): void;
}

/** A bird: a body, and two wings that flap. Flat in the plane z = 0, facing +x, about one unit across. */
function birdGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  // x forward, y across. wing tips (y = ±0.5) carry the flap, through attribute `aWing` (0 at the body, 1 at the tip).
  const positions = new Float32Array([
    // body
    0.32, 0, 0, -0.18, 0.07, 0, -0.18, -0.07, 0,
    // left wing
    0.12, 0.05, 0, -0.2, 0.05, 0, -0.08, 0.5, 0,
    // right wing
    0.12, -0.05, 0, -0.2, -0.05, 0, -0.08, -0.5, 0,
  ]);
  const wing = new Float32Array([0, 0, 0, 0, 0, 1, 0, 0, 1]);
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aWing", new THREE.BufferAttribute(wing, 1));
  return geometry;
}

export function createBirds(): BirdFlocks {
  const geometry = birdGeometry();
  // per bird: flap phase, tint (rgb) and fade.
  const phase = new THREE.InstancedBufferAttribute(new Float32Array(BIRD_POOL), 1);
  const tint = new THREE.InstancedBufferAttribute(new Float32Array(BIRD_POOL * 4), 4);
  phase.setUsage(THREE.DynamicDrawUsage);
  tint.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("aPhase", phase);
  geometry.setAttribute("aTint", tint);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    // Over everything the 3D scene draws (the 2D planes and units are painted above it anyway).
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aWing;
      attribute float aPhase;
      attribute vec4 aTint;
      uniform float uTime;
      varying vec4 vTint;
      void main() {
        vTint = aTint;
        vec3 p = position;
        // The flap: the wing tips beat up and down, about a quarter of a turn behind the shoulder.
        p.z += aWing * sin(uTime * 7.0 + aPhase) * 0.32;
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec4 vTint;
      void main() {
        // The board's pixel look: flat colour, and the fade a hard dither of whole pixels, not a soft blend.
        float bayer = fract(dot(floor(gl_FragCoord.xy), vec2(0.5, 0.75)));
        if (vTint.a < 0.04 || vTint.a < bayer * 0.9) {
          discard;
        }
        gl_FragColor = vec4(min(vTint.rgb, vec3(0.92)), 1.0);
      }
    `,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, BIRD_POOL);
  mesh.count = BIRD_POOL;
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 50;
  const flocks: Flock[] = Array.from({ length: FLOCKS }, (_, i) => ({ active: false, cooldown: 1 + i * 3, age: 0, life: 0, fade: 0, x: 0, y: 0, z: 0, heading: 0, seed: i + 1, gull: false }));
  const dummy = new THREE.Object3D();
  let spawns = 0;
  return {
    mesh,
    update(params) {
      material.uniforms.uTime.value = params.seconds;
      const wanted = params.micro > 0.25 && params.weight > 0.01 ? Math.min(FLOCKS, Math.max(1, Math.round((1 + params.weight * 2) * params.boost))) : 0;
      const closeness = Math.min(1, Math.max(0, (params.micro - 0.25) / 0.3));
      let any = false;
      flocks.forEach((flock, f) => {
        if (!flock.active) {
          flock.cooldown -= params.dt;
          if (flock.cooldown <= 0 && f < wanted) {
            spawns += 1;
            const reach = FLOCK_REACH * 0.85;
            const at = spawnPoint({ x: params.x, y: params.y }, { x: params.windX, y: params.windY }, reach, (hash(spawns, flock.seed) - 0.5) * 50);
            flock.active = true;
            // Its colour is the colour of where it comes from, and it keeps it: no shift as it crosses a coast.
            flock.gull = params.coastAt(at.x, at.y);
            flock.x = at.x;
            flock.y = at.y;
            flock.z = params.groundAt(at.x, at.y) + CLEARANCE + 2 + hash(spawns, 7) * 4;
            flock.heading = Math.atan2(params.windY, params.windX) + (hash(spawns, 3) - 0.5) * 0.6;
            flock.age = 0;
            flock.life = 22 + hash(spawns, 5) * 14;
            flock.fade = 0;
          }
        }
        if (flock.active) {
          // Glide: the wind's drift and a steady push forward, bent by the curl field. Climb over what lies ahead.
          const flow = curlFlow(flock.x, flock.y, flock.z, params.seconds + flock.seed * 17);
          const speed = 3.4 + flock.seed * 0.5;
          const vx = Math.cos(flock.heading) * speed + params.windX * 0.5 + flow.x;
          const vy = Math.sin(flock.heading) * speed + params.windY * 0.5 + flow.y;
          // Turn toward the way it is carried, by the short way round.
          let turn = Math.atan2(vy, vx) - flock.heading;
          turn = Math.atan2(Math.sin(turn), Math.cos(turn));
          flock.heading += turn * 0.03;
          flock.x += vx * params.dt;
          flock.y += vy * params.dt;
          const ahead = Math.max(params.groundAt(flock.x, flock.y), params.groundAt(flock.x + vx * 2, flock.y + vy * 2));
          const floor = ahead + CLEARANCE;
          flock.z += (flow.z * 0.6 + (flock.z < floor + 1 ? 2.4 : -0.2)) * params.dt;
          flock.z = Math.max(flock.z, floor);
          flock.age += params.dt;
          const away = Math.hypot(flock.x - params.x, flock.y - params.y);
          // It fades in over the first seconds and out as its life ends or it leaves; it is let go when it is gone.
          const into = Math.min(1, flock.age / 2.5);
          const outOf = Math.min(1, Math.max(0, (flock.life - flock.age) / 3), Math.max(0, (FLOCK_REACH * 1.15 - away) / 12));
          flock.fade = Math.min(into, outOf) * closeness;
          if (flock.age > flock.life || away > FLOCK_REACH * 1.2 || (params.micro < 0.2 && flock.fade < 0.02)) {
            flock.active = false;
            flock.cooldown = 6 + hash(spawns, flock.seed + 9) * 8;
            flock.fade = 0;
          }
        }
        const coast = flock.gull;
        for (let b = 0; b < BIRDS_PER_FLOCK; b++) {
          const i = f * BIRDS_PER_FLOCK + b;
          const alpha = flock.active ? flock.fade : 0;
          if (alpha <= 0.001) {
            tint.setXYZW(i, 0, 0, 0, 0);
            continue;
          }
          any = true;
          // Each bird holds a loose place in the flock, a V and a wobble, and its own flap.
          const row = Math.floor(b / 2) + 1;
          const side = b % 2 === 0 ? 1 : -1;
          const along = -row * 1.5 + Math.sin(params.seconds * 0.9 + b * 1.7) * 0.6;
          const across = side * row * 1.2 + Math.cos(params.seconds * 0.7 + b * 2.3) * 0.5;
          const c = Math.cos(flock.heading);
          const s = Math.sin(flock.heading);
          const bx = flock.x + c * along - s * across;
          const by = flock.y + s * along + c * across;
          const bz = flock.z + Math.sin(params.seconds * 1.1 + b) * 0.5 + (b % 3) * 0.3;
          dummy.position.set(bx, -by, bz);
          // Map y runs south and scene y north, so the heading flips with it.
          dummy.rotation.set(0, 0, -flock.heading + Math.sin(params.seconds * 1.3 + b) * 0.08);
          dummy.scale.setScalar(1.6);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          const colour = coast ? GULL : CROW;
          tint.setXYZW(i, colour[0], colour[1], colour[2], alpha);
          phase.setX(i, b * 1.9 + flock.seed * 3);
        }
      });
      mesh.visible = any;
      mesh.instanceMatrix.needsUpdate = true;
      tint.needsUpdate = true;
      phase.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}

// Where the sun's shadow camera stands. Pure: no Three.js, no DOM.
//
// The shadow map is one orthographic picture of the table taken from the sun. It is fitted to
// what the board camera shows and to nothing else, so its texels are spent on the screen: a texel
// lands on about a pixel at every zoom. The ground the map has to cover is the view's rectangle on
// the land, and the same rectangle on the water, which lies lower and is slid north (see
// boardCamera.ts). Whatever casts into that ground lies on a ray toward the sun from it, so it is
// already inside the picture sideways, and only the depth range has to reach up to it.
//
// The camera moves in whole texels. A pan then slides the map under the shadows without the edge
// of each one crawling.
//
// Scene coordinates: x east, y north, z up.
import type { Triple } from "./sun";

export interface ShadowGround {
  /** The middle of the view on the land plane. */
  centerX: number;
  centerY: number;
  /** Half the view's reach east to west, and north to south along the ground. */
  halfWidth: number;
  halfDepth: number;
  /** How far the water lies below the land, and how far north its picture is slid. */
  seaDrop: number;
  seaShift: number;
  /** Height of the tallest thing that casts. */
  top: number;
}

export interface ShadowFit {
  /** Where the camera sits, and a point one unit along its line of sight. */
  position: Triple;
  target: Triple;
  /** Half the width and half the height of the orthographic frustum. */
  halfWidth: number;
  halfHeight: number;
  near: number;
  far: number;
  /** World size of a texel across and down the map. */
  texelX: number;
  texelY: number;
}

/** Slack round the fitted ground, as a share of its size: a soft edge samples a texel past it. */
const PAD = 0.03;
/** Clear air between the tallest caster and the camera, and below the water. */
const DEPTH_MARGIN = 4;

function dot(a: Triple, b: Triple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * The camera's axes for a light direction: `x` level across the light, `y` up the picture, `z`
 * back toward the sun. They are the axes Three.js builds from `lookAt` with z up.
 */
export function lightAxes(light: Triple): { x: Triple; y: Triple; z: Triple } {
  const length = Math.hypot(light[0], light[1], light[2]) || 1;
  const z: Triple = [light[0] / length, light[1] / length, light[2] / length];
  const flat = Math.hypot(z[0], z[1]);
  const x: Triple = flat < 1e-6 ? [1, 0, 0] : [-z[1] / flat, z[0] / flat, 0];
  const y: Triple = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  return { x, y, z };
}

/** The shadow camera for a light direction (a unit vector toward the sun) and the ground in view. */
export function fitSunShadow(light: Triple, ground: ShadowGround, mapSize: number): ShadowFit {
  const { x, y, z } = lightAxes(light);
  const hw = Math.max(ground.halfWidth, 1e-3);
  const hd = Math.max(ground.halfDepth, 1e-3);
  // Corners measured from the middle of the view, so the size does not change as the view pans.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const land: Triple = [sx * hw, sy * hd, 0];
      const sea: Triple = [sx * hw, sy * hd + ground.seaShift, -ground.seaDrop];
      const roof: Triple = [sx * hw, sy * hd, ground.top];
      for (const corner of [land, sea]) {
        minX = Math.min(minX, dot(corner, x));
        maxX = Math.max(maxX, dot(corner, x));
        minY = Math.min(minY, dot(corner, y));
        maxY = Math.max(maxY, dot(corner, y));
      }
      for (const corner of [land, sea, roof]) {
        minZ = Math.min(minZ, dot(corner, z));
        maxZ = Math.max(maxZ, dot(corner, z));
      }
    }
  }
  const halfWidth = ((maxX - minX) / 2) * (1 + PAD);
  const halfHeight = ((maxY - minY) / 2) * (1 + PAD);
  const size = Math.max(1, Math.floor(mapSize));
  const texelX = (halfWidth * 2) / size;
  const texelY = (halfHeight * 2) / size;
  const center: Triple = [ground.centerX, ground.centerY, 0];
  // The middle of the picture in the light's own axes, moved to a whole texel.
  const lx = Math.round((dot(center, x) + (minX + maxX) / 2) / texelX) * texelX;
  const ly = Math.round((dot(center, y) + (minY + maxY) / 2) / texelY) * texelY;
  const lz = dot(center, z) + maxZ + DEPTH_MARGIN;
  const position: Triple = [
    x[0] * lx + y[0] * ly + z[0] * lz,
    x[1] * lx + y[1] * ly + z[1] * lz,
    x[2] * lx + y[2] * ly + z[2] * lz,
  ];
  return {
    position,
    target: [position[0] - z[0], position[1] - z[1], position[2] - z[2]],
    halfWidth,
    halfHeight,
    near: 0.5,
    far: maxZ - minZ + DEPTH_MARGIN * 2,
    texelX,
    texelY,
  };
}

/**
 * Where a scene point lands in the shadow map: `u` and `v` from 0 to 1 across it, and `depth` from
 * 0 at the near plane to 1 at the far one. The pure twin of the matrix the board hands its shaders.
 */
export function shadowCoord(fit: ShadowFit, light: Triple, point: Triple): { u: number; v: number; depth: number } {
  const { x, y, z } = lightAxes(light);
  const from: Triple = [point[0] - fit.position[0], point[1] - fit.position[1], point[2] - fit.position[2]];
  return {
    u: dot(from, x) / (fit.halfWidth * 2) + 0.5,
    v: dot(from, y) / (fit.halfHeight * 2) + 0.5,
    depth: (-dot(from, z) - fit.near) / (fit.far - fit.near),
  };
}

// The natural ground under the faction wash: what colour the land is before anyone owns it. Pure.
//
// A territory's `land_cover` names its ground. Where a map leaves it unset, the world's biomes
// stand in (see ../geography.ts), so the demo map still gets steppe, sand, and taiga in the right
// places. Every colour here is low in saturation: the ground is a backdrop for the pieces.
import type { Rect, Vec2 } from "../../map/geometry";
import { type Biome, biomeAtMap } from "../geography";

export type LandCover = "OPEN" | "FOREST" | "MOUNTAIN" | "DESERT" | "SNOW" | "URBAN";

export type Rgb = [number, number, number];

/** Ground colours by cover, as sRGB hex. */
export const LAND_COVER_COLOR: Record<LandCover, string> = {
  /** Muted olive-sage grass. */
  OPEN: "#99A183",
  /** Deeper moss and pine earth. */
  FOREST: "#6F8066",
  /** Cool slate-ochre rock. */
  MOUNTAIN: "#8F8B82",
  /** Pale sand-ochre. */
  DESERT: "#CBBFA1",
  /** Frosted grey-white. */
  SNOW: "#DCDFDB",
  /** Worn stone and packed earth. */
  URBAN: "#A49D92",
};

const COVERS = Object.keys(LAND_COVER_COLOR) as LandCover[];

/** The cover a map value names. Empty and unknown values are open ground. */
export function landCoverOf(value: string | null | undefined): LandCover {
  const name = String(value ?? "").trim().toUpperCase();
  return COVERS.includes(name as LandCover) ? (name as LandCover) : "OPEN";
}

export function rgbOfHex(hex: string): Rgb {
  return [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const OPEN = rgbOfHex(LAND_COVER_COLOR.OPEN);
const FOREST = rgbOfHex(LAND_COVER_COLOR.FOREST);
const DESERT = rgbOfHex(LAND_COVER_COLOR.DESERT);
const SNOW = rgbOfHex(LAND_COVER_COLOR.SNOW);

/** Each biome as a blend of the cover colours, so the fallback sits in the same family. */
const BIOME_COLOR: Record<Biome, Rgb> = {
  ice: SNOW,
  tundra: mix(SNOW, OPEN, 0.45),
  taiga: FOREST,
  temperate: mix(OPEN, FOREST, 0.28),
  steppe: mix(OPEN, DESERT, 0.4),
  scrub: mix(OPEN, DESERT, 0.55),
  desert: DESERT,
  savanna: mix(OPEN, DESERT, 0.32),
  jungle: mix(FOREST, [88, 112, 84], 0.5),
};

export function biomeColor(biome: Biome): Rgb {
  return BIOME_COLOR[biome];
}

/** HSL saturation of a colour, 0 to 1. */
export function saturationOf(rgb: Rgb): number {
  const max = Math.max(rgb[0], rgb[1], rgb[2]) / 255;
  const min = Math.min(rgb[0], rgb[1], rgb[2]) / 255;
  if (max === min) {
    return 0;
  }
  return (max - min) / (1 - Math.abs(max + min - 1));
}

function hash(ix: number, iy: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth noise in [0, 1) with one cell per unit. */
export function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const top = hash(ix, iy) + (hash(ix + 1, iy) - hash(ix, iy)) * u;
  const bottom = hash(ix, iy + 1) + (hash(ix + 1, iy + 1) - hash(ix, iy + 1)) * u;
  return top + (bottom - top) * v;
}

/** How far a biome's edge wanders from its box, in world units. */
const EDGE_WANDER = 16;

/**
 * The ground colour at a map point, from the biomes. The point is nudged by slow noise first, so
 * a desert meets a steppe along a wandering line and never along the edge of a box.
 */
export function naturalColorAt(p: Vec2, biomeAt: (p: Vec2) => Biome = biomeAtMap): Rgb {
  const dx = (valueNoise(p.x * 0.045, p.y * 0.045) - 0.5) * EDGE_WANDER;
  const dy = (valueNoise(p.x * 0.045 + 31.7, p.y * 0.045 + 11.3) - 0.5) * EDGE_WANDER;
  return BIOME_COLOR[biomeAt({ x: p.x + dx, y: p.y + dy })];
}

/**
 * The biome ground for a whole sheet as RGBA bytes, `width` by `height`, covering `bounds`. Each
 * pixel is the colour at its centre.
 */
export function terrainPixels(
  bounds: Rect,
  width: number,
  height: number,
  biomeAt: (p: Vec2) => Biome = biomeAtMap,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const my = bounds.y + ((y + 0.5) / height) * bounds.h;
    for (let x = 0; x < width; x++) {
      const mx = bounds.x + ((x + 0.5) / width) * bounds.w;
      const color = naturalColorAt({ x: mx, y: my }, biomeAt);
      const i = (y * width + x) * 4;
      out[i] = color[0];
      out[i + 1] = color[1];
      out[i + 2] = color[2];
      out[i + 3] = 255;
    }
  }
  return out;
}

// Bakes a region scene onto offscreen canvases once. The board blits these every frame and
// animates only the sky, the sea and the battle on top.
//
// A bake can be made at a whole-number scale (1x to 3x). The same paint code runs through
// ctx.scale(bakeScale): rectangles are rounded to the 1x art grid by the painters, so they stay
// crisp pixel blocks, while ovals, polygons and lines get the extra resolution. Scale 1 runs no
// transform at all, so it paints exactly what it always did.
import type { RegionScene } from "./regionScene";
import {
  EDGE_TOP,
  GROUND_BOTTOM,
  GROUND_TOP,
  groundTones,
  paintGround,
  paintHorizon,
  paintInlandEdge,
  paintSeaHorizon,
  seaLook,
  type Paint,
  type SeaLook,
} from "./sceneryPaint";
import { toneCurve, type ToneOptions } from "./toneCurve";

export type BakedScenery =
  | {
      kind: "land";
      regionId: string;
      /** Bitmap pixels per board pixel. The canvases below are this many times larger than the board layer. */
      scale: number;
      /** Skyline and embankment, drawn over the live sky. Canvas covers y 0 to HORIZON_Y + 6. */
      horizon: HTMLCanvasElement;
      /** The field, drawn at y = GROUND_TOP. */
      ground: HTMLCanvasElement;
      /** The land strip below the board, drawn at y = EDGE_TOP. Null where the sea runs instead. */
      edge: HTMLCanvasElement | null;
      /** Islands look out over open water and use the sea skybox. */
      island: boolean;
      /** Rim colour for craters dug during the battle. */
      dirt: string;
    }
  | {
      kind: "sea";
      regionId: string;
      scale: number;
      horizon: HTMLCanvasElement;
      look: SeaLook;
    };

export interface BakeOptions {
  /**
   * The post-bake tone curve. On by default: the 16 colours span only a narrow band of lightness and the
   * curve widens it. Pass false for the bare painted pixels, or a partial set of options to tune it.
   */
  tone?: boolean | Partial<ToneOptions>;
}

/** Largest bake. 3x of the 1280 wide board is 3840 pixels, which is about 20 MB for the ground layer. */
export const MAX_SCENERY_SCALE = 3;
/** Cached bakes per region and board size: the one in use and the one before it. */
export const SCENERY_SCALES_KEPT = 2;

/** The whole-number bake a view needs, so the cache rebuilds on a step and not on every wheel tick. */
export function sceneryScaleFor(pixelsPerBoardPixel: number): number {
  if (!Number.isFinite(pixelsPerBoardPixel)) return 1;
  return Math.min(MAX_SCENERY_SCALE, Math.max(1, Math.ceil(pixelsPerBoardPixel - 1e-6)));
}

const HORIZON_H = 120;
/** The stepped painted haze stays out of the bake: the live horizon mist replaces it with a smooth gradient. */
const NO_BAKED_HAZE = { haze: false } as const;
/** Per region and board size, the bakes in order of use, newest last. */
const cache = new Map<string, BakedScenery[]>();
const pending = new Set<string>();
let bakes = 0;

/** How many scenery bakes have run, and which scales are held. For tests and the preview's readout. */
export function sceneryBakeStats(): { bakes: number; held: Record<string, number[]> } {
  const held: Record<string, number[]> = {};
  for (const [key, list] of cache) held[key] = list.map((entry) => entry.scale);
  return { bakes, held };
}

/** Forgets every bake. */
export function clearSceneryCache(): void {
  cache.clear();
}

function layer(
  width: number,
  height: number,
  offsetY: number,
  paint: (ctx: Paint) => void,
  scale: number,
  tone: Partial<ToneOptions> | null,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    // Painting never draws an image, so smoothing only matters for later copies of this canvas.
    ctx.imageSmoothingEnabled = scale > 1;
    if (scale !== 1) ctx.scale(scale, scale);
    ctx.translate(0, -offsetY);
    paint(ctx);
    if (tone) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      ctx.putImageData(new ImageData(toneCurve(pixels.data, tone), canvas.width, canvas.height), 0, 0);
    }
  }
  return canvas;
}

function toneFor(options: BakeOptions | undefined): Partial<ToneOptions> | null {
  const asked = options?.tone;
  if (asked === false) return null;
  return asked === undefined || asked === true ? {} : asked;
}

/** One layer at a time, so a slow bake can give the thread back between layers. */
function* bakeSteps(scene: RegionScene, width: number, height: number, scale: number, options?: BakeOptions): Generator<void, BakedScenery> {
  const tone = toneFor(options);
  if (scene.kind === "sea") {
    const horizon = layer(width, HORIZON_H, 0, (ctx) => paintSeaHorizon(ctx, scene, width), scale, tone);
    yield;
    return { kind: "sea", regionId: scene.regionId, scale, horizon, look: seaLook(scene) };
  }
  const horizon = layer(width, HORIZON_H, 0, (ctx) => paintHorizon(ctx, scene, width, NO_BAKED_HAZE), scale, tone);
  yield;
  const ground = layer(width, GROUND_BOTTOM - GROUND_TOP, GROUND_TOP, (ctx) => paintGround(ctx, scene, width, NO_BAKED_HAZE), scale, tone);
  yield;
  const edge = scene.coastal ? null : layer(width, height - EDGE_TOP, EDGE_TOP, (ctx) => paintInlandEdge(ctx, scene, width, height), scale, tone);
  return {
    kind: "land",
    regionId: scene.regionId,
    scale,
    horizon,
    ground,
    edge,
    island: scene.island !== null,
    dirt: groundTones(scene).dirt,
  };
}

function keyOf(scene: RegionScene, width: number, height: number): string {
  return `${scene.regionId}|${width}x${height}`;
}

function remember(key: string, baked: BakedScenery): void {
  const list = (cache.get(key) ?? []).filter((entry) => entry.scale !== baked.scale);
  list.push(baked);
  // Keep the newest two. An older bake may still be on screen; it lives as long as its caller holds it.
  while (list.length > SCENERY_SCALES_KEPT) list.shift();
  cache.set(key, list);
  bakes += 1;
}

function recall(key: string, scale: number): BakedScenery | null {
  const list = cache.get(key);
  const at = list ? list.findIndex((entry) => entry.scale === scale) : -1;
  if (!list || at < 0) return null;
  // Touch it, so the other one is the one to go next.
  const [hit] = list.splice(at, 1);
  list.push(hit);
  return hit;
}

/**
 * The baked layers for a scene. Baked on first use and kept for the session.
 * `bakeScale` is a whole number of bitmap pixels per board pixel; 1 is the plain bake.
 */
export function bakeScenery(scene: RegionScene, width: number, height: number, bakeScale = 1, options?: BakeOptions): BakedScenery {
  const scale = Math.min(MAX_SCENERY_SCALE, Math.max(1, Math.round(bakeScale)));
  const key = keyOf(scene, width, height);
  const hit = recall(key, scale);
  if (hit) return hit;
  const steps = bakeSteps(scene, width, height, scale, options);
  let next = steps.next();
  while (!next.done) next = steps.next();
  remember(key, next.value);
  return next.value;
}

/**
 * What to draw now for a view that wants `wanted`. Returns the best bake already made (the plain bake
 * the first time), and bakes `wanted` in the background if it is missing, a layer per task. `onReady` runs
 * once the new bake is in the cache; ask again then. Call it only when the view has settled, not during a glide.
 */
export function sceneryForView(
  scene: RegionScene,
  width: number,
  height: number,
  wanted: number,
  onReady?: (baked: BakedScenery) => void,
  options?: BakeOptions,
): BakedScenery {
  const scale = Math.min(MAX_SCENERY_SCALE, Math.max(1, Math.round(wanted)));
  const key = keyOf(scene, width, height);
  const hit = recall(key, scale);
  if (hit) return hit;
  // Something to draw straight away: whatever is held, or the plain bake.
  const held = cache.get(key);
  const fallback = held && held.length > 0 ? (held[held.length - 1] as BakedScenery) : bakeScenery(scene, width, height, 1, options);
  const job = `${key}@${scale}`;
  if (!pending.has(job)) {
    pending.add(job);
    const steps = bakeSteps(scene, width, height, scale, options);
    const run = () => {
      const next = steps.next();
      if (next.done) {
        pending.delete(job);
        remember(key, next.value);
        onReady?.(next.value);
        return;
      }
      setTimeout(run, 0);
    };
    setTimeout(run, 0);
  }
  return fallback;
}

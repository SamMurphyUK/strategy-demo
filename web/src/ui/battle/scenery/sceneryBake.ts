// Bakes a region scene onto offscreen canvases once. The board blits these every frame and
// animates only the sky, the sea and the battle on top.
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

export type BakedScenery =
  | {
      kind: "land";
      regionId: string;
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
      horizon: HTMLCanvasElement;
      look: SeaLook;
    };

const HORIZON_H = 120;
const cache = new Map<string, BakedScenery>();

function layer(width: number, height: number, offsetY: number, paint: (ctx: Paint) => void): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.translate(0, -offsetY);
    paint(ctx);
  }
  return canvas;
}

/** The baked layers for a scene. Baked on first use and kept for the session. */
export function bakeScenery(scene: RegionScene, width: number, height: number): BakedScenery {
  const key = `${scene.regionId}|${width}x${height}`;
  const hit = cache.get(key);
  if (hit) return hit;

  let baked: BakedScenery;
  if (scene.kind === "sea") {
    baked = {
      kind: "sea",
      regionId: scene.regionId,
      horizon: layer(width, HORIZON_H, 0, (ctx) => paintSeaHorizon(ctx, scene, width)),
      look: seaLook(scene),
    };
  } else {
    baked = {
      kind: "land",
      regionId: scene.regionId,
      horizon: layer(width, HORIZON_H, 0, (ctx) => paintHorizon(ctx, scene, width)),
      ground: layer(width, GROUND_BOTTOM - GROUND_TOP, GROUND_TOP, (ctx) => paintGround(ctx, scene, width)),
      edge: scene.coastal ? null : layer(width, height - EDGE_TOP, EDGE_TOP, (ctx) => paintInlandEdge(ctx, scene, width, height)),
      island: scene.island !== null,
      dirt: groundTones(scene).dirt,
    };
  }
  cache.set(key, baked);
  return baked;
}

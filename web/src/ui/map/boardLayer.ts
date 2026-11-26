// The seam between the 2D map and a board drawn somewhere else (the React Three Fiber viewport).
//
// MapView keeps every gesture, pick, and unit painter. A board layer takes over the ground only:
// water, land, cliffs, and whatever stands on them. While a layer is active MapView skips its own
// base map and paints the washes, counters, sprites, and arrows on clear canvases, and the layer
// lays those canvases over its own picture.
import type { ReactNode } from "react";
import type { Vec2 } from "./geometry";
import type { RegionLayout } from "./mapRenderer";
import type { View } from "./viewMath";

/** A standing figure's picture on the frame: device pixels from the top-left corner, after the lean. */
export interface FigureCard {
  /** The stack's key and the figure's place in it: `region|copy|slot:index`. */
  id: string;
  left: number;
  top: number;
  w: number;
  h: number;
  /** Where the figure stands. */
  feetX: number;
  feetY: number;
}

/** The rectangle of one marked stack, and where its figures sit on the outline canvas. */
export interface OutlineSlot {
  kind: "selected" | "hover";
  x: number;
  y: number;
  w: number;
  h: number;
  atlasX: number;
  atlasY: number;
}

/**
 * The standing figures on canvases of their own, for a board that casts them or lines them. One
 * object, changed in place each time the figures are stamped; `BoardLayer.touch` says it changed.
 */
export interface FigureCards {
  /** Every figure alone on a clear canvas, at `maskScale` of the frame's device pixels. Null when nothing casts. */
  mask: HTMLCanvasElement | null;
  maskScale: number;
  cards: FigureCard[];
  /** The figures of the marked stacks, pixel for pixel, each stack in its own rectangle. */
  atlas: HTMLCanvasElement | null;
  slots: OutlineSlot[];
}

/** One painted frame of the 2D map, as the board layer needs it. */
export interface BoardFrame {
  /** The view the canvases were painted with. Land-plane world points go to screen through this. */
  view: View;
  /** CSS size of the painted picture. */
  width: number;
  height: number;
  dpr: number;
  /** The fitted zoom and the closest zoom the wheel allows. */
  fitK: number;
  maxK: number;
  /** Horizontal offsets of the world copies in view. */
  copies: readonly number[];
  /** Counters as laid out for this frame, in screen pixels. */
  layouts: readonly RegionLayout[];
  /** On-screen diameter of a token, in CSS pixels. */
  tokenPx: number;
  /** 0 icon tokens, 1 upright sprites. */
  unitFade: number;
  /** The painted canvases, back to front. */
  layers: readonly HTMLCanvasElement[];
  /** The standing figures apart from the rest, when the board asked for them (see mapVisualConfig.ts). */
  figures?: FigureCards | null;
}

export interface BoardLayer {
  /** Mounted under the 2D canvases, inside the element that slides with the menu drift. */
  node: ReactNode;
  /** True once the layer draws the ground. Until then the 2D base map stays. */
  active: boolean;
  /** Called after every full paint. */
  frame(frame: BoardFrame): void;
  /** Called after a partial repaint (an idle sprite frame, the arrow layer): the canvases changed. */
  touch(): void;
  /** The ground paints the frontline, so the canvas leaves that band off. */
  ownFront?: boolean;
  /** The canvas draws the lines between sea zones. The water picture has none of its own. */
  seaBorders?: boolean;
  /** How far the ground under a world point stands up the screen, in CSS pixels. A figure there is lifted by it, so its base sits on the slope. */
  groundLift?(world: Vec2, stack?: { naval: boolean; count: number }): number;
  /** The bases under land stacks are drawn by the board, in three dimensions: the canvas leaves its flat ones off. */
  plinths3D?: boolean;
}

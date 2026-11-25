// The seam between the 2D map and a board drawn somewhere else (the React Three Fiber viewport).
//
// MapView keeps every gesture, pick, and unit painter. A board layer takes over the ground only:
// water, land, cliffs, and whatever stands on them. While a layer is active MapView skips its own
// base map and paints the washes, counters, sprites, and arrows on clear canvases, and the layer
// lays those canvases over its own picture.
import type { ReactNode } from "react";
import type { RegionLayout } from "./mapRenderer";
import type { View } from "./viewMath";

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
}

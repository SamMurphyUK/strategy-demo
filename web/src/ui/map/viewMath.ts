// Pan and zoom maths for the map canvas. Pure.
import type { Rect, Vec2 } from "./geometry";
import { MAX_BAKE_SCALE } from "./mapBakeMath";

/** `x`, `y` is the world point at the canvas's top-left corner; `k` is screen pixels per world unit. */
export interface View {
  x: number;
  y: number;
  k: number;
}

export const MIN_ZOOM_FACTOR = 0.6; // relative to the fitted view
export const MAX_ZOOM_FACTOR = 24;
/**
 * The baked map stops gaining pixels at `MAX_BAKE_SCALE`. Past this many screen pixels per bake pixel
 * the bitmap is only being enlarged, and the coast breaks into blocks. Two keeps a close view sharp.
 */
export const MAX_BAKE_MAGNIFICATION = 2;

/** Tightest zoom the wheel and the battle approach may use. The bake, not the old 24× factor, is what binds. */
export function maxZoomK(fitK: number, dpr = 1): number {
  const relative = (fitK > 0 ? fitK : 1) * MAX_ZOOM_FACTOR;
  const sharp = (MAX_BAKE_SCALE * MAX_BAKE_MAGNIFICATION) / Math.max(dpr, 1);
  return Math.min(relative, sharp);
}
/** How far a unit's on-screen size may drift from its size on the fitted map. */
export const TOKEN_ZOOM_LIMIT = 0.1;

/**
 * Unit screen size relative to the fitted view. Zooming out shrinks a unit and zooming in grows it,
 * each by at most 10%. `viewK` and `fitK` are screen pixels per world unit.
 */
export function tokenZoomScale(viewK: number, fitK: number): number {
  const zoom = fitK > 0 ? viewK / fitK : 1;
  return Math.min(Math.max(zoom, 1 - TOKEN_ZOOM_LIMIT), 1 + TOKEN_ZOOM_LIMIT);
}

/** A unit token never draws smaller or larger than this on screen, however far the camera is in or out. */
export const TOKEN_MIN_PX = 4;
export const TOKEN_MAX_PX = 32;

/**
 * On-screen diameter of a unit token: its world diameter times the zoom, so tokens grow and shrink with the
 * map and every formation keeps its exact shape. Only the extremes are clamped.
 */
export function worldTokenPx(viewK: number, tokenWorld: number): number {
  return Math.min(Math.max(tokenWorld * viewK, TOKEN_MIN_PX), TOKEN_MAX_PX);
}

/**
 * How far the camera has tipped toward eye level. Flat at zoom 1.15, fully tipped at 2.2.
 * World X stays at `zoom`. World Y is drawn at `zoom * (1 - 0.15 * tilt)`.
 */
export function tiltFactor(zoom: number): number {
  if (zoom >= 2.2) {
    return 1;
  }
  if (zoom <= 1.15) {
    return 0;
  }
  return (zoom - 1.15) / (2.2 - 1.15);
}

/** Screen pixels per world unit. `sx` is the zoom; `sy` is the foreshortened vertical scale. */
export function projectionScales(zoom: number): { sx: number; sy: number } {
  const tilt = tiltFactor(zoom);
  return { sx: zoom, sy: zoom * (1 - 0.15 * tilt) };
}

/** Coastal cliff drop, relative to the flat map. Full tilt stretches it by 2.6. */
export function cliffDepthScale(zoom: number): number {
  return 1 + 1.6 * tiltFactor(zoom);
}

export function fitView(bounds: Rect, width: number, height: number, padding = 16): View {
  const w = Math.max(1, width - padding * 2);
  const h = Math.max(1, height - padding * 2);
  const k = Math.min(w / Math.max(bounds.w, 1e-6), h / Math.max(bounds.h, 1e-6));
  const { sx, sy } = projectionScales(k);
  return {
    k,
    x: bounds.x + bounds.w / 2 - width / 2 / sx,
    y: bounds.y + bounds.h / 2 - height / 2 / sy,
  };
}

export function worldToScreen(view: View, p: Vec2): Vec2 {
  const { sx, sy } = projectionScales(view.k);
  return { x: (p.x - view.x) * sx, y: (p.y - view.y) * sy };
}

export function screenToWorld(view: View, p: Vec2): Vec2 {
  const { sx, sy } = projectionScales(view.k);
  return { x: p.x / sx + view.x, y: p.y / sy + view.y };
}

export function panBy(view: View, dxPx: number, dyPx: number): View {
  return { ...view, x: view.x - dxPx / view.k, y: view.y - dyPx / view.k };
}

/** Screen-pixel pan along the tilted scales, so a drag tracks the pixel under the cursor. */
export function panView(view: View, dxPx: number, dyPx: number): View {
  const { sx, sy } = projectionScales(view.k);
  return { ...view, x: view.x - dxPx / sx, y: view.y - dyPx / sy };
}

/** `factor` > 1 zooms in. The world point under `screenPoint` stays put. */
export function zoomAt(view: View, screenPoint: Vec2, factor: number, fitK: number, dpr = 1): View {
  const k = Math.min(Math.max(view.k * factor, fitK * MIN_ZOOM_FACTOR), maxZoomK(fitK, dpr));
  const anchor = screenToWorld(view, screenPoint);
  const { sx, sy } = projectionScales(k);
  return { k, x: anchor.x - screenPoint.x / sx, y: anchor.y - screenPoint.y / sy };
}

/**
 * Distance between two territory anchors. On a wrapping map the shorter way around wins, so a
 * neighbour drawn on the other copy is not a trip across the world.
 */
export function anchorSpan(from: Vec2, to: Vec2, bounds: Rect, wrap: boolean): number {
  let dx = to.x - from.x;
  if (wrap && bounds.w > 0) {
    dx = wrapWorldX(to.x, bounds) - wrapWorldX(from.x, bounds);
    const half = bounds.w / 2;
    if (dx > half) dx -= bounds.w;
    else if (dx < -half) dx += bounds.w;
  }
  return Math.hypot(dx, to.y - from.y);
}

/** World x folded into [bounds.x, bounds.x + bounds.w): the same spot on the primary copy of a wrapped world. */
export function wrapWorldX(x: number, bounds: Rect): number {
  if (bounds.w <= 0) {
    return x;
  }
  return bounds.x + ((((x - bounds.x) % bounds.w) + bounds.w) % bounds.w);
}

/**
 * Keeps the view's centre inside the primary copy of a wrapped world, shifting by whole world widths, so
 * the three drawn copies (-1, 0, +1) always surround it however far the user pans.
 */
export function wrapView(view: View, canvasWidth: number, bounds: Rect): View {
  if (bounds.w <= 0 || view.k <= 0) {
    return view;
  }
  const centre = view.x + canvasWidth / 2 / view.k;
  const folded = wrapWorldX(centre, bounds);
  return folded === centre ? view : { ...view, x: view.x + (folded - centre) };
}

/**
 * Horizontal offsets (-w, 0, +w) of the world copies that intersect the canvas. With `wrap` off, only the
 * primary copy (the editor edits one copy, so its coordinates stay true).
 */
export function visibleCopies(view: View, canvasWidth: number, bounds: Rect, wrap: boolean): number[] {
  if (!wrap || bounds.w <= 0 || view.k <= 0) {
    return [0];
  }
  const left = view.x;
  const right = view.x + canvasWidth / view.k;
  const out: number[] = [];
  for (const n of [-1, 0, 1]) {
    const from = bounds.x + n * bounds.w;
    if (from < right && from + bounds.w > left) {
      out.push(n * bounds.w);
    }
  }
  return out.length > 0 ? out : [0];
}

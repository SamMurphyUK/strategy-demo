// Pan and zoom maths for the map canvas. Pure.
import type { Rect, Vec2 } from "./geometry";

/** `x`, `y` is the world point at the canvas's top-left corner; `k` is screen pixels per world unit. */
export interface View {
  x: number;
  y: number;
  k: number;
}

export const MIN_ZOOM_FACTOR = 0.6; // relative to the fitted view
export const MAX_ZOOM_FACTOR = 24;
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
export const TOKEN_MIN_PX = 8;
export const TOKEN_MAX_PX = 64;

/**
 * On-screen diameter of a unit token: its world diameter times the zoom, so tokens grow and shrink with the
 * map and every formation keeps its exact shape. Only the extremes are clamped.
 */
export function worldTokenPx(viewK: number, tokenWorld: number): number {
  return Math.min(Math.max(tokenWorld * viewK, TOKEN_MIN_PX), TOKEN_MAX_PX);
}

export function fitView(bounds: Rect, width: number, height: number, padding = 16): View {
  const w = Math.max(1, width - padding * 2);
  const h = Math.max(1, height - padding * 2);
  const k = Math.min(w / Math.max(bounds.w, 1e-6), h / Math.max(bounds.h, 1e-6));
  return {
    k,
    x: bounds.x + bounds.w / 2 - width / 2 / k,
    y: bounds.y + bounds.h / 2 - height / 2 / k,
  };
}

export function worldToScreen(view: View, p: Vec2): Vec2 {
  return { x: (p.x - view.x) * view.k, y: (p.y - view.y) * view.k };
}

export function screenToWorld(view: View, p: Vec2): Vec2 {
  return { x: p.x / view.k + view.x, y: p.y / view.k + view.y };
}

export function panBy(view: View, dxPx: number, dyPx: number): View {
  return { ...view, x: view.x - dxPx / view.k, y: view.y - dyPx / view.k };
}

/** `factor` > 1 zooms in. The world point under `screenPoint` stays put. */
export function zoomAt(view: View, screenPoint: Vec2, factor: number, fitK: number): View {
  const k = Math.min(Math.max(view.k * factor, fitK * MIN_ZOOM_FACTOR), fitK * MAX_ZOOM_FACTOR);
  const anchor = screenToWorld(view, screenPoint);
  return { k, x: anchor.x - screenPoint.x / k, y: anchor.y - screenPoint.y / k };
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

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

// Camera for the approach into a battle. The first fight of a combat phase zooms in.
// Every fight after that pans, and keeps the zoom the first one arrived at.
import type { Rect, Vec2 } from "./geometry";
import { fitView, type View } from "./viewMath";

export const COMBAT_ZOOM_MS = 1900;
export const COMBAT_PAN_MS = 1400;
const FRAME_PADDING = 72;
const ZOOM_MIN = 2.6;
const ZOOM_MAX = 8;

export interface CameraGoal {
  center: Vec2;
  k: number;
}

export interface CameraSnapshot {
  view: View;
  fitK: number;
  width: number;
  height: number;
}

export interface MapCamera {
  snapshot(): CameraSnapshot;
  moveTo(goal: CameraGoal, ms: number): Promise<void>;
}

export function easeInOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - ((-2 * x + 2) ** 3) / 2;
}

export function viewCenter(view: View, width: number, height: number): Vec2 {
  return { x: view.x + width / 2 / view.k, y: view.y + height / 2 / view.k };
}

export function viewFor(center: Vec2, k: number, width: number, height: number): View {
  return { k, x: center.x - width / 2 / k, y: center.y - height / 2 / k };
}

/** `t` is 0 at `from` and 1 at `to`. The world point in the middle of the canvas is what moves. */
export function lerpView(from: View, to: View, t: number, width: number, height: number): View {
  const e = easeInOutCubic(t);
  const a = viewCenter(from, width, height);
  const b = viewCenter(to, width, height);
  const k = from.k + (to.k - from.k) * e;
  return viewFor({ x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e }, k, width, height);
}

/**
 * Where the camera should sit on `bounds`. Zoom frames the territory, closer than the whole map
 * and short of the zoom cap. Pan keeps `current.k` and only moves the centre.
 * `focus` is the battle icon. When it is set, that point stays in the middle of the frame.
 */
export function combatGoal(
  current: View,
  bounds: Rect,
  canvasW: number,
  canvasH: number,
  fitK: number,
  mode: "zoom" | "pan",
  focus?: Vec2,
): CameraGoal {
  const center = focus ?? { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
  if (mode === "pan") {
    return { center, k: current.k };
  }
  const framed = fitView(bounds, Math.max(canvasW, 1), Math.max(canvasH, 1), FRAME_PADDING);
  const minK = fitK * ZOOM_MIN;
  const maxK = fitK * ZOOM_MAX;
  return { center, k: Math.min(Math.max(framed.k, minK), maxK) };
}

/**
 * The attack card, in reading order. Joined with spaces:
 * `GERMANY IS ATTACKING SOVIET UNION AT EASTERN EUROPE`.
 */
export function attackBriefingLines(attacker: string, defender: string, region: string): [string, string, string] {
  return [`${attacker.toUpperCase()} IS ATTACKING`, defender.toUpperCase(), `AT ${region.toUpperCase()}`];
}

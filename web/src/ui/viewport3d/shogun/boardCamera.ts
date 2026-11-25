// Camera maths for the 3D board. Pure: no Three.js, no DOM.
//
// The camera is described the way the 2D map describes it: a world point in the middle of the
// viewport and `k`, the screen pixels one world unit covers there. Map world space is x right and
// y down. The scene puts the board on the plane z = 0 with y pointing up, so a map point (x, y)
// sits at (x, -y, 0).
import type { Rect, Vec2 } from "../../map/geometry";
import { MAX_ZOOM_FACTOR, MIN_ZOOM_FACTOR } from "../../map/viewMath";

/** Vertical field of view. Narrow, so the flat view reads close to the printed map. */
export const BOARD_FOV_DEG = 30;
/** Tip toward eye level at full zoom. Zero is straight down. */
export const MAX_PITCH_DEG = 55;
/** Zoom, as a multiple of the fitted view, where the camera starts to tip and where it has finished. */
export const TILT_START = 1.4;
export const TILT_FULL = 5;
/** Height of the land above the water, in world units. */
export const LAND_HEIGHT = 1.5;

export interface BoardCamera {
  center: Vec2;
  k: number;
}

export interface BoardPose {
  /** Scene coordinates. */
  position: [number, number, number];
  target: [number, number, number];
  /** Radians from straight down. */
  pitch: number;
  distance: number;
}

/** A map point in scene coordinates, on the water plane. */
export function toScene(p: Vec2): [number, number, number] {
  return [p.x, -p.y, 0];
}

/** The `k` at which `bounds` fills the viewport, straight down. */
export function fitBoardK(bounds: Rect, width: number, height: number, padding = 16): number {
  const w = Math.max(1, width - padding * 2);
  const h = Math.max(1, height - padding * 2);
  return Math.min(w / Math.max(bounds.w, 1e-6), h / Math.max(bounds.h, 1e-6));
}

export function clampBoardK(k: number, fitK: number): number {
  const fit = fitK > 0 ? fitK : 1;
  return Math.min(Math.max(k, fit * MIN_ZOOM_FACTOR), fit * MAX_ZOOM_FACTOR);
}

/** Camera tip for a zoom: flat up to `TILT_START` times the fitted view, eased to full at `TILT_FULL`. */
export function pitchFor(k: number, fitK: number): number {
  const zoom = fitK > 0 ? k / fitK : 1;
  const t = Math.min(1, Math.max(0, (zoom - TILT_START) / (TILT_FULL - TILT_START)));
  const eased = t * t * (3 - 2 * t);
  return (eased * MAX_PITCH_DEG * Math.PI) / 180;
}

/** Distance from the target at which one world unit covers `k` pixels across the screen. */
export function cameraDistance(k: number, viewportHeight: number): number {
  const half = Math.tan((BOARD_FOV_DEG * Math.PI) / 360);
  return Math.max(1, viewportHeight) / (2 * half * Math.max(k, 1e-6));
}

/** Where the camera sits and what it looks at. It tips back toward the south, so north stays up. */
export function boardPose(camera: BoardCamera, fitK: number, viewportHeight: number): BoardPose {
  const pitch = pitchFor(camera.k, fitK);
  const distance = cameraDistance(camera.k, viewportHeight);
  const target = toScene(camera.center);
  return {
    position: [target[0], target[1] - Math.sin(pitch) * distance, Math.cos(pitch) * distance],
    target,
    pitch,
    distance,
  };
}

/** Keeps the middle of the viewport on the board. */
export function clampCenter(center: Vec2, bounds: Rect): Vec2 {
  return {
    x: Math.min(Math.max(center.x, bounds.x), bounds.x + bounds.w),
    y: Math.min(Math.max(center.y, bounds.y), bounds.y + bounds.h),
  };
}

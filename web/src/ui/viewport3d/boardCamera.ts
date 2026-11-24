// Camera maths for the 3D board. Pure: no Three.js, no DOM.
//
// The board is seen through an orthographic camera that tips back as the zoom rises. The tip is the
// one the 2D map already draws: `projectionScales` squashes world y by `sy / sx`, and a camera
// pitched by `acos(sy / sx)` squashes the ground plane by exactly that. So the top of the land
// (the plane z = 0) lands on the same screen pixels as the 2D `View`, and every painter written
// for that view (tokens, sprites, badges, arrows) lines up on the 3D board without a second
// projection.
//
// Map world space is x right and y down. The scene has y pointing up, so a map point (x, y) sits
// at (x, -y, 0).
//
// The water lies `SEA_DROP` below the land. The sea layer is pushed straight back along the camera
// ray, by `seaShift` in y, so a point drawn on it also lands where the 2D view puts it. The cliff
// between the two is the only thing on screen that the flat map does not have.
import { viewCenter, viewFor } from "../map/combatCamera";
import type { Rect, Vec2 } from "../map/geometry";
import { fitView, maxZoomK, MIN_ZOOM_FACTOR, projectionScales, type View, wrapWorldX } from "../map/viewMath";

/**
 * How far the water sits below the top of the land, in world units. At full tilt the cliff shows
 * about 3.7 units of face, the depth the 2D map paints its cliff lip to.
 */
export const SEA_DROP = 7;
/** Distance from the camera to the point it looks at. Orthographic, so this only has to clear the scene. */
export const CAMERA_DISTANCE = 1500;

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
  /** Half the width and half the height of the orthographic frustum, in world units. */
  halfWidth: number;
  halfHeight: number;
}

/** A map point in scene coordinates, on the land plane. */
export function toScene(p: Vec2): [number, number, number] {
  return [p.x, -p.y, 0];
}

/** The `k` at which `bounds` fills the viewport. The same number the 2D map fits to. */
export function fitBoardK(bounds: Rect, width: number, height: number, padding = 16): number {
  return fitView(bounds, width, height, padding).k;
}

/** Zoom limits of the 2D map: the same floor, and the same ceiling the baked sheet sets. */
export function clampBoardK(k: number, fitK: number, dpr = 1): number {
  const fit = fitK > 0 ? fitK : 1;
  return Math.min(Math.max(k, fit * MIN_ZOOM_FACTOR), maxZoomK(fit, dpr));
}

/** Camera tip for a zoom, in radians from straight down. It follows the 2D map's foreshortening. */
export function pitchFor(k: number): number {
  const { sx, sy } = projectionScales(k);
  if (!(sx > 0)) {
    return 0;
  }
  return Math.acos(Math.min(1, Math.max(0, sy / sx)));
}

/** How far the sea layer slides north so it stays on the camera ray through the land plane. */
export function seaShift(k: number, drop = SEA_DROP): number {
  return drop * Math.tan(pitchFor(k));
}

/** The 2D view this camera shows on the land plane. */
export function boardView(camera: BoardCamera, width: number, height: number): View {
  return viewFor(camera.center, camera.k, Math.max(1, width), Math.max(1, height));
}

/** The camera for a 2D view: the world point in the middle of the viewport, and the zoom. */
export function cameraOf(view: View, width: number, height: number): BoardCamera {
  return { center: viewCenter(view, Math.max(1, width), Math.max(1, height)), k: view.k };
}

/** Where the camera sits and what it looks at. It backs off toward the south, so north stays up. */
export function boardPose(camera: BoardCamera, width: number, height: number): BoardPose {
  const pitch = pitchFor(camera.k);
  const target = toScene(camera.center);
  const k = Math.max(camera.k, 1e-6);
  return {
    position: [target[0], target[1] - Math.sin(pitch) * CAMERA_DISTANCE, Math.cos(pitch) * CAMERA_DISTANCE],
    target,
    pitch,
    halfWidth: Math.max(1, width) / (2 * k),
    halfHeight: Math.max(1, height) / (2 * k),
  };
}

/**
 * Where a scene point lands on screen, in CSS pixels from the top-left corner. The pure twin of
 * the Three.js camera, so tests can hold the two projections together.
 */
export function projectScenePoint(
  camera: BoardCamera,
  width: number,
  height: number,
  point: readonly [number, number, number],
): Vec2 {
  const pitch = pitchFor(camera.k);
  const dx = point[0] - camera.center.x;
  const dy = point[1] + camera.center.y;
  const up = dy * Math.cos(pitch) + point[2] * Math.sin(pitch);
  return { x: width / 2 + dx * camera.k, y: height / 2 - up * camera.k };
}

/** Keeps the middle of the viewport on the board. A wrapped world folds x; y is held inside the sheet. */
export function holdCenter(center: Vec2, bounds: Rect, wrap: boolean): Vec2 {
  return {
    x: wrap ? wrapWorldX(center.x, bounds) : Math.min(Math.max(center.x, bounds.x), bounds.x + bounds.w),
    y: Math.min(Math.max(center.y, bounds.y), bounds.y + bounds.h),
  };
}

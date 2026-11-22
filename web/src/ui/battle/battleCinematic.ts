import { fieldViewScale, fieldWheelZoom } from "../../art/nativeBattleOverlay";

/** Auto camera for a battle: pan with the units, and change the zoom only a little. */

export interface CamView {
  scale: number;
  focusX: number;
  focusY: number;
}

export interface CinematicHitMark {
  x: number;
  y: number;
  until: number;
}

export const CINEMATIC_SCALE_MIN = 0.72;
export const CINEMATIC_SCALE_MAX = 2.4;
/** How quickly the frame slides toward the units. About a second to settle. */
export const CINEMATIC_PAN_RATE = 1.05;
/** Zoom trails the pan, so a move reads as a slide with a small scale change. */
export const CINEMATIC_ZOOM_RATE = 0.32;
/** Share of the way from the formation to a moving unit. The pan does the tracking. */
export const CINEMATIC_MOTION_PULL = 0.7;
/** Added on top of the resting scale while a unit is moving. */
export const CINEMATIC_MOTION_ZOOM = 0.07;

export function identityCam(canvasW: number, canvasH: number): CamView {
  return {scale: 1, focusX: canvasW / 2, focusY: canvasH / 2};
}

/** A small step closer when few units are left. The spread stays readable. */
export function baseScaleForLiveCount(live: number): number {
  if (live <= 4) return 1.12;
  if (live <= 8) return 1.08;
  if (live <= 14) return 1.05;
  return 1.02;
}

export function lerpCam(
  current: CamView,
  target: CamView,
  dt: number,
  rate = 3.4,
  zoomRate = rate,
): CamView {
  const pan = 1 - Math.exp(-rate * Math.max(0, dt));
  const zoom = 1 - Math.exp(-zoomRate * Math.max(0, dt));
  return {
    scale: current.scale + (target.scale - current.scale) * zoom,
    focusX: current.focusX + (target.focusX - current.focusX) * pan,
    focusY: current.focusY + (target.focusY - current.focusY) * pan,
  };
}

export function averagePoint(points: ReadonlyArray<{x: number; y: number}>): {x: number; y: number} | null {
  if (points.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return {x: x / points.length, y: y / points.length};
}

export function clampCamScale(scale: number): number {
  return Math.min(CINEMATIC_SCALE_MAX, Math.max(CINEMATIC_SCALE_MIN, scale));
}

export function applyCamTransform(
  ctx: CanvasRenderingContext2D,
  cam: CamView,
  canvasW: number,
  canvasH: number,
): void {
  ctx.translate(canvasW / 2, canvasH / 2);
  ctx.scale(cam.scale, cam.scale);
  ctx.translate(-cam.focusX, -cam.focusY);
}

export function screenToWorld(
  screenX: number,
  screenY: number,
  cam: CamView,
  canvasW: number,
  canvasH: number,
): {x: number; y: number} {
  return {
    x: cam.focusX + (screenX - canvasW / 2) / cam.scale,
    y: cam.focusY + (screenY - canvasH / 2) / cam.scale,
  };
}

/**
 * Wheel zoom with the field test's range and curve. The board point under the cursor stays put.
 * Positive `deltaY` zooms out. The cinematic camera's own framing stays inside a tighter range.
 */
export function zoomCamField(
  cam: CamView,
  screenX: number,
  screenY: number,
  canvasW: number,
  canvasH: number,
  deltaY: number,
  deltaMode = 0,
): CamView {
  const world = screenToWorld(screenX, screenY, cam, canvasW, canvasH);
  const scale = fieldWheelZoom(cam.scale, deltaY, deltaMode);
  return {
    scale,
    focusX: world.x - (screenX - canvasW / 2) / scale,
    focusY: world.y - (screenY - canvasH / 2) / scale,
  };
}

/** Jump to a whole view step, keeping the point the camera is looking at. */
export function jumpCamScale(cam: CamView, scale: number): CamView {
  return {...cam, scale: fieldViewScale(scale)};
}

/** Wheel zoom that keeps the board point under the cursor fixed. */
export function zoomCamAt(
  cam: CamView,
  screenX: number,
  screenY: number,
  canvasW: number,
  canvasH: number,
  deltaY: number,
): CamView {
  const world = screenToWorld(screenX, screenY, cam, canvasW, canvasH);
  const factor = deltaY > 0 ? 0.92 : 1.08;
  const scale = clampCamScale(cam.scale * factor);
  return {
    scale,
    focusX: world.x - (screenX - canvasW / 2) / scale,
    focusY: world.y - (screenY - canvasH / 2) / scale,
  };
}

export function pruneCinematicHits(hits: CinematicHitMark[], now: number): CinematicHitMark[] {
  return hits.filter((h) => h.until > now);
}

/**
 * Frame the units. A moving unit pulls the frame toward it. The zoom only steps up a little,
 * so the slide is what follows the motion.
 */
export function desiredCinematicView(input: {
  canvasW: number;
  canvasH: number;
  unitPoints: ReadonlyArray<{x: number; y: number}>;
  motionPoints: ReadonlyArray<{x: number; y: number}>;
}): CamView {
  const formation = averagePoint(input.unitPoints);
  if (!formation) {
    return identityCam(input.canvasW, input.canvasH);
  }
  const motion = averagePoint(input.motionPoints);
  const scale = baseScaleForLiveCount(input.unitPoints.length) + (motion ? CINEMATIC_MOTION_ZOOM : 0);
  if (!motion) {
    return {scale, focusX: formation.x, focusY: formation.y};
  }
  return {
    scale,
    focusX: formation.x + (motion.x - formation.x) * CINEMATIC_MOTION_PULL,
    focusY: formation.y + (motion.y - formation.y) * CINEMATIC_MOTION_PULL,
  };
}

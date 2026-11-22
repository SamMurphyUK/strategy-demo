import { fieldViewScale, fieldWheelZoom } from "../../art/nativeBattleOverlay";

/** Auto camera for a battle: zoom on few units, follow a firing row, then return to the dice. */

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
/** Dice tray centre (1280×720 board). */
export const DICE_FOCUS = {x: 640, y: 600};

export function identityCam(canvasW: number, canvasH: number): CamView {
  return {scale: 1, focusX: canvasW / 2, focusY: canvasH / 2};
}

/** Closer when few units are left on the board. */
export function baseScaleForLiveCount(live: number): number {
  if (live <= 4) return 1.55;
  if (live <= 8) return 1.32;
  if (live <= 14) return 1.16;
  return 1.05;
}

export function lerpCam(current: CamView, target: CamView, dt: number, rate = 3.4): CamView {
  const t = 1 - Math.exp(-rate * Math.max(0, dt));
  return {
    scale: current.scale + (target.scale - current.scale) * t,
    focusX: current.focusX + (target.focusX - current.focusX) * t,
    focusY: current.focusY + (target.focusY - current.focusY) * t,
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

export type CinematicSubPhase = 'IDLE' | 'ROLLING' | 'FIRING' | 'RESOLVED';

/**
 * Pick where the camera should look for the current combat beat.
 * Firing: shooters → in-flight shots → recent hits. Rolling / waiting: the dice tray.
 */
export function desiredCinematicView(input: {
  canvasW: number;
  canvasH: number;
  liveCount: number;
  subPhase: CinematicSubPhase | string;
  shooterPoints: ReadonlyArray<{x: number; y: number}>;
  trackPoints: ReadonlyArray<{x: number; y: number}>;
  hitPoints: ReadonlyArray<{x: number; y: number}>;
  allocation: boolean;
}): CamView {
  const base = baseScaleForLiveCount(input.liveCount);
  const centre = {x: input.canvasW / 2, y: input.canvasH / 2 - 24};

  if (input.allocation) {
    return {scale: base, focusX: centre.x, focusY: centre.y};
  }

  if (input.subPhase === 'ROLLING') {
    return {
      scale: Math.max(base, 1.38),
      focusX: DICE_FOCUS.x,
      focusY: DICE_FOCUS.y,
    };
  }

  if (input.subPhase === 'FIRING') {
    const shooters = averagePoint(input.shooterPoints);
    const track = averagePoint(input.trackPoints);
    const hits = averagePoint(input.hitPoints);

    if (track && shooters) {
      return {
        scale: Math.max(base, 1.42),
        focusX: shooters.x * 0.28 + track.x * 0.72,
        focusY: shooters.y * 0.28 + track.y * 0.72,
      };
    }
    if (track) {
      return {scale: Math.max(base, 1.4), focusX: track.x, focusY: track.y};
    }
    if (hits) {
      return {scale: Math.max(base, 1.36), focusX: hits.x, focusY: hits.y};
    }
    if (shooters) {
      return {scale: Math.max(base, 1.52), focusX: shooters.x, focusY: shooters.y};
    }
  }

  // Waiting to roll, or settling after a volley — hold on the dice.
  return {
    scale: Math.max(base, 1.12),
    focusX: DICE_FOCUS.x,
    focusY: DICE_FOCUS.y,
  };
}

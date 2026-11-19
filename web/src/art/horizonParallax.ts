/**
 * How far the skyline falls behind the field when the field preview is panned, as a share of the pan.
 * 0 keeps the horizon, buildings and ground in one piece, which is how the painted scene reads. The
 * buildings stand on the ground line, so any trail shows as them sliding off it. Raise it only if the
 * ground strip under the skyline is tied to the same shift.
 */
export const HORIZON_PARALLAX = 0;

/** The skyline never trails further than this many board pixels. */
export const HORIZON_PARALLAX_MAX = 96;

/**
 * Board pixels to slide the skyline for a camera at `camX` (device pixels), in whole device pixels.
 * `centreCam` is the camera a zoom about the stage centre would have; the default view is exactly that.
 * Always 0 when `factor` is 0, and never -0.
 */
export function horizonShiftX(camX: number, centreCam: number, span: number, factor: number = HORIZON_PARALLAX): number {
  if (factor === 0 || span <= 0) {
    return 0;
  }
  const trail = Math.max(-HORIZON_PARALLAX_MAX, Math.min(HORIZON_PARALLAX_MAX, (-factor * (camX - centreCam)) / span));
  return Math.round(trail * span) / span + 0;
}

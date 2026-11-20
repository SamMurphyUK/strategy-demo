/** Screen pixels to one frame pixel. A wide sprite opens small enough to see, and can zoom out further. */
export const FRAME_ZOOMS = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 10, 12] as const;

export function zoomLabel(step: number): string {
  if (step === 0.25) return "¼×";
  if (step === 0.5) return "½×";
  return `${step}×`;
}

/** The largest step, up to 8, at which the whole frame fits in a box this size. */
export function openingFrameZoom(width: number, height: number, box = { width: 720, height: 640 }): number {
  let best = 1;
  for (const step of FRAME_ZOOMS) {
    if (step <= 8 && width * step <= box.width && height * step <= box.height) {
      best = step;
    }
  }
  return best;
}

/** The largest step, including quarter and half, at which the frame fits the box. */
export function fittingFrameZoom(width: number, height: number, box: { width: number; height: number }): number {
  let best: number = FRAME_ZOOMS[0];
  for (const step of FRAME_ZOOMS) {
    if (width * step <= box.width && height * step <= box.height) {
      best = step;
    }
  }
  return best;
}

/**
 * What the editor opens at. A sprite that fits at 1× keeps the old steps, up to 8.
 * One that does not fit at 1× drops to a half or a quarter.
 */
export function viewFrameZoom(width: number, height: number, box: { width: number; height: number }): number {
  if (width <= box.width && height <= box.height) {
    return openingFrameZoom(width, height, box);
  }
  return fittingFrameZoom(width, height, box);
}

/**
 * The smallest step the editor will zoom out to. A sprite that fits at 1× stays at least that
 * large. A wider one stops at the largest step that still fits, so a swipe cannot shrink it away.
 */
export function minFrameZoom(width: number, height: number, box: { width: number; height: number }): number {
  if (width <= box.width && height <= box.height) {
    return 1;
  }
  return fittingFrameZoom(width, height, box);
}

/** The largest step whose picture still fits in the box. Past this the editor panel leaves the screen. */
export function maxFrameZoom(width: number, height: number, box: { width: number; height: number }): number {
  const fit = fittingFrameZoom(width, height, box);
  const floor = minFrameZoom(width, height, box);
  return fit < floor ? floor : fit;
}

/** One notch on the wheel. A positive `deltaY` zooms out. The result stays between `floor` and `ceiling`. */
export function stepZoom(
  current: number,
  deltaY: number,
  floor: number = FRAME_ZOOMS[0],
  ceiling: number = FRAME_ZOOMS[FRAME_ZOOMS.length - 1],
): number {
  const index = FRAME_ZOOMS.findIndex((step) => step >= current - 0.001);
  const at = index < 0 ? FRAME_ZOOMS.length - 1 : index;
  const next = deltaY > 0 ? Math.max(0, at - 1) : Math.min(FRAME_ZOOMS.length - 1, at + 1);
  let chosen = FRAME_ZOOMS[next] ?? current;
  const low = FRAME_ZOOMS.find((step) => step >= floor - 0.001) ?? FRAME_ZOOMS[0];
  let high: number = FRAME_ZOOMS[0];
  for (const step of FRAME_ZOOMS) {
    if (step <= ceiling + 0.001) high = step;
  }
  if (low > high) return low;
  if (chosen < low) chosen = low;
  if (chosen > high) chosen = high;
  return chosen;
}

/** How long one wheel gesture is held to a single step. A trackpad fires many events at once. */
export const WHEEL_ZOOM_GAP_MS = 180;

/** The time to remember, or null when this event is inside the gap or has no movement. */
export function wheelZoomAt(now: number, last: number, deltaY: number): number | null {
  if (deltaY === 0 || now - last < WHEEL_ZOOM_GAP_MS) {
    return null;
  }
  return now;
}

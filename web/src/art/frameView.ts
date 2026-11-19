/** Screen pixels to one frame pixel. A wide sprite opens at a low step and the canvas scrolls. */
export const FRAME_ZOOMS = [1, 2, 3, 4, 6, 8, 10, 12] as const;

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

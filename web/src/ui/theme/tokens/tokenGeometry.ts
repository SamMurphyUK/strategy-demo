// Geometry shared by the token processor and renderer. Pure, so it runs under Vitest.
//
// The supplied art is a 794 x 1123 artboard with a circle (outer radius 280, centre 393.5, 428) and a
// silhouette that may overhang the circle sideways but never above or below it. Everything here is
// expressed in units of the circle diameter D so any output size works.

export const ARTBOARD = { width: 794, height: 1123 } as const;
export const ART_CIRCLE = { cx: 393.5, cy: 428, diameter: 560 } as const;

/** Half the token canvas width, in D. The widest art (ships, tank) reaches about 0.72 D from centre. */
export const TOKEN_HALF_WIDTH = 0.72;
/** Token canvas width / height. The layout box is the circle; the canvas bleeds sideways for overhang. */
export const TOKEN_WIDTH_RATIO = TOKEN_HALF_WIDTH * 2;

/** Ring stroke as a share of D, with a floor in device pixels so it survives at 24-32 px. */
export const RING_WIDTH_RATIO = 0.034;
export const RING_MIN_PX = 1.5;

/** Where the serif unit letter sits when the art leaves room (the 'T' on the transport token). */
export const LETTER_TOP_BASELINE = -0.1125; // from centre, in D (y down)
export const LETTER_CAP_HEIGHT = 0.2625;
export const LETTER_BOX = { halfWidth: 0.125, top: -0.375, bottom: -0.1125 } as const;
/** Georgia Bold cap height as a share of font size. */
export const SERIF_CAP_RATIO = 0.69;
/** The letter is only drawn when the silhouette covers less than this share of its box. */
export const LETTER_CLEAR_LIMIT = 0.015;

/** Letter-only tokens (no art yet) centre a larger letter instead. */
export const FALLBACK_CAP_HEIGHT = 0.46;

export interface Size {
  width: number;
  height: number;
}

export function tokenCanvasSize(circleDiameterPx: number, dpr: number): Size {
  const height = Math.max(1, Math.round(circleDiameterPx * dpr));
  return { width: Math.max(1, Math.round(height * TOKEN_WIDTH_RATIO)), height };
}

export function ringWidthPx(heightPx: number, dpr: number): number {
  return Math.max(heightPx * RING_WIDTH_RATIO, RING_MIN_PX * dpr);
}

/**
 * Sizes to draw through when shrinking by a large factor. One big drawImage aliases thin parts (masts,
 * barrels); halving until within 2x of the target keeps them intact. The last entry is the target.
 */
export function halvingSteps(srcW: number, srcH: number, dstW: number, dstH: number): Size[] {
  const steps: Size[] = [];
  let w = srcW;
  let h = srcH;
  while (w / 2 > dstW || h / 2 > dstH) {
    w = Math.max(dstW, Math.ceil(w / 2));
    h = Math.max(dstH, Math.ceil(h / 2));
    steps.push({ width: w, height: h });
  }
  steps.push({ width: dstW, height: dstH });
  return steps;
}

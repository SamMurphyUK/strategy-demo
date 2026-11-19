// Pure numbers behind the campaign map's coast relief and sea depth. No canvas here, so all of it is
// testable. mapBake.ts turns these into strokes and blurs.
//
// Light comes from the top-left, the same as on the unit art. Land edges that face up-left catch a
// highlight; edges that face down-right take a shadow. The sea is darkest in the open and steps lighter
// toward the coast, like a chart's depth contours.

/** The light's direction on screen: from the top-left, so it travels down-right. */
export const LIGHT_FROM = { x: -1, y: -1 } as const;

/** Narrowest and widest bevel band, in bake pixels. */
export const BEVEL_MIN_PX = 1;
export const BEVEL_MAX_PX = 3;

/**
 * Width of the bevel band in bake pixels. A bake pixel is close to a screen pixel, so the band stays
 * thin at every zoom: one pixel on the coarsest sheet, under three on the finest.
 */
export function bevelBandPx(scale: number): number {
  const wide = 0.9 + 0.65 * (Math.max(1, scale) - 1);
  return Math.min(BEVEL_MAX_PX, Math.max(BEVEL_MIN_PX, wide));
}

export interface CoastBevel {
  /** Stroke width in bake pixels. */
  band: number;
  /** Where to slide the coast path, in bake pixels, to leave a highlight on the up-left-facing edges. */
  highlight: { dx: number; dy: number };
  /** The opposite slide: a shadow on the down-right-facing edges. */
  shadow: { dx: number; dy: number };
}

/**
 * Offsets for the two bevel strokes. Sliding the coast path toward the light pushes its up-left edges
 * inland, so once the stroke is clipped to the land only the inside of those edges stays; sliding it away
 * does the same for the down-right edges. `inkHalfPx` is half the coastline ink width in bake pixels: the
 * band starts just past it, so the ink does not cover the bevel. Edges that run along the light (up-right
 * and down-left facing) get no offset, and the ink hides the part of the stroke that sits on them.
 */
export function coastBevel(scale: number, inkHalfPx: number): CoastBevel {
  const band = bevelBandPx(scale);
  const slide = inkHalfPx + band / 2;
  const toward = { dx: -LIGHT_FROM.x * slide, dy: -LIGHT_FROM.y * slide };
  return {
    band,
    highlight: toward,
    shadow: { dx: -toward.dx, dy: -toward.dy },
  };
}

export interface ShelfBand {
  /** Blur spread of the band, in map units (one standard deviation). */
  sigma: number;
  /** Opacity of the shelf colour this band lays over the open sea, before the blur thins it. */
  alpha: number;
}

/**
 * Depth steps, widest first. Each is a blurred copy of the land in the shelf colour, so the colour builds
 * up toward the coast: open sea stays dark and the shallows are the lightest. The spreads are map units,
 * so the shelf grows with the map like the coast does. The blur runs once per land shape on a small
 * sheet (see mapBake.ts); stroking wide bands along the whole coast on every bake is far too slow.
 */
export function shelfBands(): readonly ShelfBand[] {
  return SHELF_BANDS;
}

const SHELF_BANDS: readonly ShelfBand[] = [
  { sigma: 12, alpha: 0.14 },
  { sigma: 6, alpha: 0.16 },
  { sigma: 3, alpha: 0.2 },
  { sigma: 1.4, alpha: 0.24 },
];

/** Standard normal upper tail: the share of a blurred straight edge's weight beyond `z` sigmas. */
function normalTail(z: number): number {
  // Abramowitz and Stegun 26.2.17, good to about 1e-7.
  const x = Math.abs(z);
  const t = 1 / (1 + 0.2316419 * x);
  const poly = t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const tail = Math.exp((-x * x) / 2) * 0.3989422804 * poly;
  return z >= 0 ? tail : 1 - tail;
}

/** The land silhouette is grown this far (map units) before the blur, so thin islands keep a shelf. */
export const SHELF_GROW = 3;

/**
 * Shelf colour's opacity at `distance` map units out from a straight coast: each band's alpha times the
 * blurred edge's weight there, stacked. The edge sits `SHELF_GROW` past the coast. It falls steadily
 * from the coast to the open sea.
 */
export function shelfCoverage(distance: number): number {
  let clear = 1;
  for (const band of SHELF_BANDS) {
    clear *= 1 - band.alpha * normalTail((distance - SHELF_GROW) / band.sigma);
  }
  return 1 - clear;
}

function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Straight RGB mix of two `#rrggbb` colours; `t` is the share of `to`. */
export function mixHex(from: string, to: string, t: number): string {
  const a = channels(from);
  const b = channels(to);
  const byte = (i: number) =>
    Math.max(0, Math.min(255, Math.round(a[i] + (b[i] - a[i]) * t)))
      .toString(16)
      .padStart(2, "0");
  return `#${byte(0)}${byte(1)}${byte(2)}`;
}

/** How far the open sea is pulled from slate toward charcoal. */
export const DEEP_SEA_SHARE = 0.24;

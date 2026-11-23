// Pure numbers behind the campaign map's coast relief and sea depth. No canvas here, so all of it is
// testable. mapBake.ts turns these into strokes and blurs.
import { ringRuns, type Pt, type Seam } from "./mapBakeMath";
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

/**
 * One rise and fall of the shallows, in seconds. `2π` is three cycles of the unit breathe
 * (`sin(time * 3)`), so the tide and the idle motion share a clock and do not drift.
 */
export const SURF_PERIOD_S = Math.PI * 2;

/**
 * How far the existing shallow bloom's edge moves, in screen pixels. Negative pulls that
 * lighter water inward; positive pushes it out. The swing is ±1.5, half the old 6px rise.
 */
export const SURF_REACH_PX = 1.5;

/** Fixed break in the ring, in screen pixels. Chosen once per vertex; it does not animate. */
export const SURF_GRAIN_PX = 0.12;

/** Distance along the shore between one crest and the next, in map units. */
export const SURF_WAVELENGTH = 56;

/** The four numbers the swell reads. Callers omit it and get the shipped coast. */
export interface SurfTune {
  reachPx: number;
  periodS: number;
  wavelength: number;
  grainPx: number;
}

export const SHIPPED_SURF: SurfTune = {
  reachPx: SURF_REACH_PX,
  periodS: SURF_PERIOD_S,
  wavelength: SURF_WAVELENGTH,
  grainPx: SURF_GRAIN_PX,
};

/**
 * Signed shift of the shallow bloom, in screen pixels. One cosine out and the same cosine
 * back: the value at `t` matches the value at `period - t`, so the water narrows by retracing
 * the way it widened. A point then takes a share of this (`surfLocalPx`) so the crest can
 * travel along the shore.
 */
export function surfScreenPx(timeSeconds: number, tune: SurfTune = SHIPPED_SURF): number {
  const period = tune.periodS > 0 ? tune.periodS : SHIPPED_SURF.periodS;
  const wave = -Math.cos((timeSeconds / period) * Math.PI * 2);
  return wave * tune.reachPx;
}

/**
 * Longest side of a landmass, in map units. Continents and big islands sit at or above
 * `CLIFF_BIG_SPAN`. Recognisable smaller islands (Borneo, the larger Indonesian and Philippine
 * islands) sit at or above `CLIFF_TINY_SPAN`. Anything shorter is a speck.
 */
export const CLIFF_BIG_SPAN = 60;
export const CLIFF_TINY_SPAN = 12;
/** Cliff drop for a smaller island, as a share of the continental drop. 0.7 is 30% shorter, so the lip sits higher. */
export const CLIFF_SMALL_LIFT = 0.7;
/** Cliff drop for a very small island, as a share of the continental drop. 0.6 is 40% shorter. */
export const CLIFF_TINY_LIFT = 0.6;

export function ringSpan(ring: readonly Pt[]): number {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of ring) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  if (!Number.isFinite(x0)) {
    return 0;
  }
  return Math.max(x1 - x0, y1 - y0);
}

/** Share of the continental cliff drop. Smaller islands are shorter, so the lip sits higher. Continents and big islands stay at 1. */
export function cliffLift(span: number): number {
  if (span >= CLIFF_BIG_SPAN) {
    return 1;
  }
  if (span >= CLIFF_TINY_SPAN) {
    return CLIFF_SMALL_LIFT;
  }
  return CLIFF_TINY_LIFT;
}

/**
 * Screen shift at one point, along the outward normal. `along` is arc length in map units,
 * `jitter` is a fixed value in `[-1, 1]` chosen when the coast was loaded. The sine travels;
 * the jitter does not.
 */
export function surfLocalPx(timeSeconds: number, along: number, jitter: number, tune: SurfTune = SHIPPED_SURF): number {
  const envelope = surfScreenPx(timeSeconds, tune);
  const period = tune.periodS > 0 ? tune.periodS : SHIPPED_SURF.periodS;
  const wavelength = tune.wavelength > 0 ? tune.wavelength : SHIPPED_SURF.wavelength;
  const travel = Math.sin((along / wavelength) * Math.PI * 2 + (timeSeconds / period) * Math.PI * 2);
  const shape = 0.84 + 0.16 * travel;
  // Grain is a fixed outward nudge. It does not follow the clock.
  const grain = tune.grainPx * Math.max(-1, Math.min(1, jitter));
  return envelope * shape + grain;
}

/** One coast vertex, ready to push into the water along its outward normal. */
export interface SurfSample {
  x: number;
  y: number;
  nx: number;
  ny: number;
  /** Arc length used by the traveling crest, in map units. */
  along: number;
  /** Stable grain in `[-1, 1]`. */
  jitter: number;
  /** Cliff drop for this landmass, as a share of the continental drop. */
  lift: number;
}

/** Stable grain in `[-1, 1]` for a coast vertex. The same point always gets the same value. */
export function surfJitter(x: number, y: number): number {
  let hash = 2166136261;
  const key = `${Math.round(x * 10)}\0${Math.round(y * 10)}`;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 4294967296) * 2 - 1;
}

function openRing(ring: Pt[]): Pt[] {
  const n = ring.length;
  if (n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]) {
    return ring.slice(0, n - 1);
  }
  return ring;
}

/** Right-hand unit normal of an edge, flipped when `sign` is -1. Null for a zero-length edge. */
function edgeOut(a: Pt, b: Pt, sign: number): { nx: number; ny: number } | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-8) {
    return null;
  }
  return { nx: (sign * dy) / len, ny: (sign * -dx) / len };
}

/**
 * +1 when the right-hand normal of the longest edge steps into the sea, -1 when it steps onto land.
 * One probe per ring, on the longest edge, so a thin spit does not flip the whole coast.
 */
function outwardSign(pts: Pt[], contains: (x: number, y: number) => boolean): number {
  let best = 0;
  let bi = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    if (len2 > best) {
      best = len2;
      bi = i;
    }
  }
  if (best < 1e-12) {
    return 1;
  }
  const a = pts[bi];
  const b = pts[(bi + 1) % n];
  const len = Math.sqrt(best);
  const nx = (b[1] - a[1]) / len;
  const ny = -(b[0] - a[0]) / len;
  const inside = contains((a[0] + b[0]) / 2 + nx * 0.4, (a[1] + b[1]) / 2 + ny * 0.4);
  return inside ? -1 : 1;
}

function samplesFromRun(run: Pt[], sign: number, closed: boolean, lift: number, wavelength: number): SurfSample[] {
  const unique = closed ? run.slice(0, -1) : run;
  const n = unique.length;
  if (n < 2) {
    return [];
  }
  const dist: number[] = [];
  let perimeter = 0;
  for (let i = 0; i < n; i++) {
    dist.push(perimeter);
    if (!closed && i === n - 1) {
      break;
    }
    const a = unique[i];
    const b = unique[(i + 1) % n];
    perimeter += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const normals: { nx: number; ny: number }[] = [];
  for (let i = 0; i < n; i++) {
    const prev = closed ? unique[(i - 1 + n) % n] : i > 0 ? unique[i - 1] : null;
    const next = closed ? unique[(i + 1) % n] : i + 1 < n ? unique[i + 1] : null;
    let sx = 0;
    let sy = 0;
    if (prev) {
      const edge = edgeOut(prev, unique[i], sign);
      if (edge) {
        sx += edge.nx;
        sy += edge.ny;
      }
    }
    if (next) {
      const edge = edgeOut(unique[i], next, sign);
      if (edge) {
        sx += edge.nx;
        sy += edge.ny;
      }
    }
    const len = Math.hypot(sx, sy);
    if (len < 1e-6) {
      const fallback = (next ? edgeOut(unique[i], next, sign) : null) ?? (prev ? edgeOut(prev, unique[i], sign) : null);
      normals.push(fallback ?? { nx: 0, ny: 1 });
    } else {
      normals.push({ nx: sx / len, ny: sy / len });
    }
  }
  const shift = surfJitter(unique[0][0] + 17, unique[0][1] - 9) * wavelength;
  let scale = 1;
  if (closed && perimeter > 1e-6) {
    const turns = Math.max(1, Math.round(perimeter / wavelength));
    scale = (turns * wavelength) / perimeter;
  }
  const samples: SurfSample[] = unique.map((p, i) => ({
    x: p[0],
    y: p[1],
    nx: normals[i].nx,
    ny: normals[i].ny,
    along: shift + dist[i] * scale,
    jitter: surfJitter(p[0], p[1]),
    lift,
  }));
  if (closed) {
    samples.push({ ...samples[0] });
  }
  return samples;
}

/**
 * Shoreline samples for the live shallow bloom. Each run has outward normals (into the sea,
 * including lakes). Edges on the world seam are left out, so a wrapped copy does not paint them twice.
 * `contains` is true on land.
 */
export function buildSurfCoast(
  rings: readonly Pt[][],
  seam: Seam | null,
  contains: (x: number, y: number) => boolean,
  liftOf: (ring: Pt[]) => number = () => 1,
  tune: SurfTune = SHIPPED_SURF,
): SurfSample[][] {
  const out: SurfSample[][] = [];
  for (const ring of rings) {
    const pts = openRing(ring);
    if (pts.length < 2) {
      continue;
    }
    const lift = liftOf(ring);
    const sign = outwardSign(pts, contains);
    for (const run of ringRuns(pts, seam)) {
      if (run.length < 2) {
        continue;
      }
      const closed =
        run.length > 2 && run[0][0] === run[run.length - 1][0] && run[0][1] === run[run.length - 1][1];
      const samples = samplesFromRun(run, sign, closed, lift, tune.wavelength > 0 ? tune.wavelength : SHIPPED_SURF.wavelength);
      if (samples.length >= 2) {
        out.push(samples);
      }
    }
  }
  return out;
}

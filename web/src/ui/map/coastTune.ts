// Numbers for the campaign coast tuner. Pure data: no React, no canvas, no storage.
// The shipped constants stay the defaults. A locked file or a live slider replaces them.
import {
  cliffLift,
  ringSpan,
  SURF_GRAIN_PX,
  SURF_PERIOD_S,
  SURF_REACH_PX,
  SURF_WAVELENGTH,
  type SurfSample,
  type SurfTune,
} from "./coastRelief";
import { pointInMultiPolygon, type MultiPolygon, type Polygon, type Ring } from "./regionClip";

/** Shipped share of the original near-cliff drop. See `cliffLip` in mapRenderer.ts. */
export const SHIPPED_CLIFF_LIP = 0.68;
/** Resting place of the soft bloom edge, in screen pixels past the cliff. */
export const SHIPPED_BLOOM_REST_PX = 10;
/** Soft brush, wide enough that the moving edge is not a hard stripe. */
export const SHIPPED_BLOOM_BRUSH_PX = 14;
export const SHIPPED_BLOOM_BLUR_PX = 7;
/** Stroke alpha of the single shallow edge. */
export const SHIPPED_BLOOM_ALPHA = 0.42;

export interface CoastTune {
  reachPx: number;
  periodS: number;
  wavelength: number;
  grainPx: number;
  bloomRestPx: number;
  bloomBrushPx: number;
  bloomBlurPx: number;
  bloomAlpha: number;
  /** Global cliff lip, the share `cliffLip` multiplies. */
  cliffLip: number;
  /** Region id to a lift that replaces the size-based drop. Absent means the island's size. */
  cliffOverrides: Record<string, number>;
}

export const SHIPPED_COAST_TUNE: CoastTune = {
  reachPx: SURF_REACH_PX,
  periodS: SURF_PERIOD_S,
  wavelength: SURF_WAVELENGTH,
  grainPx: SURF_GRAIN_PX,
  bloomRestPx: SHIPPED_BLOOM_REST_PX,
  bloomBrushPx: SHIPPED_BLOOM_BRUSH_PX,
  bloomBlurPx: SHIPPED_BLOOM_BLUR_PX,
  bloomAlpha: SHIPPED_BLOOM_ALPHA,
  cliffLip: SHIPPED_CLIFF_LIP,
  cliffOverrides: {},
};

const FIELD_LIMITS = {
  reachPx: [0, 64],
  periodS: [0.05, 120],
  wavelength: [1, 4000],
  grainPx: [0, 16],
  bloomRestPx: [0, 120],
  bloomBrushPx: [0, 120],
  bloomBlurPx: [0, 80],
  bloomAlpha: [0, 1],
  cliffLip: [0, 4],
} as const;

type TuneField = keyof typeof FIELD_LIMITS;

export function shippedCoastTune(): CoastTune {
  return { ...SHIPPED_COAST_TUNE, cliffOverrides: {} };
}

export function surfTuneFromCoast(tune: CoastTune): SurfTune {
  return {
    reachPx: tune.reachPx,
    periodS: tune.periodS,
    wavelength: tune.wavelength,
    grainPx: tune.grainPx,
  };
}

/** Stable key order so a lock-in writes the same file for the same numbers. */
export function canonicalCoastTune(tune: CoastTune): CoastTune {
  const cliffOverrides: Record<string, number> = {};
  for (const id of Object.keys(tune.cliffOverrides).sort()) {
    cliffOverrides[id] = tune.cliffOverrides[id];
  }
  return {
    reachPx: tune.reachPx,
    periodS: tune.periodS,
    wavelength: tune.wavelength,
    grainPx: tune.grainPx,
    bloomRestPx: tune.bloomRestPx,
    bloomBrushPx: tune.bloomBrushPx,
    bloomBlurPx: tune.bloomBlurPx,
    bloomAlpha: tune.bloomAlpha,
    cliffLip: tune.cliffLip,
    cliffOverrides,
  };
}

function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

/** A stored tune, or null when the payload is not one the map can draw. Missing fields stay shipped. */
export function parseCoastTune(raw: unknown): CoastTune | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const next = shippedCoastTune();
  for (const key of Object.keys(FIELD_LIMITS) as TuneField[]) {
    if (!(key in record)) {
      continue;
    }
    const [min, max] = FIELD_LIMITS[key];
    const value = record[key];
    if (!inRange(value, min, max)) {
      return null;
    }
    next[key] = value;
  }
  if ("cliffOverrides" in record) {
    const overrides = record.cliffOverrides;
    if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides)) {
      return null;
    }
    for (const [id, value] of Object.entries(overrides)) {
      if (id === "" || !inRange(value, 0, 4)) {
        return null;
      }
      next.cliffOverrides[id] = value;
    }
  }
  return next;
}

/** Size lift, unless this region has an override. An override replaces the island's size, including 0. */
export function effectiveCliffLift(
  span: number,
  regionId: string,
  overrides: Readonly<Record<string, number>>,
): number {
  const over = overrides[regionId];
  if (typeof over === "number" && Number.isFinite(over)) {
    return over;
  }
  return cliffLift(span);
}

export interface CoastTuneSpot {
  id: string;
  x: number;
  y: number;
}

/**
 * Nearest first. Ties keep the incoming order, so a tie does not fall through to the name.
 * `origin` is the view centre, or the first selected region once one has been picked.
 */
export function sortLandRegionsByProximity<T extends { x: number; y: number }>(
  regions: readonly T[],
  origin: { x: number; y: number },
): T[] {
  return regions
    .map((region, index) => ({
      region,
      index,
      distance: (region.x - origin.x) ** 2 + (region.y - origin.y) ** 2,
    }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .map((item) => item.region);
}

/** View centre until a region is the anchor; then distance from that region, so the list stays put. */
export function coastTuneSortOrigin<T extends CoastTuneSpot>(
  regions: readonly T[],
  viewCenter: { x: number; y: number },
  anchorId: string | null,
): { x: number; y: number } {
  if (anchorId) {
    const anchor = regions.find((region) => region.id === anchorId);
    if (anchor) {
      return { x: anchor.x, y: anchor.y };
    }
  }
  return viewCenter;
}

export interface CliffRegion {
  id: string;
  polygons: MultiPolygon;
}

export interface CliffStamp {
  lift: number;
  polygons: MultiPolygon;
  /**
   * Territory pieces can share a border. The drawer unions those before filling.
   * A landmass stamp is the whole island, and islands of one height do not share a border.
   */
  territory: boolean;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function ringBBox(ring: Ring): Box {
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
  return { x0, y0, x1, y1 };
}

function boxHas(box: Box, point: { x: number; y: number }): boolean {
  return point.x >= box.x0 && point.x <= box.x1 && point.y >= box.y0 && point.y <= box.y1;
}

function ringCentroid(ring: Ring): { x: number; y: number } {
  const end =
    ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring.length - 1
      : ring.length;
  if (end <= 0) {
    return { x: 0, y: 0 };
  }
  let x = 0;
  let y = 0;
  for (let i = 0; i < end; i++) {
    x += ring[i][0];
    y += ring[i][1];
  }
  return { x: x / end, y: y / end };
}

/** A point inside the polygon, for assigning a territory to the island it sits on. */
function interiorPoint(poly: Polygon): { x: number; y: number } | null {
  const ring = poly[0];
  if (!ring || ring.length < 3) {
    return null;
  }
  const centre = ringCentroid(ring);
  if (pointInMultiPolygon(centre, [poly])) {
    return centre;
  }
  const end =
    ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring.length - 1
      : ring.length;
  for (let i = 0; i < end; i++) {
    const point = { x: (ring[i][0] + centre.x) / 2, y: (ring[i][1] + centre.y) / 2 };
    if (pointInMultiPolygon(point, [poly])) {
      return point;
    }
  }
  return null;
}

function overrideOf(overrides: Readonly<Record<string, number>>, id: string): number | undefined {
  const value = overrides[id];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Cliff faces to stamp. A landmass whose regions are all still on the size lift is one silhouette,
 * the same as the shipped coast. Once any region on it has an override, each distinct height is
 * stamped from the territory polygons that use it, so two regions on one island can differ.
 */
export function planCliffStamps(
  land: MultiPolygon,
  regions: readonly CliffRegion[],
  overrides: Readonly<Record<string, number>>,
): CliffStamp[] {
  const pieces: { regionId: string; polygon: Polygon; at: { x: number; y: number } }[] = [];
  for (const region of regions) {
    for (const polygon of region.polygons) {
      const at = interiorPoint(polygon);
      if (at) {
        pieces.push({ regionId: region.id, polygon, at });
      }
    }
  }

  const masses = land.map((poly) => ({
    poly,
    span: poly[0] ? ringSpan(poly[0]) : 0,
    box: poly[0] && poly[0].length > 0 ? ringBBox(poly[0]) : null,
  }));

  const assigned = new Map<number, { regionId: string; polygon: Polygon }[]>();
  for (const piece of pieces) {
    for (let i = 0; i < masses.length; i++) {
      const mass = masses[i];
      if (!mass.box || !boxHas(mass.box, piece.at)) {
        continue;
      }
      if (!pointInMultiPolygon(piece.at, [mass.poly])) {
        continue;
      }
      const list = assigned.get(i);
      if (list) {
        list.push(piece);
      } else {
        assigned.set(i, [piece]);
      }
      break;
    }
  }

  const landmassesByLift = new Map<number, Polygon[]>();
  const territoriesByLift = new Map<number, Polygon[]>();
  const add = (bucket: Map<number, Polygon[]>, lift: number, polygon: Polygon) => {
    const list = bucket.get(lift);
    if (list) {
      list.push(polygon);
    } else {
      bucket.set(lift, [polygon]);
    }
  };

  for (let i = 0; i < masses.length; i++) {
    const mass = masses[i];
    if (!mass.poly[0] || mass.poly[0].length < 3) {
      continue;
    }
    const here = assigned.get(i) ?? [];
    const split = here.some((piece) => overrideOf(overrides, piece.regionId) !== undefined);
    if (!split) {
      add(landmassesByLift, cliffLift(mass.span), mass.poly);
      continue;
    }
    for (const piece of here) {
      add(territoriesByLift, effectiveCliffLift(mass.span, piece.regionId, overrides), piece.polygon);
    }
  }

  const stamps: CliffStamp[] = [];
  for (const [lift, polygons] of landmassesByLift) {
    stamps.push({ lift, polygons, territory: false });
  }
  for (const [lift, polygons] of territoriesByLift) {
    stamps.push({ lift, polygons, territory: true });
  }
  return stamps;
}

/** Longest side of the landmass under `point`, or null when the point is at sea. */
export function landmassSpanAt(land: MultiPolygon, point: { x: number; y: number }): number | null {
  for (const poly of land) {
    if (!poly[0] || poly[0].length < 3) {
      continue;
    }
    const box = ringBBox(poly[0]);
    if (!boxHas(box, point)) {
      continue;
    }
    if (pointInMultiPolygon(point, [poly])) {
      return ringSpan(poly[0]);
    }
  }
  return null;
}

interface IndexedRegion {
  id: string;
  polygons: MultiPolygon;
  box: Box | null;
}

function indexRegions(regions: readonly CliffRegion[]): IndexedRegion[] {
  return regions.map((region) => {
    let box: Box | null = null;
    for (const poly of region.polygons) {
      if (!poly[0] || poly[0].length === 0) {
        continue;
      }
      const next = ringBBox(poly[0]);
      box = box
        ? {
            x0: Math.min(box.x0, next.x0),
            y0: Math.min(box.y0, next.y0),
            x1: Math.max(box.x1, next.x1),
            y1: Math.max(box.y1, next.y1),
          }
        : next;
    }
    return { id: region.id, polygons: region.polygons, box };
  });
}

function regionAt(point: { x: number; y: number }, regions: readonly IndexedRegion[]): string {
  for (let i = regions.length - 1; i >= 0; i--) {
    const region = regions[i];
    if (!region.box || !boxHas(region.box, point)) {
      continue;
    }
    if (pointInMultiPolygon(point, region.polygons)) {
      return region.id;
    }
  }
  return "";
}

/**
 * Where a coast sample's cliff share comes from. Samples already carry the landmass size lift.
 * A probe just inland picks the territory; an override on that territory replaces the size lift.
 * The same number is what the taupe stamp and the shallow-water knockout use.
 */
export function applyShoreLifts(
  runs: SurfSample[][],
  regions: readonly CliffRegion[],
  overrides: Readonly<Record<string, number>>,
): void {
  const overridden = new Set<string>();
  for (const [id, value] of Object.entries(overrides)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      overridden.add(id);
    }
  }
  if (overridden.size === 0) {
    return;
  }
  const indexed = indexRegions(regions);
  const inland = 0.4;
  for (const run of runs) {
    for (const sample of run) {
      const probe = { x: sample.x - sample.nx * inland, y: sample.y - sample.ny * inland };
      const id = regionAt(probe, indexed);
      if (id !== "" && overridden.has(id)) {
        sample.lift = overrides[id];
      }
    }
    const last = run.length - 1;
    if (last > 0 && run[0].x === run[last].x && run[0].y === run[last].y) {
      run[last].lift = run[0].lift;
    }
  }
}

// The static base map, painted once onto an offscreen canvas and blitted every frame.
//
//   Layer 0  slate water with cached pixel wave bands, then a shallow shelf and sand edge
//   Layer 1  muted faction land, a 4×4 dither, and a light paper grain
//   Layer 2  inner sepia shade along every territory's inside edge
//   Layer 3  territory borders and the coastline ink
//
// Everything here is slow (blur, clip, thousands of segments), so none of it runs per frame. The live
// renderer only draws the cached bitmap, then the dynamic layers (highlights, units, editor handles) on top.
// The bitmap is rebuilt only when the geometry or a territory's owner changes, or the zoom needs a finer
// resolution (see BakeCache). Lines on it are in map units, so they scale with the map like a printed sheet.
//
// The world wraps horizontally. Land is cut at the left and right edges, so edges lying on the seam are
// never inked: a coastline or border drawn there would be a false line through land that carries on in the
// next copy.
import type { FactionKey } from "../theme/factionPalette";
import { MILITARY } from "../theme/militaryPalette";
import { resolveFaction } from "../theme/factionPalette";
import type { Rect, RegionShape } from "./geometry";
import { hatchSegments, isHatchedOwner } from "./hatch";
import {
  BakeCache,
  type BakeKey,
  grainTile,
  ownersSignature,
  type Pt,
  ringRuns,
  ringsOf,
  type Seam,
  sharedEdges,
} from "./mapBakeMath";
import {
  BORDER_PASSES,
  BURN_PASSES,
  COAST_INK,
  NEUTRAL_HATCH,
  SEA_SEAM_WIDTH,
} from "./mapStyle";
import type { MultiPolygon } from "./regionClip";
import type { MasterLand } from "./svgLandLoader";

export interface BakeInput {
  /** The world rectangle: the land SVG's viewBox. */
  bounds: Rect;
  land: MasterLand | null;
  regions: RegionShape[];
  /** The regions' true shapes as paths (or the rough cutters when `exact` is false). */
  paths: Map<string, Path2D>;
  /** The same shapes as polygons, when the land has been clipped. */
  shapes: Map<string, MultiPolygon> | null;
  exact: boolean;
  owners: Record<string, string>;
}

export interface Baked {
  canvas: HTMLCanvasElement;
  /** Bitmap pixels per world unit. */
  scale: number;
}

const GRAIN_SIZE = 256;
/** How strongly the paper grain is multiplied into the land. */
const LAND_GRAIN_ALPHA = 0.35;
/** Ocean from the 16-colour strip. The tested `SEA_BASE_COLOR` stays the parchment-era constant. */
const WATER = MILITARY.steel;
const WAVE_DEEP = MILITARY.spruce;
const WAVE_FOAM = MILITARY.spruce;
const SHELF = MILITARY.spruce;
const SAND = MILITARY.tan;
const INNER_SHADE = MILITARY.charcoal;
/** Faction land from the strip. `FACTION_TINT` remains the tested parchment palette. */
const TACTICAL_LAND: Record<FactionKey, string> = {
  JAP: MILITARY.terracotta,
  USSR: MILITARY.crimson,
  GER: MILITARY.feldgrau,
  UK: MILITARY.khaki,
  US: MILITARY.olive,
  NEUTRAL: MILITARY.bone,
};
let tile: HTMLCanvasElement | null = null;
let waveCanvas: HTMLCanvasElement | null = null;
let ditherCanvas: HTMLCanvasElement | null = null;

/** The seamless paper tile, generated once. */
function parchmentTile(): HTMLCanvasElement {
  if (!tile) {
    const data = grainTile(GRAIN_SIZE) as Uint8ClampedArray<ArrayBuffer>;
    tile = document.createElement("canvas");
    tile.width = GRAIN_SIZE;
    tile.height = GRAIN_SIZE;
    tile.getContext("2d")!.putImageData(new ImageData(data, GRAIN_SIZE, GRAIN_SIZE), 0, 0);
  }
  return tile;
}

/** Horizontal pixel dashes for the ocean, built once and repeated. */
function waveTile(): HTMLCanvasElement {
  if (!waveCanvas) {
    waveCanvas = document.createElement("canvas");
    waveCanvas.width = 48;
    waveCanvas.height = 16;
    const g = waveCanvas.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    g.fillStyle = WATER;
    g.fillRect(0, 0, 48, 16);
    g.fillStyle = WAVE_DEEP;
    for (let x = 0; x < 48; x += 6) {
      g.fillRect(x, 3, 3, 1);
    }
    g.fillStyle = WAVE_FOAM;
    for (let x = 2; x < 48; x += 6) {
      g.fillRect(x, 11, 3, 1);
    }
  }
  return waveCanvas;
}

/** A 4×4 pixel grain, painted inside each territory at low opacity. */
function ditherTile(): HTMLCanvasElement {
  if (!ditherCanvas) {
    ditherCanvas = document.createElement("canvas");
    ditherCanvas.width = 4;
    ditherCanvas.height = 4;
    const g = ditherCanvas.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    g.fillStyle = INNER_SHADE;
    g.fillRect(0, 1, 1, 1);
    g.fillRect(2, 3, 1, 1);
  }
  return ditherCanvas;
}

function tacticalLandTint(owner: string): string {
  return TACTICAL_LAND[resolveFaction(owner)];
}

/**
 * The water behind the baked bitmap, so the area past the world matches the ocean on it.
 */
export function oceanBackdrop(): string {
  return WATER;
}

function ringPoints(points: { x: number; y: number }[]): Pt[] {
  return points.map((p) => [p.x, p.y] as Pt);
}

/** The region's outline as polygons: the clipped shape, or the rough cutter (with its extra islands). */
function shapeOf(region: RegionShape, input: BakeInput): MultiPolygon {
  const clipped = input.shapes?.get(region.id);
  if (clipped) {
    return clipped;
  }
  return [[ringPoints(region.points)], ...(region.extra ?? []).map((ring) => [ringPoints(ring)])] as MultiPolygon;
}

function runsPath(runs: Pt[][]): Path2D {
  const path = new Path2D();
  for (const run of runs) {
    run.forEach(([x, y], i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
  }
  return path;
}

/** Every ring of the shape as one path, minus the edges on the wrap seam. */
function outlinePath(shape: MultiPolygon, seam: Seam): Path2D {
  return runsPath(ringsOf(shape).flatMap((ring) => ringRuns(ring, seam)));
}

function segmentsPath(segments: [number, number, number, number][]): Path2D {
  const path = new Path2D();
  for (const [x1, y1, x2, y2] of segments) {
    path.moveTo(x1, y1);
    path.lineTo(x2, y2);
  }
  return path;
}

export function bakeTerrain(input: BakeInput, scale: number): Baked {
  const { bounds, land } = input;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(bounds.w * scale));
  canvas.height = Math.max(1, Math.ceil(bounds.h * scale));
  const ctx = canvas.getContext("2d")!;
  const sx = canvas.width / bounds.w;
  const sy = canvas.height / bounds.h;
  const toWorld = () => ctx.setTransform(sx, 0, 0, sy, -bounds.x * sx, -bounds.y * sy);
  const toPixels = () => ctx.setTransform(1, 0, 0, 1, 0, 0);
  const seam: Seam = { left: bounds.x, right: bounds.x + bounds.w };
  const grain = ctx.createPattern(parchmentTile(), "repeat");
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  /** Multiplies the paper tile over whatever the current clip allows. */
  const grainOver = (alpha: number) => {
    if (!grain) {
      return;
    }
    ctx.save();
    toPixels();
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = alpha;
    ctx.fillStyle = grain;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  };

  const landRegions = input.regions.filter((r) => r.type === "land" && input.paths.has(r.id));
  const seaRegions = input.regions.filter((r) => r.type === "sea" && input.paths.has(r.id));

  // Layer 0: slate water and cached pixel wave bands. Smoothing stays off so the dashes stay square.
  toPixels();
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = WATER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const waves = ctx.createPattern(waveTile(), "repeat");
  if (waves) {
    ctx.fillStyle = waves;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.imageSmoothingEnabled = true;
  toWorld();
  ctx.lineWidth = SEA_SEAM_WIDTH;
  ctx.strokeStyle = WAVE_DEEP;
  ctx.stroke(segmentsPath(sharedEdges(seaRegions.map((r) => shapeOf(r, input)), seam, 2)));

  // Shallow shelf and sand edge, stroked before the land fill so only the seaward half remains.
  const coast = land
    ? runsPath(ringsOf(land.polygons).flatMap((ring) => ringRuns(ring, seam)))
    : landRegions.length > 0
      ? outlinePath(landRegions.flatMap((region) => shapeOf(region, input)), seam)
      : null;
  if (coast) {
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = SHELF;
    ctx.lineWidth = 12 / sx;
    ctx.stroke(coast);
    ctx.strokeStyle = SAND;
    ctx.lineWidth = 5 / sx;
    ctx.stroke(coast);
    ctx.restore();
  }

  // Neutral land under everything, then a hatch on the decorative gaps the territories will cover.
  if (land) {
    ctx.fillStyle = TACTICAL_LAND.NEUTRAL;
    ctx.fill(land.masterLandPath);
  }
  const hatch = segmentsPath(hatchSegments(bounds, NEUTRAL_HATCH.spacing));
  const strokeHatch = () => {
    ctx.lineWidth = NEUTRAL_HATCH.width;
    ctx.strokeStyle = "rgba(100, 83, 85, 0.35)";
    ctx.lineCap = "butt";
    ctx.stroke(hatch);
    ctx.lineCap = "round";
  };
  if (land) {
    ctx.save();
    ctx.clip(land.masterLandPath);
    strokeHatch();
    ctx.restore();
  }
  // Cliff faces are drawn with the live camera so their depth can follow the tilt.
  ctx.save();
  if (land && !input.exact) {
    ctx.clip(land.masterLandPath);
  }
  for (const region of landRegions) {
    const owner = input.owners[region.id] ?? "";
    ctx.fillStyle = tacticalLandTint(owner);
    ctx.fill(input.paths.get(region.id)!, "evenodd");
    if (!land && isHatchedOwner(owner)) {
      ctx.save();
      ctx.clip(input.paths.get(region.id)!, "evenodd");
      strokeHatch();
      ctx.restore();
    }
  }
  ctx.restore();

  const dither = ctx.createPattern(ditherTile(), "repeat");
  if (dither) {
    for (const region of landRegions) {
      ctx.save();
      ctx.clip(input.paths.get(region.id)!, "evenodd");
      ctx.globalAlpha = 0.08;
      toPixels();
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = dither;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
    toWorld();
  }

  ctx.save();
  if (land) {
    ctx.clip(land.masterLandPath);
  } else {
    const union = new Path2D();
    for (const region of landRegions) {
      union.addPath(input.paths.get(region.id)!);
    }
    ctx.clip(union, "evenodd");
  }
  grainOver(LAND_GRAIN_ALPHA);
  ctx.restore();

  // Inner shade, clipped so only the landward half of the stroke shows.
  const landShapes: MultiPolygon[] = [];
  for (const region of landRegions) {
    const shape = shapeOf(region, input);
    landShapes.push(shape);
    ctx.save();
    ctx.clip(input.paths.get(region.id)!, "evenodd");
    const outline = outlinePath(shape, seam);
    for (const pass of BURN_PASSES) {
      ctx.lineWidth = pass.width;
      ctx.strokeStyle = "rgba(100, 83, 85, 0.22)";
      ctx.stroke(outline);
    }
    ctx.lineWidth = 4 / sx;
    ctx.strokeStyle = INNER_SHADE;
    ctx.stroke(outline);
    ctx.restore();
  }

  // Layer 3: borders two territories share, smudge then ink, kept off the water; then the coastline.
  ctx.save();
  if (land) {
    ctx.clip(land.masterLandPath);
  }
  const borders = segmentsPath(sharedEdges(landShapes, seam, land ? 2 : 1));
  for (const pass of BORDER_PASSES) {
    ctx.lineWidth = pass.width;
    ctx.strokeStyle = pass.width > 2 ? "rgba(100, 83, 85, 0.28)" : MILITARY.charcoal;
    ctx.stroke(borders);
  }
  ctx.restore();

  if (land) {
    ctx.lineWidth = COAST_INK.width;
    ctx.strokeStyle = MILITARY.charcoal;
    ctx.stroke(runsPath(ringsOf(land.polygons).flatMap((ring) => ringRuns(ring, seam))));
  }
  toPixels();
  return { canvas, scale };
}

/** Bump when the baked paint changes, so a live view throws away the old bitmap. */
export const BAKE_PAINT = 2;

/** Owns the cached base map. Create one per map view. */
export class TerrainBake {
  private readonly cache = new BakeCache<BakeInput, Baked>(bakeTerrain);
  /** How long the last rebuild took, in ms. */
  lastBuildMs = 0;

  /** The cached bitmap, rebuilt only if the geometry, ownership or needed resolution changed. */
  ensure(input: BakeInput, pixelsPerUnit: number): Baked {
    const key: BakeKey = {
      regions: input.regions,
      paths: input.paths,
      land: input.land,
      exact: input.exact,
      owners: ownersSignature(input.regions, input.owners),
      bounds: `${input.bounds.x},${input.bounds.y},${input.bounds.w},${input.bounds.h}`,
    };
    const before = this.cache.builds;
    const started = performance.now();
    const out = this.cache.get(key, pixelsPerUnit, input).value;
    if (this.cache.builds !== before) {
      this.lastBuildMs = performance.now() - started;
    }
    return out;
  }

  get builds(): number {
    return this.cache.builds;
  }
}

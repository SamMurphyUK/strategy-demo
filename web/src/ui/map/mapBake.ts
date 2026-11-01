// The static base map, painted once onto an offscreen canvas and blitted every frame.
//
//   Layer 0  muted slate-blue ocean with paper grain, pale seams between sea zones, a soft shadow under the land
//   Layer 1  desaturated faction tints on the land, with the grain multiplied over them
//   Layer 2  contour-hugging aged burn along every territory's inside edge
//   Layer 3  airbrushed double-stroke territory borders and the coastline ink
//
// Everything here is slow (blur, clip, thousands of segments), so none of it runs per frame. The live
// renderer only draws the cached bitmap, then the dynamic layers (highlights, units, editor handles) on top.
// The bitmap is rebuilt only when the geometry or a territory's owner changes, or the zoom needs a finer
// resolution (see BakeCache). Lines on it are in map units, so they scale with the map like a printed sheet.
//
// The world wraps horizontally. Land is cut at the left and right edges, so edges lying on the seam are
// never inked: a coastline or border drawn there would be a false line through land that carries on in the
// next copy.
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
  tileMean,
} from "./mapBakeMath";
import {
  BORDER_PASSES,
  BURN_PASSES,
  COAST_INK,
  COAST_SHADOW,
  FACTION_TINT,
  landTint,
  NEUTRAL_HATCH,
  SEA_BASE_COLOR,
  SEA_SEAM_COLOR,
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
/** How strongly the paper grain is multiplied into the ocean. */
const OCEAN_GRAIN_ALPHA = 0.7;
let tile: HTMLCanvasElement | null = null;
let tileBrightness = 1;

/** The seamless paper tile, generated once. */
function parchmentTile(): HTMLCanvasElement {
  if (!tile) {
    const data = grainTile(GRAIN_SIZE) as Uint8ClampedArray<ArrayBuffer>;
    tileBrightness = tileMean(data);
    tile = document.createElement("canvas");
    tile.width = GRAIN_SIZE;
    tile.height = GRAIN_SIZE;
    tile.getContext("2d")!.putImageData(new ImageData(data, GRAIN_SIZE, GRAIN_SIZE), 0, 0);
  }
  return tile;
}

/**
 * The colour the grained ocean averages out to. Painted behind the map, so the water beyond the edges of the
 * baked bitmap (zoomed out, or above and below the world) matches the water on it.
 */
export function oceanBackdrop(): string {
  parchmentTile();
  const n = Number.parseInt(SEA_BASE_COLOR.slice(1), 16);
  const shade = 1 - OCEAN_GRAIN_ALPHA * (1 - tileBrightness);
  const ch = (v: number) => Math.round(v * shade);
  return `rgb(${ch((n >> 16) & 255)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`;
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

  // Layer 0: ocean, grain, and the pale rules where one sea zone meets another.
  toPixels();
  ctx.fillStyle = SEA_BASE_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  grainOver(OCEAN_GRAIN_ALPHA);
  toWorld();
  ctx.lineWidth = SEA_SEAM_WIDTH;
  ctx.strokeStyle = SEA_SEAM_COLOR;
  ctx.stroke(segmentsPath(sharedEdges(seaRegions.map((r) => shapeOf(r, input)), seam, 2)));

  // The land's silhouette, in neutral parchment, casts the drop shadow. Territories are painted over it.
  if (land) {
    ctx.save();
    ctx.shadowColor = COAST_SHADOW.color;
    ctx.shadowBlur = COAST_SHADOW.blur * sx;
    ctx.shadowOffsetX = COAST_SHADOW.offset * sx;
    ctx.shadowOffsetY = COAST_SHADOW.offset * sy;
    ctx.fillStyle = FACTION_TINT.NEUTRAL;
    ctx.fill(land.masterLandPath);
    ctx.restore();
  }

  // Layer 1: faction tints. Unclaimed (decorative) land keeps the neutral base, hatched. The hatch covers all
  // the land first and the owned territories are painted over it, so only neutral and decorative land keeps it.
  const hatch = segmentsPath(hatchSegments(bounds, NEUTRAL_HATCH.spacing));
  const strokeHatch = () => {
    ctx.lineWidth = NEUTRAL_HATCH.width;
    ctx.strokeStyle = NEUTRAL_HATCH.color;
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
  ctx.save();
  if (land && !input.exact) {
    ctx.clip(land.masterLandPath);
  }
  for (const region of landRegions) {
    const owner = input.owners[region.id] ?? "";
    const tint = landTint(owner);
    if (land && tint === FACTION_TINT.NEUTRAL) {
      continue;
    }
    ctx.fillStyle = tint;
    ctx.fill(input.paths.get(region.id)!, "evenodd");
    if (!land && isHatchedOwner(owner)) {
      // Without the land mask there is no decorative land to hatch, only the neutral territories themselves.
      ctx.save();
      ctx.clip(input.paths.get(region.id)!, "evenodd");
      strokeHatch();
      ctx.restore();
    }
  }
  ctx.restore();

  // The grain, multiplied over the land so the colours look dyed into the stock.
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
  grainOver(0.85);
  ctx.restore();

  // Layer 2: the aged burn. Clip to the territory (every island of it), then stroke its outline: only the
  // inside half of the stroke shows, so it follows every inlet, peninsula and frontier.
  const landShapes: MultiPolygon[] = [];
  for (const region of landRegions) {
    const shape = shapeOf(region, input);
    landShapes.push(shape);
    ctx.save();
    ctx.clip(input.paths.get(region.id)!, "evenodd");
    const outline = outlinePath(shape, seam);
    for (const pass of BURN_PASSES) {
      ctx.lineWidth = pass.width;
      ctx.strokeStyle = pass.color;
      ctx.stroke(outline);
    }
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
    ctx.strokeStyle = pass.color;
    ctx.stroke(borders);
  }
  ctx.restore();

  if (land) {
    ctx.lineWidth = COAST_INK.width;
    ctx.strokeStyle = COAST_INK.color;
    ctx.stroke(runsPath(ringsOf(land.polygons).flatMap((ring) => ringRuns(ring, seam))));
  }
  toPixels();
  return { canvas, scale };
}

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

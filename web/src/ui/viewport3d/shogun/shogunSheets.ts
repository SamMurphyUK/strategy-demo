// The sheets the Shogun board's shaders read, painted on 2D canvases.
//
//   terrain   the natural ground, with no owner and no border on it
//   faction   each territory's faction colour, flat
//   lines     red: every border and the coast   green: borders inside one faction   blue: those, dashed
//   front     red: the frontline's centre   green: its flanks   blue: the banded frontline
//   edge      red: how near a point on land is to its territory's edge   green: the same at sea
//
// The lines and the frontline are stored as coverage and coloured in the shader, so a style or a
// strength changes with a uniform and no sheet is painted again. Sheets are painted again only
// when the map itself changes: a territory changes hands, or the front moves.
import type { Rect, RegionShape } from "../../map/geometry";
import { ringRuns, ringsOf, type Pt, type Seam, sharedEdges } from "../../map/mapBakeMath";
import type { MultiPolygon } from "../../map/regionClip";
import type { MasterLand } from "../../map/svgLandLoader";
import type { FrontlineSegment } from "../../map/terrainRelief";
import { crestPoints, MOUNTAIN_RANGES } from "../geography";
import { chainSegments, friendlyBorders, type OwnedShape, type Polyline, type Segment } from "./borderLines";
import { LAND_COVER_COLOR, landCoverOf, terrainPixels } from "./terrainBase";

/** Bitmap pixels per world unit for the line sheets. */
export const LINE_SHEET_SCALE = 3;
const FACTION_SHEET_SCALE = 2;
const EDGE_SHEET_SCALE = 2;
/** How far inside a territory the edge sheet still measures, in world units. */
export const EDGE_REACH = 6;

/** Stroke widths, in world units. */
const BORDER_WIDTH = 0.8;
const COAST_WIDTH = 1.2;
const DASH_WIDTH = 0.7;
const DASH_PATTERN = [2.6, 2.2];
const FRONT_CENTRE_WIDTH = 0.5;
const FRONT_FLANK_WIDTH = 2.6;
const FRONT_BAND_WIDTH = 6;
const FRONT_DASH_WIDTH = 2;
const FRONT_DASH_PATTERN = [4, 3];

function sheet(bounds: Rect, scale: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; toWorld(dx?: number): void } {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bounds.w * scale));
  canvas.height = Math.max(1, Math.round(bounds.h * scale));
  const ctx = canvas.getContext("2d")!;
  const sx = canvas.width / bounds.w;
  const sy = canvas.height / bounds.h;
  return {
    canvas,
    ctx,
    toWorld: (dx = 0) => ctx.setTransform(sx, 0, 0, sy, (dx - bounds.x) * sx, -bounds.y * sy),
  };
}

/** A territory's shape as a path to fill with the even-odd rule, so its holes stay open. */
function shapePath(shape: MultiPolygon): Path2D {
  const path = new Path2D();
  for (const ring of ringsOf(shape)) {
    ring.forEach(([x, y], i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
    path.closePath();
  }
  return path;
}

function linesPath(lines: readonly Polyline[]): Path2D {
  const path = new Path2D();
  for (const line of lines) {
    line.forEach(([x, y], i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
  }
  return path;
}

function segmentsPath(segments: readonly Segment[]): Path2D {
  return linesPath(chainSegments(segments));
}

/** Every ring of the shapes as one path, minus the edges on the world's seam. */
function outlinesPath(shapes: readonly MultiPolygon[], seam: Seam): Path2D {
  return linesPath(shapes.flatMap((shape) => ringsOf(shape).flatMap((ring) => ringRuns(ring as Pt[], seam))));
}

function black(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

/**
 * The natural ground: biomes, then the mountain belts, then any territory that names its own
 * `land_cover`, and a blur over the lot so one ground runs into the next like a wash. One pixel
 * per world unit is plenty: the shader adds the grain.
 */
export function terrainCanvas(bounds: Rect, regions: readonly RegionShape[], shapes: ReadonlyMap<string, MultiPolygon>): HTMLCanvasElement {
  const base = sheet(bounds, 1);
  const { canvas, ctx } = base;
  const pixels = terrainPixels(bounds, canvas.width, canvas.height) as Uint8ClampedArray<ArrayBuffer>;
  ctx.putImageData(new ImageData(pixels, canvas.width, canvas.height), 0, 0);

  // Mountain belts: rock along each crest, and snow down the middle of the high ones.
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const blur = typeof ctx.filter === "string";
  for (const range of MOUNTAIN_RANGES) {
    const crest = new Path2D();
    crestPoints(range, 2).forEach((p, i) => (i === 0 ? crest.moveTo(p.x, p.y) : crest.lineTo(p.x, p.y)));
    for (const dx of [-bounds.w, 0, bounds.w]) {
      base.toWorld(dx);
      if (blur) {
        ctx.filter = "blur(1.5px)";
      }
      ctx.globalAlpha = 0.78;
      ctx.strokeStyle = LAND_COVER_COLOR.MOUNTAIN;
      ctx.lineWidth = range.spread * 3.2;
      ctx.stroke(crest);
      if (range.snowline < 1) {
        ctx.globalAlpha = (1 - range.snowline) * 0.9;
        ctx.strokeStyle = LAND_COVER_COLOR.SNOW;
        ctx.lineWidth = range.spread * 1.1;
        ctx.stroke(crest);
      }
    }
  }
  if (blur) {
    ctx.filter = "none";
  }

  // A territory that names its cover wears it.
  base.toWorld();
  ctx.globalAlpha = 0.92;
  for (const region of regions) {
    const shape = shapes.get(region.id);
    if (region.type !== "land" || !region.landCover || !shape) {
      continue;
    }
    ctx.fillStyle = LAND_COVER_COLOR[landCoverOf(region.landCover)];
    ctx.fill(shapePath(shape), "evenodd");
  }
  ctx.globalAlpha = 1;

  // The wash: a soft blur, with the neighbours drawn in so the sheet still joins at the seam.
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  const wash = out.getContext("2d")!;
  if (typeof wash.filter === "string") {
    wash.filter = "blur(4.5px)";
  }
  for (const dx of [-canvas.width, 0, canvas.width]) {
    wash.drawImage(canvas, dx, 0);
  }
  return out;
}

/** Each territory filled flat with its faction's colour. Land no territory claims takes `colorOf("")`. */
export function factionCanvas(
  bounds: Rect,
  regions: readonly RegionShape[],
  shapes: ReadonlyMap<string, MultiPolygon>,
  owners: Readonly<Record<string, string>>,
  colorOf: (owner: string) => string,
): HTMLCanvasElement {
  const { canvas, ctx, toWorld } = sheet(bounds, FACTION_SHEET_SCALE);
  ctx.fillStyle = colorOf("");
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  toWorld();
  for (const region of regions) {
    const shape = shapes.get(region.id);
    if (region.type !== "land" || !shape) {
      continue;
    }
    const path = shapePath(shape);
    const color = colorOf(owners[region.id] ?? "");
    ctx.fillStyle = color;
    ctx.fill(path, "evenodd");
    // A hair of the same colour past the edge, so the neighbour's colour does not show under the line.
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.4;
    ctx.stroke(path);
  }
  return canvas;
}

/**
 * Borders as coverage. Red is every border between two territories and the coastline. Green is the
 * borders inside one faction's land, solid, and blue is the same borders dashed. The shader takes
 * green from red to get the borders between different owners.
 */
export function lineCanvas(bounds: Rect, land: MasterLand | null, shapes: readonly OwnedShape[]): HTMLCanvasElement {
  const { canvas, ctx, toWorld } = sheet(bounds, LINE_SHEET_SCALE);
  const seam: Seam = { left: bounds.x, right: bounds.x + bounds.w };
  black(ctx, canvas);
  toWorld();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.save();
  if (land) {
    ctx.clip(land.masterLandPath);
  }
  const all = segmentsPath(sharedEdges(shapes.map((item) => item.shape), seam, 2));
  const friendly = friendlyBorders(shapes, seam);
  const friendlyPath = segmentsPath(friendly);
  ctx.lineWidth = BORDER_WIDTH;
  ctx.strokeStyle = "#ff0000";
  ctx.stroke(all);
  ctx.strokeStyle = "#00ff00";
  ctx.stroke(friendlyPath);
  ctx.lineCap = "butt";
  ctx.lineWidth = DASH_WIDTH;
  ctx.setLineDash(DASH_PATTERN);
  ctx.strokeStyle = "#0000ff";
  ctx.stroke(friendlyPath);
  ctx.setLineDash([]);
  ctx.lineCap = "round";
  if (land) {
    ctx.lineWidth = COAST_WIDTH;
    ctx.strokeStyle = "#ff0000";
    ctx.stroke(outlinesPath([land.polygons], seam));
  }
  ctx.restore();
  return canvas;
}

/**
 * The frontline as coverage. Red is the thin centre line and green is the wider band its two
 * flank strokes fill. Blue carries the banded frontline: half for the band, full for its dashes.
 */
export function frontCanvas(bounds: Rect, land: MasterLand | null, frontlines: readonly FrontlineSegment[]): HTMLCanvasElement {
  const { canvas, ctx, toWorld } = sheet(bounds, LINE_SHEET_SCALE);
  black(ctx, canvas);
  if (frontlines.length === 0) {
    return canvas;
  }
  toWorld();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.save();
  if (land) {
    ctx.clip(land.masterLandPath);
  }
  const path = segmentsPath(frontlines.map((segment): Segment => [segment.x1, segment.y1, segment.x2, segment.y2]));
  ctx.lineWidth = FRONT_FLANK_WIDTH;
  ctx.strokeStyle = "#00ff00";
  ctx.stroke(path);
  ctx.lineWidth = FRONT_CENTRE_WIDTH;
  ctx.strokeStyle = "#ff0000";
  ctx.stroke(path);
  ctx.lineCap = "butt";
  ctx.lineWidth = FRONT_BAND_WIDTH;
  ctx.strokeStyle = "#000080";
  ctx.stroke(path);
  ctx.lineWidth = FRONT_DASH_WIDTH;
  ctx.setLineDash(FRONT_DASH_PATTERN);
  ctx.strokeStyle = "#00007f";
  ctx.stroke(path);
  ctx.setLineDash([]);
  ctx.restore();
  return canvas;
}

/**
 * Nearness to a territory's own edge: 1 on the edge, falling to 0 at `EDGE_REACH` units inside.
 * Red measures land territories and green measures sea zones. Inside a territory the nearest
 * border of any kind is its own, so one sheet serves every territory.
 */
export function edgeCanvas(bounds: Rect, landShapes: readonly MultiPolygon[], seaShapes: readonly MultiPolygon[]): HTMLCanvasElement {
  const { canvas, ctx, toWorld } = sheet(bounds, EDGE_SHEET_SCALE);
  const seam: Seam = { left: bounds.x, right: bounds.x + bounds.w };
  black(ctx, canvas);
  toWorld();
  // "lighten" keeps the brighter value in each channel, so two strokes that cross do not add up.
  ctx.globalCompositeOperation = "lighten";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // Strokes from wide and dim to narrow and bright make a ramp that peaks on the border.
  const lay = (shapes: readonly MultiPolygon[], colorOf: (level: string) => string) => {
    const path = segmentsPath(sharedEdges(shapes, seam, 1));
    for (let i = EDGE_REACH; i >= 1; i--) {
      const level = Math.round((255 * (EDGE_REACH - i + 1)) / EDGE_REACH);
      ctx.strokeStyle = colorOf(level.toString(16).padStart(2, "0"));
      ctx.lineWidth = i * 2;
      ctx.stroke(path);
    }
  };
  lay(landShapes, (level) => `#${level}0000`);
  lay(seaShapes, (level) => `#00${level}00`);

  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  const soft = out.getContext("2d")!;
  if (typeof soft.filter === "string") {
    soft.filter = `blur(${(0.6 * EDGE_SHEET_SCALE).toFixed(1)}px)`;
  }
  soft.drawImage(canvas, 0, 0);
  return out;
}

/** A mask that calls every point inland. It stands in until the land has loaded. */
export function allLandMask(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 2;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 2, 2);
  return canvas;
}

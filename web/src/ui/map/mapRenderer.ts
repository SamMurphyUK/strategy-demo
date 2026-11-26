// Layered canvas renderer for the strategic map.
//
//   Layers 0-3  the baked war-room base map (mapBake.ts): ocean, faction-tinted land, aged burn, borders and\n//               coastline. Painted once to an offscreen canvas and blitted per visible world copy.\n//   Layer 4     highlight washes, hover and selection: gold tint plus outline on the region's true shape\n//   Layer 5     anchors, IPC shields, unit counters, markers, and the editor overlay
//   Layer 6     operational arrows on their own canvas, above the map. Battle icons are painted last.
//
// `scene.paths` are the regions' true shapes: each cutter polygon boolean-clipped against the land SVG
// (land regions intersected with it, sea zones differenced from it). Fills and outlines on them follow
// the inland borders and the exact coastline. When the land has not loaded they are the rough cutters
// and `exact` is false, so land regions are clipped to the stencil at draw time instead.
//
// Layers 0-4 draw in world units; layer 5 draws in screen pixels so counters keep their size at any zoom.
import { MILITARY } from "../theme/militaryPalette";
import { isLandAt } from "./hitTest";
import { LATTICE, LATTICE_COLS, LATTICE_ROWS, latticePartRing, MAP_H, MAP_W } from "./editor/seaLattice";
import { drawMapToken } from "./mapToken";
import { isActiveFaction } from "./tokenStyle";
import {
  drawUprightStack,
  idlePhase,
  nearestEnemyOctant,
  type FacingRegion,
  type FacingStacks,
  type FaceOctant,
} from "./uprightSprites";
import {
  BADGE_FILL,
  BADGE_INACTIVE_STROKE,
  BADGE_INK,
  type BadgeShape,
  badgeExtent,
  badgeShapes,
  chimneyCount,
  factoryParts,
  planePolygon,
  silhouetteBox,
} from "./facilityBadge";
import {
  type Facilities,
  facilitiesOf,
  facilityAnchorOf,
  type HighlightMode,
  pointInPolygon,
  type Rect,
  type RegionShape,
  SELECTED_OUTLINE_WIDTH,
  type StackEntry,
  type StackSlot,
  type Vec2,
} from "./geometry";
import { layoutRegionVisuals, type LayoutStage, type PlacedBadge, type UnitDomain } from "./unitStacks";
import { TOKEN_WORLD } from "./unitSlots";
import { type Baked, oceanBackdrop } from "./mapBake";
import {
  EDITOR_LAND_DIM,
  highlightLandFill,
  highlightSeaFill,
  HOVER_COLOR,
  HOVER_TINT,
  LAND_WASH,
  SEA_SEAM_WIDTH,
  SELECTED_COLOR,
  SELECTED_TINT,
} from "./mapStyle";
import { shapeBounds, shapeCenter, type DraftShape, type SculptTool } from "./editor/landmass";
import type { MasterLand } from "./svgLandLoader";
import {
  type ArrowStart,
  arrowPolygons,
  ATTACK_WIDTH,
  battleBadgeHalf,
  battleBadgeScale,
  operationalFill,
  type OperationalOrder,
  type PlannedArrow,
  planOperationalArrows,
  shaftClearancePx,
  ARROW_INK,
} from "./operationalArrows";
import type { FrontlineSegment, ScarFrame } from "./terrainRelief";
import { getDrawFlags } from "./renderDebug";
import { landMaskAt } from "./landMask";
import { facilityBadgeAlpha, microSpriteLean, unitLean } from "./boardTune";
import { getBoardTune } from "./boardTuneStore";
import { mapVisuals, plinthLook } from "./mapVisualConfig";
import { waterY } from "../viewport3d/skins/waterSwell";
import { cliffDepthScale, projectionScales, type View, screenToWorld, worldToScreen } from "./viewMath";
import { buildSurfCoast, cliffLift, ringSpan, surfLocalPx, type SurfSample, type SurfTune } from "./coastRelief";
import {
  applyShoreLifts,
  cliffSweepEdges,
  planCliffStamps,
  SHIPPED_CLIFF_LIP,
  surfTuneFromCoast,
  type CliffRegion,
} from "./coastTune";
import { getCoastTune } from "./coastTuneStore";
import { ringsOf, type Pt } from "./mapBakeMath";
import polygonClipping from "polygon-clipping";
import { pointInMultiPolygon, type MultiPolygon } from "./regionClip";
import type { ShoreVeil } from "../../art/fieldVehicleStage";
import type { ShoreStencil } from "./figureSheet";
import { landScreenTransform, SEA_LAND_ALPHA } from "./seaOverlap";
import { plinthFactor, unitBaseShare } from "../viewport3d/plinthPlacement";
import { drawHoldCircles } from "./shipHold";
import {
  type MapLod,
  TACTICAL_IN,
  type TerrainStamp,
  terrainStampFadeAlpha,
  terrainStamps,
  uprightDrawOrder,
} from "./zoomLod";

export const TOKEN_PX = 32;
const PAPER = MILITARY.cream;
const INK = MILITARY.charcoal;
const PLINTH = MILITARY.charcoal;
const BRASS = MILITARY.brass;
const GOLD_NUM = MILITARY.cream;
const SERIF = 'Georgia, "Iowan Old Style", "Times New Roman", serif';
const MONO = '"Courier New", "JetBrains Mono", ui-monospace, monospace';

export interface TerrainScene {
  width: number;
  height: number;
  dpr: number;
  view: View;
  land: MasterLand | null;
  regions: RegionShape[];
  /** True region shapes (coastline-clipped) when `exact`, rough cutters otherwise. */
  paths: Map<string, Path2D>;
  /** Coastline-clipped polygons, when the land mask has loaded. Cliff overrides stamp these. */
  shapes?: Map<string, MultiPolygon> | null;
  exact: boolean;
  owners: Record<string, string>;
  highlight: HighlightMode;
  selectedRegionId: string;
  hoverRegionId: string;
  /** Regions of this layer are drawn faded (the editor's other layer). */
  dim?: "land" | "sea" | null;
  /** The cached base map (see mapBake.ts), blitted once per copy in copies. */
  baked: Baked;
  /** The world rectangle the bake covers: the land SVG's viewBox. */
  bounds: Rect;
  /** Horizontal offsets of the world copies to draw: -width, 0, +width as they come into view. */
  copies: number[];
  /** Hostile land borders, in world units. Drawn on every copy. */
  frontlines?: readonly FrontlineSegment[];
  /** Craters and the current smoke frame, in world units. Drawn on every copy. */
  scars?: readonly ScarFrame[];
  /** 0 strategic, 1 operational stamps, 2 upright sprites. Omitted means strategic. */
  lod?: MapLod;
  /** 0 icon tokens, 1 upright sprites. A value between is the timed handoff. */
  unitFade?: number;
  /** World points stamps must stay clear of, per land region. Hubs and unit slots. */
  stampAvoid?: Readonly<Record<string, readonly Vec2[]>>;
  /** Skip cliff fills. The pan/zoom interacting paint blits a held picture instead. */
  skipCliffs?: boolean;
  /**
   * The ground is drawn by a board layer under this canvas (see boardLayer.ts). The canvas is
   * cleared, and the base map, cliffs, and terrain stamps are left out.
   */
  backdrop?: boolean;
  /** With a 3D board under the canvas: how far the water lies below the land, in world units. A sea zone's coast is outlined at the foot of the cliff. */
  cliffDrop?: number;
}

export interface PlacedCounter {
  regionId: string;
  slot: StackSlot;
  domain: UnitDomain;
  /** Screen position of the counter's centre. */
  x: number;
  y: number;
}

export interface RegionLayout {
  region: RegionShape;
  anchor: Vec2;
  /** Back to front. The last counter is the lead, and it wins a click. */
  counters: PlacedCounter[];
  /** open: one slot each. arc: satellites around a primary. capped: the arcs stopped and grew a [+]. */
  stage: LayoutStage;
  capped: boolean;
  /** The [+] on the lead token, when the fan is capped. */
  plus: Vec2 | null;
  /** The facility badge, or null when the region has no facility. */
  badge: PlacedBadge | null;
  /** Screen y of the IPC shield's centre, and of the combat marker's. */
  shieldY: number;
  markerY: number;
  /** Half the height of a token, in px, or 0 when the region has none. */
  halfHeight: number;
  /** The world copy this layout is for: 0 for the primary map, otherwise a multiple of the world width. */
  copyDx: number;
}

export interface LayoutOptions {
  /** A region's unit slots in world units (see effectiveUnitSlots). Asked for only when the region has units. */
  slotsFor?(region: RegionShape): Vec2[];
  /** Unit type id to land, air or sea, from the scenario's unit data. */
  categories?: Record<string, string>;
  copyDx?: number;
}

/** Side of one facility badge triangle at a token size of TOKEN_PX, in px. */
export const BADGE_SIDE_PX = 30;

/**
 * Lays out every region's tokens, badge and shield for one world copy. `tokenScale` is the on-screen token
 * size relative to TOKEN_PX: tokens grow and shrink with the map (see worldTokenPx).
 */
export function layoutRegions(
  regions: RegionShape[],
  stacks: Record<string, StackEntry[]>,
  view: View,
  tokenScale = 1,
  options: LayoutOptions = {},
): RegionLayout[] {
  const tokenPx = TOKEN_PX * tokenScale;
  const yScale = view.k > 0 ? projectionScales(view.k).sy / view.k : 1;
  const tiltY = (y: number) => y * yScale;
  return regions.map((region) => {
    const anchor = worldToScreen(view, region.anchor);
    const entries = stacks[region.id] ?? [];
    const visuals = layoutRegionVisuals(region, entries, {
      view,
      tokenPx,
      badgeSide: BADGE_SIDE_PX * tokenScale,
      slots: entries.length > 0 ? (options.slotsFor?.(region) ?? [region.anchor]) : [],
      categories: options.categories,
    });
    const counters = visuals.tokens.map((t) => ({
      regionId: region.id,
      slot: { key: t.key, entry: t.entry, offset: { x: t.x - anchor.x, y: tiltY(t.y) - anchor.y } },
      domain: t.domain,
      x: t.x,
      y: tiltY(t.y),
    }));
    return {
      region,
      anchor,
      counters,
      stage: visuals.stage,
      capped: visuals.capped,
      plus: visuals.plus ? { x: visuals.plus.x, y: tiltY(visuals.plus.y) } : null,
      badge: visuals.badge ? { ...visuals.badge, y: tiltY(visuals.badge.y) } : null,
      shieldY: tiltY(visuals.shieldY),
      markerY: tiltY(visuals.markerY),
      halfHeight: visuals.tokens.length > 0 ? tokenPx / 2 : 0,
      copyDx: options.copyDx ?? 0,
    };
  });
}

function setWorldTransform(ctx: CanvasRenderingContext2D, view: View, dpr: number): void {
  const { sx, sy } = projectionScales(view.k);
  const xs = dpr * sx;
  const ys = dpr * sy;
  ctx.setTransform(xs, 0, 0, ys, -view.x * xs, -view.y * ys);
}

function setScreenTransform(ctx: CanvasRenderingContext2D, dpr: number): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ---------------------------------------------------------------
// Layers 0-3: the cached base map, then the dynamic washes on top
// ---------------------------------------------------------------

/**
 * Draws the baked base map once per visible world copy, then the parts that change with play: highlight
 * washes, hover and selection. Nothing here blurs, shadows or generates noise; that is all in the bake.
 */
export function drawTerrain(ctx: CanvasRenderingContext2D, s: TerrainScene): void {
  const { view, dpr, baked, bounds } = s;
  setScreenTransform(ctx, dpr);
  if (s.backdrop) {
    ctx.clearRect(0, 0, s.width, s.height);
  } else {
    ctx.fillStyle = oceanBackdrop();
    ctx.fillRect(0, 0, s.width, s.height);
  }

  const px = 1 / view.k;
  // Adjacent copies overlap by under a pixel, so bilinear edges leave no hairline between them.
  const bleed = s.copies.length > 1 ? 0.4 * px : 0;
  for (const dx of s.copies) {
    setWorldTransform(ctx, view, dpr);
    ctx.translate(dx, 0);
    ctx.lineJoin = "round";
    if (!s.backdrop) {
      ctx.drawImage(baked.canvas, bounds.x - bleed, bounds.y, bounds.w + bleed * 2, bounds.h);
      if (getDrawFlags().cliffs && !s.skipCliffs) {
        drawTiltedCliffs(ctx, s, bleed);
      }
    }
    drawDynamicTerrain(ctx, s, px, dx);
  }
  setWorldTransform(ctx, view, dpr);
}

/**
 * Share of the original near-cliff drop (`2.5 × relief`). Raised from 0.4 so the lip reaches the
 * land. The deeper third shadow (`5 × relief`) stays gone. The shipped share is `SHIPPED_CLIFF_LIP`.
 */

/** Charcoal rim on the outer cliff edge, in map units. It does not grow with the lip. */
const CLIFF_RIM = 0.55;

function landRegionsOf(s: TerrainScene): RegionShape[] {
  return s.regions.filter((region) => region.type === "land" && s.paths.has(region.id));
}

/** The continent silhouette the cliff is extruded from. The master coast when it has loaded. */
function fillLandSilhouette(ctx: CanvasRenderingContext2D, s: TerrainScene): void {
  if (s.land) {
    ctx.fill(s.land.masterLandPath);
    return;
  }
  for (const region of landRegionsOf(s)) {
    const path = s.paths.get(region.id);
    if (path) {
      ctx.fill(path, "evenodd");
    }
  }
}

function strokeLandSilhouette(ctx: CanvasRenderingContext2D, s: TerrainScene): void {
  if (s.land) {
    ctx.stroke(s.land.masterLandPath);
    return;
  }
  for (const region of landRegionsOf(s)) {
    const path = s.paths.get(region.id);
    if (path) {
      ctx.stroke(path);
    }
  }
}

/** The face between a group's coast and the same coast `dy` lower: one four-sided piece under every edge. */
function cliffSweepPath(group: CliffGroup, dy: number): Path2D {
  if (group.sweep?.dy === dy) {
    return group.sweep.path;
  }
  const path = new Path2D();
  const edges = group.edges;
  // A fill closes each piece itself. `closePath` on a path this long is slow enough to drop a frame.
  for (let i = 0; i < edges.length; i += 4) {
    path.moveTo(edges[i], edges[i + 1]);
    path.lineTo(edges[i + 2], edges[i + 3]);
    path.lineTo(edges[i + 2], edges[i + 3] + dy);
    path.lineTo(edges[i], edges[i + 1] + dy);
  }
  group.sweep = { dy, path };
  return path;
}

/**
 * Southern cliff under the land. A single downward copy leaves a water gap under any island
 * shorter than the drop, so the face is the whole silhouette swept from the coast down to the lip.
 * The baked land is put back on top. One taupe face; no second darker extrude.
 *
 * The sweep is three fills: the lowered silhouette with its rim, the faces under every edge, and
 * the silhouette in place. Filling the silhouette once for each pixel of the drop draws the same
 * picture and costs a coastline fill per pixel, which stalls a zoom.
 */
function drawTiltedCliffs(ctx: CanvasRenderingContext2D, s: TerrainScene, bleed: number): void {
  const landRegions = landRegionsOf(s);
  if (!s.land && landRegions.length === 0) {
    return;
  }
  ctx.fillStyle = MILITARY.taupe;
  ctx.strokeStyle = MILITARY.charcoal;
  ctx.lineWidth = CLIFF_RIM;
  ctx.lineJoin = "miter";
  const lip = cliffLip(s.view.k, getCoastTune().cliffLip);
  if (s.land && getDrawFlags().stamp) {
    // The picture the sweep replaced. One coastline fill per device pixel of the drop.
    const { sy } = projectionScales(s.view.k);
    const step = 1 / (s.dpr * sy);
    for (const group of cliffGroups(s)) {
      const dy = lip * group.lift;
      const steps = Math.max(1, Math.min(120, Math.ceil(dy / step)));
      for (let i = steps; i >= 0; i--) {
        ctx.save();
        ctx.translate(0, (dy * i) / steps);
        ctx.fill(group.path, "evenodd");
        if (i === steps) {
          ctx.stroke(group.path);
        }
        ctx.restore();
      }
    }
  } else if (s.land) {
    for (const group of cliffGroups(s)) {
      const dy = lip * group.lift;
      ctx.save();
      ctx.translate(0, dy);
      ctx.fill(group.path, "evenodd");
      ctx.stroke(group.path);
      ctx.restore();
      if (dy > 0) {
        ctx.fill(cliffSweepPath(group, dy), "nonzero");
      }
      ctx.fill(group.path, "evenodd");
    }
  } else {
    // Rough cutters, before the land outline has loaded. Few shapes, and only for a moment.
    const { sy } = projectionScales(s.view.k);
    const steps = Math.max(1, Math.min(120, Math.ceil(lip * s.dpr * sy)));
    for (let i = steps; i >= 0; i--) {
      ctx.save();
      ctx.translate(0, (lip * i) / steps);
      fillLandSilhouette(ctx, s);
      if (i === steps) {
        strokeLandSilhouette(ctx, s);
      }
      ctx.restore();
    }
  }

  ctx.save();
  if (s.land) {
    ctx.clip(s.land.masterLandPath);
  } else {
    const cover = new Path2D();
    for (const region of landRegions) {
      const path = s.paths.get(region.id);
      if (path) {
        cover.addPath(path);
      }
    }
    ctx.clip(cover);
  }
  ctx.drawImage(s.baked.canvas, s.bounds.x - bleed, s.bounds.y, s.bounds.w + bleed * 2, s.bounds.h);
  ctx.restore();
}

/** How far the cliff lip hangs below the continent, in map units. */
export function cliffLip(zoom: number, lip = SHIPPED_CLIFF_LIP): number {
  return 2.5 * cliffDepthScale(zoom) * lip;
}

const surfCoasts = new WeakMap<object, { key: string; runs: SurfSample[][] }>();

interface CliffGroup {
  lift: number;
  path: Path2D;
  /** The coast edges a drop sweeps. See `cliffSweepEdges`. */
  edges: Float64Array;
  /** The swept faces for the last drop drawn. Past the tilt's end the drop no longer changes with zoom. */
  sweep: { dy: number; path: Path2D } | null;
}

const cliffGroupCache = new WeakMap<object, { key: string; groups: CliffGroup[] }>();

function polygonsForRegion(region: RegionShape, shapes: Map<string, MultiPolygon> | null | undefined): MultiPolygon {
  const clipped = shapes?.get(region.id);
  if (clipped && clipped.length > 0) {
    return clipped;
  }
  const rough: MultiPolygon = [[region.points.map((point) => [point.x, point.y])]];
  for (const extra of region.extra ?? []) {
    rough.push([extra.map((point) => [point.x, point.y])]);
  }
  return rough;
}

function cliffRegionsOf(scene: TerrainScene): CliffRegion[] {
  const regions: CliffRegion[] = [];
  for (const region of scene.regions) {
    if (region.type !== "land") {
      continue;
    }
    regions.push({ id: region.id, polygons: polygonsForRegion(region, scene.shapes) });
  }
  return regions;
}

function geometryKey(regions: readonly CliffRegion[]): string {
  let hash = 2166136261;
  const mix = (n: number) => {
    hash ^= n | 0;
    hash = Math.imul(hash, 16777619);
  };
  mix(regions.length);
  for (const region of regions) {
    for (let i = 0; i < region.id.length; i++) {
      mix(region.id.charCodeAt(i));
    }
    mix(region.polygons.length);
    const ring = region.polygons[0]?.[0];
    if (ring && ring.length > 0) {
      mix(ring.length);
      mix(Math.round(ring[0][0] * 10));
      mix(Math.round(ring[0][1] * 10));
    }
  }
  return (hash >>> 0).toString(16);
}

function overrideKey(overrides: Readonly<Record<string, number>>): string {
  return Object.keys(overrides)
    .sort()
    .map((id) => `${id}=${overrides[id]}`)
    .join(",");
}

function polygonsPath(polygons: MultiPolygon): Path2D {
  const path = new Path2D();
  for (const poly of polygons) {
    for (const ring of poly) {
      if (ring.length === 0) {
        continue;
      }
      ring.forEach(([x, y], i) => (i === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
      path.closePath();
    }
  }
  return path;
}

/** One path per polygon when a union fails, so a shared border cannot cancel the fill. */
function shapesForStamp(polygons: MultiPolygon, territory: boolean): MultiPolygon[] {
  if (!territory || polygons.length <= 1) {
    return [polygons];
  }
  try {
    return [polygonClipping.union(polygons[0], ...polygons.slice(1))];
  } catch {
    return polygons.map((polygon) => [polygon]);
  }
}

/**
 * Landmasses grouped by cliff lift. While every region on a landmass is still the size lift, the
 * stamp is that landmass, holes included. An override splits the island into territory shapes.
 */
function cliffGroups(scene: TerrainScene): CliffGroup[] {
  const land = scene.land;
  if (!land) {
    return [];
  }
  const tune = getCoastTune();
  const regions = cliffRegionsOf(scene);
  const key = `${overrideKey(tune.cliffOverrides)}|${geometryKey(regions)}`;
  const hit = cliffGroupCache.get(land);
  if (hit?.key === key) {
    return hit.groups;
  }
  const groups = planCliffStamps(land.polygons, regions, tune.cliffOverrides).flatMap((stamp) =>
    shapesForStamp(stamp.polygons, stamp.territory).map((shape) => ({
      lift: stamp.lift,
      path: polygonsPath(shape),
      edges: cliffSweepEdges(shape),
      sweep: null,
    })),
  );
  cliffGroupCache.set(land, { key, groups });
  return groups;
}

/** Shoreline samples for this land shape. Wavelength and cliff overrides rebuild them; the swell does not. */
function surfCoast(scene: TerrainScene): SurfSample[][] {
  const land = scene.land;
  if (!land) {
    return [];
  }
  const tune = getCoastTune();
  const regions = cliffRegionsOf(scene);
  const key = `${tune.wavelength}|${overrideKey(tune.cliffOverrides)}|${geometryKey(regions)}`;
  const hit = surfCoasts.get(land);
  if (hit?.key === key) {
    return hit.runs;
  }
  const seam = { left: land.viewBox.x, right: land.viewBox.x + land.viewBox.w };
  const liftOf = new Map<Pt[], number>();
  for (const poly of land.polygons) {
    const lift = cliffLift(ringSpan(poly[0]));
    for (const ring of poly) {
      liftOf.set(ring, lift);
    }
  }
  const runs = buildSurfCoast(
    ringsOf(land.polygons),
    seam,
    (x, y) => pointInMultiPolygon({ x, y }, land.polygons),
    (ring) => liftOf.get(ring) ?? 1,
    surfTuneFromCoast(tune),
  );
  applyShoreLifts(runs, regions, tune.cliffOverrides);
  surfCoasts.set(land, { key, runs });
  return runs;
}

/**
 * Resting place of the soft bloom edge, in screen pixels past the cliff. The tide slides this
 * by `surfLocalPx`, so the same shelf colour widens and narrows in the water that is already light.
 * The shipped rest, brush, blur and alpha live on the coast tune.
 */

let tideSharp: HTMLCanvasElement | null = null;
let tideSoft: HTMLCanvasElement | null = null;

function tideCanvas(slot: "sharp" | "soft", width: number, height: number): HTMLCanvasElement {
  const current = slot === "sharp" ? tideSharp : tideSoft;
  const canvas = current ?? document.createElement("canvas");
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
  }
  if (slot === "sharp") {
    tideSharp = canvas;
  } else {
    tideSoft = canvas;
  }
  return canvas;
}

/**
 * One soft edge in the water, outside the cliff. It slides out and back along the shore normal
 * on the same path, so the narrow half is the wide half played in reverse. Seam runs are already
 * omitted. The whole run stays one stroke, so a crest does not pop a new segment into view.
 */
function bloomEdge(
  runs: SurfSample[][],
  timeSeconds: number,
  toWorld: number,
  drop: number,
  restPx: number,
  tune: SurfTune,
): Path2D {
  const edge = new Path2D();
  for (const run of runs) {
    run.forEach((p, i) => {
      const signed = surfLocalPx(timeSeconds, p.along, p.jitter, tune);
      const clear = drop * p.lift * Math.max(0, p.ny);
      const reach = clear + (restPx + signed) * toWorld;
      const x = p.x + p.nx * reach;
      const y = p.y + p.ny * reach;
      if (i === 0) {
        edge.moveTo(x, y);
      } else {
        edge.lineTo(x, y);
      }
    });
  }
  return edge;
}

/**
 * The baked shallow bloom, breathing. Same shelf tint, slid along the shore normal, clipped off
 * the land and off the cliff. Call this after the held coast so the idle redraw can move it
 * without repainting the land.
 */
export function drawCoastSurf(ctx: CanvasRenderingContext2D, scene: TerrainScene, timeSeconds: number): void {
  const land = scene.land;
  const canvas = ctx.canvas;
  if (!land || canvas.width === 0 || canvas.height === 0) {
    return;
  }
  const runs = surfCoast(scene);
  if (runs.length === 0) {
    return;
  }
  const tune = getCoastTune();
  const surf = surfTuneFromCoast(tune);
  const { sy } = projectionScales(scene.view.k);
  const toWorld = 1 / (scene.dpr * sy);
  const drop = cliffLip(scene.view.k, tune.cliffLip);
  const edge = bloomEdge(runs, timeSeconds, toWorld, drop, tune.bloomRestPx, surf);

  const sharp = tideCanvas("sharp", canvas.width, canvas.height);
  const soft = tideCanvas("soft", canvas.width, canvas.height);
  const sg = sharp.getContext("2d");
  const bg = soft.getContext("2d");
  if (!sg || !bg) {
    return;
  }
  sg.setTransform(1, 0, 0, 1, 0, 0);
  sg.clearRect(0, 0, sharp.width, sharp.height);
  sg.lineJoin = "round";
  sg.lineCap = "round";
  sg.lineWidth = tune.bloomBrushPx * toWorld;
  for (const dx of scene.copies) {
    setWorldTransform(sg, scene.view, scene.dpr);
    sg.translate(dx, 0);
    sg.globalAlpha = tune.bloomAlpha;
    sg.strokeStyle = MILITARY.spruce;
    sg.stroke(edge);
  }

  bg.setTransform(1, 0, 0, 1, 0, 0);
  bg.clearRect(0, 0, soft.width, soft.height);
  bg.filter = `blur(${tune.bloomBlurPx}px)`;
  bg.drawImage(sharp, 0, 0);
  bg.filter = "none";
  bg.globalAlpha = 1;
  bg.globalCompositeOperation = "destination-out";
  bg.fillStyle = "#000";
  for (const dx of scene.copies) {
    setWorldTransform(bg, scene.view, scene.dpr);
    bg.translate(dx, 0);
    for (const group of cliffGroups(scene)) {
      bg.fill(group.path, "evenodd");
      bg.save();
      bg.translate(0, drop * group.lift);
      bg.fill(group.path, "evenodd");
      bg.restore();
    }
  }
  bg.globalCompositeOperation = "source-over";

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(soft, 0, 0);
  ctx.restore();
}

/** Land mask for ships that sit too far inland. Null until the continent has loaded. */
export function shoreVeilFor(scene: TerrainScene): ShoreVeil | null {
  if (!scene.land) {
    return null;
  }
  return {
    path: scene.land.pathData,
    alpha: SEA_LAND_ALPHA,
    transforms: scene.copies.map((dx) => landScreenTransform(scene.view, dx)),
  };
}

/** The same land as `shoreVeilFor`, for the figure sheet: a path and one world-to-screen scale for each copy. */
export function shoreStencilFor(scene: TerrainScene): ShoreStencil | null {
  if (!scene.land) {
    return null;
  }
  const { sx, sy } = projectionScales(scene.view.k);
  return {
    path: scene.land.masterLandPath,
    alpha: SEA_LAND_ALPHA,
    copies: scene.copies.map((dx) => ({ sx, sy, e: -(scene.view.x - dx) * sx, f: -scene.view.y * sy })),
  };
}

function fillLandWash(ctx: CanvasRenderingContext2D, s: TerrainScene, color: string): void {
  ctx.fillStyle = color;
  if (s.land) {
    ctx.fill(s.land.masterLandPath);
    return;
  }
  for (const region of s.regions) {
    const path = s.paths.get(region.id);
    if (region.type === "land" && path) {
      ctx.fill(path, "evenodd");
    }
  }
}

/**
 * Sea-zone seams, the same stroke the baked map uses: spruce, one world unit wide.
 * Drawn on a board whose water picture does not carry the bake.
 */
export function drawSeaZoneBorders(
  ctx: CanvasRenderingContext2D,
  s: TerrainScene,
  edges: readonly [number, number, number, number][],
): void {
  if (edges.length === 0) {
    return;
  }
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = MILITARY.spruce;
  ctx.lineWidth = SEA_SEAM_WIDTH;
  for (const dx of s.copies) {
    setWorldTransform(ctx, s.view, s.dpr);
    ctx.translate(dx, 0);
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of edges) {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function strokeFrontline(ctx: CanvasRenderingContext2D, segments: readonly FrontlineSegment[]): void {
  ctx.beginPath();
  for (const segment of segments) {
    ctx.moveTo(segment.x1, segment.y1);
    ctx.lineTo(segment.x2, segment.y2);
  }
  ctx.strokeStyle = "rgba(156, 82, 78, 0.45)";
  ctx.lineWidth = 6;
  ctx.setLineDash([]);
  ctx.stroke();
  ctx.strokeStyle = MILITARY.terracotta;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawFrontlines(ctx: CanvasRenderingContext2D, segments: readonly FrontlineSegment[]): void {
  if (segments.length === 0) {
    return;
  }
  ctx.save();
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  strokeFrontline(ctx, segments);
  ctx.restore();
}

/** The old hostile band, on a board that otherwise paints its own frontline. */
export function drawClassicFront(
  ctx: CanvasRenderingContext2D,
  s: TerrainScene,
  segments: readonly FrontlineSegment[],
): void {
  if (segments.length === 0) {
    return;
  }
  ctx.save();
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  for (const dx of s.copies) {
    setWorldTransform(ctx, s.view, s.dpr);
    ctx.translate(dx, 0);
    strokeFrontline(ctx, segments);
  }
  ctx.restore();
}

/** The old territory ink: a wide shade, then the charcoal or sepia line. */
export function drawClassicBorders(
  ctx: CanvasRenderingContext2D,
  s: TerrainScene,
  edges: readonly [number, number, number, number][],
  passes: readonly { color: string; width: number }[],
): void {
  if (edges.length === 0 || passes.length === 0) {
    return;
  }
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const dx of s.copies) {
    setWorldTransform(ctx, s.view, s.dpr);
    ctx.translate(dx, 0);
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of edges) {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    for (const pass of passes) {
      ctx.lineWidth = pass.width;
      ctx.strokeStyle = pass.color;
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawBattleScars(ctx: CanvasRenderingContext2D, scars: readonly ScarFrame[], px: number, plumes: boolean): void {
  if (scars.length === 0) {
    return;
  }
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  for (const scar of scars) {
    for (const crater of scar.craters) {
      ctx.fillStyle = crater.rim;
      ctx.beginPath();
      ctx.ellipse(crater.x, crater.y, crater.rx, crater.ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = crater.pit;
      ctx.beginPath();
      ctx.ellipse(crater.x, crater.y, Math.max(px, crater.rx * 0.42), Math.max(px, crater.ry * 0.42), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!plumes) {
      continue;
    }
    for (const puff of scar.smoke) {
      ctx.fillStyle = puff.color;
      ctx.fillRect(puff.x, puff.y, puff.w, puff.h);
    }
    if (scar.ember) {
      ctx.fillStyle = scar.ember.color;
      ctx.fillRect(scar.ember.x, scar.ember.y, px, px);
    }
  }
  ctx.restore();
}

const stampCache = new Map<string, { key: string; stamps: TerrainStamp[] }>();

function inTerritory(region: RegionShape, p: Vec2): boolean {
  if (pointInPolygon(p, region.points)) {
    return true;
  }
  for (const ring of region.extra ?? []) {
    if (pointInPolygon(p, ring)) {
      return true;
    }
  }
  return false;
}

function stampKey(region: RegionShape, avoid: readonly Vec2[], land: boolean): string {
  let h = region.points.length;
  for (const point of region.points) {
    h = Math.imul(h, 31) + Math.round(point.x * 10) + Math.imul(Math.round(point.y * 10), 17);
  }
  for (const point of avoid) {
    h = Math.imul(h, 31) + Math.round(point.x) + Math.imul(Math.round(point.y), 13);
  }
  return `${h}:${land ? 1 : 0}`;
}

function drawPine(ctx: CanvasRenderingContext2D, x: number, y: number, u: number, v: number): void {
  ctx.fillStyle = MILITARY.charcoal;
  ctx.fillRect(x + 3 * u, y - 5 * v, 2 * u, 5 * v);
  ctx.fillStyle = MILITARY.spruce;
  ctx.fillRect(x + 3 * u, y - 14 * v, 2 * u, 3 * v);
  ctx.fillRect(x + 1 * u, y - 11 * v, 6 * u, 4 * v);
  ctx.fillRect(x - 1 * u, y - 7 * v, 10 * u, 4 * v);
  ctx.fillRect(x - 2 * u, y - 4 * v, 12 * u, 3 * v);
}

function drawPineCluster(ctx: CanvasRenderingContext2D, x: number, y: number, u: number, v: number, n: number): void {
  const start = -((n - 1) * 5 * u) / 2;
  for (let i = 0; i < n; i++) {
    drawPine(ctx, x + start + i * 5 * u, y + (i % 2) * 2 * v, u, v);
  }
}

function drawRidge(ctx: CanvasRenderingContext2D, x: number, y: number, u: number, v: number): void {
  ctx.fillStyle = MILITARY.charcoal;
  ctx.fillRect(x - 7 * u, y - 1 * v, 16 * u, 2 * v);
  ctx.fillStyle = MILITARY.taupe;
  ctx.fillRect(x - 6 * u, y - 3 * v, 5 * u, 2 * v);
  ctx.fillRect(x - 1 * u, y - 5 * v, 4 * u, 2 * v);
  ctx.fillRect(x + 3 * u, y - 3 * v, 5 * u, 2 * v);
  ctx.fillStyle = MILITARY.brown;
  ctx.fillRect(x - 1 * u, y - 6 * v, 2 * u, 2 * v);
}

function drawWaterDash(ctx: CanvasRenderingContext2D, x: number, y: number, u: number, v: number): void {
  ctx.fillStyle = MILITARY.spruce;
  ctx.fillRect(x, y, 3 * u, v);
  ctx.fillRect(x + 5 * u, y, 2 * u, v);
  ctx.fillRect(x + 8 * u, y, 3 * u, v);
}

function drawPixelStamps(ctx: CanvasRenderingContext2D, s: TerrainScene, dx: number): void {
  const alpha = terrainStampFadeAlpha(s.view.k);
  if (alpha <= 0) {
    return;
  }
  const copyView = { ...s.view, x: s.view.x - dx };
  const { sx, sy } = projectionScales(s.view.k);
  const u = 1 / sx;
  const v = 1 / sy;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = alpha;
  for (const region of s.regions) {
    if (region.type !== "land" || region.points.length < 3) {
      continue;
    }
    const origin = worldToScreen(copyView, { x: region.bounds.x, y: region.bounds.y });
    const far = worldToScreen(copyView, { x: region.bounds.x + region.bounds.w, y: region.bounds.y + region.bounds.h });
    if (far.x < -24 || origin.x > s.width + 24 || far.y < -24 || origin.y > s.height + 24) {
      continue;
    }
    const avoid = s.stampAvoid?.[region.id] ?? [region.anchor, ...(region.unitSlots ?? [])];
    const key = stampKey(region, avoid, s.land !== null);
    const cached = stampCache.get(region.id);
    const stamps =
      cached && cached.key === key
        ? cached.stamps
        : terrainStamps(region.id, [region.points, ...(region.extra ?? [])], avoid, {
            interior: (p) => inTerritory(region, p) && (s.land ? isLandAt(s.land, p) : true),
            water: (p) => (s.land ? !isLandAt(s.land, p) : !inTerritory(region, p)),
          });
    if (!cached || cached.key !== key) {
      stampCache.set(region.id, { key, stamps });
    }
    for (const stamp of stamps) {
      const screen = worldToScreen(copyView, stamp);
      if (screen.x < -24 || screen.y < -24 || screen.x > s.width + 24 || screen.y > s.height + 24) {
        continue;
      }
      if (stamp.kind === "pine") {
        const trees = 2 + (Math.abs(Math.round(stamp.x * 3 + stamp.y * 5)) % 2);
        drawPineCluster(ctx, stamp.x, stamp.y, u, v, trees);
      } else if (stamp.kind === "ridge") {
        drawRidge(ctx, stamp.x, stamp.y, u, v);
      } else {
        drawWaterDash(ctx, stamp.x, stamp.y, u, v);
      }
    }
  }
  ctx.restore();
}

function drawDynamicTerrain(ctx: CanvasRenderingContext2D, s: TerrainScene, px: number, dx: number): void {
  const { land } = s;

  // The editor fades the layer it is not working on.
  if (s.dim === "land") {
    fillLandWash(ctx, s, EDITOR_LAND_DIM);
  }

  // Move and mobilize highlights: fade the land that is not on offer, then tint what is.
  if (s.highlight.kind !== "none") {
    fillLandWash(ctx, s, LAND_WASH);
    ctx.save();
    if (land && !s.exact) {
      ctx.clip(land.masterLandPath);
    }
    for (const region of s.regions) {
      const path = s.paths.get(region.id);
      if (!path) {
        continue;
      }
      const fill =
        region.type === "land"
          ? highlightLandFill(region.id, s.owners[region.id] ?? "", s.highlight)
          : highlightSeaFill(region.id, s.highlight);
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill(path, "evenodd");
      }
    }
    ctx.restore();
  }

  // Hover, then selection. A gold tint inside the true shape, then its outline, which follows the inland
  // borders and the coastline alike. The selected region draws last so it wins on overlap.
  for (const [id, tint, color, width] of [
    [s.hoverRegionId, HOVER_TINT, HOVER_COLOR, 2],
    [s.selectedRegionId, SELECTED_TINT, SELECTED_COLOR, SELECTED_OUTLINE_WIDTH],
  ] as const) {
    const path = id === "" ? undefined : s.paths.get(id);
    if (path) {
      ctx.fillStyle = tint;
      ctx.fill(path, "evenodd");
      ctx.lineWidth = width * px;
      ctx.strokeStyle = color;
      // A hovered sea zone is outlined at the foot of the cliff; a selected one keeps the old rule, from the top of the cliff.
      if (id === s.selectedRegionId || !strokeSeaAtCliffFoot(ctx, s, id)) {
        ctx.stroke(path);
      }
    }
  }

  if (!s.backdrop) {
    drawPixelStamps(ctx, s, dx);
  }

  drawFrontlines(ctx, s.frontlines ?? []);
  drawBattleScars(ctx, s.scars ?? [], px, (s.unitFade ?? 0) <= 0);
}

/**
 * A sea zone's outline, drawn where the water meets the cliff and not along the top of it. The coast stretches of the outline are
 * moved down the screen by the cliff's height; the borders with other sea zones are on the water already and stay. Returns false
 * when it does not apply (a land territory, a flat map, or no true shape yet), so the caller strokes the path as before.
 */
function strokeSeaAtCliffFoot(ctx: CanvasRenderingContext2D, s: TerrainScene, regionId: string): boolean {
  const drop = s.cliffDrop ?? 0;
  const shape = s.shapes?.get(regionId);
  const land = s.land;
  const region = s.regions.find((item) => item.id === regionId);
  if (!(drop > 0) || !shape || !land || region?.type !== "sea") {
    return false;
  }
  const { sx, sy } = projectionScales(s.view.k);
  const ratio = sx > 0 ? Math.min(1, sy / sx) : 1;
  // The cliff's face on the screen, in pixels, and that in world y.
  const facePx = drop * Math.sqrt(Math.max(0, 1 - ratio * ratio)) * s.view.k;
  const shiftY = sy > 0 ? facePx / sy : 0;
  const probe = 0.7;
  for (const polygon of shape) {
    for (const ring of polygon) {
      const n = ring.length;
      if (n < 2) {
        continue;
      }
      // A segment is coast when land lies close to it on either side.
      const coast: boolean[] = [];
      for (let i = 0; i < n; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % n];
        const mx = (a[0] + b[0]) / 2;
        const my = (a[1] + b[1]) / 2;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const nx = -(b[1] - a[1]) / len;
        const ny = (b[0] - a[0]) / len;
        coast.push(landMaskAt(land, { x: mx + nx * probe, y: my + ny * probe }) || landMaskAt(land, { x: mx - nx * probe, y: my - ny * probe }));
      }
      ctx.beginPath();
      let open = false;
      for (let i = 0; i < n; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % n];
        const dy = coast[i] ? shiftY : 0;
        if (!open || (i > 0 && coast[i] !== coast[i - 1])) {
          ctx.moveTo(a[0], a[1] + dy);
        }
        ctx.lineTo(b[0], b[1] + dy);
        open = true;
      }
      ctx.stroke();
    }
  }
  return true;
}

/** Hover wash on the arrow layer, so a pointer move does not repaint the coast. */
export function drawHoverMark(ctx: CanvasRenderingContext2D, scene: TerrainScene, regionId: string): void {
  if (regionId === "") {
    return;
  }
  const path = scene.paths.get(regionId);
  if (!path) {
    return;
  }
  const px = 1 / scene.view.k;
  ctx.save();
  for (const dx of scene.copies) {
    setWorldTransform(ctx, scene.view, scene.dpr);
    ctx.translate(dx, 0);
    ctx.fillStyle = HOVER_TINT;
    ctx.fill(path, "evenodd");
    ctx.lineWidth = 2 * px;
    ctx.strokeStyle = HOVER_COLOR;
    if (!strokeSeaAtCliffFoot(ctx, scene, regionId)) {
      ctx.stroke(path);
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------
// Layer 4: game overlay
// ---------------------------------------------------------------

export interface GameOverlay {
  layouts: RegionLayout[];
  /** How far the ground under a world point stands up the screen, in CSS pixels. Absent is flat. */
  groundLift?(world: Vec2, stack?: { naval: boolean; count: number }): number;
  /** The board draws the bases under land stacks in three dimensions, so the canvas draws none for them. */
  plinths3D?: boolean;
  owners: Record<string, string>;
  selectedStack: { regionId: string; key: string } | null;
  isUnmoved(regionId: string, entry: StackEntry): boolean;
  combatMarkers: { regionId: string; count: number }[];
  /** On-screen token size relative to TOKEN_PX. Tokens scale with the map, clamped (see worldTokenPx). */
  unitScale: number;
  /** The faction whose turn it is: its count pills are gold, everyone else's black. */
  activeFactionId: string;
  /** Remaining fuel drawn on air tokens. Omitted in the editor. */
  fuelFor?(regionId: string, entry: StackEntry): number | null;
  /** A transport with cargo aboard gets a dot at its token's top left. */
  isLoaded?(entry: StackEntry): boolean;
  /** How many land units are aboard, for the cargo pill. */
  cargoCount?(entry: StackEntry): number;
  /** Transport cargo seats. Null means this piece has no circles. */
  holdFor?(regionId: string, entry: StackEntry): import("./shipHold").HoldMark[] | null;
  /** Unit type id to land, air or sea, from the scenario's unit data. */
  categories?: Record<string, string>;
  /** The token under the pointer. Drawn last so a tucked card comes to the front. */
  hoverStack?: { regionId: string; key: string; copyDx: number } | null;
  /** Seconds for the upright breathe. Omitted below the sprite zoom, so those figures stay still. */
  idleTime?: number;
  /** Factions that share a side. Upright sprites face the nearest region this rejects. */
  sameTeam?(a: string, b: string): boolean;
  /** Piece counts from the start of the current faction's combat move. */
  facingStacks?: FacingStacks;
}

/** Facility icons stay at this opacity. Forty percent more opaque than the old 0.66, and nothing else changes it. */
export const FACILITY_ICON_ALPHA = Math.min(1, 0.66 * 1.4);

/** The Tri-Wedge: airbase ▼, factory ▲ and harbour ▼ as one trapezoid. See facilityBadge.ts for the geometry. */
export function drawFacilityBadge(ctx: CanvasRenderingContext2D, badge: PlacedBadge, f: Facilities, dpr = 1): void {
  const s = badge.side;
  const shapes = badgeShapes(f);
  const previousAlpha = ctx.globalAlpha;
  ctx.globalAlpha = FACILITY_ICON_ALPHA;
  const trace = (shape: BadgeShape) => {
    ctx.beginPath();
    shape.points.forEach((p, i) => (i === 0 ? ctx.moveTo(badge.x + p.x * s, badge.y + p.y * s) : ctx.lineTo(badge.x + p.x * s, badge.y + p.y * s)));
    ctx.closePath();
  };
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // Slots without a facility: only a faint outline, so the trapezoid still reads as one piece.
  for (const shape of shapes.filter((x) => !x.active)) {
    trace(shape);
    ctx.lineWidth = 1;
    ctx.strokeStyle = BADGE_INACTIVE_STROKE;
    ctx.stroke();
  }
  // Fills, with one soft shadow under the whole badge.
  ctx.shadowColor = "rgba(75, 61, 68, 0.45)";
  ctx.shadowBlur = 3 * dpr;
  ctx.shadowOffsetY = 1 * dpr;
  for (const shape of shapes.filter((x) => x.active)) {
    trace(shape);
    ctx.fillStyle = BADGE_FILL[shape.slot];
    ctx.fill();
  }
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  for (const shape of shapes.filter((x) => x.active)) {
    trace(shape);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = BADGE_INK;
    ctx.stroke();
  }
  for (const shape of shapes.filter((x) => x.active)) {
    const { centre, size } = silhouetteBox(shape);
    const at = { x: badge.x + centre.x * s, y: badge.y + centre.y * s };
    const u = size * s;
    ctx.fillStyle = BADGE_INK;
    ctx.strokeStyle = BADGE_INK;
    if (shape.slot === "factory") {
      const { hall, chimneys } = factoryParts(f.factory);
      ctx.beginPath();
      hall.forEach((p, i) => (i === 0 ? ctx.moveTo(at.x + p.x * u, at.y + p.y * u) : ctx.lineTo(at.x + p.x * u, at.y + p.y * u)));
      ctx.closePath();
      ctx.fill();
      for (const c of chimneys.slice(0, chimneyCount(f.factory))) {
        ctx.fillRect(at.x + (c.x - c.w / 2) * u, at.y + c.y1 * u, c.w * u, (c.y0 - c.y1) * u);
      }
    } else if (shape.slot === "airbase") {
      ctx.beginPath();
      planePolygon().forEach((p, i) => (i === 0 ? ctx.moveTo(at.x + p.x * u, at.y + p.y * u) : ctx.lineTo(at.x + p.x * u, at.y + p.y * u)));
      ctx.closePath();
      ctx.fill();
    } else {
      // A naval anchor: ring, shank, stock and curved flukes.
      ctx.lineWidth = Math.max(1.1, u * 0.2);
      ctx.beginPath();
      ctx.arc(at.x, at.y - 0.72 * u, 0.2 * u, 0, Math.PI * 2);
      ctx.moveTo(at.x, at.y - 0.52 * u);
      ctx.lineTo(at.x, at.y + 0.8 * u);
      ctx.moveTo(at.x - 0.42 * u, at.y - 0.28 * u);
      ctx.lineTo(at.x + 0.42 * u, at.y - 0.28 * u);
      ctx.moveTo(at.x + 0.66 * u * Math.cos(Math.PI * 0.12), at.y + 0.14 * u + 0.66 * u * Math.sin(Math.PI * 0.12));
      ctx.arc(at.x, at.y + 0.14 * u, 0.66 * u, Math.PI * 0.12, Math.PI * 0.88);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = previousAlpha;
}

/** The [+] on a capped fan: a paper disc and an ink plus, at the lead token's upper right. */
function drawPlusBadge(ctx: CanvasRenderingContext2D, x: number, y: number, tokenPx: number): void {
  const r = Math.max(5, tokenPx * 0.16);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - r * 0.42, y);
  ctx.lineTo(x + r * 0.42, y);
  ctx.moveTo(x, y - r * 0.42);
  ctx.lineTo(x, y + r * 0.42);
  ctx.lineWidth = Math.max(1.25, r * 0.28);
  ctx.lineCap = "butt";
  ctx.strokeStyle = INK;
  ctx.stroke();
}

/** The capital's mark: a small geometric diamond in the same ink as the numeral. */
function drawDiamond(ctx: CanvasRenderingContext2D, x: number, y: number, outer: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - outer);
  ctx.lineTo(x + outer * 0.72, y);
  ctx.lineTo(x, y + outer);
  ctx.lineTo(x - outer * 0.72, y);
  ctx.closePath();
  ctx.fillStyle = MILITARY.charcoal;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "miter";
  ctx.strokeStyle = MILITARY.cream;
  ctx.stroke();
}

/**
 * One region's unit tokens, back to front, with the rings that mark a selected or unmoved stack. A hovered
 * token is drawn last so a card tucked under the fan comes to the front. A capped fan grows a [+] on the lead.
 * The game draws these for each region; the editor draws them too, so a garrison can be judged while editing.
 */
export function drawRegionUnits(ctx: CanvasRenderingContext2D, layout: RegionLayout, game: GameOverlay, dpr: number): void {
  const { region } = layout;
  const tokenPx = TOKEN_PX * game.unitScale;
  const hover = game.hoverStack;
  const hot = (counter: PlacedCounter) =>
    hover?.regionId === region.id && hover.key === counter.slot.key && hover.copyDx === layout.copyDx;
  const drawOne = (counter: PlacedCounter) => {
    const { entry } = counter.slot;
    drawMapToken(ctx, entry, counter.x, counter.y, tokenPx, {
      dpr,
      activeFactionId: game.activeFactionId,
      categories: game.categories,
      loaded: game.isLoaded?.(entry) ?? false,
      cargoCount: game.cargoCount?.(entry) ?? 0,
      fuel: game.fuelFor?.(region.id, entry) ?? null,
    });
    const seats = game.holdFor?.(region.id, entry);
    if (seats) {
      drawHoldCircles(ctx, counter.x, counter.y, tokenPx, false, seats.length);
    }
    const selected = game.selectedStack?.regionId === region.id && game.selectedStack.key === counter.slot.key;
    const unmoved = game.isUnmoved(region.id, entry);
    if (selected || unmoved) {
      ctx.beginPath();
      ctx.arc(counter.x, counter.y, tokenPx / 2 + 3 * game.unitScale, 0, Math.PI * 2);
      ctx.lineWidth = selected ? 3 : 1.5;
      ctx.strokeStyle = selected ? SELECTED_COLOR : "rgba(221, 207, 153, 0.9)";
      ctx.setLineDash(selected ? [] : [4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  };
  for (const counter of layout.counters) {
    if (!hot(counter)) {
      drawOne(counter);
    }
  }
  for (const counter of layout.counters) {
    if (hot(counter)) {
      drawOne(counter);
    }
  }
  if (layout.plus) {
    drawPlusBadge(ctx, layout.plus.x, layout.plus.y, tokenPx);
  }
}

/** The editor's preview of every region's garrison, under its own handles. */
export function drawEditorUnits(ctx: CanvasRenderingContext2D, scene: TerrainScene, game: GameOverlay): void {
  setScreenTransform(ctx, scene.dpr);
  for (const layout of game.layouts) {
    if (layout.counters.length > 0) {
      drawRegionUnits(ctx, layout, game, scene.dpr);
    }
  }
}

function scarGroundY(scar: ScarFrame): number {
  let y = -Infinity;
  for (const crater of scar.craters) {
    y = Math.max(y, crater.y);
  }
  if (y === -Infinity) {
    for (const puff of scar.smoke) {
      y = Math.max(y, puff.y);
    }
  }
  return y;
}

function paintSmokePlume(ctx: CanvasRenderingContext2D, scene: TerrainScene, dx: number, scar: ScarFrame): void {
  ctx.save();
  setWorldTransform(ctx, scene.view, scene.dpr);
  ctx.translate(dx, 0);
  ctx.imageSmoothingEnabled = false;
  const { sx, sy } = projectionScales(scene.view.k);
  for (const puff of scar.smoke) {
    ctx.fillStyle = puff.color;
    ctx.fillRect(puff.x, puff.y, puff.w, puff.h);
  }
  if (scar.ember) {
    ctx.fillStyle = scar.ember.color;
    ctx.fillRect(scar.ember.x, scar.ember.y, 1 / sx, 1 / sy);
  }
  ctx.restore();
}

/**
 * LoD 2 painter's pass. Upright plinths, facility badges and smoke plumes draw in ground-Y order,
 * so a unit closer to the camera covers one standing behind it.
 */
function drawUprightDepth(ctx: CanvasRenderingContext2D, scene: TerrainScene, game: GameOverlay): void {
  const tokenPx = TOKEN_PX * game.unitScale;
  const facing = facingByStack(scene, game);
  // On the 3D board a figure stands on a turned base. The 2D map keeps the flat baseplate.
  const plinth = scene.backdrop ? plinthLook(mapVisuals) : null;
  const items: { worldY: number; paint: () => void }[] = [];
  for (const layout of game.layouts) {
    const copyView = { ...scene.view, x: scene.view.x - layout.copyDx };
    if (layout.badge) {
      const { badge } = layout;
      if (badge.x >= -80 && badge.y >= -80 && badge.x <= scene.width + 80 && badge.y <= scene.height + 80) {
        const worldY = screenToWorld(copyView, { x: badge.x, y: badge.y }).y;
        items.push({
          worldY,
          paint: () => {
            // The factory, harbor and airfield badges fade slowly away as the camera comes in, and are gone at the closest zoom: the models
            // stand there instead.
            const shown = facilityBadgeAlpha(scene.view.k);
            if (shown < 0.02) {
              return;
            }
            setScreenTransform(ctx, scene.dpr);
            ctx.save();
            ctx.globalAlpha *= shown;
            drawFacilityBadge(ctx, badge, facilitiesOf(layout.region), scene.dpr);
            ctx.restore();
          },
        });
      }
    }
    for (const counter of layout.counters) {
      if (counter.x < -48 || counter.y < -56 || counter.x > scene.width + 48 || counter.y > scene.height + 48) {
        continue;
      }
      const { entry } = counter.slot;
      const world = screenToWorld(copyView, { x: counter.x, y: counter.y });
      const worldY = world.y;
      const selected = game.selectedStack?.regionId === layout.region.id && game.selectedStack.key === counter.slot.key;
      items.push({
        worldY,
        paint: () => {
          setScreenTransform(ctx, scene.dpr);
          // A figure on a range stands on its slope: it is lifted by how far the ground there stands up the screen.
          const lift = game.groundLift?.(world, { naval: counter.domain === "sea", count: entry.count }) ?? 0;
          if (lift !== 0) {
            ctx.translate(0, -lift);
          }
          // Held at the zoom the sprites arrive, so a figure keeps one size however close the camera comes.
          // In the micro tier the camera is low, and the figures lean back a few degrees more, so they stand against the horizon.
          const lean = unitLean(Math.min(scene.view.k, TACTICAL_IN), getBoardTune()) * microSpriteLean(scene.view.k);
          if (lean !== 1) {
            ctx.translate(counter.x, counter.y);
            ctx.scale(1, lean);
            ctx.translate(-counter.x, -counter.y);
          }
          // An aircraft over open water has no base: no model under it, no footprint, nothing flat.
          const noBase = counter.domain === "air" && scene.land != null && !landMaskAt(scene.land, screenToWorld(copyView, counter));
          drawUprightStack(ctx, {
            unitType: entry.unit_type_id,
            factionId: entry.faction_id,
            count: entry.count,
            x: counter.x,
            y: counter.y,
            tokenPx,
            spriteScale: game.unitScale,
            contactAo: mapVisuals.contactAoStrength,
            vehicleScale: mapVisuals.vehicleDioramaScale,
            noBase,
            plinth3D:
              game.plinths3D && counter.domain !== "sea" && !noBase
                ? {
                    factor:
                      plinthFactor(entry.count, { pair: mapVisuals.squadRadius2, crowd: mapVisuals.squadRadius3Plus }) *
                      unitBaseShare(entry.unit_type_id, { vehicleRadius: mapVisuals.vehiclePlinthRadius }),
                    spread: mapVisuals.squadSpread,
                    // How much the ground is foreshortened here: the base is a disc, and shows as this ellipse.
                    ratio: projectionScales(scene.view.k).sy / projectionScales(scene.view.k).sx,
                  }
                : undefined,
            swell:
              counter.domain === "sea"
                ? {
                    worldX: world.x,
                    worldY: world.y,
                    // The radius of the ship's waterline ring, in world units.
                    ringWorld: (tokenPx / 2 / Math.max(scene.view.k, 1e-6)) * 1.15,
                    bobAmp: mapVisuals.navalIdleBobAmp,
                    rockAmp: mapVisuals.navalWaveRockAmp,
                    loopSeconds: mapVisuals.waveLoopSeconds,
                    directionDeg: mapVisuals.waveDirectionDeg,
                    subFactor: mapVisuals.subRockFactor,
                  }
                : undefined,
            submergePx: counter.domain === "sea" ? mapVisuals.navalSubmergeDepth * scene.view.k * 0.55 : 0,
            waterRisePx:
              counter.domain === "sea" && game.idleTime != null
                ? waterY(world.x, world.y, {
                    amp: mapVisuals.waterSwellAmp,
                    seconds: game.idleTime,
                    loopSeconds: mapVisuals.waveLoopSeconds,
                    directionDeg: mapVisuals.waveDirectionDeg,
                  }) *
                  scene.view.k *
                  0.55
                : 0,
            dpr: scene.dpr,
            selected,
            unmoved: game.isUnmoved(layout.region.id, entry),
            active: isActiveFaction(entry.faction_id, game.activeFactionId),
            fuel: game.fuelFor?.(layout.region.id, entry) ?? null,
            loaded: game.isLoaded?.(entry) ?? false,
            cargoCount: game.cargoCount?.(entry) ?? 0,
            holds: game.holdFor?.(layout.region.id, entry)?.length ?? null,
            idleTime: game.idleTime,
            idlePhase: idlePhase(layout.region.id, entry.unit_type_id),
            aim: facing(layout.region.id, entry.faction_id),
            vectorKey: `${layout.region.id}|${layout.copyDx}|${counter.slot.key}`,
            landAt: scene.land
              ? (sx, sy) => landMaskAt(scene.land!, screenToWorld(copyView, { x: sx, y: sy }))
              : undefined,
            plinth,
          });
        },
      });
    }
  }
  for (const dx of scene.copies) {
    const copyView = { ...scene.view, x: scene.view.x - dx };
    for (const scar of scene.scars ?? []) {
      if (scar.smoke.length === 0 && !scar.ember) {
        continue;
      }
      const worldY = scarGroundY(scar);
      const ground = scar.craters[0] ?? scar.smoke[0];
      if (!ground) {
        continue;
      }
      const at = worldToScreen(copyView, { x: ground.x, y: worldY });
      if (at.x < -80 || at.y < -120 || at.x > scene.width + 80 || at.y > scene.height + 80) {
        continue;
      }
      items.push({
        worldY,
        paint: () => paintSmokePlume(ctx, scene, dx, scar),
      });
    }
  }
  for (const item of uprightDrawOrder(2, items)) {
    item.paint();
  }
}

/** One eight-way bearing per region and faction. The campaign map wraps, so the short way around wins. */
function facingByStack(scene: TerrainScene, game: GameOverlay): (regionId: string, factionId: string) => FaceOctant {
  const factions = new Map<string, string[]>();
  for (const layout of game.layouts) {
    let list = factions.get(layout.region.id);
    if (!list) {
      list = [];
      factions.set(layout.region.id, list);
    }
    for (const counter of layout.counters) {
      const id = counter.slot.entry.faction_id;
      if (id !== "" && !list.includes(id)) list.push(id);
    }
  }
  const regions: FacingRegion[] = scene.regions.map((region) => ({
    id: region.id,
    anchor: region.anchor,
    owner: game.owners[region.id] ?? "",
    factions: factions.get(region.id) ?? [],
    stacks: game.facingStacks?.[region.id],
  }));
  const cache = new Map<string, FaceOctant>();
  return (regionId, factionId) => {
    const key = `${regionId}\0${factionId}`;
    const hit = cache.get(key);
    if (hit != null) return hit;
    const home = regions.find((region) => region.id === regionId);
    const aim = home
      ? nearestEnemyOctant(regionId, home.anchor, factionId, regions, scene.bounds, true, game.sameTeam)
      : 0;
    cache.set(key, aim);
    return aim;
  };
}

export function drawGameOverlay(ctx: CanvasRenderingContext2D, scene: TerrainScene, game: GameOverlay): void {
  const dpr = scene.dpr;
  const s = game.unitScale;
  const lod = scene.lod ?? 0;
  setScreenTransform(ctx, dpr);
  const markers = new Map(game.combatMarkers.map((m) => [m.regionId, m.count]));
  // A territory's pieces stand at slots that can be far from its anchor, so a big territory is drawn while any one
  // of its counters is on screen, not only while its anchor is. Otherwise a token vanishes at the screen's edge
  // while the board still draws its shadow.
  const visible = (layout: RegionLayout) => {
    const { anchor } = layout;
    if (anchor.x >= -80 && anchor.y >= -80 && anchor.x <= scene.width + 80 && anchor.y <= scene.height + 80) {
      return true;
    }
    return layout.counters.some((c) => c.x >= -80 && c.y >= -80 && c.x <= scene.width + 80 && c.y <= scene.height + 80);
  };
  const drawShield = (layout: RegionLayout) => {
    const { region, anchor } = layout;
    if (region.type !== "land" || region.ipc <= 0) {
      return;
    }
    const shieldY = layout.shieldY;
    const label = String(region.ipc);
    const size = Math.max(9, 13 * s);
    ctx.font = `700 ${size}px ${MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 1.5 * Math.max(1, s);
    ctx.strokeStyle = MILITARY.cream;
    ctx.strokeText(label, anchor.x, shieldY);
    ctx.fillStyle = MILITARY.charcoal;
    ctx.fillText(label, anchor.x, shieldY);
    if (region.capital) {
      drawDiamond(ctx, anchor.x, shieldY - size * 0.95, Math.max(3, 4 * s));
    }
  };
  const drawMarker = (layout: RegionLayout) => {
    const combat = markers.get(layout.region.id);
    if (combat === undefined) {
      return;
    }
    const cy = layout.markerY;
    ctx.beginPath();
    ctx.roundRect(layout.anchor.x - 22, cy - 11, 44, 22, 6);
    ctx.fillStyle = PLINTH;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = BRASS;
    ctx.stroke();
    ctx.fillStyle = GOLD_NUM;
    ctx.font = `700 12px ${MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`\u2694 ${combat}`, layout.anchor.x, cy);
  };

  const drawIcons = () => {
    for (const layout of game.layouts) {
      if (!visible(layout)) {
        continue;
      }
      if (layout.badge) {
        drawFacilityBadge(ctx, layout.badge, facilitiesOf(layout.region), dpr);
      }
      drawShield(layout);
      drawRegionUnits(ctx, layout, game, dpr);
      drawMarker(layout);
    }
  };
  const drawSprites = () => {
    for (const layout of game.layouts) {
      if (visible(layout)) {
        drawShield(layout);
      }
    }
    drawUprightDepth(ctx, scene, game);
    setScreenTransform(ctx, dpr);
    for (const layout of game.layouts) {
      if (!visible(layout)) {
        continue;
      }
      if (layout.plus) {
        drawPlusBadge(ctx, layout.plus.x, layout.plus.y, TOKEN_PX * s);
      }
      drawMarker(layout);
    }
  };

  const mix = scene.unitFade ?? (lod >= 2 ? 1 : 0);
  if (mix <= 0) {
    drawIcons();
    return;
  }
  if (mix >= 1) {
    drawSprites();
    return;
  }
  ctx.save();
  ctx.globalAlpha *= 1 - mix;
  drawIcons();
  ctx.restore();
  ctx.save();
  ctx.globalAlpha *= mix;
  drawSprites();
  ctx.restore();
}

function tracePolygon(ctx: CanvasRenderingContext2D, points: Vec2[]): void {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
}

function fillPolygon(ctx: CanvasRenderingContext2D, points: Vec2[]): void {
  if (points.length < 3) {
    return;
  }
  tracePolygon(ctx, points);
  ctx.fill();
}

let scanCanvas: HTMLCanvasElement | null = null;

/** Diagonal pixel stripes laid over an attack shaft. */
function attackScanPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (!scanCanvas) {
    scanCanvas = document.createElement("canvas");
    scanCanvas.width = 8;
    scanCanvas.height = 8;
    const g = scanCanvas.getContext("2d");
    if (!g) {
      return null;
    }
    g.imageSmoothingEnabled = false;
    g.strokeStyle = "rgba(75, 61, 68, 0.7)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, 8);
    g.lineTo(8, 0);
    g.moveTo(-2, 2);
    g.lineTo(2, -2);
    g.moveTo(6, 10);
    g.lineTo(10, 6);
    g.stroke();
  }
  return ctx.createPattern(scanCanvas, "repeat");
}

const ATTACK_RING = MILITARY.brass;

function tokenMatches(counter: PlacedCounter, order: OperationalOrder): boolean {
  const entry = counter.slot.entry;
  if (!isActiveFaction(entry.faction_id, order.faction)) {
    return false;
  }
  if (order.unitType && entry.unit_type_id !== order.unitType) {
    return false;
  }
  const ship = order.shipInstanceIds?.[0];
  return ship ? entry.instance_id === ship : true;
}

/** The combat marker: crossed swords and the attacking unit count, scaled with the map. */
function drawBattleBadge(ctx: CanvasRenderingContext2D, x: number, y: number, count: number, scale: number): void {
  const w = 44 * scale;
  const h = 22 * scale;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, 6 * scale);
  ctx.fillStyle = PLINTH;
  ctx.fill();
  ctx.lineWidth = Math.max(1, 1.25 * scale);
  ctx.strokeStyle = BRASS;
  ctx.stroke();
  ctx.fillStyle = GOLD_NUM;
  ctx.font = `700 ${Math.max(1, 12 * scale)}px ${MONO}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`\u2694 ${count}`, x, y);
}

const FOOT_BADGE = MILITARY.charcoal;

/** A stomping boot and the number of units ordered into that region. Same stamp as the sword badge. */
function drawFootBadge(ctx: CanvasRenderingContext2D, x: number, y: number, count: number, scale: number): void {
  const w = 44 * scale;
  const h = 22 * scale;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, 6 * scale);
  ctx.fillStyle = FOOT_BADGE;
  ctx.fill();
  ctx.lineWidth = Math.max(1, 1.25 * scale);
  ctx.strokeStyle = BRASS;
  ctx.stroke();

  ctx.save();
  ctx.translate(x - 8 * scale, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = GOLD_NUM;
  ctx.beginPath();
  ctx.moveTo(-8, 6);
  ctx.lineTo(6, 6);
  ctx.lineTo(8, 4);
  ctx.lineTo(8, 2);
  ctx.quadraticCurveTo(4, 1, 1, -1);
  ctx.lineTo(-1, -2);
  ctx.lineTo(-2, -7);
  ctx.lineTo(-7, -7);
  ctx.lineTo(-8, -2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = GOLD_NUM;
  ctx.lineWidth = 1.35;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(5, -2);
  ctx.lineTo(7, -6);
  ctx.moveTo(8, -1);
  ctx.lineTo(10, -5);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = GOLD_NUM;
  ctx.font = `700 ${Math.max(1, 12 * scale)}px ${MONO}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(String(count), x + 2 * scale, y);
  ctx.textAlign = "center";
}

function drawAttackRings(ctx: CanvasRenderingContext2D, rings: { x: number; y: number; radius: number }[]): void {
  for (const ring of rings) {
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(2.5, ring.radius * 0.18);
    ctx.strokeStyle = ARROW_INK;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1.6, ring.radius * 0.1);
    ctx.strokeStyle = ATTACK_RING;
    ctx.stroke();
  }
}

/**
 * Movement orders as converging arrows, one pass per world copy. Ink for the whole cluster is laid down
 * first, then the fill, so a tributary does not leave a seam across the trunk. Attacking stacks get a
 * yellow ring. Battle icons are drawn later, after the drag guide, so they stay on top.
 */
export function drawOperationalArrows(
  ctx: CanvasRenderingContext2D,
  scene: TerrainScene,
  phase: string,
  orders: readonly OperationalOrder[],
  regionIds: readonly string[],
  layouts: readonly RegionLayout[],
): PlannedArrow[] {
  const fill = operationalFill(phase);
  if (!fill || orders.length === 0 || scene.view.k <= 0) {
    return [];
  }
  const anchors = new Map(scene.regions.map((region) => [region.id, region.anchor]));
  const battleTargets = new Set<string>();
  const moveTargets = new Set<string>();
  const starts = new Map<string, ArrowStart>();
  const rings: { x: number; y: number; radius: number }[] = [];
  const ringed = new Set<string>();
  for (const order of orders) {
    if (order.attack) {
      battleTargets.add(order.toRegionId);
    } else {
      moveTargets.add(order.toRegionId);
    }
    const clearancePx = shaftClearancePx(order.attack ? ATTACK_WIDTH : 1);
    let origin: ArrowStart | null = null;
    for (const layout of layouts) {
      if (layout.region.id !== order.fromRegionId) {
        continue;
      }
      const counter = layout.counters.find((item) => tokenMatches(item, order));
      if (!counter) {
        continue;
      }
      if (order.attack) {
        const ringKey = `${layout.copyDx}|${layout.region.id}|${counter.slot.key}`;
        if (!ringed.has(ringKey)) {
          ringed.add(ringKey);
          rings.push({ x: counter.x, y: counter.y, radius: layout.halfHeight + 4 });
        }
      }
      if (!origin) {
        origin = {
          at: screenToWorld({ ...scene.view, x: scene.view.x - layout.copyDx }, { x: counter.x, y: counter.y }),
          clearance: (layout.halfHeight + 4 + clearancePx) / scene.view.k,
        };
      }
    }
    if (origin) {
      starts.set(order.id, origin);
    }
  }
  const badge = battleBadgeHalf(scene.view.k);
  const arrows = planOperationalArrows(orders, regionIds, anchors, Math.hypot(badge.halfW, badge.halfH) / scene.view.k, {
    starts,
    battleTargets,
    badgeTargets: moveTargets,
    badge: { ...badge, viewK: scene.view.k },
  });
  if (arrows.length === 0 && rings.length === 0) {
    return [];
  }
  setScreenTransform(ctx, scene.dpr);
  for (const dx of scene.copies) {
    const view = { ...scene.view, x: scene.view.x - dx };
    const casings: Vec2[][] = [];
    const inners: Vec2[][] = [];
    for (const arrow of arrows) {
      const widthScale = arrow.battle ? ATTACK_WIDTH : 1;
      casings.push(...arrowPolygons(arrow, view, true, widthScale));
      inners.push(...arrowPolygons(arrow, view, false, widthScale));
    }
    ctx.fillStyle = ARROW_INK;
    for (const poly of casings) {
      fillPolygon(ctx, poly);
    }
    ctx.fillStyle = fill;
    for (const poly of inners) {
      fillPolygon(ctx, poly);
    }
    if (phase === "combat_move") {
      const scan = attackScanPattern(ctx);
      if (scan) {
        ctx.save();
        ctx.beginPath();
        for (const poly of inners) {
          if (poly.length < 3) {
            continue;
          }
          ctx.moveTo(poly[0].x, poly[0].y);
          for (let i = 1; i < poly.length; i++) {
            ctx.lineTo(poly[i].x, poly[i].y);
          }
          ctx.closePath();
        }
        ctx.clip();
        ctx.globalAlpha = 0.38;
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = scan;
        ctx.fillRect(0, 0, scene.width, scene.height);
        ctx.restore();
      }
    }
  }
  drawAttackRings(ctx, rings);
  return arrows;
}

function orderCount(orders: readonly OperationalOrder[], targetId: string, attack: boolean): number {
  let count = 0;
  for (const order of orders) {
    if (Boolean(order.attack) === attack && order.toRegionId === targetId) {
      count += Math.max(0, Math.trunc(order.count ?? 1));
    }
  }
  return count;
}

function attackingCount(orders: readonly OperationalOrder[], targetId: string): number {
  return orderCount(orders, targetId, true);
}

function movingCount(orders: readonly OperationalOrder[], targetId: string): number {
  return orderCount(orders, targetId, false);
}

/**
 * Sword badges for battles that are still waiting, drawn at the same anchor the attack arrow used.
 * A finished battle is left out of `icons`, so its sword goes away and the others stay.
 */
export function drawStandingBattleIcons(
  ctx: CanvasRenderingContext2D,
  scene: TerrainScene,
  icons: readonly { regionId: string; count: number }[],
): void {
  if (icons.length === 0 || scene.view.k <= 0) {
    return;
  }
  const scale = battleBadgeScale(scene.view.k);
  const anchors = new Map(scene.regions.map((region) => [region.id, region.anchor]));
  const margin = Math.hypot(22 * scale, 11 * scale) + 8;
  setScreenTransform(ctx, scene.dpr);
  for (const dx of scene.copies) {
    const view = { ...scene.view, x: scene.view.x - dx };
    for (const icon of icons) {
      const atWorld = anchors.get(icon.regionId);
      if (!atWorld) {
        continue;
      }
      const at = worldToScreen(view, atWorld);
      if (at.x < -margin || at.y < -margin || at.x > scene.width + margin || at.y > scene.height + margin) {
        continue;
      }
      drawBattleBadge(ctx, at.x, at.y, icon.count, scale);
    }
  }
}

/** Foot badges for move orders, one per destination, with the number of units ordered there. */
export function drawFootIcons(
  ctx: CanvasRenderingContext2D,
  scene: TerrainScene,
  arrows: readonly PlannedArrow[],
  orders: readonly OperationalOrder[],
): void {
  if (scene.view.k <= 0) {
    return;
  }
  const scale = battleBadgeScale(scene.view.k);
  const margin = Math.hypot(22 * scale, 11 * scale) + 8;
  setScreenTransform(ctx, scene.dpr);
  for (const dx of scene.copies) {
    const view = { ...scene.view, x: scene.view.x - dx };
    const seen = new Set<string>();
    for (const arrow of arrows) {
      if (arrow.battle || seen.has(arrow.targetId)) {
        continue;
      }
      seen.add(arrow.targetId);
      const at = worldToScreen(view, arrow.target);
      if (at.x < -margin || at.y < -margin || at.x > scene.width + margin || at.y > scene.height + margin) {
        continue;
      }
      drawFootBadge(ctx, at.x, at.y, movingCount(orders, arrow.targetId), scale);
    }
  }
}

/** Sword badges, painted after arrows and the drag guide so nothing on the map covers them. */
export function drawBattleIcons(
  ctx: CanvasRenderingContext2D,
  scene: TerrainScene,
  arrows: readonly PlannedArrow[],
  orders: readonly OperationalOrder[],
): void {
  if (scene.view.k <= 0) {
    return;
  }
  const scale = battleBadgeScale(scene.view.k);
  const margin = Math.hypot(22 * scale, 11 * scale) + 8;
  setScreenTransform(ctx, scene.dpr);
  for (const dx of scene.copies) {
    const view = { ...scene.view, x: scene.view.x - dx };
    const seen = new Set<string>();
    for (const arrow of arrows) {
      if (!arrow.battle || seen.has(arrow.targetId)) {
        continue;
      }
      seen.add(arrow.targetId);
      const at = worldToScreen(view, arrow.target);
      if (at.x < -margin || at.y < -margin || at.x > scene.width + margin || at.y > scene.height + margin) {
        continue;
      }
      drawBattleBadge(ctx, at.x, at.y, attackingCount(orders, arrow.targetId), scale);
    }
  }
}

/** A faction-coloured guide from a unit slot to the cursor. Both points are canvas pixels. */
export function drawMoveGuide(ctx: CanvasRenderingContext2D, dpr: number, from: Vec2, to: Vec2, color: string): void {
  setScreenTransform(ctx, dpr);
  ctx.save();
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.strokeStyle = "rgba(75, 61, 68, 0.55)";
  ctx.lineWidth = 4.5;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(from.x, from.y, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(75, 61, 68, 0.75)";
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------
// Layer 4: editor overlay
// ---------------------------------------------------------------

export const LINK_COLORS = { land: MILITARY.olive, sea: MILITARY.steel, coastal: MILITARY.terracotta } as const;
export type EditorLinkKind = keyof typeof LINK_COLORS;

export type EditorToolName = "select" | "vertex" | "knife" | "merge" | "draw" | "link" | "promote" | "prune" | "lattice";

export interface EditorOverlay {
  regions: RegionShape[];
  paths: Map<string, Path2D>;
  links: { a: Vec2; b: Vec2; kind: EditorLinkKind }[];
  selectedId: string;
  /** The second region of a merge (Shift-click), or "". */
  secondId: string;
  /** Every region picked for the merge besides the selected one (secondId is the first of them). */
  mergeIds?: string[];
  linkFirstId: string;
  draft: Vec2[];
  drawSea: boolean;
  /** The layer being edited. The other one is drawn faded. */
  layer: "land" | "sea";
  cursor: { point: Vec2; kind: "vertex" | "edge" | "free" } | null;
  /** The cursor is near enough to the draft's first vertex to close it. */
  closing: boolean;
  tool: EditorToolName;
  /** The Prune Box marquee, in world coordinates, and the regions inside it that would be pruned. */
  pruneBox?: { minX: number; minY: number; maxX: number; maxY: number } | null;
  pruneIds?: string[];
  /** The selected region's unit slots in world units (hand-placed or generated), drawn as S1..S8 handles. */
  slots?: Vec2[];
  /** Land-mask rings no land cutter covers: polygon, ring, [x, y]. Drawn as a debug outline. */
  uncovered?: [number, number][][][] | null;
  /** Sea-lattice grid. Set only while that tool is painting the sea layer. */
  lattice?: {
    brush: "square" | "triangle";
    shift: boolean;
    hover: { col: number; row: number; part: "FULL" | "N" | "E" | "S" | "W"; originX: number } | null;
  } | null;
  /** Draft landmass shapes, drawn above the regions while that layer is open. */
  sculpt?: {
    tool: SculptTool;
    shapes: DraftShape[];
    selectedId: string;
    draft: Vec2[];
  } | null;
}

export const SLOT_HANDLE_COLOR = MILITARY.sage;

const KNIFE_COLOR = MILITARY.crimson;
const MERGE_COLOR = MILITARY.steel;
const HANDLE_COLOR = MILITARY.brass;
/** Edges shorter than this on screen get no midpoint "+" handle. */
const MIDPOINT_MIN_PX = 22;
/** How far the knife preview runs past the line's ends, in world units. */
const KNIFE_PREVIEW_REACH = 4000;

export const FACILITY_HANDLE_COLOR = MILITARY.plum;

/**
 * Facility anchor handle. A filled magenta trapezoid on a paper disc, labeled BASE, so it does not read as
 * an amber unit diamond or a green S slot. Drawn in screen pixels.
 */
function drawFacilityHandle(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.beginPath();
  ctx.arc(x, y, 16, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(221, 207, 153, 0.96)";
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = FACILITY_HANDLE_COLOR;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x - 12, y - 8);
  ctx.lineTo(x + 12, y - 8);
  ctx.lineTo(x + 6, y + 6);
  ctx.lineTo(x - 6, y + 6);
  ctx.closePath();
  ctx.fillStyle = FACILITY_HANDLE_COLOR;
  ctx.fill();

  ctx.fillStyle = PAPER;
  ctx.font = `700 11px ${MONO}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("F", x, y - 1);

  ctx.font = `700 11px ${MONO}`;
  ctx.lineWidth = 3;
  ctx.strokeStyle = PAPER;
  ctx.strokeText("BASE", x, y + 24);
  ctx.fillStyle = FACILITY_HANDLE_COLOR;
  ctx.fillText("BASE", x, y + 24);
}

function drawSeaLattice(
  ctx: CanvasRenderingContext2D,
  scene: TerrainScene,
  lattice: NonNullable<EditorOverlay["lattice"]>,
): void {
  const { view } = scene;
  const px = 1 / view.k;
  const x0 = view.x;
  const x1 = view.x + scene.width / view.k;
  const y0 = view.y;
  const y1 = view.y + scene.height / view.k;
  const diagonals = lattice.brush === "triangle" || lattice.shift;

  ctx.save();
  ctx.lineWidth = px;
  ctx.strokeStyle = "rgba(184, 148, 90, 0.45)";
  ctx.beginPath();
  for (let col = 0; col <= LATTICE_COLS; col++) {
    const x = col * LATTICE;
    for (const shift of [-MAP_W, 0, MAP_W]) {
      const gx = x + shift;
      if (gx < x0 - LATTICE || gx > x1 + LATTICE) {
        continue;
      }
      ctx.moveTo(gx, Math.max(y0, 0));
      ctx.lineTo(gx, Math.min(y1, MAP_H));
    }
  }
  const rowTop = Math.max(0, Math.floor(y0 / LATTICE));
  const rowBottom = Math.min(LATTICE_ROWS, Math.ceil(y1 / LATTICE));
  for (let row = rowTop; row <= rowBottom; row++) {
    const y = row * LATTICE;
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
  }
  ctx.stroke();

  if (diagonals) {
    ctx.strokeStyle = "rgba(184, 148, 90, 0.28)";
    ctx.beginPath();
    const colStart = Math.floor(x0 / LATTICE) - 1;
    const colEnd = Math.ceil(x1 / LATTICE) + 1;
    const rowStart = Math.max(0, Math.floor(y0 / LATTICE) - 1);
    const rowEnd = Math.min(LATTICE_ROWS - 1, Math.ceil(y1 / LATTICE));
    for (let col = colStart; col <= colEnd; col++) {
      for (let row = rowStart; row <= rowEnd; row++) {
        const gx = col * LATTICE;
        const gy = row * LATTICE;
        ctx.moveTo(gx, gy);
        ctx.lineTo(gx + LATTICE, gy + LATTICE);
        ctx.moveTo(gx + LATTICE, gy);
        ctx.lineTo(gx, gy + LATTICE);
      }
    }
    ctx.stroke();
  }

  const hover = lattice.hover;
  if (hover) {
    const ring = latticePartRing(hover.col, hover.row, hover.part);
    ctx.beginPath();
    ring.forEach((point, index) => {
      const x = point.x + hover.originX;
      if (index === 0) {
        ctx.moveTo(x, point.y);
      } else {
        ctx.lineTo(x, point.y);
      }
    });
    ctx.closePath();
    ctx.fillStyle = "rgba(80, 196, 206, 0.35)";
    ctx.fill();
    ctx.lineWidth = 1.5 * px;
    ctx.strokeStyle = "rgba(196, 164, 106, 0.95)";
    ctx.stroke();
  }
  ctx.restore();
}

function traceRing(ctx: CanvasRenderingContext2D, ring: Vec2[], move: boolean): void {
  if (ring.length === 0) {
    return;
  }
  ctx.moveTo(ring[0].x, ring[0].y);
  for (let i = 1; i < ring.length; i++) {
    ctx.lineTo(ring[i].x, ring[i].y);
  }
  if (!move) {
    ctx.closePath();
  }
}

function drawSculptLayer(
  ctx: CanvasRenderingContext2D,
  scene: TerrainScene,
  sculpt: NonNullable<EditorOverlay["sculpt"]>,
  px: number,
): void {
  setWorldTransform(ctx, scene.view, scene.dpr);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const shape of sculpt.shapes) {
    ctx.beginPath();
    traceRing(ctx, shape.ring, false);
    for (const hole of shape.holes) {
      traceRing(ctx, hole, false);
    }
    const selected = shape.id === sculpt.selectedId;
    if (!shape.hole) {
      ctx.fillStyle = selected ? "rgba(91, 125, 115, 0.55)" : "rgba(91, 125, 115, 0.35)";
      ctx.fill("evenodd");
    }
    ctx.setLineDash(shape.hole ? [4 * px, 3 * px] : []);
    ctx.lineWidth = (selected ? 2.25 : 1.25) * px;
    ctx.strokeStyle = selected ? MILITARY.brass : MILITARY.charcoal;
    ctx.stroke();
    if (selected && (sculpt.tool === "vertex" || sculpt.tool === "select")) {
      const rings = [shape.ring, ...shape.holes];
      ctx.setLineDash([]);
      ctx.fillStyle = MILITARY.brass;
      for (const ring of rings) {
        for (const p of ring) {
          ctx.fillRect(p.x - 2.5 * px, p.y - 2.5 * px, 5 * px, 5 * px);
        }
      }
    }
    if (selected && sculpt.tool === "select" && shape.ring.length >= 3) {
      const bounds = shapeBounds(shape);
      const center = shapeCenter(shape);
      ctx.setLineDash([]);
      ctx.fillStyle = MILITARY.cream;
      ctx.fillRect(bounds.maxX - 3 * px, bounds.maxY - 3 * px, 6 * px, 6 * px);
      ctx.beginPath();
      ctx.moveTo(center.x, center.y);
      ctx.lineTo(center.x, bounds.minY - 14 * px);
      ctx.strokeStyle = MILITARY.cream;
      ctx.lineWidth = px;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(center.x, bounds.minY - 14 * px, 3.5 * px, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (sculpt.draft.length > 1) {
    ctx.beginPath();
    traceRing(ctx, sculpt.draft, true);
    ctx.setLineDash([]);
    ctx.lineWidth = 1.5 * px;
    ctx.strokeStyle = MILITARY.spruce;
    ctx.stroke();
  }
  setScreenTransform(ctx, scene.dpr);
}

export function drawEditorOverlay(ctx: CanvasRenderingContext2D, scene: TerrainScene, editor: EditorOverlay): void {
  const { view, dpr } = scene;
  const px = 1 / view.k;
  const active = (type: "land" | "sea") => type === editor.layer;

  // Full rough outlines (including the parts the land mask hides) so the slicing is visible.
  setWorldTransform(ctx, view, dpr);
  ctx.lineJoin = "round";
  ctx.lineWidth = px;
  ctx.setLineDash([2 * px, 3 * px]);
  ctx.strokeStyle = "rgba(75, 61, 68, 0.55)";
  for (const region of editor.regions) {
    const path = editor.paths.get(region.id);
    if (path) {
      ctx.globalAlpha = active(region.type) ? 1 : 0.35;
      ctx.stroke(path);
    }
  }
  ctx.globalAlpha = 1;

  // Land the cutters miss. Orange under magenta, in screen pixels, so a small island stays visible when zoomed out.
  if (editor.uncovered && editor.uncovered.length > 0) {
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const poly of editor.uncovered) {
      for (const ring of poly) {
        if (ring.length < 2) continue;
        ctx.moveTo(ring[0][0], ring[0][1]);
        for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i][0], ring[i][1]);
        ctx.closePath();
      }
    }
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = 3.5 * px;
    ctx.strokeStyle = "#FF6A00";
    ctx.stroke();
    ctx.lineWidth = 1.5 * px;
    ctx.strokeStyle = "#FF2BD6";
    ctx.stroke();
  }

  // The other regions picked for a merge. Each path covers every island of its territory.
  const picked = new Set([...(editor.secondId === "" ? [] : [editor.secondId]), ...(editor.mergeIds ?? [])]);
  for (const id of picked) {
    const path = editor.paths.get(id);
    if (path) {
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(78, 84, 99, 0.2)";
      ctx.fill(path, "evenodd");
      ctx.lineWidth = 2.5 * px;
      ctx.strokeStyle = MERGE_COLOR;
      ctx.stroke(path);
    }
  }

  // Neighbor links, dotted, colour-coded.
  ctx.lineCap = "round";
  ctx.lineWidth = 2 * px;
  ctx.setLineDash([0.1 * px, 5 * px]);
  for (const link of editor.links) {
    ctx.strokeStyle = LINK_COLORS[link.kind];
    ctx.beginPath();
    ctx.moveTo(link.a.x, link.a.y);
    ctx.lineTo(link.b.x, link.b.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.lineCap = "butt";

  if (editor.tool === "lattice" && editor.layer === "sea" && editor.lattice) {
    drawSeaLattice(ctx, scene, editor.lattice);
  }

  setScreenTransform(ctx, dpr);
  const S = (p: Vec2) => worldToScreen(view, p);

  // Anchors and names.
  ctx.textAlign = "center";
  for (const region of editor.regions) {
    ctx.globalAlpha = active(region.type) ? 1 : 0.3;
    const a = S(region.anchor);
    ctx.beginPath();
    ctx.arc(a.x, a.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = region.type === "sea" ? LINK_COLORS.sea : INK;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = PAPER;
    ctx.stroke();
    ctx.font = `600 11px ${SERIF}`;
    ctx.textBaseline = "top";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(221, 207, 153, 0.9)";
    ctx.strokeText(region.id, a.x, a.y + 7);
    ctx.fillStyle = INK;
    ctx.fillText(region.id, a.x, a.y + 7);
  }
  ctx.globalAlpha = 1;

  // A preview of every facility badge where it will be drawn in play, so the Airbase, Harbour and Factory
  // choices and the facility anchor can be judged on the map.
  for (const region of editor.regions) {
    const f = facilitiesOf(region);
    const ext = badgeExtent(f);
    if (ext.w === 0) {
      continue;
    }
    const side = BADGE_SIDE_PX * 0.85;
    const at = S(facilityAnchorOf(region));
    ctx.globalAlpha = active(region.type) ? 1 : 0.3;
    drawFacilityBadge(ctx, { regionId: region.id, x: at.x, y: at.y, hw: (ext.w * side) / 2, hh: (ext.h * side) / 2, side }, f, dpr);
  }
  ctx.globalAlpha = 1;

  if (editor.linkFirstId !== "") {
    const region = editor.regions.find((r) => r.id === editor.linkFirstId);
    if (region) {
      const a = S(region.anchor);
      ctx.beginPath();
      ctx.arc(a.x, a.y, 11, 0, Math.PI * 2);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = HANDLE_COLOR;
      ctx.stroke();
    }
  }

  // Handles on the selected region: the anchor you can drag, and in the vertex tool every vertex
  // (squares) and edge midpoint ("+" circles, click to insert a vertex).
  const selected = editor.regions.find((r) => r.id === editor.selectedId);
  const handles = editor.tool === "select" || editor.tool === "vertex" || editor.tool === "merge";
  if (selected && handles) {
    if (editor.tool === "vertex") {
      const pts = selected.points.map(S);
      pts.forEach((p, i) => {
        const q = pts[(i + 1) % pts.length];
        if (pts.length >= 2 && Math.hypot(q.x - p.x, q.y - p.y) >= MIDPOINT_MIN_PX) {
          const mx = (p.x + q.x) / 2;
          const my = (p.y + q.y) / 2;
          ctx.beginPath();
          ctx.arc(mx, my, 6, 0, Math.PI * 2);
          ctx.fillStyle = PAPER;
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = HANDLE_COLOR;
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(mx - 3, my);
          ctx.lineTo(mx + 3, my);
          ctx.moveTo(mx, my - 3);
          ctx.lineTo(mx, my + 3);
          ctx.stroke();
        }
      });
      for (const p of pts) {
        ctx.fillStyle = PAPER;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.5;
        ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
        ctx.strokeRect(p.x - 4, p.y - 4, 8, 8);
      }
    }
    const a = S(selected.anchor);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y - 9);
    ctx.lineTo(a.x + 9, a.y);
    ctx.lineTo(a.x, a.y + 9);
    ctx.lineTo(a.x - 9, a.y);
    ctx.closePath();
    ctx.fillStyle = "rgba(170, 162, 93, 0.35)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = HANDLE_COLOR;
    ctx.stroke();

    // The unit slots S1..S8: a dotted ring the size of a token, and a numbered handle in the middle.
    (editor.slots ?? []).forEach((slot, i) => {
      const at = S(slot);
      ctx.beginPath();
      ctx.setLineDash([2, 3]);
      ctx.arc(at.x, at.y, (TOKEN_WORLD * view.k) / 2, 0, Math.PI * 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(142, 159, 125, 0.6)";
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(at.x, at.y, 9, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(221, 207, 153, 0.92)";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = SLOT_HANDLE_COLOR;
      ctx.stroke();
      ctx.fillStyle = SLOT_HANDLE_COLOR;
      ctx.font = `700 9px ${MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`S${i + 1}`, at.x, at.y + 0.5);
    });

    // The facility anchor, on top of the slots. A solid tether back to the unit diamond. Land only.
    if (selected.type === "land") {
      const at = S(facilityAnchorOf(selected));
      ctx.beginPath();
      ctx.setLineDash([]);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(at.x, at.y);
      ctx.lineWidth = 2;
      ctx.strokeStyle = FACILITY_HANDLE_COLOR;
      ctx.stroke();
      drawFacilityHandle(ctx, at.x, at.y);
    }
  }

  // The knife line, with a faint preview of where its ends run on to.
  if (editor.tool === "knife" && editor.draft.length > 0) {
    const pts = [...editor.draft];
    if (editor.cursor) {
      pts.push(editor.cursor.point);
    }
    if (pts.length >= 2) {
      const head = pts[0];
      const tail = pts[pts.length - 1];
      const dh = { x: head.x - pts[1].x, y: head.y - pts[1].y };
      const dt = { x: tail.x - pts[pts.length - 2].x, y: tail.y - pts[pts.length - 2].y };
      const lh = Math.hypot(dh.x, dh.y) || 1;
      const lt = Math.hypot(dt.x, dt.y) || 1;
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(156, 82, 78, 0.55)";
      ctx.beginPath();
      const h2 = S({ x: head.x + (dh.x / lh) * KNIFE_PREVIEW_REACH, y: head.y + (dh.y / lh) * KNIFE_PREVIEW_REACH });
      const t2 = S({ x: tail.x + (dt.x / lt) * KNIFE_PREVIEW_REACH, y: tail.y + (dt.y / lt) * KNIFE_PREVIEW_REACH });
      ctx.moveTo(h2.x, h2.y);
      ctx.lineTo(S(head).x, S(head).y);
      ctx.moveTo(S(tail).x, S(tail).y);
      ctx.lineTo(t2.x, t2.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const screen = pts.map(S);
    ctx.beginPath();
    screen.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = KNIFE_COLOR;
    ctx.stroke();
    editor.draft.map(S).forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = PAPER;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = KNIFE_COLOR;
      ctx.stroke();
    });
  }

  // The polygon being drawn.
  if (editor.tool === "draw" && editor.draft.length > 0) {
    const color = editor.drawSea ? LINK_COLORS.sea : MILITARY.terracotta;
    const pts = editor.draft.map(S);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts.slice(1)) {
      ctx.lineTo(p.x, p.y);
    }
    if (editor.cursor) {
      const c = S(editor.cursor.point);
      ctx.lineTo(c.x, c.y);
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
    if (pts.length >= 3) {
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = editor.drawSea ? "rgba(78, 84, 99, 0.18)" : "rgba(185, 122, 96, 0.18)";
      ctx.fill();
    }
    pts.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, i === 0 && editor.closing ? 8 : 4, 0, Math.PI * 2);
      ctx.fillStyle = i === 0 ? HANDLE_COLOR : PAPER;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = color;
      ctx.stroke();
    });
  }

  // Prune Box marquee, and an outline on every region it would prune.
  if (editor.pruneBox) {
    const box = editor.pruneBox;
    setWorldTransform(ctx, view, dpr);
    for (const id of editor.pruneIds ?? []) {
      const path = editor.paths.get(id);
      if (path) {
        ctx.setLineDash([]);
        ctx.lineWidth = 2 * px;
        ctx.fillStyle = "rgba(156, 82, 78, 0.3)";
        ctx.fill(path, "evenodd");
        ctx.strokeStyle = KNIFE_COLOR;
        ctx.stroke(path);
      }
    }
    ctx.fillStyle = "rgba(156, 82, 78, 0.12)";
    ctx.fillRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
    ctx.setLineDash([5 * px, 4 * px]);
    ctx.lineWidth = 1.5 * px;
    ctx.strokeStyle = KNIFE_COLOR;
    ctx.strokeRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
    ctx.setLineDash([]);
    setScreenTransform(ctx, dpr);
  }

  if (editor.sculpt) {
    drawSculptLayer(ctx, scene, editor.sculpt, px);
  }

  // Snap indicator.
  if (editor.cursor && (editor.tool === "draw" || editor.tool === "knife")) {
    const c = S(editor.cursor.point);
    ctx.beginPath();
    ctx.arc(c.x, c.y, editor.cursor.kind === "free" ? 3 : 7, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = editor.cursor.kind === "vertex" ? MILITARY.sage : editor.cursor.kind === "edge" ? MILITARY.tan : INK;
    ctx.stroke();
  }
}

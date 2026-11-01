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
import { isLandAt } from "./hitTest";
import { drawMapToken } from "./mapToken";
import { isActiveFaction } from "./tokenStyle";
import { drawUprightStack } from "./uprightSprites";
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
  SELECTED_COLOR,
  SELECTED_TINT,
} from "./mapStyle";
import type { MasterLand } from "./svgLandLoader";
import {
  type ArrowStart,
  arrowPolygons,
  ATTACK_WIDTH,
  battleBadgeHalf,
  battleBadgeScale,
  ARROW_BRASS,
  operationalFill,
  type OperationalOrder,
  type PlannedArrow,
  planOperationalArrows,
  shaftClearancePx,
  ARROW_INK,
} from "./operationalArrows";
import type { FrontlineSegment, ScarFrame } from "./terrainRelief";
import { cliffDepthScale, projectionScales, type View, screenToWorld, worldToScreen } from "./viewMath";
import {
  type MapLod,
  type TerrainStamp,
  terrainStampAlpha,
  terrainStamps,
  uprightDrawOrder,
} from "./zoomLod";

export const TOKEN_PX = 32;
const PAPER = "#f4f1ea";
const INK = "#1a1a18";
const PLINTH = "#262126";
const BRASS = "#D9B26F";
const GOLD_NUM = "#E8C585";
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
  /** World points stamps must stay clear of, per land region. Hubs and unit slots. */
  stampAvoid?: Readonly<Record<string, readonly Vec2[]>>;
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
  ctx.fillStyle = oceanBackdrop();
  ctx.fillRect(0, 0, s.width, s.height);

  const px = 1 / view.k;
  // Adjacent copies overlap by under a pixel, so bilinear edges leave no hairline between them.
  const bleed = s.copies.length > 1 ? 0.4 * px : 0;
  for (const dx of s.copies) {
    setWorldTransform(ctx, view, dpr);
    ctx.translate(dx, 0);
    ctx.lineJoin = "round";
    ctx.drawImage(baked.canvas, bounds.x - bleed, bounds.y, bounds.w + bleed * 2, bounds.h);
    drawTiltedCliffs(ctx, s, bleed);
    drawDynamicTerrain(ctx, s, px, dx);
  }
  setWorldTransform(ctx, view, dpr);
}

/** Southern cliff lip in the water. Depth grows with the camera tilt. The baked land is put back on top. */
function drawTiltedCliffs(ctx: CanvasRenderingContext2D, s: TerrainScene, bleed: number): void {
  const landRegions = s.regions.filter((region) => region.type === "land" && s.paths.has(region.id));
  if (landRegions.length === 0) {
    return;
  }
  const relief = cliffDepthScale(s.view.k);
  const extrude = (dy: number, fill: string, stroke: string, width: number) => {
    ctx.save();
    ctx.translate(0, dy);
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.lineJoin = "miter";
    for (const region of landRegions) {
      const path = s.paths.get(region.id);
      if (!path) {
        continue;
      }
      ctx.fill(path, "evenodd");
      ctx.stroke(path);
    }
    ctx.restore();
  };
  extrude(5 * relief, "rgba(20, 30, 34, 0.65)", "rgba(20, 30, 34, 0.65)", 1);
  extrude(2.5 * relief, "#2E2723", "#1A1815", 1.5);

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

function drawFrontlines(ctx: CanvasRenderingContext2D, segments: readonly FrontlineSegment[]): void {
  if (segments.length === 0) {
    return;
  }
  ctx.save();
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  ctx.beginPath();
  for (const segment of segments) {
    ctx.moveTo(segment.x1, segment.y1);
    ctx.lineTo(segment.x2, segment.y2);
  }
  ctx.strokeStyle = "rgba(184, 37, 32, 0.32)";
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.strokeStyle = "#E86A58";
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.stroke();
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
  ctx.fillStyle = "#423840";
  ctx.fillRect(x + 3 * u, y - 5 * v, 2 * u, 5 * v);
  ctx.fillStyle = "#527A71";
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
  ctx.fillStyle = "#2E2723";
  ctx.fillRect(x - 7 * u, y - 1 * v, 16 * u, 2 * v);
  ctx.fillStyle = "#4A4038";
  ctx.fillRect(x - 6 * u, y - 3 * v, 5 * u, 2 * v);
  ctx.fillRect(x - 1 * u, y - 5 * v, 4 * u, 2 * v);
  ctx.fillRect(x + 3 * u, y - 3 * v, 5 * u, 2 * v);
  ctx.fillStyle = "#6B5E52";
  ctx.fillRect(x - 1 * u, y - 6 * v, 2 * u, 2 * v);
}

function drawWaterDash(ctx: CanvasRenderingContext2D, x: number, y: number, u: number, v: number): void {
  ctx.fillStyle = "#79989E";
  ctx.fillRect(x, y, 3 * u, v);
  ctx.fillRect(x + 5 * u, y, 2 * u, v);
  ctx.fillRect(x + 8 * u, y, 3 * u, v);
}

function drawPixelStamps(ctx: CanvasRenderingContext2D, s: TerrainScene, dx: number): void {
  const alpha = terrainStampAlpha(s.view.k);
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
      ctx.stroke(path);
    }
  }

  if ((s.lod ?? 0) === 1) {
    drawPixelStamps(ctx, s, dx);
  }

  drawFrontlines(ctx, s.frontlines ?? []);
  drawBattleScars(ctx, s.scars ?? [], px, (s.lod ?? 0) !== 2);
}

// ---------------------------------------------------------------
// Layer 4: game overlay
// ---------------------------------------------------------------

export interface GameOverlay {
  layouts: RegionLayout[];
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
  /** Unit type id to land, air or sea, from the scenario's unit data. */
  categories?: Record<string, string>;
  /** The token under the pointer. Drawn last so a tucked card comes to the front. */
  hoverStack?: { regionId: string; key: string; copyDx: number } | null;
}

/** Facility icons stay at this opacity. The map shows through, and nothing else (layer, hover) changes it. */
export const FACILITY_ICON_ALPHA = 0.66;

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
  ctx.shadowColor = "rgba(26, 24, 21, 0.45)";
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
  ctx.strokeStyle = "#1A1815";
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - r * 0.42, y);
  ctx.lineTo(x + r * 0.42, y);
  ctx.moveTo(x, y - r * 0.42);
  ctx.lineTo(x, y + r * 0.42);
  ctx.lineWidth = Math.max(1.25, r * 0.28);
  ctx.lineCap = "butt";
  ctx.strokeStyle = "#1A1815";
  ctx.stroke();
}

/** The IPC shield, 20 x 25 px at the base token size. */
function shieldPath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(x - 10 * s, y - 11 * s);
  ctx.lineTo(x + 10 * s, y - 11 * s);
  ctx.lineTo(x + 10 * s, y + 3 * s);
  ctx.quadraticCurveTo(x + 10 * s, y + 11 * s, x, y + 14 * s);
  ctx.quadraticCurveTo(x - 10 * s, y + 11 * s, x - 10 * s, y + 3 * s);
  ctx.closePath();
}

/** The capital's emblem: a gold five-point star with an ink edge. */
function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, outer: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? outer : outer * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = x + radius * Math.cos(a);
    const py = y + radius * Math.sin(a);
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
  ctx.fillStyle = "#E2B53C";
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.lineJoin = "round";
  ctx.strokeStyle = INK;
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
      fuel: game.fuelFor?.(region.id, entry) ?? null,
    });
    const selected = game.selectedStack?.regionId === region.id && game.selectedStack.key === counter.slot.key;
    const unmoved = game.isUnmoved(region.id, entry);
    if (selected || unmoved) {
      ctx.beginPath();
      ctx.arc(counter.x, counter.y, tokenPx / 2 + 3 * game.unitScale, 0, Math.PI * 2);
      ctx.lineWidth = selected ? 3 : 1.5;
      ctx.strokeStyle = selected ? SELECTED_COLOR : "rgba(244, 241, 234, 0.9)";
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
            setScreenTransform(ctx, scene.dpr);
            drawFacilityBadge(ctx, badge, facilitiesOf(layout.region), scene.dpr);
          },
        });
      }
    }
    for (const counter of layout.counters) {
      if (counter.x < -48 || counter.y < -56 || counter.x > scene.width + 48 || counter.y > scene.height + 48) {
        continue;
      }
      const { entry } = counter.slot;
      const worldY = screenToWorld(copyView, { x: counter.x, y: counter.y }).y;
      const selected = game.selectedStack?.regionId === layout.region.id && game.selectedStack.key === counter.slot.key;
      items.push({
        worldY,
        paint: () => {
          setScreenTransform(ctx, scene.dpr);
          drawUprightStack(ctx, {
            unitType: entry.unit_type_id,
            factionId: entry.faction_id,
            count: entry.count,
            x: counter.x,
            y: counter.y,
            tokenPx,
            dpr: scene.dpr,
            selected,
            unmoved: game.isUnmoved(layout.region.id, entry),
            active: isActiveFaction(entry.faction_id, game.activeFactionId),
            fuel: game.fuelFor?.(layout.region.id, entry) ?? null,
            loaded: game.isLoaded?.(entry) ?? false,
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

export function drawGameOverlay(ctx: CanvasRenderingContext2D, scene: TerrainScene, game: GameOverlay): void {
  const dpr = scene.dpr;
  const s = game.unitScale;
  const lod = scene.lod ?? 0;
  setScreenTransform(ctx, dpr);
  const markers = new Map(game.combatMarkers.map((m) => [m.regionId, m.count]));
  const visible = (layout: RegionLayout) => {
    const { anchor } = layout;
    return anchor.x >= -80 && anchor.y >= -80 && anchor.x <= scene.width + 80 && anchor.y <= scene.height + 80;
  };
  const drawShield = (layout: RegionLayout) => {
    const { region, anchor } = layout;
    if (region.type !== "land" || region.ipc <= 0) {
      return;
    }
    const shieldY = layout.shieldY;
    shieldPath(ctx, anchor.x, shieldY, s);
    ctx.fillStyle = PLINTH;
    ctx.fill();
    ctx.lineWidth = Math.max(1, 1.25 * s);
    ctx.strokeStyle = BRASS;
    ctx.stroke();
    ctx.fillStyle = GOLD_NUM;
    ctx.font = `700 ${Math.max(8, 12 * s)}px ${MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(region.ipc), anchor.x, shieldY - 1 * s);
    if (region.capital) {
      drawStar(ctx, anchor.x, shieldY - 17 * s, Math.max(4, 6.5 * s));
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

  if (lod < 2) {
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
    return;
  }

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
    g.strokeStyle = "rgba(26, 24, 21, 0.7)";
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

const ATTACK_RING = "#F5C400";

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

const FOOT_BADGE = "#262126";

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
    ctx.strokeStyle = ARROW_BRASS;
    ctx.lineWidth = 1;
    ctx.lineJoin = "miter";
    for (const poly of inners) {
      if (poly.length < 3) {
        continue;
      }
      tracePolygon(ctx, poly);
      ctx.stroke();
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
  ctx.strokeStyle = "rgba(26, 26, 24, 0.55)";
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
  ctx.strokeStyle = "rgba(26, 26, 24, 0.75)";
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------
// Layer 4: editor overlay
// ---------------------------------------------------------------

export const LINK_COLORS = { land: "#3f6b2a", sea: "#2b5f9a", coastal: "#b5651d" } as const;
export type EditorLinkKind = keyof typeof LINK_COLORS;

export type EditorToolName = "select" | "vertex" | "knife" | "merge" | "draw" | "link" | "promote" | "prune";

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
}

export const SLOT_HANDLE_COLOR = "#2e8b3e";

const KNIFE_COLOR = "#c0392b";
const MERGE_COLOR = "#2b6cb0";
const HANDLE_COLOR = "#e0a000";
/** Edges shorter than this on screen get no midpoint "+" handle. */
const MIDPOINT_MIN_PX = 22;
/** How far the knife preview runs past the line's ends, in world units. */
const KNIFE_PREVIEW_REACH = 4000;

export const FACILITY_HANDLE_COLOR = "#a23b72";

/**
 * Facility anchor handle. A filled magenta trapezoid on a paper disc, labeled BASE, so it does not read as
 * an amber unit diamond or a green S slot. Drawn in screen pixels.
 */
function drawFacilityHandle(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.beginPath();
  ctx.arc(x, y, 16, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(244, 241, 234, 0.96)";
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

export function drawEditorOverlay(ctx: CanvasRenderingContext2D, scene: TerrainScene, editor: EditorOverlay): void {
  const { view, dpr } = scene;
  const px = 1 / view.k;
  const active = (type: "land" | "sea") => type === editor.layer;

  // Full rough outlines (including the parts the land mask hides) so the slicing is visible.
  setWorldTransform(ctx, view, dpr);
  ctx.lineJoin = "round";
  ctx.lineWidth = px;
  ctx.setLineDash([2 * px, 3 * px]);
  ctx.strokeStyle = "rgba(26, 26, 24, 0.55)";
  for (const region of editor.regions) {
    const path = editor.paths.get(region.id);
    if (path) {
      ctx.globalAlpha = active(region.type) ? 1 : 0.35;
      ctx.stroke(path);
    }
  }
  ctx.globalAlpha = 1;

  // The other regions picked for a merge. Each path covers every island of its territory.
  const picked = new Set([...(editor.secondId === "" ? [] : [editor.secondId]), ...(editor.mergeIds ?? [])]);
  for (const id of picked) {
    const path = editor.paths.get(id);
    if (path) {
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(43, 108, 176, 0.2)";
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
    ctx.strokeStyle = "rgba(244, 241, 234, 0.9)";
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
    ctx.fillStyle = "rgba(224, 160, 0, 0.35)";
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
      ctx.strokeStyle = "rgba(46, 139, 62, 0.6)";
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(at.x, at.y, 9, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(244, 241, 234, 0.92)";
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
      ctx.strokeStyle = "rgba(192, 57, 43, 0.55)";
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
    const color = editor.drawSea ? LINK_COLORS.sea : "#7a3e1d";
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
      ctx.fillStyle = editor.drawSea ? "rgba(43, 95, 154, 0.18)" : "rgba(122, 62, 29, 0.18)";
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
        ctx.fillStyle = "rgba(192, 57, 43, 0.3)";
        ctx.fill(path, "evenodd");
        ctx.strokeStyle = KNIFE_COLOR;
        ctx.stroke(path);
      }
    }
    ctx.fillStyle = "rgba(192, 57, 43, 0.12)";
    ctx.fillRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
    ctx.setLineDash([5 * px, 4 * px]);
    ctx.lineWidth = 1.5 * px;
    ctx.strokeStyle = KNIFE_COLOR;
    ctx.strokeRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
    ctx.setLineDash([]);
    setScreenTransform(ctx, dpr);
  }

  // Snap indicator.
  if (editor.cursor && (editor.tool === "draw" || editor.tool === "knife")) {
    const c = S(editor.cursor.point);
    ctx.beginPath();
    ctx.arc(c.x, c.y, editor.cursor.kind === "free" ? 3 : 7, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = editor.cursor.kind === "vertex" ? "#2e8b3e" : editor.cursor.kind === "edge" ? "#e07a00" : INK;
    ctx.stroke();
  }
}

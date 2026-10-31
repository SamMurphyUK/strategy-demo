// Layered canvas renderer for the strategic map.
//
//   Layers 0-3  the baked war-room base map (mapBake.ts): ocean, faction-tinted land, aged burn, borders and\n//               coastline. Painted once to an offscreen canvas and blitted per visible world copy.\n//   Layer 4     highlight washes, hover and selection: gold tint plus outline on the region's true shape\n//   Layer 5     anchors, IPC shields, unit counters, markers, and the editor overlay
//
// `scene.paths` are the regions' true shapes: each cutter polygon boolean-clipped against the land SVG
// (land regions intersected with it, sea zones differenced from it). Fills and outlines on them follow
// the inland borders and the exact coastline. When the land has not loaded they are the rough cutters
// and `exact` is false, so land regions are clipped to the stencil at draw time instead.
//
// Layers 0-4 draw in world units; layer 5 draws in screen pixels so counters keep their size at any zoom.
import { factionPalette } from "../theme/factionPalette";
import { drawCountPill, drawMapToken, drawTokenFace } from "./mapToken";
import { isActiveFaction, tokenDisc } from "./tokenStyle";
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
  airAnchorOf,
  type Facilities,
  facilitiesOf,
  facilityAnchorOf,
  type HighlightMode,
  type Rect,
  type RegionShape,
  SELECTED_OUTLINE_WIDTH,
  type StackEntry,
  type StackSlot,
  stackKey,
  type Vec2,
} from "./geometry";
import { type DomainCluster, layoutRegionVisuals, type PlacedBadge, type UnitDomain } from "./unitStacks";
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
import { type View, worldToScreen } from "./viewMath";

export const TOKEN_PX = 32;
const PAPER = "#f4f1ea";
const INK = "#1a1a18";
const SERIF = 'Georgia, "Iowan Old Style", "Times New Roman", serif';
const MONO = 'ui-monospace, "Cascadia Mono", Consolas, monospace';

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
  /** The expanded stacks of every domain that is not collapsed. */
  counters: PlacedCounter[];
  /** One cluster per domain with units: expanded counters or a collapsed bubble. */
  clusters: DomainCluster[];
  /** The facility badge, or null when the region has no facility. */
  badge: PlacedBadge | null;
  /** Screen y of the IPC shield's centre, and of the combat marker's. */
  shieldY: number;
  markerY: number;
  /** Half the height of the tallest cluster, in px. */
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
    const counters = visuals.clusters.flatMap((cluster) =>
      cluster.slots.map((s) => ({ regionId: region.id, slot: s.slot, domain: cluster.domain, x: s.x, y: s.y })),
    );
    return {
      region,
      anchor,
      counters,
      clusters: visuals.clusters,
      badge: visuals.badge,
      shieldY: visuals.shieldY,
      markerY: visuals.markerY,
      halfHeight: visuals.clusters.reduce((m, c) => Math.max(m, c.hh), 0),
      copyDx: options.copyDx ?? 0,
    };
  });
}

function setWorldTransform(ctx: CanvasRenderingContext2D, view: View, dpr: number): void {
  const s = dpr * view.k;
  ctx.setTransform(s, 0, 0, s, -view.x * s, -view.y * s);
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
    drawDynamicTerrain(ctx, s, px);
  }
  setWorldTransform(ctx, view, dpr);
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

function drawDynamicTerrain(ctx: CanvasRenderingContext2D, s: TerrainScene, px: number): void {
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
  /** A transport with cargo aboard gets a dot at its token's top left. */
  isLoaded?(entry: StackEntry): boolean;
  /** Unit type id to land, air or sea, from the scenario's unit data. */
  categories?: Record<string, string>;
  /** The collapsed bubble whose drawer is open, if any. */
  openDrawer?: { regionId: string; domain: UnitDomain; copyDx: number } | null;
}

/** The Tri-Wedge: airbase ▼, factory ▲ and harbour ▼ as one trapezoid. See facilityBadge.ts for the geometry. */
export function drawFacilityBadge(ctx: CanvasRenderingContext2D, badge: PlacedBadge, f: Facilities, dpr = 1): void {
  const s = badge.side;
  const shapes = badgeShapes(f);
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
}

/**
 * A domain collapsed into one bubble: the lead unit by threat priority on a token-sized disc, a second card
 * behind it and a ring around both, with the domain's total on a pill at the bottom right. Clicking it opens
 * the drawer (see UnitDrawer.tsx).
 */
function drawCollapsedBubble(
  ctx: CanvasRenderingContext2D,
  cluster: DomainCluster,
  copyDx: number,
  game: GameOverlay,
  dpr: number,
): void {
  const { x, y, bubbleRadius: r, group } = cluster;
  const s = game.unitScale;
  const lead = group.lead;
  const d = r * 2;
  const paint = {
    dpr,
    activeFactionId: game.activeFactionId,
    categories: game.categories,
    loaded: game.isLoaded?.(lead) ?? false,
  };

  // The card behind, offset, so the bubble reads as a pile.
  ctx.beginPath();
  ctx.arc(x + 3.5 * s, y + 3.5 * s, r, 0, Math.PI * 2);
  ctx.fillStyle = tokenDisc(lead.faction_id);
  ctx.fill();
  ctx.lineWidth = Math.max(1, 1.5 * s);
  ctx.strokeStyle = INK;
  ctx.stroke();

  ctx.save();
  ctx.shadowColor = "rgba(26, 26, 24, 0.55)";
  ctx.shadowBlur = 3 * dpr;
  ctx.shadowOffsetY = 1 * dpr;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = tokenDisc(lead.faction_id);
  ctx.fill();
  ctx.restore();
  drawTokenFace(ctx, lead, x, y, d, paint);

  // The double ring: a thin paper ring just outside the front card, and the faction's own outside that.
  ctx.beginPath();
  ctx.arc(x, y, r + 2 * s, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1, 1.5 * s);
  ctx.strokeStyle = PAPER;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r + 3.8 * s, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(0.8, 1 * s);
  ctx.strokeStyle = INK;
  ctx.stroke();

  const selected = game.selectedStack?.regionId === cluster.regionId && group.entries.some((e) => stackKey(e) === game.selectedStack?.key);
  const unmoved = group.entries.some((e) => game.isUnmoved(cluster.regionId, e));
  const open = game.openDrawer?.regionId === cluster.regionId && game.openDrawer.domain === cluster.domain && game.openDrawer.copyDx === copyDx;
  if (selected || unmoved || open) {
    ctx.beginPath();
    ctx.arc(x, y, r + 6 * s, 0, Math.PI * 2);
    ctx.lineWidth = selected || open ? 3 : 1.5;
    ctx.strokeStyle = selected || open ? SELECTED_COLOR : "rgba(244, 241, 234, 0.9)";
    ctx.setLineDash(selected || open ? [] : [4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // The domain's total, on the same pill a token's count is on.
  const active = group.entries.some((e) => isActiveFaction(e.faction_id, game.activeFactionId));
  drawCountPill(ctx, group.total, x, y, d, active);
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
 * One region's unit tokens and collapsed bubbles, with the rings that mark a selected or unmoved stack. The
 * game draws these for each region; the editor draws them too, so a garrison can be judged while editing.
 */
export function drawRegionUnits(ctx: CanvasRenderingContext2D, layout: RegionLayout, game: GameOverlay, dpr: number): void {
  const { region } = layout;
  const tokenPx = TOKEN_PX * game.unitScale;
  for (const cluster of layout.clusters) {
    if (cluster.collapsed) {
      drawCollapsedBubble(ctx, cluster, layout.copyDx, game, dpr);
    }
  }
  for (const counter of layout.counters) {
    const { entry } = counter.slot;
    drawMapToken(ctx, entry, counter.x, counter.y, tokenPx, {
      dpr,
      activeFactionId: game.activeFactionId,
      categories: game.categories,
      loaded: game.isLoaded?.(entry) ?? false,
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
  }
}

/** The editor's preview of every region's garrison, under its own handles. */
export function drawEditorUnits(ctx: CanvasRenderingContext2D, scene: TerrainScene, game: GameOverlay): void {
  setScreenTransform(ctx, scene.dpr);
  for (const layout of game.layouts) {
    if (layout.clusters.length > 0) {
      drawRegionUnits(ctx, layout, game, scene.dpr);
    }
  }
}

export function drawGameOverlay(ctx: CanvasRenderingContext2D, scene: TerrainScene, game: GameOverlay): void {
  const dpr = scene.dpr;
  const s = game.unitScale;
  setScreenTransform(ctx, dpr);
  const markers = new Map(game.combatMarkers.map((m) => [m.regionId, m.count]));

  for (const layout of game.layouts) {
    const { region, anchor } = layout;
    if (anchor.x < -80 || anchor.y < -80 || anchor.x > scene.width + 80 || anchor.y > scene.height + 80) {
      continue;
    }
    const owner = game.owners[region.id] ?? "";
    const shieldY = layout.shieldY;

    // The facility badge sits at the facility anchor, apart from the unit tokens.
    if (layout.badge) {
      drawFacilityBadge(ctx, layout.badge, facilitiesOf(region), dpr);
    }

    // IPC shield, at the unit anchor, and a capital's star above it.
    if (region.type === "land" && region.ipc > 0) {
      shieldPath(ctx, anchor.x, shieldY, s);
      ctx.fillStyle = PAPER;
      ctx.fill();
      ctx.lineWidth = Math.max(1, 2 * s);
      ctx.strokeStyle = owner === "" ? INK : factionPalette(owner).primary;
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.font = `700 ${Math.max(8, 12 * s)}px ${MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(region.ipc), anchor.x, shieldY - 1 * s);
      if (region.capital) {
        drawStar(ctx, anchor.x, shieldY - 17 * s, Math.max(4, 6.5 * s));
      }
    }

    drawRegionUnits(ctx, layout, game, dpr);

    const combat = markers.get(region.id);
    if (combat !== undefined) {
      const cy = layout.markerY;
      ctx.beginPath();
      ctx.roundRect(anchor.x - 22, cy - 11, 44, 22, 6);
      ctx.fillStyle = "#9a4e48";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = PAPER;
      ctx.stroke();
      ctx.fillStyle = PAPER;
      ctx.font = `700 12px ${MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`\u2694 ${combat}`, anchor.x, cy);
    }
  }
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
  /** The selected region's unit slots in world units (hand-placed or generated), drawn as S1..S6 handles. */
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
export const AIR_HANDLE_COLOR = "#1f78c8";

/** Facility Anchor handle: an inverted trapezoid, the silhouette of the facility badge. */
function drawFacilityHandle(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.beginPath();
  ctx.moveTo(x - 10, y - 6);
  ctx.lineTo(x + 10, y - 6);
  ctx.lineTo(x + 5, y + 6);
  ctx.lineTo(x - 5, y + 6);
  ctx.closePath();
  // Outline only, so the badge preview underneath stays readable.
  ctx.lineWidth = 2;
  ctx.strokeStyle = FACILITY_HANDLE_COLOR;
  ctx.stroke();
}

/** Air Anchor handle: a circle with two small wings. */
function drawAirHandle(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.beginPath();
  ctx.moveTo(x - 12, y + 2);
  ctx.lineTo(x - 5, y - 3);
  ctx.lineTo(x - 5, y + 3);
  ctx.closePath();
  ctx.moveTo(x + 12, y + 2);
  ctx.lineTo(x + 5, y - 3);
  ctx.lineTo(x + 5, y + 3);
  ctx.closePath();
  ctx.fillStyle = AIR_HANDLE_COLOR;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(31, 120, 200, 0.35)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = AIR_HANDLE_COLOR;
  ctx.stroke();
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

    // The other two anchors, each its own colour and shape, tethered to the unit anchor.
    const extras: { at: Vec2; kind: "facility" | "air" }[] = [
      ...(selected.type === "land" ? [{ at: S(facilityAnchorOf(selected)), kind: "facility" as const }] : []),
      { at: S(airAnchorOf(selected)), kind: "air" as const },
    ];
    for (const { at, kind } of extras) {
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(at.x, at.y);
      ctx.lineWidth = 1;
      ctx.strokeStyle = kind === "facility" ? FACILITY_HANDLE_COLOR : AIR_HANDLE_COLOR;
      ctx.stroke();
      ctx.setLineDash([]);
      if (kind === "facility") {
        drawFacilityHandle(ctx, at.x, at.y);
      } else {
        drawAirHandle(ctx, at.x, at.y);
      }
    }

    // The unit slots S1..S6: a dotted ring the size of a token, and a numbered handle in the middle.
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

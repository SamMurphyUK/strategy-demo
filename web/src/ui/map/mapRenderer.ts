// Layered canvas renderer for the strategic map.
//
//   Layer 0  ocean fill and sea zones (rough polygons; they may run inland)
//   Layer 1  master land path filled opaque parchment: covers sea-zone lines that overlap the shore
//   Layer 2  land regions, clipped to the master land path so rough polygons stop at the coastline
//   Layer 3  master coastline stroke
//   Layer 4  anchors, IPC shields, unit counters, markers, and the editor overlay
//
// Layers 0-3 draw in world units; layer 4 draws in screen pixels so counters keep their size at any zoom.
import { factionPalette } from "../theme/factionPalette";
import { renderUnitToken } from "../theme/tokens/drawUnitToken";
import { unitArtUrl } from "./assets";
import {
  type HighlightMode,
  layoutStackSlots,
  type RegionShape,
  SELECTED_OUTLINE_WIDTH,
  type StackEntry,
  type StackSlot,
  type Vec2,
} from "./geometry";
import {
  BORDER_COLOR,
  COASTLINE_COLOR,
  COASTLINE_WIDTH_PX,
  HOVER_COLOR,
  LAND_PARCHMENT,
  landFill,
  NAVAL_BORDER_COLOR,
  OCEAN_COLOR,
  SELECTED_COLOR,
  seaFill,
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
  paths: Map<string, Path2D>;
  owners: Record<string, string>;
  highlight: HighlightMode;
  selectedRegionId: string;
  hoverRegionId: string;
}

export interface PlacedCounter {
  regionId: string;
  slot: StackSlot;
  /** Screen position of the counter's centre. */
  x: number;
  y: number;
}

export interface RegionLayout {
  region: RegionShape;
  anchor: Vec2;
  counters: PlacedCounter[];
  /** Half the height of the counter cluster, in px. */
  halfHeight: number;
}

export function layoutRegions(regions: RegionShape[], stacks: Record<string, StackEntry[]>, view: View): RegionLayout[] {
  return regions.map((region) => {
    const anchor = worldToScreen(view, region.anchor);
    const slots = layoutStackSlots(stacks[region.id] ?? []);
    const counters = slots.map((slot) => ({
      regionId: region.id,
      slot,
      x: anchor.x + slot.offset.x,
      y: anchor.y + slot.offset.y,
    }));
    const reach = slots.reduce((m, s) => Math.max(m, Math.abs(s.offset.y)), 0);
    return { region, anchor, counters, halfHeight: slots.length > 0 ? reach + TOKEN_PX / 2 + 2 : 0 };
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
// Layers 0-3
// ---------------------------------------------------------------

export function drawTerrain(ctx: CanvasRenderingContext2D, s: TerrainScene): void {
  const { view, dpr, land } = s;
  setScreenTransform(ctx, dpr);
  ctx.fillStyle = OCEAN_COLOR;
  ctx.fillRect(0, 0, s.width, s.height);

  setWorldTransform(ctx, view, dpr);
  const px = 1 / view.k;
  ctx.lineJoin = "round";

  // Layer 0: sea zones.
  ctx.lineWidth = px;
  ctx.setLineDash([5 * px, 4 * px]);
  ctx.strokeStyle = NAVAL_BORDER_COLOR;
  for (const region of s.regions) {
    const path = s.paths.get(region.id);
    if (region.type !== "sea" || !path) {
      continue;
    }
    ctx.fillStyle = seaFill(region.id, s.highlight);
    ctx.fill(path);
    ctx.stroke(path);
  }
  ctx.setLineDash([]);

  // Layer 1: the land stencil. Opaque, so it hides anything a sea zone drew over the shore.
  if (land) {
    ctx.fillStyle = LAND_PARCHMENT;
    ctx.fill(land.masterLandPath);
  }

  // Layer 2: land regions, clipped to the coastline.
  ctx.save();
  if (land) {
    ctx.clip(land.masterLandPath);
  }
  ctx.lineWidth = 1.25 * px;
  ctx.strokeStyle = BORDER_COLOR;
  for (const region of s.regions) {
    const path = s.paths.get(region.id);
    if (region.type !== "land" || !path) {
      continue;
    }
    const fill = landFill(region.id, s.owners[region.id] ?? "", s.highlight);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill(path);
    }
    ctx.stroke(path);
  }
  ctx.restore();

  // Layer 3: the coastline.
  if (land) {
    ctx.lineWidth = COASTLINE_WIDTH_PX * px;
    ctx.strokeStyle = COASTLINE_COLOR;
    ctx.stroke(land.masterLandPath);
  }

  // Hover and selection outlines sit above the coastline, unclipped.
  for (const [id, color, width] of [
    [s.hoverRegionId, HOVER_COLOR, 2],
    [s.selectedRegionId, SELECTED_COLOR, SELECTED_OUTLINE_WIDTH],
  ] as const) {
    const path = id === "" ? undefined : s.paths.get(id);
    if (path) {
      ctx.lineWidth = width * px;
      ctx.strokeStyle = color;
      ctx.stroke(path);
    }
  }
}

// ---------------------------------------------------------------
// Layer 4: game overlay
// ---------------------------------------------------------------

const imageCache = new Map<string, HTMLImageElement>();
let onImageLoad: (() => void) | null = null;

export function setImageLoadListener(listener: (() => void) | null): void {
  onImageLoad = listener;
}

function cachedImage(url: string): HTMLImageElement | null {
  let img = imageCache.get(url);
  if (!img) {
    img = new Image();
    img.onload = () => onImageLoad?.();
    img.src = url;
    imageCache.set(url, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

export interface GameOverlay {
  layouts: RegionLayout[];
  owners: Record<string, string>;
  selectedStack: { regionId: string; key: string } | null;
  isUnmoved(regionId: string, entry: StackEntry): boolean;
  combatMarkers: { regionId: string; count: number }[];
}

function shieldPath(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.beginPath();
  ctx.moveTo(x - 10, y - 11);
  ctx.lineTo(x + 10, y - 11);
  ctx.lineTo(x + 10, y + 3);
  ctx.quadraticCurveTo(x + 10, y + 11, x, y + 14);
  ctx.quadraticCurveTo(x - 10, y + 11, x - 10, y + 3);
  ctx.closePath();
}

export function drawGameOverlay(ctx: CanvasRenderingContext2D, scene: TerrainScene, game: GameOverlay): void {
  const dpr = scene.dpr;
  setScreenTransform(ctx, dpr);
  const markers = new Map(game.combatMarkers.map((m) => [m.regionId, m.count]));

  for (const layout of game.layouts) {
    const { region, anchor } = layout;
    if (anchor.x < -80 || anchor.y < -80 || anchor.x > scene.width + 80 || anchor.y > scene.height + 80) {
      continue;
    }
    const owner = game.owners[region.id] ?? "";
    const shieldY = anchor.y - layout.halfHeight - (layout.halfHeight > 0 ? 8 : 0);

    // IPC shield, with the factory beside it.
    if (region.type === "land" && region.ipc > 0) {
      shieldPath(ctx, anchor.x, shieldY);
      ctx.fillStyle = PAPER;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = owner === "" ? INK : factionPalette(owner).primary;
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.font = `700 12px ${MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(region.ipc), anchor.x, shieldY - 1);
    }
    if (region.hasFactory) {
      const url = unitArtUrl("factory", owner);
      const img = url === "" ? null : cachedImage(url);
      if (img) {
        ctx.drawImage(img, anchor.x + 14, shieldY - 14, 28, 28);
      }
    }

    for (const counter of layout.counters) {
      const { entry } = counter.slot;
      const token = renderUnitToken({ unitTypeId: entry.unit_type_id, factionId: entry.faction_id, size: TOKEN_PX, dpr });
      ctx.shadowColor = "rgba(26, 26, 24, 0.55)";
      ctx.shadowBlur = 3 * dpr;
      ctx.shadowOffsetY = 1 * dpr;
      ctx.drawImage(
        token.canvas,
        counter.x - token.canvas.width / dpr / 2,
        counter.y - token.canvas.height / dpr / 2,
        token.canvas.width / dpr,
        token.canvas.height / dpr,
      );
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      const selected = game.selectedStack?.regionId === region.id && game.selectedStack.key === counter.slot.key;
      const unmoved = game.isUnmoved(region.id, entry);
      if (selected || unmoved) {
        ctx.beginPath();
        ctx.arc(counter.x, counter.y, TOKEN_PX / 2 + 3, 0, Math.PI * 2);
        ctx.lineWidth = selected ? 3 : 1.5;
        ctx.strokeStyle = selected ? SELECTED_COLOR : "rgba(244, 241, 234, 0.9)";
        ctx.setLineDash(selected ? [] : [4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (entry.count > 1) {
        const bx = counter.x + TOKEN_PX * 0.42;
        const by = counter.y + TOKEN_PX * 0.42;
        ctx.beginPath();
        ctx.arc(bx, by, 10, 0, Math.PI * 2);
        ctx.fillStyle = INK;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = PAPER;
        ctx.stroke();
        ctx.fillStyle = PAPER;
        ctx.font = `700 12px ${MONO}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(entry.count), bx, by + 0.5);
      }
    }

    const combat = markers.get(region.id);
    if (combat !== undefined) {
      const cy = anchor.y + layout.halfHeight + 18;
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

export interface EditorOverlay {
  regions: RegionShape[];
  paths: Map<string, Path2D>;
  links: { a: Vec2; b: Vec2; kind: EditorLinkKind }[];
  selectedId: string;
  linkFirstId: string;
  draft: Vec2[];
  drawSea: boolean;
  cursor: { point: Vec2; kind: "vertex" | "edge" | "free" } | null;
  /** The cursor is near enough to the draft's first vertex to close it. */
  closing: boolean;
  tool: "select" | "draw" | "link";
}

export function drawEditorOverlay(ctx: CanvasRenderingContext2D, scene: TerrainScene, editor: EditorOverlay): void {
  const { view, dpr } = scene;
  const px = 1 / view.k;

  // Full rough outlines (including the parts the land mask hides) so the slicing is visible.
  setWorldTransform(ctx, view, dpr);
  ctx.lineJoin = "round";
  ctx.lineWidth = px;
  ctx.setLineDash([2 * px, 3 * px]);
  ctx.strokeStyle = "rgba(26, 26, 24, 0.55)";
  for (const region of editor.regions) {
    const path = editor.paths.get(region.id);
    if (path) {
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

  if (editor.linkFirstId !== "") {
    const region = editor.regions.find((r) => r.id === editor.linkFirstId);
    if (region) {
      const a = S(region.anchor);
      ctx.beginPath();
      ctx.arc(a.x, a.y, 11, 0, Math.PI * 2);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#e0a000";
      ctx.stroke();
    }
  }

  // Handles on the selected region: vertices, and the anchor you can drag.
  const selected = editor.regions.find((r) => r.id === editor.selectedId);
  if (selected && editor.tool !== "draw") {
    for (const v of selected.points) {
      const p = S(v);
      ctx.fillStyle = PAPER;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.5;
      ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
      ctx.strokeRect(p.x - 4, p.y - 4, 8, 8);
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
    ctx.strokeStyle = "#e0a000";
    ctx.stroke();
  }

  // The polygon being drawn.
  if (editor.draft.length > 0) {
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
      ctx.fillStyle = i === 0 ? "#e0a000" : PAPER;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = color;
      ctx.stroke();
    });
  }

  // Snap indicator.
  if (editor.cursor && editor.tool === "draw") {
    const c = S(editor.cursor.point);
    ctx.beginPath();
    ctx.arc(c.x, c.y, editor.cursor.kind === "free" ? 3 : 7, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = editor.cursor.kind === "vertex" ? "#2e8b3e" : editor.cursor.kind === "edge" ? "#e07a00" : INK;
    ctx.stroke();
  }
}

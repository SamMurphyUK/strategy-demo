// Map geometry for the playground renderer. Ports the drawing rules of
// scenes/game_map_root.gd and scripts/unit_layout.gd. No DOM: tests run it under
// the engine tsconfig.
import type { Dict } from "../../engine/model/types";

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface RegionShape {
  id: string;
  type: "land" | "sea";
  ipc: number;
  hasFactory: boolean;
  points: Vec2[];
  bounds: Rect;
  centroid: Vec2;
  /** Where unit icons are laid out around. */
  anchor: Vec2;
}

export interface MapGeometry {
  /** `res://` path of the base map texture, or "" when the map has none. */
  baseMap: string;
  regions: RegionShape[];
  /** Union of all region bounds. */
  bounds: Rect;
}

export const UNIT_ICON_SIZE = 48;
export const ICON_SPACING: Vec2 = { x: 36, y: 36 };
export const FACTORY_OFFSET: Vec2 = { x: 0, y: -28 };
export const IPC_LABEL_FONT_SIZE = 16;
export const SELECTED_OUTLINE: Rgba = { r: 1, g: 1, b: 0, a: 0.8 };
export const SELECTED_OUTLINE_WIDTH = 4;
const REACHABLE_HIGHLIGHT: Rgba = { r: 0.95, g: 0.15, b: 0.12, a: 0.55 };

export function buildMapGeometry(mapJson: Dict): MapGeometry {
  const regions: RegionShape[] = [];
  const rawRegions: unknown[] = Array.isArray(mapJson.regions) ? mapJson.regions : [];
  for (const raw of rawRegions) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const regionDict = raw as Dict;
    const meta: Dict = regionDict.metadata ?? {};
    const id = String(meta.region_id ?? "");
    if (id === "") {
      continue;
    }
    const ipc = Math.trunc(Number(meta.ipc ?? 0));
    const points = polygonPoints(regionDict.polygon ?? []);
    const bounds = polygonBounds(points);
    regions.push({
      id,
      type: inferRegionType(id, meta, ipc),
      ipc,
      hasFactory: Boolean(meta.factory ?? false),
      points,
      bounds,
      centroid: polygonCentroid(points),
      anchor: unitAnchor(regionDict, points, bounds),
    });
  }
  return {
    baseMap: String(mapJson.base_map ?? ""),
    regions,
    bounds: unionBounds(regions.map((r) => r.bounds)),
  };
}

/** game_map_root._infer_region_type. Differs from the session builder: no-IPC, no-factory regions draw as sea. */
export function inferRegionType(regionId: string, meta: Dict, ipc: number): "land" | "sea" {
  const explicit = String(meta.type ?? meta.region_type ?? "").toLowerCase();
  if (explicit === "land" || explicit === "sea") {
    return explicit;
  }
  const lower = regionId.toLowerCase();
  if (lower.includes("sea zone") || lower.startsWith("sea ")) {
    return "sea";
  }
  if (ipc <= 0 && !meta.factory) {
    return "sea";
  }
  return "land";
}

/** Sprite2D with centered = true at position (0, 1): the image centre sits on the map origin. */
export function baseMapRect(width: number, height: number): Rect {
  return { x: -width / 2, y: -height / 2 + 1, w: width, h: height };
}

export function polygonPath(points: Vec2[]): string {
  if (points.length === 0) {
    return "";
  }
  return `M${points.map((p) => `${p.x} ${p.y}`).join(" L")} Z`;
}

/** Geometry2D.is_point_in_polygon (even-odd). */
export function pointInPolygon(p: Vec2, points: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function regionAtPoint(map: MapGeometry, p: Vec2): string {
  for (const region of map.regions) {
    if (pointInPolygon(p, region.points)) {
      return region.id;
    }
  }
  return "";
}

// ---------------------------------------------------------------
// Unit layout (scripts/unit_layout.gd)
// ---------------------------------------------------------------

export function layoutPositions(count: number, spacing: Vec2 = ICON_SPACING): Vec2[] {
  const positions: Vec2[] = [];
  if (count <= 0) {
    return positions;
  }
  let cols: number;
  let rows: number;
  if (count <= 3) {
    cols = count;
    rows = 1;
  } else if (count <= 6) {
    cols = 3;
    rows = 2;
  } else {
    cols = 3;
    rows = 3;
  }
  const startX = -((cols - 1) * spacing.x) * 0.5;
  const startY = -((rows - 1) * spacing.y) * 0.5;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (positions.length >= count) {
        return positions;
      }
      positions.push({ x: startX + col * spacing.x, y: startY + row * spacing.y });
    }
  }
  return positions;
}

/** Godot clampf is min(max(x, lo), hi), so an inner rect with negative size pins to its far edge. */
export function clampPositionsToBounds(positions: Vec2[], anchor: Vec2, bounds: Rect, margin = 20): Vec2[] {
  if (bounds.w === 0 && bounds.h === 0) {
    return positions;
  }
  const lo = { x: bounds.x + margin, y: bounds.y + margin };
  const hi = { x: bounds.x + bounds.w - margin, y: bounds.y + bounds.h - margin };
  return positions.map((offset) => {
    const wx = Math.min(Math.max(anchor.x + offset.x, lo.x), hi.x);
    const wy = Math.min(Math.max(anchor.y + offset.y, lo.y), hi.y);
    return { x: wx - anchor.x, y: wy - anchor.y };
  });
}

export interface StackEntry {
  unit_type_id: string;
  faction_id: string;
  count: number;
  instance_id?: string;
}

export interface PlacedStack {
  key: string;
  entry: StackEntry;
  position: Vec2;
}

/** UnitVisualizer.update_region_units: one slot per type|faction[|instance], sorted by key. */
export function layoutRegionStacks(region: RegionShape, entries: StackEntry[]): PlacedStack[] {
  const byKey = new Map<string, StackEntry>();
  for (const entry of entries) {
    const key = stackKey(entry);
    if (!byKey.has(key)) {
      byKey.set(key, entry);
    }
  }
  const keys = [...byKey.keys()].sort();
  const slots = clampPositionsToBounds(layoutPositions(keys.length), region.anchor, region.bounds);
  return keys.map((key, i) => ({
    key,
    entry: byKey.get(key)!,
    position: { x: region.anchor.x + slots[i].x, y: region.anchor.y + slots[i].y },
  }));
}

/** Screen-pixel gap between unit counters in a region's stack. Counters are drawn at a fixed pixel size. */
export const STACK_SPACING_PX: Vec2 = { x: 46, y: 40 };

export interface StackSlot {
  key: string;
  entry: StackEntry;
  /** Offset from the region's anchor, in screen pixels. */
  offset: Vec2;
}

/** Same slot order as layoutRegionStacks, but offsets are screen pixels so counters never overlap when zoomed out. */
export function layoutStackSlots(entries: StackEntry[]): StackSlot[] {
  const byKey = new Map<string, StackEntry>();
  for (const entry of entries) {
    const key = stackKey(entry);
    if (!byKey.has(key)) {
      byKey.set(key, entry);
    }
  }
  const keys = [...byKey.keys()].sort();
  const offsets = layoutPositions(keys.length, STACK_SPACING_PX);
  return keys.map((key, i) => ({ key, entry: byKey.get(key)!, offset: offsets[i] }));
}

export function stackKey(entry: StackEntry): string {
  const base = `${entry.unit_type_id}|${entry.faction_id}`;
  return entry.instance_id ? `${base}|${entry.instance_id}` : base;
}

// ---------------------------------------------------------------
// Fills (game_map_root._owner_color and the highlight passes)
// ---------------------------------------------------------------

export function ownerFill(owner: string): Rgba {
  switch (owner.toLowerCase()) {
    case "allies":
      return { r: 0.5, g: 0.85, b: 0.5, a: 0.5 };
    case "axis":
      return { r: 0.6, g: 0.6, b: 0.6, a: 0.5 };
    default:
      return { r: 0.5, g: 0.5, b: 0.5, a: 0.35 };
  }
}

export type HighlightMode =
  | { kind: "none" }
  | { kind: "move"; from: string; legal: string[]; hover: string }
  | { kind: "mobilize"; legal: string[]; hover: string };

export function regionFill(regionId: string, owner: string, mode: HighlightMode): Rgba {
  const base = ownerFill(owner);
  if (mode.kind === "move") {
    if (regionId === mode.from) {
      return lightened(base, 0.12);
    }
    if (mode.legal.includes(regionId)) {
      return { ...REACHABLE_HIGHLIGHT, a: regionId === mode.hover ? 0.68 : 0.52 };
    }
    return dimmed(base);
  }
  if (mode.kind === "mobilize") {
    if (mode.legal.includes(regionId)) {
      return { ...base, a: regionId === mode.hover ? 0.62 : 0.45 };
    }
    return dimmed(base);
  }
  return base;
}

export function toCss(c: Rgba): string {
  const ch = (v: number) => Math.round(Math.min(Math.max(v, 0), 1) * 255);
  return `rgba(${ch(c.r)}, ${ch(c.g)}, ${ch(c.b)}, ${Math.round(c.a * 1000) / 1000})`;
}

function lightened(c: Rgba, amount: number): Rgba {
  return {
    r: c.r + (1 - c.r) * amount,
    g: c.g + (1 - c.g) * amount,
    b: c.b + (1 - c.b) * amount,
    a: c.a,
  };
}

function dimmed(c: Rgba): Rgba {
  return { r: c.r * 0.55, g: c.g * 0.55, b: c.b * 0.55, a: 0.18 };
}

// ---------------------------------------------------------------
// Polygon helpers
// ---------------------------------------------------------------

function polygonPoints(raw: unknown[]): Vec2[] {
  const points: Vec2[] = [];
  for (const p of raw) {
    if (Array.isArray(p) && p.length >= 2) {
      points.push({ x: Number(p[0]), y: Number(p[1]) });
    }
  }
  return points;
}

function polygonBounds(points: Vec2[]): Rect {
  if (points.length === 0) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = minX;
  let maxY = minY;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Vertex average, as _polygon_centroid does. Not the area centroid. */
function polygonCentroid(points: Vec2[]): Vec2 {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / points.length, y: sy / points.length };
}

function unitAnchor(regionDict: Dict, points: Vec2[], bounds: Rect): Vec2 {
  const anchors: unknown[] = Array.isArray(regionDict.anchors) ? regionDict.anchors : [];
  for (const a of anchors) {
    if (typeof a === "object" && a !== null && String((a as Dict).type ?? "") === "unit") {
      const anchor = { x: Number((a as Dict).x ?? 0), y: Number((a as Dict).y ?? 0) };
      if (anchor.x !== 0 || anchor.y !== 0) {
        return anchor;
      }
      break;
    }
  }
  if (bounds.w !== 0 || bounds.h !== 0) {
    return { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 - 10 };
  }
  const c = polygonCentroid(points);
  return { x: c.x, y: c.y - 10 };
}

function unionBounds(rects: Rect[]): Rect {
  if (rects.length === 0) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

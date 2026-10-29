// The map editor's data model and edit operations. Pure and immutable: every operation returns a new
// EditorMap, which is what makes undo a stack of snapshots.
import type { Dict } from "../../../engine/model/types";
import { buildMapGeometry, type MapGeometry, pointInPolygon, type Vec2 } from "../geometry";
import { WORLD_COORD_SPACE } from "../map_space";
import type { RegionClipper } from "../regionClip";
import { type Pair, sharedVertexCount } from "./adjacency";

export type { Pair };
export type LinkKind = "land" | "sea" | "coastal";

/** Starting owners as demomap01.json spells them (`metadata.faction`). */
export const OWNER_OPTIONS = ["Neutral", "USSR", "UK", "USA", "GER", "JAP"] as const;

export const LAND_SVG_REF = "assets/ne_110m_land_adjsut.svg";
const DEFAULT_ANCHOR_CAPACITY = 5;
/** Two vertices closer than this are the same vertex. Snapped borders are exact; hand-drawn ones are not. */
export const SAME_VERTEX_EPS = 0.75;
/** A point this close to an edge counts as lying on it (for welding T-junctions). */
const ON_EDGE_EPS = 0.05;

export interface EditorRegion {
  id: string;
  name: string;
  ipc_value: number;
  starting_owner: string;
  is_sea: boolean;
  factory: boolean;
  capital: boolean;
  polygon: Vec2[];
  /** Unit stack anchor, also where the region's links attach. */
  cx: number;
  cy: number;
}

export interface EditorMap {
  regions: EditorRegion[];
  /** Active neighbor links, each pair sorted. This is the truth; `neighbors` arrays are derived from it. */
  links: Pair[];
  /** Links the last "Calculate Neighbors" run produced. Manual edits are stored against it. */
  auto: Pair[];
  overrides: { add: Pair[]; remove: Pair[] };
  /** Top-level keys of the source file to carry through (version, faction_colors, ...). */
  meta: Dict;
}

// ---------------------------------------------------------------
// Pairs and links
// ---------------------------------------------------------------

export function pairOf(a: string, b: string): Pair {
  return a < b ? [a, b] : [b, a];
}

const pairKey = (p: Pair) => `${p[0]}\u001f${p[1]}`;

function withoutPair(list: Pair[], p: Pair): Pair[] {
  const key = pairKey(p);
  return list.filter((q) => pairKey(q) !== key);
}

function hasPair(list: Pair[], p: Pair): boolean {
  const key = pairKey(p);
  return list.some((q) => pairKey(q) === key);
}

export function isLinked(map: EditorMap, a: string, b: string): boolean {
  return hasPair(map.links, pairOf(a, b));
}

export function findRegion(map: EditorMap, id: string): EditorRegion | undefined {
  return map.regions.find((r) => r.id === id);
}

export function linkKind(map: EditorMap, a: string, b: string): LinkKind {
  const ra = findRegion(map, a);
  const rb = findRegion(map, b);
  if (!ra || !rb || ra.is_sea !== rb.is_sea) {
    return "coastal";
  }
  return ra.is_sea ? "sea" : "land";
}

export function neighborsOf(map: EditorMap, id: string): string[] {
  const out: string[] = [];
  for (const r of map.regions) {
    if (r.id !== id && isLinked(map, id, r.id)) {
      out.push(r.id);
    }
  }
  return out;
}

/** Flips one link and records it as an override when it differs from what the auto-calculation says. */
export function toggleLink(map: EditorMap, a: string, b: string): EditorMap {
  if (a === b || !findRegion(map, a) || !findRegion(map, b)) {
    return map;
  }
  const pair = pairOf(a, b);
  const target = !hasPair(map.links, pair);
  const autoHas = hasPair(map.auto, pair);
  let add = withoutPair(map.overrides.add, pair);
  let remove = withoutPair(map.overrides.remove, pair);
  if (target !== autoHas) {
    if (target) {
      add = [...add, pair];
    } else {
      remove = [...remove, pair];
    }
  }
  return {
    ...map,
    links: target ? [...map.links, pair] : withoutPair(map.links, pair),
    overrides: { add, remove },
  };
}

/** Replaces the auto set and re-applies the manual overrides on top of it. */
export function applyAutoLinks(map: EditorMap, auto: Pair[]): EditorMap {
  const ids = new Set(map.regions.map((r) => r.id));
  const valid = (p: Pair) => ids.has(p[0]) && ids.has(p[1]);
  const add = map.overrides.add.filter(valid);
  const remove = map.overrides.remove.filter(valid);
  let links = auto.filter(valid);
  for (const p of remove) {
    links = withoutPair(links, p);
  }
  for (const p of add) {
    if (!hasPair(links, p)) {
      links = [...links, p];
    }
  }
  return { ...map, auto: auto.filter(valid), links, overrides: { add, remove } };
}

// ---------------------------------------------------------------
// Region operations
// ---------------------------------------------------------------

export function updateRegion(map: EditorMap, id: string, patch: Partial<EditorRegion>): EditorMap {
  return { ...map, regions: map.regions.map((r) => (r.id === id ? { ...r, ...patch } : r)) };
}

export function renameRegion(map: EditorMap, oldId: string, newId: string): EditorMap | { error: string } {
  const id = newId.trim();
  if (id === "") {
    return { error: "Id cannot be empty." };
  }
  if (id !== oldId && findRegion(map, id)) {
    return { error: `"${id}" is already used.` };
  }
  if (id === oldId) {
    return map;
  }
  const rename = (p: Pair): Pair => pairOf(p[0] === oldId ? id : p[0], p[1] === oldId ? id : p[1]);
  return {
    ...map,
    regions: map.regions.map((r) => (r.id === oldId ? { ...r, id, name: r.name === oldId ? id : r.name } : r)),
    links: map.links.map(rename),
    auto: map.auto.map(rename),
    overrides: { add: map.overrides.add.map(rename), remove: map.overrides.remove.map(rename) },
  };
}

export function deleteRegion(map: EditorMap, id: string): EditorMap {
  const keep = (p: Pair) => p[0] !== id && p[1] !== id;
  return {
    ...map,
    regions: map.regions.filter((r) => r.id !== id),
    links: map.links.filter(keep),
    auto: map.auto.filter(keep),
    overrides: { add: map.overrides.add.filter(keep), remove: map.overrides.remove.filter(keep) },
  };
}

export function nextRegionId(map: EditorMap, sea: boolean): string {
  const taken = new Set(map.regions.map((r) => r.id));
  for (let n = 1; ; n++) {
    const id = sea ? `Sea Zone ${String(n).padStart(2, "0")}` : `Territory ${n}`;
    if (!taken.has(id)) {
      return id;
    }
  }
}

/** Adds a drawn polygon as a new region and welds its borders to whatever it touches. */
export function addRegionFromPolygon(map: EditorMap, polygon: Vec2[], sea: boolean): { map: EditorMap; id: string } {
  const id = nextRegionId(map, sea);
  const label = labelPoint(polygon);
  const region: EditorRegion = {
    id,
    name: id,
    ipc_value: sea ? 0 : 1,
    starting_owner: "Neutral",
    is_sea: sea,
    factory: false,
    capital: false,
    polygon: polygon.map((p) => ({ ...p })),
    cx: label.x,
    cy: label.y,
  };
  return { map: weldRegion({ ...map, regions: [...map.regions, region] }, id), id };
}

// ---------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function nearestOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { point: { x: a.x + dx * t, y: a.y + dy * t }, t };
}

export function polygonAreaCentroid(poly: Vec2[]): Vec2 | null {
  let area2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const cross = poly[j].x * poly[i].y - poly[i].x * poly[j].y;
    area2 += cross;
    cx += (poly[j].x + poly[i].x) * cross;
    cy += (poly[j].y + poly[i].y) * cross;
  }
  if (Math.abs(area2) < 1e-9) {
    return null;
  }
  return { x: cx / (3 * area2), y: cy / (3 * area2) };
}

/** A point inside the polygon, near its middle: the area centroid, or the widest span through it for concave shapes. */
export function labelPoint(poly: Vec2[]): Vec2 {
  if (poly.length === 0) {
    return { x: 0, y: 0 };
  }
  const centroid = polygonAreaCentroid(poly);
  if (centroid && pointInPolygon(centroid, poly)) {
    return centroid;
  }
  const y = centroid?.y ?? poly[0].y;
  const xs: number[] = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > y !== b.y > y) {
      xs.push(((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x);
    }
  }
  xs.sort((m, n) => m - n);
  let best: Vec2 | null = null;
  let bestWidth = -1;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (xs[i + 1] - xs[i] > bestWidth) {
      bestWidth = xs[i + 1] - xs[i];
      best = { x: (xs[i] + xs[i + 1]) / 2, y };
    }
  }
  if (best) {
    return best;
  }
  const n = poly.length;
  return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
}

// ---------------------------------------------------------------
// Snapping and welding
// ---------------------------------------------------------------

export interface Snap {
  point: Vec2;
  kind: "vertex" | "edge" | "free";
  regionId?: string;
  /** Vertex index for "vertex"; the edge's start index for "edge". */
  index?: number;
}

/**
 * Snaps to the nearest existing vertex within `tol` world units, otherwise to the nearest point on any
 * edge within `tol`, otherwise leaves the point alone. `skip` hides vertices (and the edges touching
 * them) from the search, so a dragged vertex does not snap to itself.
 */
export function snapPoint(
  p: Vec2,
  regions: { id: string; polygon: Vec2[] }[],
  tol: number,
  skip: (regionId: string, index: number) => boolean = () => false,
): Snap {
  let bestVertex: Snap | null = null;
  let bestVertexDist = tol;
  for (const r of regions) {
    r.polygon.forEach((v, i) => {
      if (skip(r.id, i)) {
        return;
      }
      const d = dist(p, v);
      if (d <= bestVertexDist) {
        bestVertexDist = d;
        bestVertex = { point: { ...v }, kind: "vertex", regionId: r.id, index: i };
      }
    });
  }
  if (bestVertex) {
    return bestVertex;
  }
  let bestEdge: Snap | null = null;
  let bestEdgeDist = tol;
  for (const r of regions) {
    const n = r.polygon.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (n < 2 || skip(r.id, i) || skip(r.id, j)) {
        continue;
      }
      const hit = nearestOnSegment(p, r.polygon[i], r.polygon[j]);
      const d = dist(p, hit.point);
      if (d <= bestEdgeDist) {
        bestEdgeDist = d;
        bestEdge = { point: hit.point, kind: "edge", regionId: r.id, index: i };
      }
    }
  }
  return bestEdge ?? { point: { ...p }, kind: "free" };
}

/** Inserts each point into the polygon where it lies on an edge (and is not already a vertex). */
export function insertOnEdges(poly: Vec2[], points: Vec2[], eps = ON_EDGE_EPS): Vec2[] {
  let out = poly;
  for (const pt of points) {
    if (out.some((v) => dist(v, pt) <= eps)) {
      continue;
    }
    for (let i = 0; i < out.length; i++) {
      const j = (i + 1) % out.length;
      if (dist(nearestOnSegment(pt, out[i], out[j]).point, pt) <= eps) {
        out = [...out.slice(0, i + 1), { ...pt }, ...out.slice(i + 1)];
        break;
      }
    }
  }
  return out;
}

/**
 * Makes borders drawn against each other share real vertices. A vertex that sits on another region's
 * edge (an edge snap) is added to that region as well, so both polygons list it.
 */
export function weldRegion(map: EditorMap, id: string): EditorMap {
  const target = findRegion(map, id);
  if (!target) {
    return map;
  }
  let polygon = target.polygon;
  const regions = map.regions.map((other) => {
    if (other.id === id) {
      return other;
    }
    const intoOther = insertOnEdges(other.polygon, polygon);
    polygon = insertOnEdges(polygon, other.polygon);
    return intoOther === other.polygon ? other : { ...other, polygon: intoOther };
  });
  return { ...map, regions: regions.map((r) => (r.id === id ? { ...r, polygon } : r)) };
}

export interface VertexRef {
  regionId: string;
  index: number;
}

/** Every vertex (this one included) sitting on the same spot, so a shared border moves as one. */
export function coincidentVertices(map: EditorMap, regionId: string, index: number, eps = SAME_VERTEX_EPS): VertexRef[] {
  const origin = findRegion(map, regionId)?.polygon[index];
  if (!origin) {
    return [];
  }
  const refs: VertexRef[] = [{ regionId, index }];
  for (const r of map.regions) {
    r.polygon.forEach((v, i) => {
      if (!(r.id === regionId && i === index) && dist(v, origin) <= eps) {
        refs.push({ regionId: r.id, index: i });
      }
    });
  }
  return refs;
}

export function moveVertices(map: EditorMap, refs: VertexRef[], to: Vec2): EditorMap {
  return {
    ...map,
    regions: map.regions.map((r) => {
      const mine = refs.filter((ref) => ref.regionId === r.id);
      if (mine.length === 0) {
        return r;
      }
      const polygon = r.polygon.map((v, i) => (mine.some((m) => m.index === i) ? { ...to } : v));
      return { ...r, polygon };
    }),
  };
}

// ---------------------------------------------------------------
// Import / export (demomap01.json)
// ---------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;

function polygonOf(raw: unknown): Vec2[] {
  const out: Vec2[] = [];
  if (Array.isArray(raw)) {
    for (const p of raw) {
      if (Array.isArray(p) && p.length >= 2) {
        out.push({ x: Number(p[0]), y: Number(p[1]) });
      }
    }
  }
  return out;
}

function pairsOf(raw: unknown): Pair[] {
  const out: Pair[] = [];
  if (Array.isArray(raw)) {
    for (const p of raw) {
      if (Array.isArray(p) && p.length >= 2) {
        out.push(pairOf(String(p[0]), String(p[1])));
      }
    }
  }
  return out;
}

function uniquePairs(list: Pair[]): Pair[] {
  const seen = new Set<string>();
  return list.filter((p) => {
    const key = pairKey(p);
    if (seen.has(key) || p[0] === p[1]) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/** `mapJson` must already be in world space (see projectMapJson). */
export function editorFromMapJson(mapJson: Dict): EditorMap {
  const regions: EditorRegion[] = [];
  const rawRegions: Dict[] = Array.isArray(mapJson.regions) ? mapJson.regions : [];
  const explicitNeighbors = rawRegions.some((r) => Array.isArray(r.neighbors));
  const geometry = buildMapGeometry(mapJson);
  for (const raw of rawRegions) {
    const meta: Dict = raw.metadata ?? {};
    const id = String(meta.region_id ?? "");
    const shape = geometry.regions.find((r) => r.id === id);
    if (id === "" || !shape) {
      continue;
    }
    regions.push({
      id,
      name: String(meta.name ?? id),
      ipc_value: Math.trunc(Number(meta.ipc ?? 0)),
      starting_owner: String(meta.faction ?? "Neutral") || "Neutral",
      is_sea: shape.type === "sea",
      factory: Boolean(meta.factory ?? false),
      capital: Boolean(meta.victory ?? false),
      polygon: polygonOf(raw.polygon),
      cx: shape.anchor.x,
      cy: shape.anchor.y,
    });
  }

  let links: Pair[] = [];
  let auto: Pair[] = [];
  let overrides: EditorMap["overrides"] = { add: [], remove: [] };
  if (explicitNeighbors) {
    for (const raw of rawRegions) {
      const id = String((raw.metadata ?? {}).region_id ?? "");
      for (const n of Array.isArray(raw.neighbors) ? raw.neighbors : []) {
        links.push(pairOf(id, String(n)));
      }
    }
    links = uniquePairs(links);
    const o: Dict = mapJson.neighbor_overrides ?? {};
    overrides = { add: pairsOf(o.add), remove: pairsOf(o.remove) };
    auto = uniquePairs([...links.filter((p) => !hasPair(overrides.add, p)), ...overrides.remove]);
  } else {
    // A file without explicit neighbors gets what the engine derives from it: two shared vertices.
    for (let i = 0; i < regions.length; i++) {
      for (let j = i + 1; j < regions.length; j++) {
        if (sharedVertexCount(regions[i].polygon, regions[j].polygon, SAME_VERTEX_EPS * 2) >= 2) {
          links.push(pairOf(regions[i].id, regions[j].id));
        }
      }
    }
    auto = links;
  }

  const { regions: _r, ...meta } = mapJson;
  const { neighbor_overrides: _o, ...rest } = meta;
  return { regions, links, auto, overrides, meta: rest };
}

export interface ExportOptions {
  /** Round coordinates to 2 decimals. On for files, off while editing so snapping stays exact. */
  round: boolean;
  /**
   * When given, every region also exports `clipped_polygon`: its cutter boolean-clipped against the land SVG,
   * as a GeoJSON-style MultiPolygon ([polygon][ring][x, y]). This is what the map draws and selects.
   * It is derived data, so loading ignores it and the editor never autosaves it.
   */
  clipper?: RegionClipper;
}

export function editorToMapJson(map: EditorMap, options: ExportOptions = { round: true }): Dict {
  const r = options.round ? round2 : (n: number) => n;
  const clipped = (region: EditorRegion): Dict =>
    options.clipper
      ? {
          clipped_polygon: options.clipper
            .clip({ id: region.id, type: region.is_sea ? "sea" : "land", points: region.polygon })
            .map((polygon) => polygon.map((ring) => ring.map(([x, y]) => [r(x), r(y)]))),
        }
      : {};
  return {
    ...map.meta,
    version: map.meta.version ?? 2,
    base_map: "",
    coord_space: WORLD_COORD_SPACE,
    land_mask: LAND_SVG_REF,
    neighbor_overrides: {
      add: map.overrides.add.map((p) => [...p]),
      remove: map.overrides.remove.map((p) => [...p]),
    },
    regions: map.regions.map((region) => ({
      anchors: [{ capacity: DEFAULT_ANCHOR_CAPACITY, type: "unit", x: r(region.cx), y: r(region.cy) }],
      metadata: {
        region_id: region.id,
        name: region.name,
        faction: region.starting_owner,
        factory: region.factory,
        ipc: region.ipc_value,
        victory: region.capital,
        type: region.is_sea ? "sea" : "land",
        is_sea: region.is_sea,
      },
      polygon: region.polygon.map((p) => [r(p.x), r(p.y)]),
      ...clipped(region),
      neighbors: neighborsOf(map, region.id),
    })),
  };
}

/** Pretty JSON with each coordinate pair on one line, so a polygon stays readable. */
export function formatMapJson(json: Dict): string {
  return JSON.stringify(json, null, 2).replace(/\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]/g, "[$1, $2]");
}

export function editorToGeometry(map: EditorMap): MapGeometry {
  return buildMapGeometry(editorToMapJson(map, { round: false }));
}

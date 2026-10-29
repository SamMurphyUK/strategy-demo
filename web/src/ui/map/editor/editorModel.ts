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
export const OWNER_OPTIONS = ["GER", "USSR", "UK", "USA", "JAP", "Neutral"] as const;

export const LAND_SVG_REF = "assets/ne_110m_land_FINAL.svg";
const DEFAULT_ANCHOR_CAPACITY = 5;
/** Two vertices closer than this are the same vertex. Snapped borders are exact; hand-drawn ones are not. */
export const SAME_VERTEX_EPS = 0.75;
/** Dragging a vertex moves every same-layer region's vertex within this many world units of it. */
export const TOPO_LOCK_EPS = 2;

/** `none` has no factory. The engine only needs to know there is one; minor and major are for the map's author. */
export type FactoryLevel = "none" | "minor" | "major";
export const FACTORY_LEVELS: readonly FactoryLevel[] = ["none", "minor", "major"];

/** One line of the scenario's `starting_units`. */
export interface StartingUnit {
  region_id: string;
  faction_id: string;
  unit_type_id: string;
  count: number;
}

export const UNIT_TYPE_OPTIONS = [
  "infantry",
  "artillery",
  "tank",
  "fighter",
  "battleship",
  "cruiser",
  "destroyer",
  "submarine",
  "carrier",
  "transport",
] as const;

export const UNIT_FACTION_OPTIONS = ["ussr", "ger", "uk", "jap", "usa", "neutral"] as const;
/** A point this close to an edge counts as lying on it (for welding T-junctions). */
const ON_EDGE_EPS = 0.05;

export interface EditorRegion {
  id: string;
  name: string;
  ipc_value: number;
  starting_owner: string;
  is_sea: boolean;
  factory: FactoryLevel;
  capital: boolean;
  polygon: Vec2[];
  /**
   * The other islands of a multi-island territory (Japan, the Philippines): disjoint outlines that share this
   * region's id, IPC value and anchor. `polygon` is the largest one. They are not editable with the vertex tool.
   */
  extra?: Vec2[][];
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

// ---------------------------------------------------------------
// Starting units (the scenario's top-level `starting_units`, carried in `meta`)
// ---------------------------------------------------------------

function unitList(meta: Dict): StartingUnit[] {
  return Array.isArray(meta.starting_units) ? meta.starting_units : [];
}

function mapStartingUnits(meta: Dict, fn: (u: StartingUnit) => StartingUnit): Dict {
  return Array.isArray(meta.starting_units) ? { ...meta, starting_units: unitList(meta).map(fn) } : meta;
}

function dropStartingUnits(meta: Dict, regionId: string): Dict {
  return Array.isArray(meta.starting_units)
    ? { ...meta, starting_units: unitList(meta).filter((u) => u.region_id !== regionId) }
    : meta;
}

export function startingUnitsOf(map: EditorMap, regionId: string): StartingUnit[] {
  return unitList(map.meta).filter((u) => u.region_id === regionId);
}

/** Replaces one region's starting units. Rows keep their place in the file; the region's block is rewritten in order. */
export function setStartingUnits(map: EditorMap, regionId: string, rows: Omit<StartingUnit, "region_id">[]): EditorMap {
  const clean = rows
    .filter((r) => r.unit_type_id !== "" && Math.trunc(r.count) > 0)
    .map((r) => ({ region_id: regionId, faction_id: r.faction_id, unit_type_id: r.unit_type_id, count: Math.trunc(r.count) }));
  const all = unitList(map.meta);
  const at = all.findIndex((u) => u.region_id === regionId);
  const rest = all.filter((u) => u.region_id !== regionId);
  const insertAt = at < 0 ? rest.length : Math.min(at, rest.length);
  return { ...map, meta: { ...map.meta, starting_units: [...rest.slice(0, insertAt), ...clean, ...rest.slice(insertAt)] } };
}

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
    meta: mapStartingUnits(map.meta, (u) => (u.region_id === oldId ? { ...u, region_id: id } : u)),
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
    meta: dropStartingUnits(map.meta, id),
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
    factory: "none",
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

/** Vertices this close are stacked on one spot, whatever the lock radius is. */
const STACKED_EPS = 0.01;

/**
 * Every vertex that moves with this one, so a shared border moves as one. That is this vertex, plus in
 * each region of the same layer (sea or land) the vertex nearest to it within `eps`. Taking only the
 * nearest keeps a stepped border from collapsing when its steps are closer together than `eps`. Vertices
 * stacked exactly on the spot always come along, in this region too.
 */
export function coincidentVertices(map: EditorMap, regionId: string, index: number, eps = SAME_VERTEX_EPS): VertexRef[] {
  const source = findRegion(map, regionId);
  const origin = source?.polygon[index];
  if (!source || !origin) {
    return [];
  }
  const refs: VertexRef[] = [{ regionId, index }];
  for (const r of map.regions) {
    if (r.is_sea !== source.is_sea) {
      continue;
    }
    let nearest = -1;
    let nearestDist = eps;
    let stacked = false;
    r.polygon.forEach((v, i) => {
      if (r.id === regionId && i === index) {
        return;
      }
      const d = dist(v, origin);
      if (d <= STACKED_EPS) {
        refs.push({ regionId: r.id, index: i });
        stacked = true;
      } else if (r.id !== regionId && d <= nearestDist) {
        nearestDist = d;
        nearest = i;
      }
    });
    if (nearest >= 0 && !stacked) {
      refs.push({ regionId: r.id, index: nearest });
    }
  }
  return refs;
}

/**
 * Adds a vertex at the midpoint of edge `index` of the region (the edge from vertex `index` to the next),
 * and into every same-layer region whose outline passes through that point, so a shared border stays shared.
 */
export function subdivideEdge(map: EditorMap, regionId: string, index: number): { map: EditorMap; at: number } | null {
  const region = findRegion(map, regionId);
  if (!region || region.polygon.length < 2) {
    return null;
  }
  const a = region.polygon[index];
  const b = region.polygon[(index + 1) % region.polygon.length];
  if (!a || !b) {
    return null;
  }
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const regions = map.regions.map((r) => {
    if (r.is_sea !== region.is_sea) {
      return r;
    }
    if (r.id === regionId) {
      return { ...r, polygon: [...r.polygon.slice(0, index + 1), { ...mid }, ...r.polygon.slice(index + 1)] };
    }
    const polygon = insertOnEdges(r.polygon, [mid]);
    return polygon === r.polygon ? r : { ...r, polygon };
  });
  return { map: { ...map, regions }, at: index + 1 };
}

// ---------------------------------------------------------------
// Roughening shared borders
// ---------------------------------------------------------------

const MIN_ROUGHEN_LENGTH = 6;

/** Where in `polygon` the edge a-b sits (either direction): its start index and whether it runs b to a. */
function findEdge(polygon: Vec2[], a: Vec2, b: Vec2): { at: number; reversed: boolean } | null {
  const n = polygon.length;
  for (let k = 0; k < n && n >= 2; k++) {
    const p = polygon[k];
    const q = polygon[(k + 1) % n];
    if (dist(p, a) <= STACKED_EPS && dist(q, b) <= STACKED_EPS) {
      return { at: k, reversed: false };
    }
    if (dist(p, b) <= STACKED_EPS && dist(q, a) <= STACKED_EPS) {
      return { at: k, reversed: true };
    }
  }
  return null;
}

/** Ids of the other same-layer regions that list exactly this edge. */
export function edgeSharers(map: EditorMap, regionId: string, index: number): string[] {
  const region = findRegion(map, regionId);
  if (!region || region.polygon.length < 3) {
    return [];
  }
  const a = region.polygon[index];
  const b = region.polygon[(index + 1) % region.polygon.length];
  if (!a || !b) {
    return [];
  }
  return map.regions
    .filter((r) => r.id !== regionId && r.is_sea === region.is_sea && findEdge(r.polygon, a, b) !== null)
    .map((r) => r.id);
}

/** The edge of the region nearest `p` within `tol` that another region shares, as its start index, or -1. */
export function nearestSharedEdge(map: EditorMap, regionId: string, p: Vec2, tol: number, only = ""): number {
  const region = findRegion(map, regionId);
  if (!region) {
    return -1;
  }
  let best = -1;
  let bestDist = tol;
  const n = region.polygon.length;
  for (let i = 0; i < n; i++) {
    const d = dist(p, nearestOnSegment(p, region.polygon[i], region.polygon[(i + 1) % n]).point);
    if (d > bestDist) {
      continue;
    }
    const sharers = edgeSharers(map, regionId, i);
    if (sharers.length > 0 && (only === "" || sharers.includes(only))) {
      best = i;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Turns one straight shared edge into a winding wargame border of 5 to 7 new points. The same points go
 * into every region that shares the edge (in that region's own winding order), so no gap or overlap opens.
 * `rand` returns [0, 1); pass a seeded one for a repeatable result.
 */
export function roughenEdge(
  map: EditorMap,
  regionId: string,
  index: number,
  rand: () => number,
  minLength = MIN_ROUGHEN_LENGTH,
): { map: EditorMap; added: number } | null {
  const region = findRegion(map, regionId);
  if (!region || region.polygon.length < 3) {
    return null;
  }
  const a = region.polygon[index];
  const b = region.polygon[(index + 1) % region.polygon.length];
  if (!a || !b || dist(a, b) < minLength || edgeSharers(map, regionId, index).length === 0) {
    return null;
  }
  const len = dist(a, b);
  const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const normal = { x: -dir.y, y: dir.x };
  const count = 5 + Math.floor(rand() * 3);
  const amp = Math.min(len * 0.09, 8);
  const phase1 = rand() * Math.PI * 2;
  const phase2 = rand() * Math.PI * 2;
  const along: Vec2[] = [];
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1) + (rand() - 0.5) * (0.5 / (count + 1));
    const wiggle = 0.65 * Math.sin(phase1 + t * Math.PI * 2 * 1.4) + 0.35 * Math.sin(phase2 + t * Math.PI * 2 * 3.1);
    const off = Math.max(-amp, Math.min(amp, amp * wiggle * (0.75 + rand() * 0.5)));
    along.push({ x: a.x + dir.x * len * t + normal.x * off, y: a.y + dir.y * len * t + normal.y * off });
  }
  const insertInto = (polygon: Vec2[], at: number, reversed: boolean): Vec2[] => {
    const pts = (reversed ? [...along].reverse() : along).map((p) => ({ ...p }));
    return [...polygon.slice(0, at + 1), ...pts, ...polygon.slice(at + 1)];
  };
  const regions = map.regions.map((r) => {
    if (r.id === regionId) {
      return { ...r, polygon: insertInto(r.polygon, index, false) };
    }
    if (r.is_sea !== region.is_sea) {
      return r;
    }
    const hit = findEdge(r.polygon, a, b);
    return hit ? { ...r, polygon: insertInto(r.polygon, hit.at, hit.reversed) } : r;
  });
  return { map: { ...map, regions }, added: count };
}

// ---------------------------------------------------------------
// Slicing
// ---------------------------------------------------------------

/** A temporary id for the new half of a split: "Moscow B", "Moscow B 2", ... */
export function splitId(map: EditorMap, baseId: string): string {
  const taken = new Set(map.regions.map((r) => r.id));
  const first = `${baseId} B`;
  if (!taken.has(first)) {
    return first;
  }
  for (let n = 2; ; n++) {
    const id = `${first} ${n}`;
    if (!taken.has(id)) {
      return id;
    }
  }
}

export interface SplitPlan {
  /** The piece that keeps the original region's id and settings. */
  keep: { polygon: Vec2[]; cx: number; cy: number };
  /** The piece that becomes the new region. */
  fresh: { polygon: Vec2[]; cx: number; cy: number };
}

/**
 * Applies a split: `keep` replaces the region's outline, `fresh` becomes a new region right after it (same
 * owner and layer, no ipc, factory or units), and both are welded to the neighbors they touch, so the cut
 * vertices are listed by both halves and by any region whose edge the cut ended on.
 */
export function applySplit(map: EditorMap, regionId: string, plan: SplitPlan): { map: EditorMap; newId: string } | null {
  const original = findRegion(map, regionId);
  if (!original) {
    return null;
  }
  const newId = splitId(map, original.id);
  const fresh: EditorRegion = {
    id: newId,
    name: newId,
    ipc_value: 0,
    starting_owner: original.starting_owner,
    is_sea: original.is_sea,
    factory: "none",
    capital: false,
    polygon: plan.fresh.polygon.map((p) => ({ ...p })),
    cx: plan.fresh.cx,
    cy: plan.fresh.cy,
  };
  const regions: EditorRegion[] = [];
  for (const r of map.regions) {
    if (r.id === regionId) {
      regions.push({ ...r, polygon: plan.keep.polygon.map((p) => ({ ...p })), cx: plan.keep.cx, cy: plan.keep.cy }, fresh);
    } else {
      regions.push(r);
    }
  }
  let next: EditorMap = { ...map, regions };
  next = weldRegion(next, regionId);
  next = weldRegion(next, newId);
  return { map: next, newId };
}

/**
 * Applies a split into any number of pieces. The first piece keeps the region's id and settings; each of the
 * others becomes a new region right after it (ids "X B", "X B 2", ...). Returns the new ids.
 */
export function applySplitMany(
  map: EditorMap,
  regionId: string,
  pieces: { polygon: Vec2[]; cx: number; cy: number }[],
): { map: EditorMap; newIds: string[] } | null {
  const original = findRegion(map, regionId);
  if (!original || pieces.length < 2) {
    return null;
  }
  const fresh: EditorRegion[] = [];
  for (const piece of pieces.slice(1)) {
    const id = splitId({ ...map, regions: [...map.regions, ...fresh] }, original.id);
    fresh.push({
      id,
      name: id,
      ipc_value: 0,
      starting_owner: original.starting_owner,
      is_sea: original.is_sea,
      factory: "none",
      capital: false,
      polygon: piece.polygon.map((p) => ({ ...p })),
      cx: piece.cx,
      cy: piece.cy,
    });
  }
  const keep = pieces[0];
  const regions: EditorRegion[] = [];
  for (const r of map.regions) {
    if (r.id === regionId) {
      regions.push({ ...r, polygon: keep.polygon.map((p) => ({ ...p })), cx: keep.cx, cy: keep.cy }, ...fresh);
    } else {
      regions.push(r);
    }
  }
  let next: EditorMap = { ...map, regions };
  for (const id of [regionId, ...fresh.map((f) => f.id)]) {
    next = weldRegion(next, id);
  }
  return { map: next, newIds: fresh.map((f) => f.id) };
}

/**
 * Replaces region A with the weld of A and B, then removes B. A keeps its id and settings (a capital or
 * factory on either one survives); B's neighbor links, starting units and any manual link overrides move to A.
 */
export function applyMerge(
  map: EditorMap,
  aId: string,
  bId: string,
  merged: { polygon: Vec2[]; cx: number; cy: number },
): EditorMap | null {
  const a = findRegion(map, aId);
  const b = findRegion(map, bId);
  if (!a || !b || aId === bId) {
    return null;
  }
  const level = (r: EditorRegion) => FACTORY_LEVELS.indexOf(r.factory);
  const factory = level(b) > level(a) ? b.factory : a.factory;
  const move = (p: Pair): Pair | null => {
    const x = p[0] === bId ? aId : p[0];
    const y = p[1] === bId ? aId : p[1];
    return x === y ? null : pairOf(x, y);
  };
  const remap = (list: Pair[]): Pair[] => uniquePairs(list.map(move).filter((p): p is Pair => p !== null));
  const regions = map.regions
    .filter((r) => r.id !== bId)
    .map((r) =>
      r.id === aId
        ? { ...r, polygon: merged.polygon.map((p) => ({ ...p })), cx: merged.cx, cy: merged.cy, capital: a.capital || b.capital, factory }
        : r,
    );
  const next: EditorMap = {
    ...map,
    meta: mapStartingUnits(map.meta, (u) => (u.region_id === bId ? { ...u, region_id: aId } : u)),
    regions,
    links: remap(map.links),
    auto: remap(map.auto),
    overrides: { add: remap(map.overrides.add), remove: remap(map.overrides.remove) },
  };
  return weldRegion(next, aId);
}

/**
 * Folds the regions in `absorbIds` into `keepId`, whose id and settings win. `merged` is the combined geometry
 * (touching outlines welded, separated islands kept as extra outlines) and the one anchor, which sits in the
 * largest island. Every neighbor link of an absorbed region moves to the survivor, so the combined territory
 * touches every sea zone and land neighbor any of its islands touched. Starting units move over too; a
 * capital or factory on any of them survives.
 */
export function applyMergeMany(
  map: EditorMap,
  keepId: string,
  absorbIds: string[],
  merged: { polygon: Vec2[]; extra: Vec2[][]; cx: number; cy: number },
): EditorMap | null {
  const keep = findRegion(map, keepId);
  const absorbed = [...new Set(absorbIds)].filter((id) => id !== keepId).map((id) => findRegion(map, id));
  if (!keep || absorbed.length === 0 || absorbed.some((r) => !r)) {
    return null;
  }
  const gone = new Set(absorbed.map((r) => (r as EditorRegion).id));
  const level = (r: EditorRegion) => FACTORY_LEVELS.indexOf(r.factory);
  const all = [keep, ...(absorbed as EditorRegion[])];
  const factory = all.reduce((best, r) => (level(r) > FACTORY_LEVELS.indexOf(best) ? r.factory : best), keep.factory);
  const move = (p: Pair): Pair | null => {
    const x = gone.has(p[0]) ? keepId : p[0];
    const y = gone.has(p[1]) ? keepId : p[1];
    return x === y ? null : pairOf(x, y);
  };
  const remap = (list: Pair[]): Pair[] => uniquePairs(list.map(move).filter((p): p is Pair => p !== null));
  const regions = map.regions
    .filter((r) => !gone.has(r.id))
    .map((r) => {
      if (r.id !== keepId) {
        return r;
      }
      const { extra: _old, ...rest } = r;
      return {
        ...rest,
        polygon: merged.polygon.map((p) => ({ ...p })),
        ...(merged.extra.length > 0 ? { extra: merged.extra.map((ring) => ring.map((p) => ({ ...p }))) } : {}),
        cx: merged.cx,
        cy: merged.cy,
        capital: all.some((x) => x.capital),
        factory,
      };
    });
  const next: EditorMap = {
    ...map,
    meta: mapStartingUnits(map.meta, (u) => (gone.has(u.region_id) ? { ...u, region_id: keepId } : u)),
    regions,
    links: remap(map.links),
    auto: remap(map.auto),
    overrides: { add: remap(map.overrides.add), remove: remap(map.overrides.remove) },
  };
  return weldRegion(next, keepId);
}

/** An untouched `Territory N`: nobody has named, owned, garrisoned or fortified it, so dropping it loses no work. */
export function isUnconfiguredLand(map: EditorMap, region: EditorRegion): boolean {
  return (
    !region.is_sea &&
    /^Territory \d+$/.test(region.id) &&
    region.name === region.id &&
    region.starting_owner.toLowerCase() === "neutral" &&
    region.ipc_value <= 1 &&
    region.factory === "none" &&
    !region.capital &&
    (region.extra ?? []).length === 0 &&
    startingUnitsOf(map, region.id).length === 0
  );
}

/** Removes every unconfigured land region whose visible area is under `threshold`. The land stays drawn on the map. */
export function pruneSmallIslands(
  map: EditorMap,
  areaOf: (region: EditorRegion) => number,
  threshold: number,
): { map: EditorMap; removed: string[] } {
  const removed = map.regions.filter((r) => isUnconfiguredLand(map, r) && areaOf(r) < threshold).map((r) => r.id);
  let next = map;
  for (const id of removed) {
    next = deleteRegion(next, id);
  }
  return { map: next, removed };
}

/** Adds each outline as a new region of the layer, placed under the existing ones. */
export function addBlocks(map: EditorMap, blocks: Vec2[][], sea: boolean, anchors: Vec2[]): { map: EditorMap; ids: string[] } {
  let next = map;
  const ids: string[] = [];
  const added: EditorRegion[] = [];
  blocks.forEach((polygon, i) => {
    const id = nextRegionId({ ...next, regions: [...next.regions, ...added] }, sea);
    const label = anchors[i] ?? labelPoint(polygon);
    ids.push(id);
    added.push({
      id,
      name: id,
      ipc_value: sea ? 0 : 1,
      starting_owner: "Neutral",
      is_sea: sea,
      factory: "none",
      capital: false,
      polygon: polygon.map((p) => ({ ...p })),
      cx: label.x,
      cy: label.y,
    });
  });
  next = { ...next, regions: [...added, ...next.regions] };
  for (const id of ids) {
    next = weldRegion(next, id);
  }
  return { map: next, ids };
}

/**
 * Detaches islands of a multi-island territory into regions of their own (default settings, like a fresh
 * block). `only` lists the island indexes in `extra`; null takes them all. The territory keeps its id and its
 * remaining islands. `anchors[i]` is the anchor of the i-th detached island.
 */
export function detachIslands(
  map: EditorMap,
  regionId: string,
  only: number[] | null,
  anchors: Vec2[] = [],
): { map: EditorMap; ids: string[] } | null {
  const region = findRegion(map, regionId);
  const extra = region?.extra ?? [];
  if (!region || region.is_sea || extra.length === 0) {
    return null;
  }
  const take = new Set(only ?? extra.map((_, i) => i));
  const taken = extra.filter((_, i) => take.has(i));
  if (taken.length === 0) {
    return null;
  }
  const kept = extra.filter((_, i) => !take.has(i));
  const trimmed: EditorMap = {
    ...map,
    regions: map.regions.map((r) => {
      if (r.id !== regionId) {
        return r;
      }
      const { extra: _dropped, ...rest } = r;
      return kept.length > 0 ? { ...rest, extra: kept } : rest;
    }),
  };
  return addBlocks(trimmed, taken, false, anchors);
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

/** Older files only say `factory: true`; those become major. */
function factoryLevelOf(meta: Dict): FactoryLevel {
  if (!meta.factory) {
    return "none";
  }
  return meta.factory_size === "minor" ? "minor" : "major";
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
      factory: factoryLevelOf(meta),
      capital: Boolean(meta.victory ?? false),
      polygon: polygonOf(raw.polygon),
      ...(shape.extra && shape.extra.length > 0 ? { extra: shape.extra.map((ring) => ring.map((p) => ({ ...p }))) } : {}),
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
            .clip({ id: region.id, type: region.is_sea ? "sea" : "land", points: region.polygon, extra: region.extra })
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
        factory: region.factory !== "none",
        ...(region.factory === "none" ? {} : { factory_size: region.factory }),
        ipc: region.ipc_value,
        victory: region.capital,
        type: region.is_sea ? "sea" : "land",
        is_sea: region.is_sea,
      },
      polygon: region.polygon.map((p) => [r(p.x), r(p.y)]),
      ...(region.extra && region.extra.length > 0
        ? { extra_polygons: region.extra.map((ring) => ring.map((p) => [r(p.x), r(p.y)])) }
        : {}),
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

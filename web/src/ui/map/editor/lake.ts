// Turns one land region into an inland sea zone.
//
// The region's cutter becomes water. Wherever that water sat on the coast, the land silhouette
// loses it, so the sea clip (cutter minus land) keeps the lake instead of erasing it. A land
// territory that contained the lake keeps a hole. An ocean zone that covered it keeps a hole too,
// and the neighbor pass then joins the lake to the ocean only when water actually connects.
import polygonClipping from "polygon-clipping";
import { pointInPolygon, unitSlotMax, type Vec2 } from "../geometry";
import { multiPolygonArea, type MultiPolygon, type Polygon, type Ring } from "../regionClip";
import type { EditorMap, EditorRegion, StartingUnit } from "./editorModel";
import { labelPoint } from "./editorModel";

const MIN_AREA = 1;

export type LakeResult =
  | { ok: true; map: EditorMap; land: MultiPolygon | null }
  | { ok: false; error: string };

function toRing(points: Vec2[]): Ring {
  const ring: Ring = points.map((p) => [p.x, p.y]);
  if (ring.length >= 3) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([first[0], first[1]]);
    }
  }
  return ring;
}

function fromRing(ring: Ring): Vec2[] {
  const points = ring.map(([x, y]) => ({ x, y }));
  if (points.length > 1) {
    const a = points[0];
    const b = points[points.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) <= 1e-6) {
      points.pop();
    }
  }
  return points;
}

function ringArea(ring: Vec2[]): number {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
  }
  return Math.abs(area) / 2;
}

function subjectOf(region: EditorRegion): MultiPolygon {
  const holes = (region.holes ?? []).filter((ring) => ring.length >= 3).map(toRing);
  const extra = (region.extra ?? [])
    .filter((ring) => ring.length >= 3)
    .map((ring): Polygon => [toRing(ring)]);
  return [[toRing(region.polygon), ...holes], ...extra];
}

interface Outline {
  polygon: Vec2[];
  holes: Vec2[][];
  extra: Vec2[][];
}

function outlineOf(mp: MultiPolygon): Outline | null {
  const parts = mp
    .map((poly) => {
      const polygon = fromRing(poly[0]);
      const holes = poly
        .slice(1)
        .map(fromRing)
        .filter((ring) => ring.length >= 3 && ringArea(ring) >= MIN_AREA);
      const area = ringArea(polygon) - holes.reduce((sum, ring) => sum + ringArea(ring), 0);
      return { polygon, holes, area };
    })
    .filter((part) => part.polygon.length >= 3 && part.area >= MIN_AREA)
    .sort((a, b) => b.area - a.area);
  if (parts.length === 0) {
    return null;
  }
  const [main, ...rest] = parts;
  return { polygon: main.polygon, holes: main.holes, extra: rest.map((part) => part.polygon) };
}

function boxOf(region: EditorRegion): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const ring of [region.polygon, ...(region.holes ?? []), ...(region.extra ?? [])]) {
    for (const p of ring) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
  }
  return { x0, y0, x1, y1 };
}

function boxesOverlap(
  a: { x0: number; y0: number; x1: number; y1: number },
  b: { x0: number; y0: number; x1: number; y1: number },
): boolean {
  return a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
}

function inHole(p: Vec2, holes: Vec2[][]): boolean {
  return holes.some((ring) => pointInPolygon(p, ring));
}

function anchorOutside(outer: Vec2[], holes: Vec2[][], current: Vec2): Vec2 {
  if (pointInPolygon(current, outer) && !inHole(current, holes)) {
    return current;
  }
  const mid = labelPoint(outer);
  if (!inHole(mid, holes)) {
    return mid;
  }
  for (const p of outer) {
    const q = { x: (p.x + mid.x) / 2, y: (p.y + mid.y) / 2 };
    if (pointInPolygon(q, outer) && !inHole(q, holes)) {
      return q;
    }
  }
  return outer[0] ?? current;
}

function withOutline(region: EditorRegion, outline: Outline): EditorRegion {
  const anchor = anchorOutside(outline.polygon, outline.holes, { x: region.cx, y: region.cy });
  const { holes: _holes, extra: _extra, ...rest } = region;
  return {
    ...rest,
    polygon: outline.polygon,
    cx: anchor.x,
    cy: anchor.y,
    ...(outline.holes.length > 0 ? { holes: outline.holes } : {}),
    ...(outline.extra.length > 0 ? { extra: outline.extra } : {}),
  };
}

function asLake(region: EditorRegion): EditorRegion {
  const {
    land_cover: _cover,
    has_airbase: _air,
    has_harbour: _harbour,
    facility_anchor: _facility,
    lattice: _lattice,
    is_convoy_zone: _convoy,
    unit_slots,
    ...rest
  } = region;
  const slots = unit_slots?.slice(0, unitSlotMax(true));
  return {
    ...rest,
    is_sea: true,
    factory: "none",
    capital: false,
    ipc_value: 0,
    ...(slots && slots.length > 0 ? { unit_slots: slots } : {}),
  };
}

function withoutUnits(meta: EditorMap["meta"], ids: Set<string>): EditorMap["meta"] {
  if (!Array.isArray(meta.starting_units)) {
    return meta;
  }
  const starting_units = (meta.starting_units as StartingUnit[]).filter((unit) => !ids.has(unit.region_id));
  return { ...meta, starting_units };
}

/**
 * The selected land region becomes an inland sea zone. `land` is the coast the bake clips against.
 * The returned land is that coast with the lake opened, or null when the coast did not cover it.
 */
export function turnRegionToLake(map: EditorMap, regionId: string, land: MultiPolygon | null): LakeResult {
  const region = map.regions.find((item) => item.id === regionId);
  if (!region) {
    return { ok: false, error: "Select a land region to turn into a lake." };
  }
  if (region.is_sea) {
    return { ok: false, error: "That region is already a sea zone." };
  }
  if (region.polygon.length < 3 || ringArea(region.polygon) < MIN_AREA) {
    return { ok: false, error: "That region has no outline to turn into a lake." };
  }
  const lakeGeom = subjectOf(region);
  const lakeBox = boxOf(region);
  const removed = new Set<string>();
  let regions: EditorRegion[];
  try {
    regions = map.regions.flatMap((item) => {
      if (item.id === region.id) {
        return [asLake(item)];
      }
      if (item.polygon.length < 3 || !boxesOverlap(lakeBox, boxOf(item))) {
        return [item];
      }
      const subject = subjectOf(item);
      const before = multiPolygonArea(subject);
      const diff = polygonClipping.difference(subject, lakeGeom);
      if (Math.abs(before - multiPolygonArea(diff)) <= 0.25) {
        return [item];
      }
      const outline = outlineOf(diff);
      if (!outline) {
        removed.add(item.id);
        return [];
      }
      return [withOutline(item, outline)];
    });
  } catch {
    return { ok: false, error: "That outline crosses itself, so it cannot become a lake." };
  }

  let opened: MultiPolygon | null = null;
  if (land && land.length > 0) {
    try {
      const diff = polygonClipping.difference(land, lakeGeom);
      if (Math.abs(multiPolygonArea(land) - multiPolygonArea(diff)) > 0.25) {
        opened = diff;
      }
    } catch {
      return { ok: false, error: "That outline crosses itself, so it cannot be cut out of the coast." };
    }
  }

  return {
    ok: true,
    map: { ...map, regions, meta: withoutUnits(map.meta, new Set([region.id, ...removed])) },
    land: opened,
  };
}

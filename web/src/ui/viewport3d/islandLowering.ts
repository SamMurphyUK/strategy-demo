// Lowering the islands. Pure.
//
// An island is a polygon of the land mask smaller than ISLAND_AREA. It stands on the water like the continents do, as a slab with a cliff, and
// can be lowered: its top moves down toward the sea by a share of the cliff's height, so a Pacific atoll sits low in the ocean and not on a
// pillar. A territory on an island can be lowered on its own (`regionScales`), and the rest take the global scale. 1 is as tall as the
// continents; 0.4 leaves two fifths of the cliff.
import type { Vec2 } from "../map/geometry";
import { pointInMultiPolygon, type MultiPolygon, type Ring } from "../map/regionClip";

/** A polygon smaller than this, in world units squared, is an island. */
export const ISLAND_AREA = 900;
/** The lowest an island's scale may go: it never sinks below the water. */
export const MIN_ISLAND_SCALE = 0.15;

export interface IslandCell {
  /** The polygon's index in the land. */
  index: number;
  /** The polygon, so a point can be tested. */
  polygon: MultiPolygon[number];
  box: { x0: number; y0: number; x1: number; y1: number };
  /** The territories whose anchors stand on it. An override for any of them lowers the whole island. */
  regionIds: readonly string[];
}

export function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(sum) / 2;
}

function boxOf(ring: Ring): IslandCell["box"] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of ring) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}

/** Every island of the land, with the territories that stand on it. */
export function islandCells(land: MultiPolygon, regions: readonly { id: string; anchor: Vec2 }[], areaMax = ISLAND_AREA): IslandCell[] {
  const out: IslandCell[] = [];
  land.forEach((polygon, index) => {
    const outline = polygon[0];
    if (!outline || outline.length < 3 || ringArea(outline) >= areaMax) {
      return;
    }
    const box = boxOf(outline);
    const regionIds = regions.filter((region) => region.anchor.x >= box.x0 && region.anchor.x <= box.x1 && region.anchor.y >= box.y0 && region.anchor.y <= box.y1 && pointInMultiPolygon(region.anchor, [polygon])).map((region) => region.id);
    out.push({ index, polygon, box, regionIds });
  });
  return out;
}

/** The scale of an island: a territory on it with its own scale wins, else the global one. Held between the floor and 1. */
export function islandScale(cell: Pick<IslandCell, "regionIds">, regionScales: Readonly<Record<string, number>>, global: number): number {
  let scale = global;
  for (const id of cell.regionIds) {
    const own = regionScales[id];
    if (typeof own === "number" && Number.isFinite(own)) {
      scale = own;
      break;
    }
  }
  return Math.min(1, Math.max(MIN_ISLAND_SCALE, scale));
}

/** The share of the cliff an island loses, 0 to 1 - MIN_ISLAND_SCALE. */
export function lowerShare(scale: number): number {
  return 1 - Math.min(1, Math.max(MIN_ISLAND_SCALE, scale));
}

/**
 * How far the ground at a point has been lowered, in world units, given the full height of the cliff. 0 off the islands. The twin of the
 * slabs the board draws, for everything that stands on an island: the figures, the bases, the trees, the roofs.
 */
export function makeLowerAt(
  cells: readonly IslandCell[],
  scaleOf: (cell: IslandCell) => number,
  cliff: () => number,
): (x: number, y: number) => number {
  return (x, y) => {
    for (const cell of cells) {
      const b = cell.box;
      if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) {
        continue;
      }
      if (pointInMultiPolygon({ x, y }, [cell.polygon])) {
        return lowerShare(scaleOf(cell)) * cliff();
      }
    }
    return 0;
  };
}

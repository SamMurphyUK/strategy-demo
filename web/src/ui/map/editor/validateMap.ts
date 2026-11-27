// What has to be true before a drawn board can be exported or played.
import type { EditorMap, EditorRegion } from "./editorModel";
import { autoNeighborPairs, type AdjacencyRegion, type Pair } from "./adjacency";

function adjacencyOf(region: EditorRegion): AdjacencyRegion {
  return {
    id: region.id,
    polygon: region.polygon,
    extra: region.extra,
    holes: region.holes,
    is_sea: region.is_sea,
  };
}

function components(ids: string[], pairs: Pair[]): number {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (id: string): string => {
    const p = parent.get(id) ?? id;
    if (p === id) {
      return id;
    }
    const root = find(p);
    parent.set(id, root);
    return root;
  };
  for (const [a, b] of pairs) {
    if (!parent.has(a) || !parent.has(b)) {
      continue;
    }
    parent.set(find(a), find(b));
  }
  return new Set(ids.map((id) => find(id))).size;
}

/**
 * Closed polygons need a name. Sea zones that do not share a border with the other seas are listed
 * once, as a count. `isLand` lets a sea meet another sea along a coastline; without it, only a shared
 * edge counts. Strait and impassable links are manual and are not treated as errors.
 */
export function validateEditorMap(
  map: EditorMap,
  isLand: ((x: number, y: number) => boolean) | null,
): string[] {
  const issues: string[] = [];
  for (const region of map.regions) {
    if (region.polygon.length < 3) {
      issues.push(`${region.id} is not a closed polygon.`);
      continue;
    }
    if (region.name.trim() === "" || region.name.trim() === region.id) {
      issues.push(`${region.id} has no territory name.`);
    }
  }
  const seas = map.regions.filter((region) => region.is_sea && region.polygon.length >= 3);
  if (seas.length > 1) {
    const pairs = autoNeighborPairs(seas.map(adjacencyOf), isLand);
    const areas = components(
      seas.map((region) => region.id),
      pairs,
    );
    if (areas > 1) {
      issues.push(`${areas} separate sea areas do not share a border.`);
    }
  }
  return issues;
}

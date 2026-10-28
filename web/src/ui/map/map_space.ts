// World space for the map is the land SVG's viewBox (800 x 504). demomap01.json was authored over
// texture/test.jpg (3000 x 2139, centred on the origin), so its coordinates are projected into world
// space when the UI loads it. The engine keeps reading the file untouched; it only needs adjacency.
import type { Dict } from "../../engine/model/types";

/** Marker written by the editor's export: coordinates are already in land-SVG world space. */
export const WORLD_COORD_SPACE = "svg";

/**
 * Fitted by matching the mainland-Australia outline in test.jpg (legacy x 955-1262, y 511-741) to the
 * same continent in the land SVG (x 518-607, y 379-449). Uniform scale; the two maps share a projection.
 */
export const LEGACY_TO_WORLD = { scale: 0.297, tx: 233.6, ty: 227.7 } as const;

export function legacyToWorld(x: number, y: number): [number, number] {
  return [x * LEGACY_TO_WORLD.scale + LEGACY_TO_WORLD.tx, y * LEGACY_TO_WORLD.scale + LEGACY_TO_WORLD.ty];
}

export function worldToLegacy(x: number, y: number): [number, number] {
  return [(x - LEGACY_TO_WORLD.tx) / LEGACY_TO_WORLD.scale, (y - LEGACY_TO_WORLD.ty) / LEGACY_TO_WORLD.scale];
}

/** A copy of the map JSON with polygons and unit anchors in world space. Already-world maps pass through. */
export function projectMapJson(mapJson: Dict): Dict {
  const out: Dict = { ...mapJson };
  if (mapJson.coord_space === WORLD_COORD_SPACE) {
    return out;
  }
  const regions: Dict[] = Array.isArray(mapJson.regions) ? mapJson.regions : [];
  out.regions = regions.map((region) => {
    const next: Dict = { ...region };
    if (Array.isArray(region.polygon)) {
      next.polygon = region.polygon.map((p: unknown) =>
        Array.isArray(p) && p.length >= 2 ? legacyToWorld(Number(p[0]), Number(p[1])) : p,
      );
    }
    if (Array.isArray(region.anchors)) {
      next.anchors = region.anchors.map((a: Dict) => {
        if (typeof a !== "object" || a === null || a.x === undefined || a.y === undefined) {
          return a;
        }
        const [x, y] = legacyToWorld(Number(a.x), Number(a.y));
        return { ...a, x, y };
      });
    }
    return next;
  });
  out.coord_space = WORLD_COORD_SPACE;
  return out;
}

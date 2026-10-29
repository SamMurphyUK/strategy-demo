import { describe, expect, it } from "vitest";
import {
  addRegionFromPolygon,
  anchorInBox,
  boxFromPoints,
  editorFromMapJson,
  editorToMapJson,
  type EditorMap,
  findRegion,
  pruneSmallIslands,
  setStartingUnits,
  toggleLink,
  updateRegion,
} from "../../../src/ui/map/editor/editorModel";
import { mapIntegrityProblems } from "./map_invariants";
import type { Vec2 } from "../../../src/ui/map/geometry";

const square = (x: number, y: number, s: number): Vec2[] => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
];
const areaOf = (r: { polygon: Vec2[] }) => {
  const p = r.polygon;
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i].x * q.y - q.x * p[i].y;
  }
  return Math.abs(a) / 2;
};

/**
 * Territory 1: big continent (left). 2, 3: specks inside the box. 4: speck outside the box.
 * 5: an inside speck that is configured. 6: a mid-size island inside the box. Sea Zone 01 touches 2 and 4.
 */
function world(): EditorMap {
  let map = editorFromMapJson({ regions: [] });
  map = addRegionFromPolygon(map, square(0, 0, 100), false).map; // 1, area 10000
  map = addRegionFromPolygon(map, square(200, 200, 4), false).map; // 2, area 16
  map = addRegionFromPolygon(map, square(210, 210, 3), false).map; // 3, area 9
  map = addRegionFromPolygon(map, square(400, 400, 4), false).map; // 4, outside
  map = addRegionFromPolygon(map, square(220, 220, 2), false).map; // 5, configured
  map = addRegionFromPolygon(map, square(230, 200, 20), false).map; // 6, area 400
  map = addRegionFromPolygon(map, square(150, 150, 20), true).map; // Sea Zone 1
  map = toggleLink(map, "Territory 2", "Sea Zone 01");
  map = toggleLink(map, "Territory 4", "Sea Zone 01");
  map = updateRegion(map, "Territory 5", { starting_owner: "USA" });
  return map;
}
const BOX = boxFromPoints({ x: 190, y: 190 }, { x: 300, y: 300 });
const ids = (m: EditorMap) => m.regions.filter((r) => !r.is_sea).map((r) => r.id);

describe("the Prune Box marquee", () => {
  it("is the same box whichever corner the drag started from", () => {
    expect(boxFromPoints({ x: 10, y: 80 }, { x: 70, y: 20 })).toEqual({ minX: 10, minY: 20, maxX: 70, maxY: 80 });
    expect(boxFromPoints({ x: 70, y: 20 }, { x: 10, y: 80 })).toEqual({ minX: 10, minY: 20, maxX: 70, maxY: 80 });
  });

  it("counts an anchor only when it is strictly inside", () => {
    const map = world();
    const r = findRegion(map, "Territory 2")!;
    expect(anchorInBox(r, { minX: r.cx - 1, minY: r.cy - 1, maxX: r.cx + 1, maxY: r.cy + 1 })).toBe(true);
    expect(anchorInBox(r, { minX: r.cx, minY: r.cy - 1, maxX: r.cx + 1, maxY: r.cy + 1 })).toBe(false); // on the edge
    expect(anchorInBox(r, { minX: r.cx - 1, minY: r.cy - 1, maxX: r.cx, maxY: r.cy + 1 })).toBe(false);
    expect(anchorInBox(r, { minX: 0, minY: 0, maxX: 10, maxY: 10 })).toBe(false);
  });
});

describe("pruning inside a box", () => {
  it("removes only untouched small regions whose anchor is in the box", () => {
    const out = pruneSmallIslands(world(), areaOf, 25, BOX);
    expect(out.removed.sort()).toEqual(["Territory 2", "Territory 3"]);
    // Outside the box, configured, or over the threshold: all kept.
    expect(ids(out.map)).toEqual(expect.arrayContaining(["Territory 1", "Territory 4", "Territory 5", "Territory 6"]));
  });

  it("follows the threshold: a bigger one also takes the mid-size island, a smaller one spares the specks", () => {
    expect(pruneSmallIslands(world(), areaOf, 1000, BOX).removed.sort()).toEqual(["Territory 2", "Territory 3", "Territory 6"]);
    expect(pruneSmallIslands(world(), areaOf, 10, BOX).removed).toEqual(["Territory 3"]);
    expect(pruneSmallIslands(world(), areaOf, 1, BOX).removed).toEqual([]);
  });

  it("prunes nothing from a box that holds no anchors", () => {
    const out = pruneSmallIslands(world(), areaOf, 1000, boxFromPoints({ x: 500, y: 500 }, { x: 600, y: 600 }));
    expect(out.removed).toEqual([]);
    expect(out.map.regions).toHaveLength(world().regions.length);
  });

  it("without a box still prunes the whole map, as the global button does", () => {
    expect(pruneSmallIslands(world(), areaOf, 25).removed.sort()).toEqual(["Territory 2", "Territory 3", "Territory 4"]);
    expect(pruneSmallIslands(world(), areaOf, 25, null).removed.sort()).toEqual(["Territory 2", "Territory 3", "Territory 4"]);
  });

  it("cleans the links and units of what it removed and leaves the original map alone", () => {
    const before = world();
    const withUnits = setStartingUnits(before, "Territory 6", [{ faction_id: "usa", unit_type_id: "infantry", count: 1 }]);
    const out = pruneSmallIslands(withUnits, areaOf, 1000, BOX);
    // Territory 6 has units, so it stays even under a generous threshold.
    expect(out.removed.sort()).toEqual(["Territory 2", "Territory 3"]);
    expect(out.map.links.some((p) => p.includes("Territory 2"))).toBe(false);
    expect(out.map.links.some((p) => p.includes("Territory 4"))).toBe(true);
    expect(findRegion(withUnits, "Territory 2")).toBeDefined();
    expect(out.map).not.toBe(withUnits);
  });

  it("leaves a sound map: unique ids, outlines, anchors and symmetric neighbors", () => {
    const out = pruneSmallIslands(world(), areaOf, 25, BOX).map;
    expect(mapIntegrityProblems(editorToMapJson(out))).toEqual([]);
  });
});

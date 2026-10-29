import polygonClipping from "polygon-clipping";
import { describe, expect, it } from "vitest";
import { autoNeighborPairs } from "../../../src/ui/map/editor/adjacency";
import {
  addBlocks,
  addRegionFromPolygon,
  applyAutoLinks,
  applyMergeMany,
  deleteRegion,
  detachIslands,
  editorFromMapJson,
  editorToMapJson,
  type EditorMap,
  findRegion,
  isLinked,
  isUnconfiguredLand,
  neighborsOf,
  pruneSmallIslands,
  setStartingUnits,
  toggleLink,
  updateRegion,
} from "../../../src/ui/map/editor/editorModel";
import { landComponentAt, masterBlocks, mergeRegions } from "../../../src/ui/map/editor/slicing";
import { mapIntegrityProblems } from "./map_invariants";
import { buildMapGeometry, pointInPolygon, regionAtPoint, type Vec2 } from "../../../src/ui/map/geometry";
import { multiPolygonArea, type MultiPolygon, RegionClipper } from "../../../src/ui/map/regionClip";

const square = (x: number, y: number, s: number): Vec2[] => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
];
const area = (ring: Vec2[]) => multiPolygonArea([[ring.map((p) => [p.x, p.y] as [number, number])]]);
const toMulti = (rings: Vec2[][]): MultiPolygon => rings.map((r) => [r.map((p) => [p.x, p.y] as [number, number])]);

describe("mergeRegions (disjoint islands become one territory)", () => {
  it("keeps separated islands as extra outlines, largest first", () => {
    const honshu = square(0, 0, 40);
    const hokkaido = square(60, 0, 20);
    const kyushu = square(0, 60, 10);
    const r = mergeRegions([{ polygon: hokkaido }, { polygon: honshu }, { polygon: kyushu }], 0.75);
    if (!r.ok) {
      throw new Error(r.error);
    }
    expect(area(r.polygon)).toBe(1600);
    expect(r.extra.map(area)).toEqual([400, 100]);
  });

  it("welds islands that do touch into one outline, and leaves the rest apart", () => {
    const r = mergeRegions([{ polygon: square(0, 0, 10) }, { polygon: square(10, 0, 10) }, { polygon: square(100, 100, 5) }], 0.75);
    if (!r.ok) {
      throw new Error(r.error);
    }
    expect(area(r.polygon)).toBe(200);
    expect(r.extra).toHaveLength(1);
  });

  it("carries the extra islands of an archipelago that is merged again", () => {
    const first = mergeRegions([{ polygon: square(0, 0, 30) }, { polygon: square(50, 0, 10) }], 0.75);
    if (!first.ok) {
      throw new Error(first.error);
    }
    const second = mergeRegions([{ polygon: first.polygon, extra: first.extra }, { polygon: square(0, 80, 20) }], 0.75);
    if (!second.ok) {
      throw new Error(second.error);
    }
    expect([second.polygon, ...second.extra].map(area)).toEqual([900, 400, 100]);
  });

  it("needs two regions", () => {
    expect(mergeRegions([{ polygon: square(0, 0, 10) }], 0.75).ok).toBe(false);
  });
});

describe("applyMergeMany", () => {
  const world = (): EditorMap => {
    let map = editorFromMapJson({ regions: [] });
    map = addRegionFromPolygon(map, square(0, 0, 40), false).map; // Territory 1: Honshu
    map = addRegionFromPolygon(map, square(60, 0, 20), false).map; // Territory 2: Hokkaido
    map = addRegionFromPolygon(map, square(0, 60, 10), false).map; // Territory 3: Kyushu
    map = addRegionFromPolygon(map, [{ x: -50, y: -50 }, { x: -10, y: -50 }, { x: -10, y: -10 }, { x: -50, y: -10 }], true).map; // Sea Zone 01
    map = addRegionFromPolygon(map, [{ x: 100, y: 0 }, { x: 140, y: 0 }, { x: 140, y: 40 }, { x: 100, y: 40 }], true).map; // Sea Zone 02
    map = toggleLink(map, "Territory 1", "Sea Zone 01");
    map = toggleLink(map, "Territory 2", "Sea Zone 02");
    map = toggleLink(map, "Territory 3", "Sea Zone 02");
    map = updateRegion(map, "Territory 1", { name: "Japan", ipc_value: 8, starting_owner: "JAP" });
    map = updateRegion(map, "Territory 3", { capital: true, factory: "minor" });
    return setStartingUnits(map, "Territory 2", [{ faction_id: "jap", unit_type_id: "infantry", count: 2 }]);
  };

  it("keeps the primary's id and settings, and unions every island's sea zones", () => {
    const before = world();
    const merged = mergeRegions(["Territory 1", "Territory 2", "Territory 3"].map((id) => findRegion(before, id)!), 0.75);
    if (!merged.ok) {
      throw new Error(merged.error);
    }
    const out = applyMergeMany(before, "Territory 1", ["Territory 2", "Territory 3"], { ...merged, cx: 20, cy: 20 })!;
    expect(out.regions.filter((r) => !r.is_sea).map((r) => r.id)).toEqual(["Territory 1"]);
    const japan = findRegion(out, "Territory 1")!;
    expect(japan).toMatchObject({ name: "Japan", ipc_value: 8, starting_owner: "JAP", cx: 20, cy: 20 });
    expect(japan.extra).toHaveLength(2);
    expect(neighborsOf(out, "Territory 1").sort()).toEqual(["Sea Zone 01", "Sea Zone 02"]);
    // The garrison, factory and capital of the absorbed islands survive; their ids do not.
    expect((out.meta.starting_units as { region_id: string }[]).map((u) => u.region_id)).toEqual(["Territory 1"]);
    expect(japan.capital).toBe(true);
    expect(japan.factory).toBe("minor");
    expect(isLinked(out, "Territory 2", "Sea Zone 02")).toBe(false);
  });

  it("moves starting units to the survivor", () => {
    const before = world();
    const merged = mergeRegions([findRegion(before, "Territory 1")!, findRegion(before, "Territory 2")!], 0.75);
    if (!merged.ok) {
      throw new Error(merged.error);
    }
    const out = applyMergeMany(before, "Territory 1", ["Territory 2"], { ...merged, cx: 20, cy: 20 })!;
    expect((out.meta.starting_units as { region_id: string }[]).map((u) => u.region_id)).toEqual(["Territory 1"]);
  });

  it("refuses an unknown region", () => {
    expect(applyMergeMany(world(), "Territory 1", ["Nowhere"], { polygon: square(0, 0, 1), extra: [], cx: 0, cy: 0 })).toBeNull();
  });
});

describe("a multi-island territory in the map file and on the board", () => {
  const archipelago = (): EditorMap => {
    let map = editorFromMapJson({ regions: [] });
    map = addRegionFromPolygon(map, square(0, 0, 40), false).map;
    return updateRegion(map, "Territory 1", { extra: [square(100, 0, 20), square(100, 100, 10)] });
  };

  it("round-trips through demomap01.json as extra_polygons", () => {
    const json = editorToMapJson(archipelago());
    const region = (json.regions as Record<string, unknown>[])[0];
    expect((region.extra_polygons as unknown[]).length).toBe(2);
    const again = editorFromMapJson(JSON.parse(JSON.stringify(json)));
    expect(findRegion(again, "Territory 1")!.extra).toHaveLength(2);
  });

  it("leaves ordinary regions' files unchanged", () => {
    const map = addRegionFromPolygon(editorFromMapJson({ regions: [] }), square(0, 0, 40), false).map;
    expect((editorToMapJson(map).regions as Record<string, unknown>[])[0]).not.toHaveProperty("extra_polygons");
  });

  it("answers for every island when a point is tested", () => {
    const geometry = buildMapGeometry(editorToMapJson(archipelago(), { round: false }));
    expect(regionAtPoint(geometry, { x: 10, y: 10 })).toBe("Territory 1");
    expect(regionAtPoint(geometry, { x: 110, y: 10 })).toBe("Territory 1");
    expect(regionAtPoint(geometry, { x: 105, y: 105 })).toBe("Territory 1");
    expect(regionAtPoint(geometry, { x: 70, y: 10 })).toBe("");
    // Unit stacks clamp to the whole territory, not just the main island.
    expect(geometry.regions[0].bounds).toEqual({ x: 0, y: 0, w: 120, h: 110 });
  });

  it("clips every island, so selecting or hovering one highlights them all", () => {
    const land: MultiPolygon = toMulti([square(0, 0, 40), square(100, 0, 20), square(100, 100, 10), square(300, 300, 10)]);
    const clipper = new RegionClipper(land);
    const region = findRegion(archipelago(), "Territory 1")!;
    const shape = clipper.clip({ id: region.id, type: "land", points: region.polygon, extra: region.extra });
    expect(shape).toHaveLength(3);
    expect(multiPolygonArea(shape)).toBe(1600 + 400 + 100);
    // Water wraps around all three.
    const sea = clipper.clip({ id: "s", type: "sea", points: square(-10, -10, 150), extra: [] });
    expect(multiPolygonArea(polygonClipping.intersection(sea, shape))).toBe(0);
  });

  it("links the territory to every sea zone that touches any of its islands", () => {
    const map = archipelago();
    const regions = [
      ...map.regions.map((r) => ({ id: r.id, polygon: r.polygon, extra: r.extra, is_sea: r.is_sea })),
      { id: "Sea Zone 01", polygon: square(40, 0, 10), is_sea: true },
      { id: "Sea Zone 02", polygon: square(120, 0, 10), is_sea: true },
      { id: "Sea Zone 03", polygon: square(500, 500, 10), is_sea: true },
    ];
    const rings = [map.regions[0].polygon, ...(map.regions[0].extra ?? [])];
    const isLand = (x: number, y: number) => rings.some((ring) => pointInPolygon({ x, y }, ring));
    const pairs = autoNeighborPairs(regions, isLand).map((p) => p.join("|")).sort();
    expect(pairs).toEqual(["Sea Zone 01|Territory 1", "Sea Zone 02|Territory 1"]);
  });
});

describe("decorative land and pruning small islands", () => {
  // Three coast pieces: a continent, a mid island and a speck, plus the sea around them.
  const land: MultiPolygon = toMulti([square(0, 0, 100), square(200, 0, 8), square(300, 0, 3)]);
  const canvas = { x: 0, y: 0, w: 400, h: 100 };

  const board = () => {
    const clipper = new RegionClipper(land);
    const blocks = masterBlocks([], canvas, "land", clipper).blocks;
    const added = addBlocks(editorFromMapJson({ regions: [] }), blocks, false, []);
    return { clipper, map: added.map };
  };
  const areaOf = (clipper: RegionClipper) => (r: { id: string; polygon: Vec2[] }) =>
    multiPolygonArea(clipper.clip({ id: r.id, type: "land", points: r.polygon }));

  it("starts with one default territory per landmass", () => {
    const { map } = board();
    expect(map.regions.map((r) => r.id)).toEqual(["Territory 1", "Territory 2", "Territory 3"]);
  });

  it("removes only untouched territories under the threshold", () => {
    const { clipper, map } = board();
    const out = pruneSmallIslands(map, areaOf(clipper), 25);
    expect(out.removed).toEqual(["Territory 3"]);
    expect(out.map.regions.map((r) => r.id)).toEqual(["Territory 1", "Territory 2"]);
    expect(pruneSmallIslands(map, areaOf(clipper), 100).removed).toEqual(["Territory 2", "Territory 3"]);
    expect(pruneSmallIslands(map, areaOf(clipper), 1).removed).toEqual([]);
  });

  it("keeps anything somebody has configured, however small", () => {
    const { clipper, map } = board();
    const configured: [string, (m: EditorMap) => EditorMap][] = [
      ["renamed", (m) => updateRegion(m, "Territory 3", { name: "Wake" })],
      ["owned", (m) => updateRegion(m, "Territory 3", { starting_owner: "USA" })],
      ["valued", (m) => updateRegion(m, "Territory 3", { ipc_value: 3 })],
      ["fortified", (m) => updateRegion(m, "Territory 3", { factory: "minor" })],
      ["capital", (m) => updateRegion(m, "Territory 3", { capital: true })],
      ["garrisoned", (m) => setStartingUnits(m, "Territory 3", [{ faction_id: "usa", unit_type_id: "infantry", count: 1 }])],
      ["archipelago", (m) => updateRegion(m, "Territory 3", { extra: [square(500, 0, 2)] })],
    ];
    for (const [label, edit] of configured) {
      const changed = edit(map);
      expect(isUnconfiguredLand(changed, findRegion(changed, "Territory 3")!), label).toBe(false);
      expect(pruneSmallIslands(changed, areaOf(clipper), 25).removed, label).toEqual([]);
    }
  });

  it("drops the pruned island's links and units", () => {
    const { clipper, map: base } = board();
    let map = addRegionFromPolygon(base, square(-10, -10, 5), true).map;
    map = toggleLink(map, "Territory 3", "Sea Zone 1");
    map = applyAutoLinks(map, []);
    const out = pruneSmallIslands(map, areaOf(clipper), 25).map;
    expect(findRegion(out, "Territory 3")).toBeUndefined();
    expect(out.links.every((p) => !p.includes("Territory 3"))).toBe(true);
    expect(out.overrides.add.every((p) => !p.includes("Territory 3"))).toBe(true);
  });

  it("marking a region decorative is a delete: links go, the land mask still holds the land", () => {
    const { clipper, map } = board();
    const linked = toggleLink(addRegionFromPolygon(map, square(-10, -10, 5), true).map, "Territory 2", "Sea Zone 1");
    const out = deleteRegion(linked, "Territory 2");
    expect(findRegion(out, "Territory 2")).toBeUndefined();
    expect(out.links).toEqual([]);
    // The island is still land, and the sea zone around it still stops at its coast.
    const sea = clipper.clip({ id: "s", type: "sea", points: square(-10, -10, 450), extra: [] });
    expect(polygonClipping.intersection(sea, toMulti([square(200, 0, 8)]))).toEqual([]);
  });

  it("promotes a decorative island back to a region, outlined by its coast", () => {
    const { clipper, map } = board();
    const pruned = pruneSmallIslands(map, areaOf(clipper), 25).map;
    const covered = pruned.regions.map((r) => clipper.clip({ id: r.id, type: "land", points: r.polygon }));
    const island = landComponentAt({ x: 301.5, y: 1.5 }, land, covered)!;
    expect(island.area).toBe(9);
    expect(island.outline).toHaveLength(4);
    // Land a region already owns, and open water, are not promotable.
    expect(landComponentAt({ x: 50, y: 50 }, land, covered)).toBeNull();
    expect(landComponentAt({ x: 150, y: 50 }, land, covered)).toBeNull();
    const back = addBlocks(pruned, [island.outline], false, [{ x: 301.5, y: 1.5 }]);
    expect(back.ids).toEqual(["Territory 3"]);
    expect(findRegion(back.map, "Territory 3")).toMatchObject({ cx: 301.5, cy: 1.5, is_sea: false });
  });

  it("promotes only the unclaimed part of a continent that is partly owned", () => {
    const clipper = new RegionClipper(land);
    const half = clipper.clip({ id: "w", type: "land", points: square(0, 0, 50) });
    const rest = landComponentAt({ x: 80, y: 80 }, land, [half])!;
    expect(rest.area).toBe(10000 - 2500);
  });
});

describe("unmerging a multi-island territory", () => {
  const archipelago = (): EditorMap => {
    let map = editorFromMapJson({ regions: [] });
    map = addRegionFromPolygon(map, square(0, 0, 40), false).map;
    map = addRegionFromPolygon(map, square(0, 100, 10), true).map;
    return updateRegion(map, "Territory 1", { name: "Japan", starting_owner: "JAP", extra: [square(100, 0, 20), square(100, 100, 10)] });
  };

  it("gives every other island its own default region and leaves the main island's id and settings", () => {
    const out = detachIslands(archipelago(), "Territory 1", null, [{ x: 110, y: 10 }, { x: 105, y: 105 }])!;
    expect(out.ids).toHaveLength(2);
    const japan = findRegion(out.map, "Territory 1")!;
    expect(japan).toMatchObject({ name: "Japan", starting_owner: "JAP" });
    expect(japan.extra).toBeUndefined();
    const second = findRegion(out.map, out.ids[0])!;
    expect(second).toMatchObject({ is_sea: false, ipc_value: 1, starting_owner: "Neutral", cx: 110, cy: 10 });
    expect(area(second.polygon)).toBe(400);
    expect(mapIntegrityProblems(editorToMapJson(out.map))).toEqual([]);
  });

  it("detaches just one island when asked, keeping the rest merged", () => {
    const out = detachIslands(archipelago(), "Territory 1", [0])!;
    expect(out.ids).toHaveLength(1);
    expect(findRegion(out.map, "Territory 1")!.extra).toHaveLength(1);
    expect(area(findRegion(out.map, out.ids[0])!.polygon)).toBe(400);
  });

  it("has nothing to do for a single-island region, a sea zone or an unknown id", () => {
    const map = archipelago();
    expect(detachIslands(map, "Sea Zone 1", null)).toBeNull();
    expect(detachIslands(map, "Nowhere", null)).toBeNull();
    expect(detachIslands(detachIslands(map, "Territory 1", null)!.map, "Territory 1", null)).toBeNull();
  });
});

describe("map integrity check", () => {
  const region = (id: string, extra: Record<string, unknown> = {}) => ({
    metadata: { region_id: id, is_sea: id.startsWith("S"), type: id.startsWith("S") ? "sea" : "land" },
    polygon: [[0, 0], [1, 0], [1, 1]],
    anchors: [{ x: 0.5, y: 0.5, type: "unit" }],
    neighbors: [],
    ...extra,
  });

  it("accepts a sound map and names each kind of fault", () => {
    const good = { regions: [region("L", { neighbors: ["S"] }), region("S", { neighbors: ["L"] })] };
    expect(mapIntegrityProblems(good)).toEqual([]);
    expect(mapIntegrityProblems({ regions: [region("L")] })).toContain("no sea region");
    expect(mapIntegrityProblems({ regions: [region("S")] })).toContain("no land region");
    expect(mapIntegrityProblems({ regions: [region("L"), region("L"), region("S")] })).toContain("duplicate id L");
    expect(mapIntegrityProblems({ regions: [region("L", { polygon: [[0, 0], [1, 1]] }), region("S")] }).join()).toContain("L: polygon");
    expect(mapIntegrityProblems({ regions: [region("L", { anchors: [] }), region("S")] }).join()).toContain("L: missing unit anchor");
    expect(mapIntegrityProblems({ regions: [region("L", { neighbors: ["X"] }), region("S")] }).join()).toContain("X does not exist");
    expect(mapIntegrityProblems({ regions: [region("L", { neighbors: ["S"] }), region("S")] }).join()).toContain("not symmetrical");
  });
});
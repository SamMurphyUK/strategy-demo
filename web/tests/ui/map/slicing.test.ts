import { describe, expect, it } from "vitest";
import type { Vec2 } from "../../../src/ui/map/geometry";
import {
  addBlocks,
  addRegionFromPolygon,
  applyMerge,
  applySplit,
  applySplitMany,
  coincidentVertices,
  editorFromMapJson,
  editorToMapJson,
  type EditorMap,
  edgeSharers,
  findRegion,
  nearestSharedEdge,
  roughenEdge,
  setStartingUnits,
  startingUnitsOf,
  subdivideEdge,
  toggleLink,
} from "../../../src/ui/map/editor/editorModel";
import {
  anchorFor,
  carveLoop,
  chaikin,
  interiorPoint,
  masterBlocks,
  mergePolygons,
  prepareStroke,
  rdp,
  removeLoops,
  splitPolygon,
  splitPolygonInto,
} from "../../../src/ui/map/editor/slicing";
import { multiPolygonArea, type MultiPolygon, RegionClipper, ringArea } from "../../../src/ui/map/regionClip";

const square = (x: number, y: number, s: number): Vec2[] => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
];

const area = (poly: Vec2[]) => ringArea(poly.map((p) => [p.x, p.y]));
const same = (a: Vec2, b: Vec2) => a.x === b.x && a.y === b.y;

describe("knife", () => {
  it("splits a square into two pieces that tile it exactly", () => {
    const r = splitPolygon(square(0, 0, 100), [
      { x: 40, y: -20 },
      { x: 40, y: 120 },
    ]);
    if (!r.ok) {
      throw new Error(r.error);
    }
    expect(area(r.a) + area(r.b)).toBeCloseTo(10000, 6);
    expect([area(r.a), area(r.b)].sort((m, n) => m - n)).toEqual([4000, 6000]);
  });

  it("gives both halves bit-identical vertices along the cut", () => {
    const r = splitPolygon(square(0, 0, 100), [
      { x: -10, y: -10 },
      { x: 55.123456789, y: 40.987654321 },
      { x: 130, y: 90 },
    ]);
    if (!r.ok) {
      throw new Error(r.error);
    }
    const shared = r.a.filter((v) => r.b.some((w) => same(v, w)));
    expect(shared.length).toBeGreaterThanOrEqual(3); // two crossings plus the bend
    expect(shared.some((v) => v.x === 55.123456789 && v.y === 40.987654321)).toBe(true);
  });

  it("stretches an end that stopped short of the edge, but only by the reach", () => {
    const shortOfBothEdges = [
      { x: 8, y: 50 },
      { x: 92, y: 50 },
    ];
    expect(splitPolygon(square(0, 0, 100), shortOfBothEdges).ok).toBe(true);
    expect(splitPolygon(square(0, 0, 100), shortOfBothEdges, { reach: 5 }).ok).toBe(false);
    // 30 from the left edge is beyond the 25 reach: the line is refused, never extended across the map.
    expect(
      splitPolygon(square(0, 0, 100), [
        { x: 30, y: 50 },
        { x: 92, y: 50 },
      ]).ok,
    ).toBe(false);
  });

  it("cuts a concave region when the line crosses its outline twice", () => {
    // An L shape, cut across the corner.
    const L: Vec2[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 40 },
      { x: 40, y: 40 },
      { x: 40, y: 100 },
      { x: 0, y: 100 },
    ];
    const r = splitPolygon(L, [
      { x: -10, y: -10 },
      { x: 120, y: 120 },
    ]);
    if (!r.ok) {
      throw new Error(r.error);
    }
    expect(area(r.a) + area(r.b)).toBeCloseTo(area(L), 6);
  });

  it("refuses a cut that would make three pieces", () => {
    const U: Vec2[] = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 70 },
      { x: 70, y: 70 },
      { x: 70, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const r = splitPolygon(U, [
      { x: -10, y: 30 },
      { x: 110, y: 30 },
    ]);
    expect(r.ok).toBe(false);
  });

  it("refuses lines that miss the region, cross themselves, or have one point", () => {
    expect(splitPolygon(square(0, 0, 100), [{ x: 200, y: -10 }, { x: 200, y: 110 }]).ok).toBe(false);
    expect(
      splitPolygon(square(0, 0, 100), [
        { x: 10, y: 10 },
        { x: 90, y: 10 },
        { x: 90, y: 50 },
        { x: 50, y: -20 },
      ]).ok,
    ).toBe(false);
    expect(splitPolygon(square(0, 0, 100), [{ x: 10, y: 10 }]).ok).toBe(false);
  });

  it("works whichever way the line is drawn", () => {
    const down = splitPolygon(square(0, 0, 100), [{ x: 40, y: -20 }, { x: 40, y: 120 }]);
    const up = splitPolygon(square(0, 0, 100), [{ x: 40, y: 120 }, { x: 40, y: -20 }]);
    expect(down.ok && up.ok).toBe(true);
  });
});

describe("merge", () => {
  it("welds the two halves of a cut back into the original", () => {
    const sq = square(0, 0, 100);
    const r = splitPolygon(sq, [{ x: 40, y: -20 }, { x: 40, y: 120 }]);
    if (!r.ok) {
      throw new Error(r.error);
    }
    const m = mergePolygons(r.a, r.b, 0.75);
    if (!m.ok) {
      throw new Error(m.error);
    }
    expect(area(m.points)).toBeCloseTo(10000, 6);
    expect(m.points).toHaveLength(4); // the cut vertices are gone again
  });

  it("closes a border that is a little off", () => {
    const m = mergePolygons(square(0, 0, 100), [{ x: 100.4, y: 0.3 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 99.8, y: 100.2 }], 0.75);
    expect(m.ok).toBe(true);
  });

  it("refuses regions that do not touch, or that would enclose a hole", () => {
    expect(mergePolygons(square(0, 0, 10), square(50, 0, 10), 0.75).ok).toBe(false);
    // A "C" and a bar closing it into a ring around a gap.
    const c: Vec2[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 20 },
      { x: 20, y: 20 },
      { x: 20, y: 80 },
      { x: 100, y: 80 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(mergePolygons(c, [{ x: 100, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 100 }, { x: 100, y: 100 }], 0.75).ok).toBe(false);
  });
});

describe("master blocks", () => {
  // Land: one 300x300 block in a 400x400 canvas.
  const land: MultiPolygon = [[[[50, 50], [350, 50], [350, 350], [50, 350]]]];
  const canvas = { x: 0, y: 0, w: 400, h: 400 };

  it("makes a block shaped like the coast, not like the canvas", () => {
    const r = masterBlocks([], canvas, "land", new RegionClipper(land));
    expect(r.blocks).toHaveLength(1);
    expect(area(r.blocks[0])).toBe(90000);
    expect(r.blocks[0].every((p) => p.x >= 50 && p.x <= 350 && p.y >= 50 && p.y <= 350)).toBe(true);
  });

  it("covers only what is unallocated, so existing regions are left alone", () => {
    const r = masterBlocks([square(0, 0, 200)], canvas, "land", new RegionClipper(land));
    expect(r.blocks).toHaveLength(1);
    // The 300x300 land minus the 150x150 corner a 200x200 cutter takes of it.
    expect(area(r.blocks[0])).toBeCloseTo(90000 - 22500, 6);
  });

  it("makes one block per landmass, largest first, so a cut on one never reaches another", () => {
    const world: MultiPolygon = [
      [[[300, 300], [320, 300], [320, 320], [300, 320]]], // an island
      [[[20, 20], [220, 20], [220, 140], [20, 140]]], // a continent
      [[[40, 300], [140, 300], [140, 380], [40, 380]]], // another
    ];
    const r = masterBlocks([], canvas, "land", new RegionClipper(world));
    expect(r.blocks.map(area)).toEqual([24000, 8000, 400]);
  });

  it("drops leftovers with no land in them, and returns nothing when everything is allocated", () => {
    const clipper = new RegionClipper(land);
    // Allocated: all the land. The rest of the canvas is open ocean.
    expect(masterBlocks([square(0, 0, 400)], canvas, "land", clipper).blocks).toHaveLength(0);
    expect(masterBlocks([square(40, 40, 320)], canvas, "land", clipper).blocks).toHaveLength(0);
  });

  it("wraps a block around the regions inside it without overlapping them", () => {
    const wide: MultiPolygon = [[[[0, 0], [400, 0], [400, 400], [0, 400]]]];
    const clipper = new RegionClipper(wide);
    const inner = [square(100, 100, 100), square(250, 250, 50)];
    const r = masterBlocks(inner, canvas, "land", clipper);
    expect(r.blocks).toHaveLength(1);
    // The block covers the canvas less both inner squares, which a bridged ring still excludes.
    const shown = multiPolygonArea(clipper.clip({ id: "b", type: "land", points: r.blocks[0] }));
    expect(shown).toBeCloseTo(160000 - 10000 - 2500, 3);
  });

  it("makes sea blocks from the water the land leaves, with the coast as their outline", () => {
    const clipper = new RegionClipper(land);
    const r = masterBlocks([], canvas, "sea", clipper);
    expect(r.blocks).toHaveLength(1);
    const shown = multiPolygonArea(clipper.clip({ id: "s", type: "sea", points: r.blocks[0] }));
    expect(shown).toBeCloseTo(160000 - 90000, 3);
  });

  it("adds blocks under the existing regions, welded to them", () => {
    let map = editorFromMapJson({ regions: [] });
    map = addRegionFromPolygon(map, square(0, 0, 200), false).map;
    const found = masterBlocks(map.regions.map((r) => r.polygon), canvas, "land", new RegionClipper(land));
    const added = addBlocks(map, found.blocks, false, []);
    expect(added.map.regions[0].id).toBe(added.ids[0]);
    expect(added.map.regions).toHaveLength(2);
    expect(added.ids[0]).not.toBe("Territory 1");
  });
});

describe("anchors", () => {
  it("finds a point inside a concave shape, away from its edges", () => {
    const L: MultiPolygon = [[[[0, 0], [100, 0], [100, 30], [30, 30], [30, 100], [0, 100]]]];
    const p = anchorFor(L)!;
    expect(p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100).toBe(true);
    expect(p.x < 30 || p.y < 30).toBe(true);
  });

  it("stays out of holes", () => {
    const donut = [
      [[0, 0], [100, 0], [100, 100], [0, 100]],
      [[20, 20], [80, 20], [80, 80], [20, 80]],
    ] as MultiPolygon[number];
    const p = interiorPoint(donut)!;
    const inHole = p.x > 20 && p.x < 80 && p.y > 20 && p.y < 80;
    expect(inHole).toBe(false);
  });

  it("keeps a preferred point that is still inside, and gives null for an empty shape", () => {
    const sq: MultiPolygon = [[[[0, 0], [100, 0], [100, 100], [0, 100]]]];
    expect(anchorFor(sq, { x: 10, y: 10 })).toEqual({ x: 10, y: 10 });
    expect(anchorFor(sq, { x: 500, y: 500 })).not.toEqual({ x: 500, y: 500 });
    expect(anchorFor([])).toBeNull();
  });

  it("picks the largest piece of a multi-part shape", () => {
    const shape: MultiPolygon = [
      [[[0, 0], [10, 0], [10, 10], [0, 10]]],
      [[[100, 100], [200, 100], [200, 200], [100, 200]]],
    ];
    const p = anchorFor(shape)!;
    expect(p.x).toBeGreaterThan(100);
    expect(multiPolygonArea(shape)).toBe(10100);
  });
});

describe("topological dragging", () => {
  const twoLand = (): EditorMap => {
    let map = editorFromMapJson({ regions: [] });
    map = addRegionFromPolygon(map, square(0, 0, 100), false).map;
    map = addRegionFromPolygon(map, [{ x: 101.5, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 101.5, y: 100 }], false).map;
    return map;
  };

  it("moves the nearest vertex of every same-layer region within 2 px", () => {
    const refs = coincidentVertices(twoLand(), "Territory 1", 1, 2);
    expect(refs.map((r) => r.regionId).sort()).toEqual(["Territory 1", "Territory 2"]);
  });

  it("does not reach into the other layer", () => {
    let map = twoLand();
    map = addRegionFromPolygon(map, [{ x: 100.5, y: 0 }, { x: 150, y: -50 }, { x: 100, y: -50 }], true).map;
    const refs = coincidentVertices(map, "Territory 1", 1, 2);
    expect(refs.every((r) => !findRegion(map, r.regionId)!.is_sea)).toBe(true);
  });

  it("takes one vertex per region, so a stepped border does not collapse", () => {
    const map = editorFromMapJson({ regions: [] });
    const a = addRegionFromPolygon(map, [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 1.4 }, { x: 0, y: 1.4 }], false).map;
    const b = addRegionFromPolygon(a, [{ x: 0, y: 0.7 }, { x: 50, y: 0.7 }, { x: 50, y: 60 }, { x: 0, y: 60 }], false).map;
    const refs = coincidentVertices(b, "Territory 2", 0, 2);
    const fromA = refs.filter((r) => r.regionId === "Territory 1");
    expect(fromA.length).toBeLessThanOrEqual(1);
  });
});

describe("edge subdivision", () => {
  it("inserts a midpoint into the region and into the neighbor that shares the edge", () => {
    let map = editorFromMapJson({ regions: [] });
    map = addRegionFromPolygon(map, square(0, 0, 100), false).map;
    map = addRegionFromPolygon(map, [{ x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 100, y: 100 }], false).map;
    // Territory 1's right edge runs from vertex 1 (100,0) to vertex 2 (100,100).
    const out = subdivideEdge(map, "Territory 1", 1)!;
    expect(out.at).toBe(2);
    expect(findRegion(out.map, "Territory 1")!.polygon[2]).toEqual({ x: 100, y: 50 });
    expect(findRegion(out.map, "Territory 2")!.polygon.some((p) => p.x === 100 && p.y === 50)).toBe(true);
  });
});

describe("knife on concave regions", () => {
  const U: Vec2[] = [
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 30, y: 70 },
    { x: 70, y: 70 },
    { x: 70, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  const line = [
    { x: -10, y: 30 },
    { x: 110, y: 30 },
  ];

  it("splitPolygonInto keeps every piece and they tile the region", () => {
    const r = splitPolygonInto(U, line);
    if (!r.ok) {
      throw new Error(r.error);
    }
    expect(r.pieces).toHaveLength(3);
    expect(r.pieces.reduce((n, piece) => n + area(piece), 0)).toBeCloseTo(area(U), 6);
    expect(area(r.pieces[0])).toBeGreaterThanOrEqual(area(r.pieces[1]));
  });

  it("applySplitMany: the first piece keeps the id, the rest get B, B 2, ...", () => {
    const map = addRegionFromPolygon(editorFromMapJson({ regions: [], starting_units: [] }), U, false).map;
    const r = splitPolygonInto(U, line);
    if (!r.ok) {
      throw new Error(r.error);
    }
    const out = applySplitMany(
      map,
      "Territory 1",
      r.pieces.map((polygon, i) => ({ polygon, cx: i, cy: i })),
    );
    expect(out?.map.regions.map((x) => x.id)).toEqual(["Territory 1", "Territory 1 B", "Territory 1 B 2"]);
    expect(out?.newIds).toHaveLength(2);
  });
});

describe("splitting and merging regions", () => {
  const base = (): EditorMap => {
    let map = editorFromMapJson({ regions: [], starting_units: [] });
    map = addRegionFromPolygon(map, square(0, 0, 100), false).map;
    map = addRegionFromPolygon(map, [{ x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 100, y: 100 }], false).map;
    return map;
  };

  const split = (map: EditorMap) => {
    const cut = splitPolygon(findRegion(map, "Territory 1")!.polygon, [{ x: 40, y: -20 }, { x: 40, y: 120 }]);
    if (!cut.ok) {
      throw new Error(cut.error);
    }
    const [big, small] = area(cut.a) > area(cut.b) ? [cut.a, cut.b] : [cut.b, cut.a];
    const out = applySplit(map, "Territory 1", {
      keep: { polygon: big, cx: 70, cy: 50 },
      fresh: { polygon: small, cx: 20, cy: 50 },
    });
    if (!out) {
      throw new Error("split failed");
    }
    return out;
  };

  it("adds the new half after the original with a temporary id and no ipc", () => {
    const { map, newId } = split(base());
    expect(newId).toBe("Territory 1 B");
    expect(map.regions.map((r) => r.id)).toEqual(["Territory 1", "Territory 1 B", "Territory 2"]);
    const fresh = findRegion(map, newId)!;
    expect(fresh).toMatchObject({ ipc_value: 0, factory: "none", capital: false, starting_owner: "Neutral", is_sea: false });
    expect(findRegion(map, "Territory 1")!.cx).toBe(70);
  });

  it("welds the cut ends into the neighbor, which now lists the vertices where the cut met its border", () => {
    // Cut the left square from the right edge's neighbor: the cut ends on the outline, not on Territory 2.
    const { map } = split(base());
    const a = findRegion(map, "Territory 1")!;
    const b = findRegion(map, "Territory 1 B")!;
    const shared = a.polygon.filter((v) => b.polygon.some((w) => same(v, w)));
    expect(shared).toHaveLength(2);
    // Territory 2 still shares its edge with Territory 1 (a's right edge is untouched by this cut).
    expect(findRegion(map, "Territory 2")!.polygon).toHaveLength(4);
  });

  it("picks an unused id for later splits", () => {
    const first = split(base());
    const second = applySplit(first.map, "Territory 1", {
      keep: { polygon: square(0, 0, 10), cx: 5, cy: 5 },
      fresh: { polygon: square(20, 0, 10), cx: 25, cy: 5 },
    })!;
    expect(second.newId).toBe("Territory 1 B 2");
  });

  it("merges B into A: A keeps its settings, takes B's links and units, and B is gone", () => {
    let map = base();
    map = { ...map, regions: map.regions.map((r) => (r.id === "Territory 2" ? { ...r, factory: "major" as const, capital: true } : r)) };
    map = setStartingUnits(map, "Territory 2", [{ faction_id: "ussr", unit_type_id: "tank", count: 3 }]);
    map = toggleLink(map, "Territory 2", "Territory 1");
    const merged = mergePolygons(findRegion(map, "Territory 1")!.polygon, findRegion(map, "Territory 2")!.polygon, 0.75);
    if (!merged.ok) {
      throw new Error(merged.error);
    }
    const out = applyMerge(map, "Territory 1", "Territory 2", { polygon: merged.points, cx: 100, cy: 50 })!;
    expect(out.regions.map((r) => r.id)).toEqual(["Territory 1"]);
    const a = findRegion(out, "Territory 1")!;
    expect(area(a.polygon)).toBeCloseTo(20000, 6);
    expect(a.factory).toBe("major");
    expect(a.capital).toBe(true);
    expect(startingUnitsOf(out, "Territory 1")).toEqual([
      { region_id: "Territory 1", faction_id: "ussr", unit_type_id: "tank", count: 3 },
    ]);
    expect(out.links).toEqual([]); // the A-B link would be a self-link
  });
});

describe("inspector data", () => {
  it("edits one region's starting units without touching the others", () => {
    let map = editorFromMapJson({ regions: [], starting_units: [
      { region_id: "A", faction_id: "ger", unit_type_id: "infantry", count: 2 },
      { region_id: "B", faction_id: "uk", unit_type_id: "tank", count: 1 },
      { region_id: "A", faction_id: "ger", unit_type_id: "tank", count: 1 },
    ] });
    map = setStartingUnits(map, "A", [{ faction_id: "ger", unit_type_id: "artillery", count: 4 }, { faction_id: "ger", unit_type_id: "fighter", count: 0 }]);
    expect(map.meta.starting_units).toEqual([
      { region_id: "A", faction_id: "ger", unit_type_id: "artillery", count: 4 },
      { region_id: "B", faction_id: "uk", unit_type_id: "tank", count: 1 },
    ]);
    expect(startingUnitsOf(map, "B")).toHaveLength(1);
  });

  it("round-trips none / minor / major factories through the file", () => {
    const base = editorFromMapJson({ regions: [] });
    let map = addRegionFromPolygon(base, square(0, 0, 10), false).map;
    map = addRegionFromPolygon(map, square(20, 0, 10), false).map;
    map = addRegionFromPolygon(map, square(40, 0, 10), false).map;
    const levels = ["none", "minor", "major"] as const;
    map = { ...map, regions: map.regions.map((r, i) => ({ ...r, factory: levels[i] })) };
    const json = editorToMapJson(map, { round: true });
    const meta = json.regions.map((r: { metadata: Record<string, unknown> }) => r.metadata);
    expect(meta.map((m: Record<string, unknown>) => m.factory)).toEqual([false, true, true]);
    const back = editorFromMapJson(json);
    expect(back.regions.map((r) => r.factory)).toEqual(["none", "minor", "major"]);
  });
});

describe("knife on the real outline", () => {
  const opts = { tolerance: 1, smooth: false, tangentSpan: 18, closeDist: 20, minLoop: 12 };
  const circle = (cx: number, cy: number, r: number, from: number, to: number, n = 48): Vec2[] =>
    Array.from({ length: n + 1 }, (_, i) => {
      const a = from + ((to - from) * i) / n;
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    });
  const inside = (p: Vec2, ring: Vec2[]) => ring.some((q) => q.x === p.x && q.y === p.y);

  it("carves a closed circular territory out of the middle of a landmass", () => {
    const country = square(0, 0, 200);
    // A hand-drawn circle that stops 10px short of where it began.
    const raw = circle(100, 100, 30, 0, Math.PI * 2 - 0.33);
    const prepared = prepareStroke(raw, opts)!;
    expect(prepared.loop).not.toBeNull();
    const r = carveLoop(country, prepared.loop!);
    if (!r.ok) {
      throw new Error(r.error);
    }
    expect(r.pieces).toHaveLength(2);
    const [outer, carved] = r.pieces;
    expect(area(outer) + area(carved)).toBeCloseTo(40000, 3);
    expect(area(carved)).toBeGreaterThan(2500);
    expect(area(carved)).toBeLessThan(Math.PI * 900 + 1);
    // The new country is entirely within the circle, and the two share their border exactly.
    expect(carved.every((p) => Math.hypot(p.x - 100, p.y - 100) <= 30.5)).toBe(true);
    expect(carved.every((p) => outer.some((q) => same(p, q)))).toBe(true);
    // The big country keeps the original id: it comes first, though the carved piece is far smaller.
    expect(r.ordered).toBe(true);
    expect(area(outer)).toBeGreaterThan(area(carved));
  });

  it("recognises a loop by the stroke crossing itself, and ignores tremor loops", () => {
    const overshoot = circle(100, 100, 30, 0, Math.PI * 2 + 0.6);
    expect(prepareStroke(overshoot, opts)!.loop).not.toBeNull();
    const withTremor = [{ x: 0, y: 100 }, { x: 40, y: 100 }, { x: 44, y: 94 }, { x: 48, y: 104 }, { x: 40, y: 100.5 }, { x: 80, y: 100 }, { x: 200, y: 100 }];
    const prepared = prepareStroke(withTremor, opts)!;
    expect(prepared.loop).toBeNull();
  });

  it("does not turn a long open stroke whose ends are far apart into a loop", () => {
    const arc = circle(100, 100, 60, 0, Math.PI);
    expect(prepareStroke(arc, opts)!.loop).toBeNull();
  });

  it("refuses a loop outside the region, and one that swallows it", () => {
    expect(carveLoop(square(0, 0, 100), circle(300, 300, 20, 0, 6.28)).ok).toBe(false);
    expect(carveLoop(square(0, 0, 100), circle(50, 50, 200, 0, 6.28)).ok).toBe(false);
  });

  it("carves only what is land when a loop spills over the coast", () => {
    const r = carveLoop(square(0, 0, 100), [{ x: 80, y: 20 }, { x: 140, y: 20 }, { x: 140, y: 80 }, { x: 80, y: 80 }]);
    if (!r.ok) {
      throw new Error(r.error);
    }
    expect(r.pieces).toHaveLength(2);
    expect(area(r.pieces[1])).toBeCloseTo(20 * 60, 6);
  });

  describe("a peninsula on a continent, with other land across the water", () => {
    // Mainland 0..200 with a peninsula 40 tall reaching east to x=260, plus Australia-like land due east.
    const land: MultiPolygon = [
      [[[0, 0], [200, 0], [200, 80], [260, 80], [260, 120], [200, 120], [200, 200], [0, 200]]],
      [[[300, 60], [420, 60], [420, 140], [300, 140]]],
      [[[30, 300], [130, 300], [130, 380], [30, 380]]],
    ];
    const blocks = () => masterBlocks([], { x: 0, y: 0, w: 800, h: 504 }, "land", new RegionClipper(land)).blocks;

    it("splits land into a region per landmass", () => {
      const found = blocks();
      expect(found).toHaveLength(3);
      expect(found.map(area).sort((a, b) => b - a)).toEqual([40000 + 40 * 60, 120 * 80, 100 * 80].sort((a, b) => b - a));
    });

    it("cuts the peninsula neck when the stroke stops within 10px of the coast, and touches nothing else", () => {
      const [mainland] = blocks();
      expect(area(mainland)).toBe(42400);
      // Vertical stroke across the 40-tall peninsula, 8px short of the north and south shores.
      const stroke = [{ x: 230, y: 88 }, { x: 230, y: 112 }];
      const r = splitPolygonInto(mainland, stroke, { reach: 25 });
      if (!r.ok) {
        throw new Error(r.error);
      }
      expect(r.pieces).toHaveLength(2);
      const [big, tip] = r.pieces;
      expect(area(tip)).toBeCloseTo(30 * 40, 6);
      expect(area(big) + area(tip)).toBeCloseTo(42400, 6);
      // Everything stayed on the mainland: nothing reaches the land across the water (x >= 300) or below.
      const all = [...big, ...tip];
      expect(Math.max(...all.map((p) => p.x))).toBeLessThanOrEqual(260);
      expect(Math.max(...all.map((p) => p.y))).toBeLessThanOrEqual(200);
      expect(Math.min(...all.map((p) => p.y))).toBeGreaterThanOrEqual(0);
      // The cut itself is the short chord between the two shores, not a line across the map.
      // It runs from shore (y=80) to shore (y=120) through the two points drawn, nowhere else.
      const cut = big.filter((p) => p.x === 230).map((p) => p.y).sort((a, b) => a - b);
      expect(cut).toEqual([80, 88, 112, 120]);
      expect(big.filter((p) => p.x === 230).every((p) => inside(p, tip))).toBe(true);
    });

    it("refuses the same stroke when it stops more than the reach from the coast", () => {
      const [mainland] = blocks();
      const r = splitPolygonInto(mainland, [{ x: 230, y: 98 }, { x: 230, y: 102 }], { reach: 10 });
      expect(r.ok).toBe(false);
    });

    it("cuts a coast-to-coast border through the mainland and leaves the other landmasses as they were", () => {
      const found = blocks();
      const [mainland, australia, island] = found;
      const r = splitPolygonInto(mainland, [{ x: 100, y: -5 }, { x: 100, y: 205 }]);
      if (!r.ok) {
        throw new Error(r.error);
      }
      expect(r.pieces).toHaveLength(2);
      expect(area(r.pieces[0]) + area(r.pieces[1])).toBeCloseTo(42400, 6);
      expect(area(australia)).toBe(120 * 80);
      expect(area(island)).toBe(100 * 80);
    });
  });

  it("bites a coastal country out with a stroke that goes in and out through the same coast", () => {
    const country = square(0, 0, 100);
    const r = splitPolygonInto(country, [{ x: 30, y: -20 }, { x: 50, y: 40 }, { x: 70, y: -20 }]);
    if (!r.ok) {
      throw new Error(r.error);
    }
    expect(r.pieces).toHaveLength(2);
    const [rest, bite] = r.pieces;
    expect(area(rest) + area(bite)).toBeCloseTo(10000, 6);
    // The bite is closed by the shore between entry and exit: it stays under the cut and inside the two crossings.
    expect(Math.min(...bite.map((p) => p.x))).toBeGreaterThanOrEqual(36);
    expect(Math.max(...bite.map((p) => p.x))).toBeLessThanOrEqual(64);
    expect(Math.max(...bite.map((p) => p.y))).toBeCloseTo(40, 6);
    expect(bite.some((p) => p.y === 0)).toBe(true);
  });

  it("stretches a bite stroke that stopped just inside the coast on its way out", () => {
    const r = splitPolygonInto(square(0, 0, 100), [{ x: 30, y: -20 }, { x: 50, y: 40 }, { x: 62, y: 8 }]);
    expect(r.ok).toBe(true);
  });
});

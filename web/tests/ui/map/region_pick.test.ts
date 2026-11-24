import { describe, expect, it } from "vitest";
import type { RegionShape, Vec2 } from "../../../src/ui/map/geometry";
import type { MultiPolygon, Ring } from "../../../src/ui/map/regionClip";
import { buildPickShapes, pickRegionAt } from "../../../src/ui/map/regionPick";

function square(x: number, y: number, size: number): Vec2[] {
  return [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ];
}

function ring(x: number, y: number, size: number): Ring {
  return square(x, y, size).map((p) => [p.x, p.y]);
}

function region(id: string, type: "land" | "sea", points: Vec2[], extra?: Vec2[][]): RegionShape {
  return {
    id,
    type,
    ipc: 0,
    hasFactory: false,
    points,
    ...(extra ? { extra } : {}),
    bounds: { x: 0, y: 0, w: 0, h: 0 },
    centroid: points[0],
    anchor: points[0],
  };
}

describe("pickRegionAt on clipped shapes", () => {
  // A 10x10 island with a 2x2 lake, inside a 20x20 sea zone that has the island cut out of it.
  const island = region("island", "land", square(5, 5, 10));
  const sea = region("sea", "sea", square(0, 0, 20));
  const clipped = new Map<string, MultiPolygon>([
    ["island", [[ring(5, 5, 10), ring(9, 9, 2)]]],
    ["sea", [[ring(0, 0, 20), ring(5, 5, 10)]]],
  ]);
  const shapes = buildPickShapes([sea, island], clipped);

  it("is exact when every region has a clipped shape", () => {
    expect(shapes.exact).toBe(true);
  });

  it("picks the land inside the coastline and the sea outside it", () => {
    expect(pickRegionAt(shapes, { x: 7, y: 7 })).toBe("island");
    expect(pickRegionAt(shapes, { x: 2, y: 2 })).toBe("sea");
  });

  it("leaves a lake open", () => {
    expect(pickRegionAt(shapes, { x: 10, y: 10 })).toBe("");
  });

  it("returns nothing off the board", () => {
    expect(pickRegionAt(shapes, { x: -1, y: 5 })).toBe("");
    expect(pickRegionAt(shapes, { x: 5, y: 21 })).toBe("");
  });

  it("limits the pick to one layer", () => {
    expect(pickRegionAt(shapes, { x: 7, y: 7 }, { only: "sea" })).toBe("");
    expect(pickRegionAt(shapes, { x: 7, y: 7 }, { only: "land" })).toBe("island");
    expect(pickRegionAt(shapes, { x: 2, y: 2 }, { only: "land" })).toBe("");
  });

  it("skips a region the clipper left empty", () => {
    const ghost = region("ghost", "land", square(0, 0, 20));
    const withGhost = buildPickShapes(
      [sea, island, ghost],
      new Map<string, MultiPolygon>([...clipped, ["ghost", []]]),
    );
    expect(pickRegionAt(withGhost, { x: 2, y: 2 })).toBe("sea");
  });

  it("gives the later region where two shapes overlap", () => {
    const a = region("a", "land", square(0, 0, 10));
    const b = region("b", "land", square(5, 0, 10));
    const overlap = buildPickShapes(
      [a, b],
      new Map<string, MultiPolygon>([
        ["a", [[ring(0, 0, 10)]]],
        ["b", [[ring(5, 0, 10)]]],
      ]),
    );
    expect(pickRegionAt(overlap, { x: 7, y: 5 })).toBe("b");
    expect(pickRegionAt(overlap, { x: 2, y: 5 })).toBe("a");
  });
});

describe("pickRegionAt on rough cutters", () => {
  // Both cutters cover the whole box. The land polygon decides which one a point belongs to.
  const coast = region("coast", "land", square(0, 0, 20));
  const water = region("water", "sea", square(0, 0, 20));
  const land: MultiPolygon = [[ring(0, 0, 10)]];
  const shapes = buildPickShapes([coast, water], null);

  it("is not exact without clipped shapes", () => {
    expect(shapes.exact).toBe(false);
  });

  it("asks the land polygon which layer the point is in", () => {
    expect(pickRegionAt(shapes, { x: 5, y: 5 }, { land })).toBe("coast");
    expect(pickRegionAt(shapes, { x: 15, y: 15 }, { land })).toBe("water");
  });

  it("gives the later cutter when there is no land polygon", () => {
    expect(pickRegionAt(shapes, { x: 5, y: 5 })).toBe("water");
  });

  it("picks the other islands of a territory", () => {
    const chain = region("chain", "land", square(0, 0, 4), [square(10, 10, 4)]);
    const cutters = buildPickShapes([chain], null);
    expect(pickRegionAt(cutters, { x: 2, y: 2 })).toBe("chain");
    expect(pickRegionAt(cutters, { x: 12, y: 12 })).toBe("chain");
    expect(pickRegionAt(cutters, { x: 7, y: 7 })).toBe("");
  });
});

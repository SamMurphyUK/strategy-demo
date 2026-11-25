import { describe, expect, it } from "vitest";
import { type MultiPolygon, multiPolygonArea, type Ring } from "../../../../src/ui/map/regionClip";
import { flatGeometry, outlineGeometry, paintOf, planArea, shapesOf, slabGeometry } from "../../../../src/ui/viewport3d/vanilla/regionMeshes";

/** A closed ring, first point repeated, as the clipper returns it. */
function closedSquare(x: number, y: number, size: number): Ring {
  return [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
    [x, y],
  ];
}

// A 10x10 island with a 2x2 lake, and a separate 4x4 islet.
const ISLANDS: MultiPolygon = [[closedSquare(0, 0, 10), closedSquare(4, 4, 2)], [closedSquare(20, 20, 4)]];

describe("region meshes", () => {
  it("makes one shape per polygon and keeps the holes", () => {
    const shapes = shapesOf(ISLANDS);
    expect(shapes).toHaveLength(2);
    expect(shapes[0].holes).toHaveLength(1);
    expect(shapes[1].holes).toHaveLength(0);
  });

  it("drops the repeated closing point and flips y", () => {
    const points = shapesOf(ISLANDS)[1].getPoints();
    const unique = new Set(points.map((p) => `${p.x},${p.y}`));
    expect(unique).toEqual(new Set(["20,-20", "24,-20", "24,-24", "20,-24"]));
  });

  it("triangulates the same area the 2D map fills", () => {
    const geometry = flatGeometry(ISLANDS);
    expect(multiPolygonArea(ISLANDS)).toBe(100 - 4 + 16);
    expect(planArea(geometry)).toBeCloseTo(multiPolygonArea(ISLANDS), 6);
  });

  it("raises a slab to the given height with a top slot and a cliff slot", () => {
    const geometry = slabGeometry(ISLANDS, 1.5);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox?.min.z).toBeCloseTo(0, 9);
    expect(geometry.boundingBox?.max.z).toBeCloseTo(1.5, 9);
    expect(new Set(geometry.groups.map((group) => group.materialIndex))).toEqual(new Set([0, 1]));
  });

  it("draws every ring edge once in the outline", () => {
    const geometry = outlineGeometry([ISLANDS], 2);
    const position = geometry.getAttribute("position");
    // Three squares, four edges each, two points per edge.
    expect(position.count).toBe(3 * 4 * 2);
    for (let i = 0; i < position.count; i++) {
      expect(position.getZ(i)).toBe(2);
      expect(position.getY(i)).toBeLessThanOrEqual(0);
    }
  });

  it("reads the map's CSS colours", () => {
    const wash = paintOf("rgba(242, 38, 31, 0.52)");
    expect(wash.opacity).toBe(0.52);
    expect(wash.color.getHexString()).toBe("f2261f");
    const solid = paintOf("#B6C4CC");
    expect(solid.opacity).toBe(1);
    expect(solid.color.getHexString()).toBe("b6c4cc");
  });
});

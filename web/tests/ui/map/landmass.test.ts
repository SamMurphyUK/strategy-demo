import { describe, expect, it } from "vitest";
import { multiPolygonArea, pointInMultiPolygon } from "../../../src/ui/map/regionClip";
import {
  bakeLandmass,
  blobFromStroke,
  type DraftShape,
  landmassToSvg,
  shapesFromSvg,
  simplifyClosed,
} from "../../../src/ui/map/editor/landmass";

function square(id: string, x: number, y: number, size: number, hole = false): DraftShape {
  return {
    id,
    hole,
    holes: [],
    ring: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  };
}

describe("landmass bake", () => {
  it("unions overlapping outlines and keeps separate islands", () => {
    const welded = bakeLandmass([square("a", 0, 0, 10), square("b", 8, 0, 10)], 0);
    expect(welded.ok).toBe(true);
    if (!welded.ok) return;
    expect(welded.polygons).toHaveLength(1);
    expect(multiPolygonArea(welded.polygons)).toBeCloseTo(180, 0);

    const islands = bakeLandmass([square("a", 0, 0, 4), square("b", 20, 20, 4)], 0);
    expect(islands.ok).toBe(true);
    if (!islands.ok) return;
    expect(islands.polygons).toHaveLength(2);
  });

  it("keeps an inland hole punched out of the coast", () => {
    const baked = bakeLandmass([square("land", 0, 0, 20), square("lake", 5, 5, 10, true)], 0);
    expect(baked.ok).toBe(true);
    if (!baked.ok) return;
    expect(multiPolygonArea(baked.polygons)).toBeCloseTo(300, 0);
    expect(pointInMultiPolygon({ x: 1, y: 1 }, baked.polygons)).toBe(true);
    expect(pointInMultiPolygon({ x: 10, y: 10 }, baked.polygons)).toBe(false);
  });

  it("drops a point that sits on a straight edge", () => {
    const ring = simplifyClosed(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 5 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      0.5,
    );
    expect(ring).toHaveLength(4);
  });

  it("writes an even-odd svg and reads the same coast back", () => {
    const baked = bakeLandmass([square("a", 0, 0, 10), square("lake", 2, 2, 4, true)], 0);
    expect(baked.ok).toBe(true);
    if (!baked.ok) return;
    const svg = landmassToSvg(baked.polygons, { x: 0, y: 0, w: 100, h: 50 });
    expect(svg).toContain('viewBox="0 0 100 50"');
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).toContain("<path ");
    const again = bakeLandmass(shapesFromSvg(svg), 0);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(multiPolygonArea(again.polygons)).toBeCloseTo(multiPolygonArea(baked.polygons), 0);
  });

  it("turns a stroke into one blob outline", () => {
    const blob = blobFromStroke(
      [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
      ],
      4,
    );
    expect(blob).not.toBeNull();
    expect(blob && blob.ring.length).toBeGreaterThanOrEqual(3);
  });
});

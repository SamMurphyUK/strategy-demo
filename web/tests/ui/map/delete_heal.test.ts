import { describe, expect, it } from "vitest";
import {
  addRegionFromPolygon,
  applySplitMany,
  deleteRegion,
  editorFromMapJson,
  findRegion,
  labelPoint,
  updateRegion,
} from "../../../src/ui/map/editor/editorModel";
import { carveLoop, healDeletedRegion } from "../../../src/ui/map/editor/slicing";
import { pointInPolygon, type Vec2 } from "../../../src/ui/map/geometry";
import { ringArea } from "../../../src/ui/map/regionClip";

const square = (x: number, y: number, s: number): Vec2[] => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
];

const area = (ring: Vec2[]) => ringArea(ring.map((p) => [p.x, p.y]));

describe("deleting a region drops the border it shared", () => {
  it("gives a cut-out back to the region it was carved from, so a later cut can cross the old line", () => {
    let map = addRegionFromPolygon(editorFromMapJson({ regions: [] }), square(0, 0, 100), false).map;
    const cut = carveLoop(findRegion(map, "Territory 1")!.polygon, square(20, 20, 30));
    expect(cut.ok).toBe(true);
    if (!cut.ok) {
      return;
    }
    const split = applySplitMany(
      map,
      "Territory 1",
      cut.pieces.map((polygon) => {
        const at = labelPoint(polygon);
        return { polygon, cx: at.x, cy: at.y };
      }),
    )!;
    const healed = healDeletedRegion(split.map, split.newIds[0]);
    expect(healed?.into).toBe("Territory 1");
    const host = findRegion(healed!.map, "Territory 1")!;
    expect(findRegion(healed!.map, split.newIds[0])).toBeUndefined();
    expect(area(host.polygon)).toBeCloseTo(10000, 0);
    expect(pointInPolygon({ x: 35, y: 35 }, host.polygon)).toBe(true);

    const again = carveLoop(host.polygon, square(10, 10, 50));
    expect(again.ok).toBe(true);
    if (!again.ok) {
      return;
    }
    const piece = again.pieces.find((ring) => pointInPolygon({ x: 15, y: 15 }, ring));
    expect(piece).toBeDefined();
    expect(pointInPolygon({ x: 35, y: 35 }, piece!)).toBe(true);
  });

  it("joins a neighbor across the longest shared border and leaves the others in place", () => {
    const wide = [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 40 },
      { x: 0, y: 40 },
    ];
    const mid = [
      { x: 60, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 40 },
      { x: 60, y: 40 },
    ];
    const stub = [
      { x: 60, y: 40 },
      { x: 80, y: 40 },
      { x: 80, y: 50 },
      { x: 60, y: 50 },
    ];
    let map = editorFromMapJson({ regions: [] });
    map = addRegionFromPolygon(map, wide, false).map;
    map = addRegionFromPolygon(map, mid, false).map;
    map = addRegionFromPolygon(map, stub, false).map;
    const beforeStub = findRegion(map, "Territory 3")!.polygon.map((p) => ({ ...p }));
    const healed = healDeletedRegion(map, "Territory 2")!;
    expect(healed.into).toBe("Territory 1");
    const host = findRegion(healed.map, "Territory 1")!;
    expect(area(host.polygon)).toBeCloseTo(60 * 40 + 40 * 40, 0);
    expect(pointInPolygon({ x: 80, y: 20 }, host.polygon)).toBe(true);
    expect(findRegion(healed.map, "Territory 3")!.polygon).toEqual(beforeStub);
  });

  it("drops an island that shared no border instead of keeping it on the neighbor", () => {
    let map = editorFromMapJson({ regions: [] });
    map = addRegionFromPolygon(map, square(0, 0, 20), false).map;
    map = addRegionFromPolygon(map, square(20, 0, 20), false).map;
    map = updateRegion(map, "Territory 2", { extra: [square(200, 0, 10)] });
    const healed = healDeletedRegion(map, "Territory 2")!;
    const host = findRegion(healed.map, "Territory 1")!;
    expect(pointInPolygon({ x: 30, y: 10 }, host.polygon)).toBe(true);
    expect(pointInPolygon({ x: 205, y: 5 }, host.polygon)).toBe(false);
    expect(host.extra ?? []).toEqual([]);
  });

  it("leaves a region that shares no border as a gap", () => {
    let map = editorFromMapJson({ regions: [] });
    map = addRegionFromPolygon(map, square(0, 0, 10), false).map;
    map = addRegionFromPolygon(map, square(100, 0, 10), false).map;
    expect(healDeletedRegion(map, "Territory 2")).toBeNull();
    const gone = deleteRegion(map, "Territory 2");
    expect(findRegion(gone, "Territory 2")).toBeUndefined();
    expect(area(findRegion(gone, "Territory 1")!.polygon)).toBeCloseTo(100, 0);
  });
});

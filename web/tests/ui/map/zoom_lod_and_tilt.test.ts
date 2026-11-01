import { describe, expect, it } from "vitest";
import {
  cliffDepthScale,
  projectionScales,
  screenToWorld,
  tiltFactor,
  worldToScreen,
} from "../../../src/ui/map/viewMath";
import { lodForZoom, sortByGroundY, squadSpriteCount, uprightDrawOrder } from "../../../src/ui/map/zoomLod";

describe("oblique tilt", () => {
  it("round-trips world and screen at a flat zoom and at full tilt", () => {
    for (const zoom of [1, 2.2]) {
      const view = { x: 4, y: -8, k: zoom };
      const world = { x: 30, y: 70 };
      const back = screenToWorld(view, worldToScreen(view, world));
      expect(back.x).toBeCloseTo(world.x, 8);
      expect(back.y).toBeCloseTo(world.y, 8);
    }

    expect(tiltFactor(1)).toBe(0);
    expect(tiltFactor(2.2)).toBe(1);
    expect(projectionScales(1)).toEqual({ sx: 1, sy: 1 });
    const full = projectionScales(2.2);
    expect(full.sx).toBeCloseTo(2.2, 8);
    expect(full.sy).toBeCloseTo(2.2 * 0.85, 8);
    expect(cliffDepthScale(1)).toBe(1);
    expect(cliffDepthScale(2.2)).toBeCloseTo(2.6, 8);
  });
});

describe("semantic zoom lod", () => {
  it("crosses the thresholds and holds the tactical view until 1.65", () => {
    expect(lodForZoom(1.34, 0)).toBe(0);
    expect(lodForZoom(1.35, 0)).toBe(1);
    expect(lodForZoom(1.74, 1)).toBe(1);
    expect(lodForZoom(1.7, 1)).toBe(1);
    expect(lodForZoom(1.75, 0)).toBe(2);
    expect(lodForZoom(1.75, 1)).toBe(2);
    expect(lodForZoom(1.7, 2)).toBe(2);
    expect(lodForZoom(1.65, 2)).toBe(2);
    expect(lodForZoom(1.649, 2)).toBe(1);
    expect(lodForZoom(1.34, 2)).toBe(0);
    expect(squadSpriteCount(1)).toBe(1);
    expect(squadSpriteCount(2)).toBe(1);
    expect(squadSpriteCount(3)).toBe(2);
    expect(squadSpriteCount(6)).toBe(3);
  });

  it("sorts upright sprites, facilities and smoke by worldY in LoD 2", () => {
    const items = [
      { id: "south-unit", worldY: 40 },
      { id: "smoke", worldY: 12 },
      { id: "facility", worldY: 25 },
      { id: "north-unit", worldY: 8 },
    ];
    expect(uprightDrawOrder(1, items).map((item) => item.id)).toEqual([
      "south-unit",
      "smoke",
      "facility",
      "north-unit",
    ]);
    expect(sortByGroundY(items).map((item) => item.id)).toEqual([
      "north-unit",
      "smoke",
      "facility",
      "south-unit",
    ]);
    expect(uprightDrawOrder(2, items).map((item) => item.id)).toEqual([
      "north-unit",
      "smoke",
      "facility",
      "south-unit",
    ]);
  });
});

import { describe, expect, it } from "vitest";
import type { VehicleSvgUnit } from "../../../src/art/fieldVehicleStage";
import { figureStampBox } from "../../../src/ui/map/figureSheet";

/** A 40 by 20 sprite with its feet at (16, 18), drawn at half a CSS pixel per sprite pixel. */
function figure(over: Partial<VehicleSvgUnit> = {}): VehicleSvgUnit {
  return {
    id: "ger|0|tank:0",
    x: 100,
    y: 50,
    unitScale: 0.5,
    rootX: -16,
    rootY: -18,
    face: 1,
    parts: [{ role: "torso", href: "/tank/idle_0.svg", x: 0, y: 0, width: 40, height: 20, resolution: 4 }],
    ...over,
  };
}

describe("figure sheet placement", () => {
  it("puts the picture where the SVG stage put it, with the feet on the stack's point", () => {
    expect(figureStampBox(figure(), 1)).toEqual({ left: 92, top: 41, w: 20, h: 10, mirror: false });
  });

  it("mirrors the picture around the feet", () => {
    // Facing left, the 8 pixels that sat left of the feet sit right of them.
    expect(figureStampBox(figure({ face: -1 }), 1)).toEqual({ left: 88, top: 41, w: 20, h: 10, mirror: true });
  });

  it("sizes the picture in device pixels", () => {
    expect(figureStampBox(figure(), 2)).toEqual({ left: 184, top: 82, w: 40, h: 20, mirror: false });
  });

  it("gives every figure of one kind the same size, wherever its feet fall", () => {
    const a = figureStampBox(figure({ x: 100.2, y: 50.7 }), 1.605)!;
    const b = figureStampBox(figure({ x: 733.9, y: 12.1 }), 1.605)!;
    expect([a.w, a.h]).toEqual([b.w, b.h]);
    expect(Number.isInteger(a.left) && Number.isInteger(a.top)).toBe(true);
  });

  it("skips a figure with no picture", () => {
    expect(figureStampBox(figure({ parts: [] }), 1)).toBeNull();
    expect(figureStampBox(figure({ unitScale: 0 }), 1)).toBeNull();
  });
});

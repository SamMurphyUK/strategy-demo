import { describe, expect, it } from "vitest";
import { MILITARY } from "../../../src/ui/theme/militaryPalette";
import {
  HIGHLIGHT_LUMA,
  liftHighlightPixel,
  separateFigure,
  spriteLuma,
  sunkTerritoryFill,
} from "../../../src/ui/map/figureGround";

function put(data: Uint8ClampedArray, index: number, r: number, g: number, b: number, a: number): void {
  const offset = index * 4;
  data[offset] = r;
  data[offset + 1] = g;
  data[offset + 2] = b;
  data[offset + 3] = a;
}

function pixel(data: Uint8ClampedArray, index: number): number[] {
  const offset = index * 4;
  return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
}

describe("figure-ground separation", () => {
  it("shifts a bright top plane toward parchment and leaves a faction midtone", () => {
    const bright = liftHighlightPixel(230, 220, 210);
    expect(spriteLuma(230, 220, 210)).toBeGreaterThan(HIGHLIGHT_LUMA);
    expect(bright[2]).toBeLessThan(210);
    expect(liftHighlightPixel(0x9c, 0x52, 0x4e)).toEqual([0x9c, 0x52, 0x4e]);
    expect(MILITARY.cream).toBe("#DDCF99");
    expect(MILITARY.crimson).toBe("#9C524E");
  });

  it("paints a 1px outline on the four neighbors and not on a diagonal", () => {
    const data = new Uint8ClampedArray(3 * 3 * 4);
    put(data, 4, 0x9c, 0x52, 0x4e, 255);
    separateFigure(data, 3, 3);
    expect(pixel(data, 4)).toEqual([0x9c, 0x52, 0x4e, 255]);
    for (const neighbor of [1, 3, 5, 7]) {
      expect(pixel(data, neighbor)).toEqual([0x1a, 0x16, 0x14, 255]);
    }
    expect(pixel(data, 0)).toEqual([0, 0, 0, 0]);
  });

  it("darkens a territory fill without replacing the palette entry", () => {
    const sunk = sunkTerritoryFill(MILITARY.crimson);
    const [r, g, b] = [Number.parseInt(sunk.slice(1, 3), 16), Number.parseInt(sunk.slice(3, 5), 16), Number.parseInt(sunk.slice(5, 7), 16)];
    expect(spriteLuma(r, g, b)).toBeLessThan(spriteLuma(0x9c, 0x52, 0x4e));
    expect(MILITARY.crimson).toBe("#9C524E");
  });
});

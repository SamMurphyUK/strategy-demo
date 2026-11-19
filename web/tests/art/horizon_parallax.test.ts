import { describe, expect, it } from "vitest";
import { HORIZON_PARALLAX, HORIZON_PARALLAX_MAX, horizonShiftX } from "../../src/art/horizonParallax";

describe("horizon parallax", () => {
  it("ships at 0, so the skyline stays on the ground line", () => {
    expect(HORIZON_PARALLAX).toBe(0);
  });

  it("never shifts the skyline with the shipped factor, panned or zoomed", () => {
    for (const span of [1, 1.07, 2, 3, 4]) {
      for (const camX of [-900, -260, 0, 120, 640, 2000]) {
        expect(Object.is(horizonShiftX(camX, 0, span), 0)).toBe(true);
        expect(Object.is(horizonShiftX(camX, 300, span), 0)).toBe(true);
      }
    }
  });

  it("is 0 at the default camera for any factor", () => {
    expect(horizonShiftX(0, 0, 1, 0.35)).toBe(0);
    expect(horizonShiftX(480, 480, 2, 0.35)).toBe(0);
  });

  it("can still be switched on: trails the pan, in whole device pixels, within the cap", () => {
    expect(horizonShiftX(120, 0, 1, 0.35)).toBe(-42);
    expect(horizonShiftX(-120, 0, 1, 0.35)).toBe(42);
    expect(horizonShiftX(100000, 0, 1, 0.35)).toBe(-HORIZON_PARALLAX_MAX);
    const shifted = horizonShiftX(37, 0, 2, 0.35);
    expect(Number.isInteger(shifted * 2)).toBe(true);
  });
});

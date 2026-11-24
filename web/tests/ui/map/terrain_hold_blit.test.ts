import { describe, expect, it } from "vitest";
import { panView, projectionScales, terrainHoldPlacement, type View } from "../../../src/ui/map/viewMath";

describe("terrain hold blit placement", () => {
  it("moves the bitmap by N device pixels when the camera pans N CSS pixels", () => {
    const from: View = { x: 40, y: 12, k: 1.4 };
    const cssWidth = 800;
    const cssHeight = 500;
    const dpr = 2;
    const dxCss = 11;
    const dyCss = -7;
    const to = panView(from, dxCss, dyCss);
    const blit = terrainHoldPlacement(from, to, cssWidth, cssHeight, dpr);
    expect(blit.dx).toBeCloseTo(dxCss * dpr, 8);
    expect(blit.dy).toBeCloseTo(dyCss * dpr, 8);
    expect(blit.dw).toBeCloseTo(cssWidth * dpr, 8);
    expect(blit.dh).toBeCloseTo(cssHeight * dpr, 8);
  });

  it("scales the hold with the tilted projection when zoom changes", () => {
    const from: View = { x: 10, y: 20, k: 1.2 };
    const to: View = { x: 10, y: 20, k: 2.2 };
    const dpr = 1.5;
    const blit = terrainHoldPlacement(from, to, 640, 400, dpr);
    const fromScale = projectionScales(from.k);
    const toScale = projectionScales(to.k);
    expect(blit.dx).toBeCloseTo(0, 8);
    expect(blit.dy).toBeCloseTo(0, 8);
    expect(blit.dw).toBeCloseTo(640 * dpr * (toScale.sx / fromScale.sx), 8);
    expect(blit.dh).toBeCloseTo(400 * dpr * (toScale.sy / fromScale.sy), 8);
  });
});

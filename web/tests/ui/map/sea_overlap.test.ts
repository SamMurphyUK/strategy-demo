import { describe, expect, it } from "vitest";
import { FACILITY_ICON_ALPHA } from "../../../src/ui/map/mapRenderer";
import { landShareOf, seaLandOpacity, shouldFadeAtShore, spriteScreenBox } from "../../../src/ui/map/seaOverlap";

describe("ship overlap on land", () => {
  it("keeps a ship solid until more than 40 percent of the picture is inland", () => {
    expect(seaLandOpacity(0.4)).toBeNull();
    expect(seaLandOpacity(0.2)).toBeNull();
    expect(seaLandOpacity(0.41)).toBe(0.3);
  });

  it("counts only the cells the land test accepts", () => {
    const box = { left: 0, top: 0, width: 10, height: 10 };
    const share = landShareOf(box, 2, 2, (x) => x > 5);
    expect(share).toBe(0.5);
  });

  it("mirrors the picture around its feet", () => {
    const right = spriteScreenBox(100, 50, 20, 10, 16, 8, 2, 1);
    const left = spriteScreenBox(100, 50, 20, 10, 16, 8, 2, -1);
    expect(right).toEqual({ left: 68, top: 34, width: 40, height: 20 });
    expect(left.left).toBeCloseTo(100 - (20 - 16) * 2, 5);
    expect(left.width).toBe(40);
    expect(left.top).toBe(34);
  });
});

describe("facility marks", () => {
  it("draws factories, airfields and harbours 40 percent more opaque", () => {
    expect(FACILITY_ICON_ALPHA).toBeCloseTo(0.66 * 1.4, 5);
  });
});
describe("a ship at the end of a cliff", () => {
  const box = { left: 0, top: 0, width: 80, height: 50 };

  it("fades when the land runs along the hull", () => {
    expect(shouldFadeAtShore(box, (x, y) => x > 30 && y > 5)).toBe(true);
    expect(shouldFadeAtShore(box, (x, y) => x < 50 && y > 5)).toBe(true);
  });

  it("stays solid when the land only reaches the hull from one end and the far end is clear water", () => {
    // A hill behind the masts across the whole top, and a cliff that ends on the left of the hull.
    expect(shouldFadeAtShore(box, (x, y) => y < 20 || x < 20)).toBe(false);
    expect(shouldFadeAtShore(box, (x, y) => y < 20 || x > 60)).toBe(false);
  });

  it("fades when the land reaches the hull from one end and the far end is land too", () => {
    expect(shouldFadeAtShore(box, (x, y) => y < 20 || x < 20 || x > 60)).toBe(true);
  });

  it("fades when the land along the hull is more than three columns of eight", () => {
    expect(shouldFadeAtShore(box, (x, y) => y < 20 || x < 40)).toBe(true);
  });

  it("stays solid with land only behind the masts, little land, or an empty box", () => {
    expect(shouldFadeAtShore(box, (_x, y) => y < 20)).toBe(false);
    expect(shouldFadeAtShore(box, () => false)).toBe(false);
    expect(shouldFadeAtShore({ left: 0, top: 0, width: 0, height: 0 }, () => true)).toBe(false);
  });
});

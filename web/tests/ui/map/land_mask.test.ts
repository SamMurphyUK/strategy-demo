import { describe, expect, it } from "vitest";
import { landMaskHit, type LandMask } from "../../../src/ui/map/landMask";
import { landShareOf } from "../../../src/ui/map/seaOverlap";

/** A 4 by 2 grid over a world rectangle that starts at (100, 50). The left half is land. */
const mask: LandMask = {
  cells: Uint8Array.from([1, 1, 0, 0, 1, 1, 0, 0]),
  columns: 4,
  rows: 2,
  box: { x: 100, y: 50, w: 40, h: 20 },
};

describe("land mask", () => {
  it("reads the cell under a world point", () => {
    expect(landMaskHit(mask, { x: 101, y: 51 })).toBe(true);
    expect(landMaskHit(mask, { x: 119.9, y: 69.9 })).toBe(true);
    expect(landMaskHit(mask, { x: 120, y: 51 })).toBe(false);
    expect(landMaskHit(mask, { x: 139, y: 69 })).toBe(false);
  });

  it("treats a point outside the grid as water", () => {
    expect(landMaskHit(mask, { x: 99.9, y: 60 })).toBe(false);
    expect(landMaskHit(mask, { x: 140, y: 60 })).toBe(false);
    expect(landMaskHit(mask, { x: 110, y: 49.9 })).toBe(false);
    expect(landMaskHit(mask, { x: 110, y: 70 })).toBe(false);
  });

  it("gives a ship's overlap grid the same share as the land it covers", () => {
    const box = { left: 100, top: 50, width: 40, height: 20 };
    expect(landShareOf(box, 8, 5, (x, y) => landMaskHit(mask, { x, y }))).toBe(0.5);
  });
});

import { describe, expect, it } from "vitest";
import { FACILITY_ICON_ALPHA } from "../../../src/ui/map/mapRenderer";
import { landShareOf, seaLandOpacity, spriteScreenBox } from "../../../src/ui/map/seaOverlap";

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
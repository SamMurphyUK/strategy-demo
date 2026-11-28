import { beforeEach, describe, expect, it } from "vitest";
import { beginSpriteBoxes, commitSpriteBoxes, getSpriteBoxes, hull, recordSpriteBox, spriteAt } from "../../../src/ui/map/spriteHits";

describe("picking standing figures by their own pictures", () => {
  beforeEach(() => {
    beginSpriteBoxes();
    commitSpriteBoxes();
  });

  it("trims a picture's box to a tight hull", () => {
    const box = { left: 100, top: 100, width: 40, height: 60 };
    const tight = hull(box);
    expect(tight.width).toBeLessThan(box.width);
    expect(tight.height).toBeLessThan(box.height);
    expect(tight.left).toBeGreaterThan(box.left);
    expect(tight.left + tight.width).toBeLessThan(box.left + box.width);
  });

  it("records a figure under its region, copy and stack", () => {
    beginSpriteBoxes();
    recordSpriteBox("france|0|inf:1", { left: 10, top: 10, width: 20, height: 30 });
    commitSpriteBoxes();
    expect(getSpriteBoxes()).toHaveLength(1);
    expect(getSpriteBoxes()[0]).toMatchObject({ regionId: "france", copyDx: 0, stackKey: "inf:1" });
  });

  it("gives the hover to the figure nearer the camera where two pictures overlap", () => {
    beginSpriteBoxes();
    recordSpriteBox("a|0|back", { left: 0, top: 0, width: 40, height: 60 });
    recordSpriteBox("a|0|front", { left: 10, top: 20, width: 40, height: 60 });
    commitSpriteBoxes();
    expect(spriteAt({ x: 25, y: 40 })?.stackKey).toBe("front");
    expect(spriteAt({ x: 25, y: 10 })?.stackKey).toBe("back");
  });

  it("answers nothing where only a base would be: below and beside the figures", () => {
    beginSpriteBoxes();
    recordSpriteBox("a|0|one", { left: 100, top: 100, width: 30, height: 50 });
    commitSpriteBoxes();
    // The base ring is wider than the figure and lies under its feet.
    expect(spriteAt({ x: 100 - 18, y: 148 })).toBeNull();
    expect(spriteAt({ x: 115, y: 170 })).toBeNull();
    expect(spriteAt({ x: 115, y: 125 })?.stackKey).toBe("one");
  });
});

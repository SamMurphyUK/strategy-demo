import { describe, expect, it } from "vitest";
import { clampMoveCount, dragDropAction, guideOriginScreen, halfStack } from "../../../src/ui/map/moveDrag";

const WORLD = { x: 0, y: 0, w: 800, h: 400 };
const VIEW = { x: 0, y: 0, k: 1 };

describe("drag drop", () => {
  it("commits a single unit and any count the player already changed", () => {
    expect(dragDropAction(1, false)).toBe("commit");
    expect(dragDropAction(4, true)).toBe("commit");
    expect(dragDropAction(4, false)).toBe("split");
  });

  it("rounds half up and clamps the live count", () => {
    expect(halfStack(1)).toBe(1);
    expect(halfStack(2)).toBe(1);
    expect(halfStack(3)).toBe(2);
    expect(halfStack(5)).toBe(3);
    expect(clampMoveCount(0, 4)).toBe(1);
    expect(clampMoveCount(9, 4)).toBe(4);
    expect(clampMoveCount(Number.NaN, 4)).toBe(4);
  });
});

describe("wrap-aware guide", () => {
  it("starts the line on the copy of the origin closest to the cursor", () => {
    const origin = { x: 100, y: 50 };
    const acrossTheSheet = guideOriginScreen(origin, { x: 750, y: 50 }, VIEW, WORLD, true);
    expect(acrossTheSheet).toEqual({ x: 900, y: 50 });
    const nearby = guideOriginScreen(origin, { x: 140, y: 80 }, VIEW, WORLD, true);
    expect(nearby).toEqual({ x: 100, y: 50 });
    const unwrapped = guideOriginScreen(origin, { x: 750, y: 50 }, VIEW, WORLD, false);
    expect(unwrapped).toEqual({ x: 100, y: 50 });
  });
});

import { describe, expect, it } from "vitest";
import { screenToWorld, wheelZoomFactor, zoomAt } from "../../src/ui/map/viewMath";
import { terrainStampFadeAlpha } from "../../src/ui/map/zoomLod";

describe("smooth wheel zoom", () => {
  it("turns a small trackpad tick into a small scale change and keeps the cursor's world point", () => {
    const view = { x: 12, y: -4, k: 1.4 };
    const cursor = { x: 180, y: 90 };
    const before = screenToWorld(view, cursor);
    const factor = wheelZoomFactor(4, 0);

    expect(Math.abs(factor - 1)).toBeLessThan(0.02);
    expect(Math.abs(factor - 1.15)).toBeGreaterThan(0.1);
    expect(Math.abs(factor - 1 / 1.15)).toBeGreaterThan(0.1);

    const next = zoomAt(view, cursor, factor, 0.5);
    const after = screenToWorld(next, cursor);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(next.k / view.k).toBeCloseTo(factor, 8);
  });
});

describe("terrain stamp fade", () => {
  it("ramps from 0 to 1 across the transition band", () => {
    expect(terrainStampFadeAlpha(1.04)).toBe(0);
    expect(terrainStampFadeAlpha(1.05)).toBe(0);
    expect(terrainStampFadeAlpha(1.15)).toBeCloseTo(0.5, 5);
    expect(terrainStampFadeAlpha(1.25)).toBe(1);
    expect(terrainStampFadeAlpha(1.4)).toBe(1);

    let previous = 0;
    for (let zoom = 1.05; zoom <= 1.25; zoom += 0.02) {
      const alpha = terrainStampFadeAlpha(Number(zoom.toFixed(4)));
      expect(alpha).toBeGreaterThanOrEqual(previous);
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThanOrEqual(1);
      previous = alpha;
    }

    const step = terrainStampFadeAlpha(1.1) - terrainStampFadeAlpha(1.08);
    expect(step).toBeGreaterThan(0);
    expect(step).toBeLessThan(0.2);
  });
});

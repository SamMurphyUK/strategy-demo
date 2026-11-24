import { describe, expect, it } from "vitest";
import { DAY_SHARE, litFactor, shadowReach, SUN_CYCLE_S, sunAt } from "../../../src/ui/viewport3d/sun";

const DAY = SUN_CYCLE_S * DAY_SHARE;

describe("board sun", () => {
  it("always points up, from a unit direction", () => {
    for (let s = 0; s < SUN_CYCLE_S; s += 7) {
      const sun = sunAt(s);
      expect(Math.hypot(...sun.dir)).toBeCloseTo(1, 9);
      expect(sun.dir[2]).toBeGreaterThan(0.45);
    }
  });

  it("stays on the north side and crosses from east to west", () => {
    const morning = sunAt(DAY * 0.1);
    const noon = sunAt(DAY * 0.5);
    const evening = sunAt(DAY * 0.9);
    expect(morning.dir[0]).toBeGreaterThan(0);
    expect(noon.dir[0]).toBeCloseTo(0, 9);
    expect(evening.dir[0]).toBeLessThan(0);
    for (const sun of [morning, noon, evening]) {
      // North is scene +y, so shadows fall toward the bottom of the screen.
      expect(sun.dir[1]).toBeGreaterThan(0);
    }
  });

  it("is highest and plainest at noon, low and warm at the ends", () => {
    const morning = sunAt(DAY * 0.1);
    const noon = sunAt(DAY * 0.5);
    expect(noon.dir[2]).toBeGreaterThan(morning.dir[2]);
    expect(shadowReach(noon)).toBeLessThan(shadowReach(morning));
    // Warm light has less blue for its red.
    expect(morning.color[2] / morning.color[0]).toBeLessThan(noon.color[2] / noon.color[0]);
  });

  it("fades the direct light out before the direction jumps back to morning", () => {
    expect(sunAt(DAY * 0.5).direct).toBe(1);
    expect(sunAt(DAY - 0.001).direct).toBeLessThan(0.01);
    const between = sunAt(DAY + 1);
    expect(between.direct).toBe(0);
    expect(between.shadow).toBe(0);
    expect(sunAt(0.001).direct).toBeLessThan(0.01);
    // The next day starts where this one did.
    const again = sunAt(SUN_CYCLE_S + 12).dir;
    sunAt(12).dir.forEach((value, i) => expect(again[i]).toBeCloseTo(value, 9));
  });

  it("leaves the flat top of the land near its printed colour at noon", () => {
    const noon = sunAt(DAY * 0.5);
    for (const channel of litFactor(noon, noon.dir[2])) {
      expect(channel).toBeGreaterThan(0.95);
      expect(channel).toBeLessThan(1.08);
    }
  });

  it("lights a face toward the sun more than one turned away", () => {
    const sun = sunAt(DAY * 0.3);
    const toward = litFactor(sun, 0.9);
    const away = litFactor(sun, -0.5);
    expect(toward[0]).toBeGreaterThan(away[0] + 0.3);
    expect(away).toEqual(litFactor(sun, 0));
  });

  it("holds still for the dusk look and for reduced motion", () => {
    expect(sunAt(10, "dusk")).toEqual(sunAt(200, "dusk"));
    expect(sunAt(10, "field", true)).toEqual(sunAt(200, "field", true));
    // Dusk is the lower light.
    expect(sunAt(0, "dusk").dir[2]).toBeLessThan(sunAt(0, "field", true).dir[2]);
  });

  it("caps how far a shadow can reach", () => {
    expect(shadowReach(sunAt(0, "dusk"), 1.2)).toBe(1.2);
    expect(shadowReach(sunAt(DAY * 0.5), 5)).toBeCloseTo(1 / Math.tan((62 * Math.PI) / 180), 6);
  });
});

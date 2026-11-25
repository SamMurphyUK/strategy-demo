import { describe, expect, it } from "vitest";
import {
  DAY_SHARE,
  HELD_SUN_LIMIT,
  litFactor,
  SHIPPED_ARC,
  shadowReach,
  SUN_CYCLE_S,
  sunAt,
  sunAtAzimuth,
  sunFor,
} from "../../../src/ui/viewport3d/sun";

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

  it("holds the sun at an azimuth on the same arc, with the direct light on", () => {
    const noon = sunAtAzimuth(0);
    sunAt(DAY * 0.5).dir.forEach((value, i) => expect(noon.dir[i]).toBeCloseTo(value, 9));
    const east = sunAtAzimuth(40);
    expect(Math.atan2(east.dir[0], east.dir[1]) * (180 / Math.PI)).toBeCloseTo(40, 6);
    expect(east.direct).toBe(1);
    // Past the limit the sun stops at the limit.
    expect(sunAtAzimuth(90)).toEqual(sunAtAzimuth(HELD_SUN_LIMIT));
    expect(sunAtAzimuth(-90).direct).toBe(1);
    expect(sunAtAzimuth(10, "dusk")).toEqual(sunAt(0, "dusk"));
  });

  it("caps how far a shadow can reach", () => {
    expect(shadowReach(sunAt(0, "dusk"), 1.2)).toBe(1.2);
    expect(shadowReach(sunAt(DAY * 0.5), 5)).toBeCloseTo(1 / Math.tan((62 * Math.PI) / 180), 6);
  });
});

describe("the sun's arc", () => {
  const elevation = (dir: readonly number[]) => Math.asin(dir[2]) * (180 / Math.PI);
  const arc = { minElevation: 35, maxElevation: 65, warmth: 1, fill: 1 };

  it("is the shipped arc when none is given", () => {
    expect(SHIPPED_ARC).toEqual({ minElevation: 30, maxElevation: 62, warmth: 1, fill: 1 });
    for (const s of [3, 40, 138, 250, 290]) {
      expect(sunAt(s, "field", false, SHIPPED_ARC)).toEqual(sunAt(s));
      expect(sunFor("animated", s, "field", false, null, SHIPPED_ARC)).toEqual(sunFor("animated", s, "field"));
    }
    expect(sunAtAzimuth(20, "field", SHIPPED_ARC)).toEqual(sunAtAzimuth(20));
  });

  it("stands at the low height at each end of the day and the high one at noon, and between them all day", () => {
    expect(elevation(sunAt(0.0001, "field", false, arc).dir)).toBeCloseTo(35, 1);
    expect(elevation(sunAt(DAY * 0.5, "field", false, arc).dir)).toBeCloseTo(65, 6);
    expect(elevation(sunAt(DAY - 0.0001, "field", false, arc).dir)).toBeCloseTo(35, 1);
    for (let s = 0; s < DAY; s += 5) {
      const height = elevation(sunAt(s, "field", false, arc).dir);
      expect(height).toBeGreaterThanOrEqual(35 - 1e-6);
      expect(height).toBeLessThanOrEqual(65 + 1e-6);
    }
  });

  it("holds one height all day when the two are the same", () => {
    const level = { ...arc, minElevation: 50, maxElevation: 50 };
    for (let s = 1; s < DAY; s += 20) {
      expect(elevation(sunAt(s, "field", false, level).dir)).toBeCloseTo(50, 6);
    }
  });

  it("warms the light with the warmth, and whitens it at none", () => {
    const blue = (warmth: number, day: number) => {
      const sun = sunAt(DAY * day, "field", false, { ...arc, warmth });
      return sun.color[2] / sun.color[0];
    };
    // More warmth, less blue for the red, at noon and in the morning alike.
    expect(blue(2, 0.5)).toBeLessThan(blue(1, 0.5));
    expect(blue(2, 0.15)).toBeLessThan(blue(1, 0.15));
    expect(blue(1, 0.15)).toBeLessThan(blue(0, 0.15));
    // No warmth is the plain noon light all day.
    expect(sunAt(DAY * 0.15, "field", false, { ...arc, warmth: 0 }).color).toEqual(sunAt(DAY * 0.5, "field", false, { ...arc, warmth: 0 }).color);
    // The shipped warmth leaves noon as it was.
    expect(sunAt(DAY * 0.5, "field", false, arc).color).toEqual(sunAt(DAY * 0.5).color);
  });

  it("scales the fill from the sky and leaves the sunlight alone", () => {
    const plain = sunAt(DAY * 0.3, "field", false, arc);
    const strong = sunAt(DAY * 0.3, "field", false, { ...arc, fill: 1.5 });
    strong.ambient.forEach((value, i) => expect(value).toBeCloseTo(plain.ambient[i] * 1.5, 9));
    expect(strong.color).toEqual(plain.color);
    expect(strong.dir).toEqual(plain.dir);
  });

  it("leaves the dusk look its own light", () => {
    expect(sunAt(10, "dusk", false, arc)).toEqual(sunAt(10, "dusk"));
  });
});

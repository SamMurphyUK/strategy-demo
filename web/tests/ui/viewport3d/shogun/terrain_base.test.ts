import { describe, expect, it } from "vitest";
import type { Biome } from "../../../../src/ui/viewport3d/geography";
import {
  biomeColor,
  LAND_COVER_COLOR,
  landCoverOf,
  naturalColorAt,
  rgbOfHex,
  saturationOf,
  terrainPixels,
  valueNoise,
} from "../../../../src/ui/viewport3d/shogun/terrainBase";

const BIOMES: Biome[] = ["ice", "tundra", "taiga", "temperate", "steppe", "scrub", "desert", "savanna", "jungle"];

describe("land cover", () => {
  it("reads the map's cover names, and calls anything else open ground", () => {
    expect(landCoverOf("FOREST")).toBe("FOREST");
    expect(landCoverOf(" desert ")).toBe("DESERT");
    expect(landCoverOf("")).toBe("OPEN");
    expect(landCoverOf(undefined)).toBe("OPEN");
    expect(landCoverOf("LAVA")).toBe("OPEN");
  });

  it("keeps every ground colour low in saturation", () => {
    for (const hex of Object.values(LAND_COVER_COLOR)) {
      expect(saturationOf(rgbOfHex(hex))).toBeLessThan(0.3);
    }
    for (const biome of BIOMES) {
      expect(saturationOf(biomeColor(biome))).toBeLessThan(0.3);
    }
  });

  it("orders the grounds from dark forest to pale snow", () => {
    const luma = (hex: string) => {
      const [r, g, b] = rgbOfHex(hex);
      return 0.299 * r + 0.587 * g + 0.114 * b;
    };
    expect(luma(LAND_COVER_COLOR.FOREST)).toBeLessThan(luma(LAND_COVER_COLOR.OPEN));
    expect(luma(LAND_COVER_COLOR.OPEN)).toBeLessThan(luma(LAND_COVER_COLOR.DESERT));
    expect(luma(LAND_COVER_COLOR.DESERT)).toBeLessThan(luma(LAND_COVER_COLOR.SNOW));
    // Grass is green and sand is warm.
    const open = rgbOfHex(LAND_COVER_COLOR.OPEN);
    expect(open[1]).toBeGreaterThan(open[0]);
    expect(open[1]).toBeGreaterThan(open[2]);
    const sand = rgbOfHex(LAND_COVER_COLOR.DESERT);
    expect(sand[0]).toBeGreaterThan(sand[2]);
  });
});

describe("the natural ground", () => {
  it("is the biome's colour away from a boundary", () => {
    expect(naturalColorAt({ x: 100, y: 100 }, () => "desert")).toEqual(biomeColor("desert"));
    expect(naturalColorAt({ x: 300, y: 40 }, () => "taiga")).toEqual(biomeColor("taiga"));
  });

  it("wanders a biome's edge, and by no more than a few units", () => {
    // A straight north-south boundary at x = 200.
    const biomeAt = (p: { x: number; y: number }): Biome => (p.x < 200 ? "desert" : "taiga");
    const desert = biomeColor("desert");
    const edges: number[] = [];
    for (let y = 0; y < 400; y += 5) {
      let edge = 180;
      while (edge < 220 && naturalColorAt({ x: edge, y }, biomeAt)[0] === desert[0]) {
        edge += 0.5;
      }
      edges.push(edge);
    }
    expect(Math.min(...edges)).toBeGreaterThanOrEqual(191);
    expect(Math.max(...edges)).toBeLessThanOrEqual(209);
    expect(Math.max(...edges) - Math.min(...edges)).toBeGreaterThan(2);
  });

  it("gives the same answer every time", () => {
    expect(valueNoise(12.3, 45.6)).toBe(valueNoise(12.3, 45.6));
    expect(valueNoise(12.3, 45.6)).toBeGreaterThanOrEqual(0);
    expect(valueNoise(12.3, 45.6)).toBeLessThan(1);
    // Smooth: a small step moves it a little.
    expect(Math.abs(valueNoise(3.5, 7.5) - valueNoise(3.51, 7.5))).toBeLessThan(0.05);
  });
});

describe("the terrain sheet", () => {
  it("fills every pixel, opaque, with the colour at its centre", () => {
    const bounds = { x: 10, y: 20, w: 8, h: 4 };
    const biomeAt = (): Biome => "steppe";
    const pixels = terrainPixels(bounds, 8, 4, biomeAt);
    expect(pixels.length).toBe(8 * 4 * 4);
    const steppe = biomeColor("steppe").map((v) => Math.round(v));
    for (let i = 0; i < pixels.length; i += 4) {
      expect([pixels[i], pixels[i + 1], pixels[i + 2]]).toEqual(steppe);
      expect(pixels[i + 3]).toBe(255);
    }
  });

  it("lays the sheet out row by row from the top-left of the bounds", () => {
    const bounds = { x: 0, y: 0, w: 400, h: 200 };
    const biomeAt = (p: { x: number; y: number }): Biome => (p.y < 100 ? "ice" : "desert");
    const pixels = terrainPixels(bounds, 4, 2, biomeAt);
    const ice = Math.round(biomeColor("ice")[0]);
    const desert = Math.round(biomeColor("desert")[0]);
    expect(pixels[0]).toBe(ice);
    expect(pixels[4 * 4]).toBe(desert);
  });
});

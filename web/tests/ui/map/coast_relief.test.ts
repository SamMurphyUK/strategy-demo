import { describe, expect, it } from "vitest";
import {
  BEVEL_MAX_PX,
  BEVEL_MIN_PX,
  bevelBandPx,
  coastBevel,
  DEEP_SEA_SHARE,
  LIGHT_FROM,
  mixHex,
  SHELF_GROW,
  shelfBands,
  shelfCoverage,
} from "../../../src/ui/map/coastRelief";
import { MAX_BAKE_SCALE } from "../../../src/ui/map/mapBakeMath";
import { MILITARY } from "../../../src/ui/theme/militaryPalette";

describe("coast bevel width", () => {
  it("stays between 1 and 3 bake pixels at every bake scale", () => {
    for (let scale = 1; scale <= MAX_BAKE_SCALE; scale++) {
      const band = bevelBandPx(scale);
      expect(band).toBeGreaterThanOrEqual(BEVEL_MIN_PX);
      expect(band).toBeLessThanOrEqual(BEVEL_MAX_PX);
    }
  });

  it("grows with the bake scale", () => {
    const widths = [1, 2, 3, 4].map(bevelBandPx);
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeGreaterThan(widths[i - 1]);
    }
    expect(widths[0]).toBe(BEVEL_MIN_PX);
  });

  it("clamps a scale outside the baked range", () => {
    expect(bevelBandPx(0.2)).toBe(bevelBandPx(1));
    expect(bevelBandPx(50)).toBe(BEVEL_MAX_PX);
  });
});

describe("coast bevel offsets", () => {
  it("light comes from the top-left", () => {
    expect(LIGHT_FROM.x).toBeLessThan(0);
    expect(LIGHT_FROM.y).toBeLessThan(0);
  });

  it("slides the highlight toward the light's far side and the shadow the opposite way", () => {
    // Sliding the path down-right leaves the highlight inside the up-left-facing edges.
    const bevel = coastBevel(3, 2.4);
    expect(bevel.highlight.dx).toBeGreaterThan(0);
    expect(bevel.highlight.dy).toBeGreaterThan(0);
    expect(bevel.shadow.dx).toBe(-bevel.highlight.dx);
    expect(bevel.shadow.dy).toBe(-bevel.highlight.dy);
  });

  it("starts the band just past the coastline ink", () => {
    for (let scale = 1; scale <= MAX_BAKE_SCALE; scale++) {
      const ink = 0.8 * scale;
      const bevel = coastBevel(scale, ink);
      // On an edge facing straight into the light the slide is the whole distance: ink, then the band.
      expect(bevel.highlight.dx - bevel.band / 2).toBeCloseTo(ink, 6);
      expect(bevel.band).toBe(bevelBandPx(scale));
    }
  });

  it("is symmetric on both axes, so the light sits at 45 degrees", () => {
    const bevel = coastBevel(2, 1.6);
    expect(Math.abs(bevel.highlight.dx)).toBe(Math.abs(bevel.highlight.dy));
  });
});

describe("shelf depth steps", () => {
  it("lists the widest, faintest-per-reach band first, and narrowing after", () => {
    const bands = shelfBands();
    expect(bands.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i].sigma).toBeLessThan(bands[i - 1].sigma);
      expect(bands[i].alpha).toBeGreaterThan(0);
      expect(bands[i].alpha).toBeLessThan(1);
    }
  });

  it("is lightest at the coast and falls steadily to nothing in the open sea", () => {
    let last = shelfCoverage(0);
    for (const distance of [2, 4, 8, 14, 24, 40, 80]) {
      const now = shelfCoverage(distance);
      expect(now).toBeLessThan(last);
      last = now;
    }
    expect(shelfCoverage(0)).toBeGreaterThan(0.25);
    expect(shelfCoverage(80)).toBeLessThan(0.01);
  });

  it("keeps the shallows in the sea in a believable range, not a solid fill", () => {
    expect(shelfCoverage(0)).toBeLessThan(0.7);
    expect(shelfCoverage(SHELF_GROW)).toBeGreaterThan(shelfCoverage(SHELF_GROW + 10));
  });
});

describe("deep sea tone", () => {
  it("mixes straight RGB between two palette colours", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("is darker than the slate it starts from", () => {
    const luma = (hex: string) => {
      const n = Number.parseInt(hex.slice(1), 16);
      return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
    };
    const deep = mixHex(MILITARY.steel, MILITARY.charcoal, DEEP_SEA_SHARE);
    expect(luma(deep)).toBeLessThan(luma(MILITARY.steel));
    expect(luma(deep)).toBeGreaterThan(luma(MILITARY.charcoal));
    // The shelf colour stays lighter than the open sea, so the shallows read as shallow.
    expect(luma(MILITARY.spruce)).toBeGreaterThan(luma(deep));
  });
});

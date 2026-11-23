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
  SURF_PERIOD_S,
  SURF_WAVELENGTH,
  buildSurfCoast,
  CLIFF_BIG_SPAN,
  CLIFF_SMALL_LIFT,
  CLIFF_TINY_LIFT,
  CLIFF_TINY_SPAN,
  cliffLift,
  shelfBands,
  shelfCoverage,
  surfJitter,
  surfLocalPx,
  surfScreenPx,
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

describe("cliff lip by landmass size", () => {
  it("leaves continents and big islands at the base lip", () => {
    expect(cliffLift(CLIFF_BIG_SPAN)).toBe(1);
    expect(cliffLift(89)).toBe(1);
    expect(cliffLift(200)).toBe(1);
  });

  it("shortens smaller islands by 30 percent", () => {
    expect(cliffLift(CLIFF_TINY_SPAN)).toBe(CLIFF_SMALL_LIFT);
    expect(cliffLift(53)).toBe(CLIFF_SMALL_LIFT);
    expect(cliffLift(19)).toBe(CLIFF_SMALL_LIFT);
    expect(CLIFF_SMALL_LIFT).toBeCloseTo(0.7, 5);
  });

  it("shortens very small islands by 40 percent", () => {
    expect(cliffLift(CLIFF_TINY_SPAN - 0.01)).toBe(CLIFF_TINY_LIFT);
    expect(cliffLift(4)).toBe(CLIFF_TINY_LIFT);
    expect(CLIFF_TINY_LIFT).toBeCloseTo(0.6, 5);
  });
});

describe("coast surf", () => {
  it("is narrow in the trough and wide at the crest", () => {
    expect(surfScreenPx(0)).toBeCloseTo(-1.5, 5);
    expect(surfScreenPx(SURF_PERIOD_S / 2)).toBeCloseTo(1.5, 5);
    expect(surfScreenPx(SURF_PERIOD_S)).toBeCloseTo(-1.5, 5);
  });

  it("narrows by retracing the way it widened", () => {
    const samples = [0.125, 0.25, 0.375];
    for (const share of samples) {
      expect(surfScreenPx(SURF_PERIOD_S * share)).toBeCloseTo(surfScreenPx(SURF_PERIOD_S * (1 - share)), 5);
    }
    expect(surfScreenPx(SURF_PERIOD_S * 0.25)).toBeCloseTo(0, 5);
    expect(surfScreenPx(SURF_PERIOD_S * 0.75)).toBeCloseTo(0, 5);
  });

  it("shares its clock with the unit breathe, three bobs to one swell", () => {
    expect(SURF_PERIOD_S).toBeCloseTo(Math.PI * 2, 8);
    expect(SURF_PERIOD_S).toBeCloseTo(3 * ((Math.PI * 2) / 3), 8);
  });

  it("lets the crest travel along the shore, and keeps the grain fixed", () => {
    const atStart = surfLocalPx(0.4, 0, 0);
    const quarter = surfLocalPx(0.4, SURF_WAVELENGTH / 4, 0);
    expect(quarter).not.toBeCloseTo(atStart, 2);
    // Grain is a fixed outward nudge, including while the tide is still inward.
    expect(surfLocalPx(0.4, 12, 1)).toBeGreaterThan(surfLocalPx(0.4, 12, -1));
    expect(surfLocalPx(SURF_PERIOD_S / 2, 12, 1)).toBeGreaterThan(surfLocalPx(SURF_PERIOD_S / 2, 12, -1));
    expect(surfJitter(4, 9)).toBe(surfJitter(4, 9));
    expect(surfJitter(4, 9)).toBeGreaterThanOrEqual(-1);
    expect(surfJitter(4, 9)).toBeLessThanOrEqual(1);
  });

  it("pushes a coast outward into the sea and joins a closed shore", () => {
    const square: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const land = (x: number, y: number) => x > 0 && x < 10 && y > 0 && y < 10;
    const [run] = buildSurfCoast([square], null, land);
    const at = (x: number, y: number) => run.find((p) => p.x === x && p.y === y);
    const south = at(10, 10)!;
    const north = at(0, 0)!;
    expect(south.ny).toBeGreaterThan(0.5);
    expect(north.ny).toBeLessThan(-0.5);
    expect(run[0].x).toBe(run[run.length - 1].x);
    expect(run[0].y).toBe(run[run.length - 1].y);
    expect(run[0].along).toBeCloseTo(run[run.length - 1].along, 6);
    expect(run[0].lift).toBe(1);
  });

  it("keeps a parent's cliff lift on every shore of that landmass", () => {
    const island: [number, number][] = [
      [0, 0],
      [20, 0],
      [20, 8],
      [0, 8],
    ];
    const land = (x: number, y: number) => x > 0 && x < 20 && y > 0 && y < 8;
    const [run] = buildSurfCoast([island], null, land, () => CLIFF_SMALL_LIFT);
    expect(run.every((p) => p.lift === CLIFF_SMALL_LIFT)).toBe(true);
  });

  it("leaves out an edge that lies on the world seam", () => {
    const square: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const land = (x: number, y: number) => x > 0 && x < 10 && y > 0 && y < 10;
    const runs = buildSurfCoast([square], { left: 0, right: 100 }, land);
    expect(runs).toHaveLength(1);
    const run = runs[0];
    expect(run.some((p) => p.x === 10)).toBe(true);
    for (let i = 1; i < run.length; i++) {
      const seamEdge = run[i - 1].x === 0 && run[i].x === 0;
      expect(seamEdge).toBe(false);
    }
  });
});

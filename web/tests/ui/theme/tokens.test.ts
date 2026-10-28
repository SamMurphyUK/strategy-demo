import { describe, expect, it } from "vitest";
import { FACTION_PALETTE, factionPalette, resolveFaction } from "../../../src/ui/theme/factionPalette";
import {
  coverageFraction,
  detectArtColors,
  extractSilhouetteAlpha,
  lumaOf,
} from "../../../src/ui/theme/tokens/silhouette";
import {
  halvingSteps,
  ringWidthPx,
  tokenCanvasSize,
} from "../../../src/ui/theme/tokens/tokenGeometry";
import { resolveTokenSpec, UNIT_TOKEN_SPEC } from "../../../src/ui/theme/tokens/unitTokenSpec";

const HEX = /^#[0-9A-F]{6}$/i;

describe("faction palette", () => {
  it("gives every faction valid colours and a readable ink", () => {
    for (const p of Object.values(FACTION_PALETTE)) {
      for (const c of [p.primary, p.ring, p.fill, p.ink]) expect(c).toMatch(HEX);
      const luma = (hex: string) =>
        lumaOf(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));
      expect(luma(p.fill) - luma(p.ink)).toBeGreaterThan(150);
    }
  });

  it("keeps the five powers visually distinct", () => {
    const primaries = ["US", "UK", "JAP", "GER", "USSR"].map((k) => FACTION_PALETTE[k as "US"].primary);
    expect(new Set(primaries).size).toBe(5);
  });

  it("resolves engine ids and aliases", () => {
    expect(resolveFaction("allies")).toBe("US");
    expect(resolveFaction("axis")).toBe("GER");
    expect(resolveFaction("Germany")).toBe("GER");
    expect(resolveFaction("uk")).toBe("UK");
    expect(resolveFaction("japan")).toBe("JAP");
    expect(resolveFaction("soviet")).toBe("USSR");
    expect(resolveFaction("")).toBe("NEUTRAL");
    expect(resolveFaction(undefined)).toBe("NEUTRAL");
    expect(resolveFaction("mars")).toBe("NEUTRAL");
    expect(factionPalette("axis").side).toBe("axis");
  });
});

describe("token spec", () => {
  it("uses the allied infantry art only for allied factions", () => {
    expect(resolveTokenSpec("infantry", "allies").artName).toBe("allies_inf_ii");
    expect(resolveTokenSpec("infantry", "axis").artName).toBe("axis_inf_ii");
    expect(resolveTokenSpec("infantry", "neutral").artName).toBe("axis_inf_ii");
  });

  it("falls back to the axis art for other units on any side", () => {
    expect(resolveTokenSpec("tank", "allies").artName).toBe("axis_tank");
    expect(resolveTokenSpec("transport", "axis").artName).toBe("axis_trans");
  });

  it("makes unit types without art letter-only, and unknown types too", () => {
    expect(resolveTokenSpec("fighter", "allies")).toEqual({ letter: "F", artName: null });
    expect(resolveTokenSpec("zeppelin", "axis")).toEqual({ letter: "Z", artName: null });
  });

  it("gives every unit type a distinct letter", () => {
    const letters = Object.values(UNIT_TOKEN_SPEC).map((s) => s.letter);
    expect(new Set(letters).size).toBe(letters.length);
  });
});

describe("silhouette extraction", () => {
  // 4x1 image: transparent, ink, ring, fill.
  const px = (r: number, g: number, b: number, a = 255) => [r, g, b, a];
  const flat = (...pixels: number[][]) => Uint8ClampedArray.from(pixels.flat());

  it("finds ink, ring and fill as the three dominant opaque colours", () => {
    const data: number[][] = [];
    for (let i = 0; i < 5; i++) data.push(px(0, 0, 0));
    for (let i = 0; i < 9; i++) data.push(px(138, 140, 127));
    for (let i = 0; i < 20; i++) data.push(px(249, 248, 246));
    data.push(px(10, 10, 10), px(0, 0, 0, 0), px(90, 90, 90, 128));
    const colors = detectArtColors(flat(...data));
    expect(colors).not.toBeNull();
    expect(colors!.ink).toBe(0);
    expect(colors!.ring).toBeCloseTo(lumaOf(138, 140, 127), 5);
    expect(colors!.fill).toBeGreaterThan(240);
  });

  it("rejects art that is not three flat colours", () => {
    expect(detectArtColors(flat(px(0, 0, 0), px(255, 255, 255)))).toBeNull();
  });

  it("keeps ink, drops ring, fill and background", () => {
    const colors = { ink: 0, ring: lumaOf(138, 140, 127), fill: lumaOf(249, 248, 246) };
    const out = extractSilhouetteAlpha(
      flat(px(0, 0, 0), px(138, 140, 127), px(249, 248, 246), px(0, 0, 0, 0), px(70, 70, 70)),
      colors,
    );
    const alpha = (i: number) => out[i * 4 + 3];
    expect(alpha(0)).toBe(255);
    expect(alpha(1)).toBeLessThanOrEqual(2);
    expect(alpha(2)).toBe(0);
    expect(alpha(3)).toBe(0);
    expect(alpha(4)).toBeGreaterThan(100); // anti-aliased edge keeps partial coverage
    expect(alpha(4)).toBeLessThan(160);
    expect(out[0]).toBe(0); // rgb stays black; the renderer tints it
  });

  it("works for an olive ink that is not black", () => {
    const olive = lumaOf(67, 73, 39);
    const out = extractSilhouetteAlpha(flat(px(67, 73, 39), px(168, 178, 114)), {
      ink: olive,
      ring: lumaOf(168, 178, 114),
      fill: 250,
    });
    expect(out[3]).toBe(255);
    expect(out[7]).toBe(0);
  });

  it("measures coverage of a rectangle", () => {
    // 4x2: left two columns solid, right two clear.
    const rgba = Uint8ClampedArray.from(
      [0, 1].flatMap(() => [px(0, 0, 0), px(0, 0, 0), px(0, 0, 0, 0), px(0, 0, 0, 0)]).flat(),
    );
    expect(coverageFraction(rgba, 4, 2, { x0: 0, y0: 0, x1: 4, y1: 2 })).toBe(0.5);
    expect(coverageFraction(rgba, 4, 2, { x0: 2, y0: 0, x1: 4, y1: 2 })).toBe(0);
    expect(coverageFraction(rgba, 4, 2, { x0: 0, y0: 0, x1: 2, y1: 1 })).toBe(1);
    expect(coverageFraction(rgba, 4, 2, { x0: 10, y0: 10, x1: 12, y1: 12 })).toBe(0);
  });
});

describe("token geometry", () => {
  it("sizes the canvas wider than the circle for overhang", () => {
    expect(tokenCanvasSize(32, 1)).toEqual({ width: 46, height: 32 });
    expect(tokenCanvasSize(48, 2)).toEqual({ width: 138, height: 96 });
  });

  it("keeps the ring visible at map counter size", () => {
    expect(ringWidthPx(24, 1)).toBeGreaterThanOrEqual(1.5);
    expect(ringWidthPx(32, 2)).toBeGreaterThanOrEqual(3);
    expect(ringWidthPx(1000, 1)).toBeCloseTo(34, 5);
  });

  it("halves a big source down to the target without ever jumping past 2x", () => {
    const steps = halvingSteps(806, 560, 46, 32);
    expect(steps[steps.length - 1]).toEqual({ width: 46, height: 32 });
    let prev = { width: 806, height: 560 };
    for (const s of steps) {
      expect(prev.width / s.width).toBeLessThanOrEqual(2.01);
      prev = s;
    }
    expect(steps.length).toBeGreaterThan(3);
  });

  it("does a single draw when no shrink is needed", () => {
    expect(halvingSteps(100, 70, 100, 70)).toEqual([{ width: 100, height: 70 }]);
  });
});

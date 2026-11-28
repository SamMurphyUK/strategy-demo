import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_VISUALS,
  mapVisuals,
  parseVisuals,
  PIXEL_CHART_VISUALS,
  PIXIE_MIN_TEXEL_PX,
  PIXIE_ZOOM_FOLLOW,
  landSoftness,
  pixieLook,
  PLAIN_VISUALS,
  resetVisuals,
  setVisual,
  SOLID_VISUALS,
  VISUAL_PRESETS,
  VISUAL_RANGES,
  visualPresetOf,
} from "../../../src/ui/map/mapVisualConfig";

/** The fitted board and the closest zoom on a laptop, in screen pixels to a world unit. */
const FIT = 1.75;
const MAX = 7.48;
/** A zoom past where the soft land is whole. */
const NEAR = 10.3;

afterEach(() => {
  resetVisuals();
});

describe("the pixel chart's settings", () => {
  const NUMBERS = [
    "pixelTexelDensity",
    "pixelHillshadeContrast",
    "pixelShadowSteps",
    "pixelDitherStrength",
    "pixelPaletteSaturation",
    "seaContourSteps",
    "coastRimIntensity",
  ] as const;

  it("ships the chart on, with each territory in its climate's palette", () => {
    expect(DEFAULT_VISUALS.enableFauxPixelMap).toBe(true);
    expect(DEFAULT_VISUALS.regionalPaletteDetail).toBe(true);
  });

  it("gives every number a range that holds its default", () => {
    for (const key of NUMBERS) {
      const [low, high] = VISUAL_RANGES[key];
      expect(low).toBeLessThan(high);
      expect(DEFAULT_VISUALS[key]).toBeGreaterThanOrEqual(low);
      expect(DEFAULT_VISUALS[key]).toBeLessThanOrEqual(high);
      expect(parseVisuals({ [key]: "fine" })[key]).toBe(DEFAULT_VISUALS[key]);
      expect(parseVisuals({ [key]: 1e9 })[key]).toBe(high);
      expect(parseVisuals({ [key]: -1e9 })[key]).toBe(low);
    }
  });

  it("steps the sea in three or four bands unless it is asked for more", () => {
    expect(DEFAULT_VISUALS.seaContourSteps).toBeGreaterThanOrEqual(3);
    expect(DEFAULT_VISUALS.seaContourSteps).toBeLessThanOrEqual(4);
  });

  it("has a preset of its own, and the shipped look keeps its name", () => {
    expect(VISUAL_PRESETS["faux-pixel-cartography"]).toBe(PIXEL_CHART_VISUALS);
    expect(PIXEL_CHART_VISUALS.enableFauxPixelMap).toBe(true);
    expect(visualPresetOf(PIXEL_CHART_VISUALS)).toBe("faux-pixel-cartography");
    expect(visualPresetOf(DEFAULT_VISUALS)).toBe("shogun");
  });

  it("holds the preset's light still, with nothing laid over the texels", () => {
    expect(PIXEL_CHART_VISUALS.sunCycle).toBe("static-noon");
    expect(PIXEL_CHART_VISUALS.filmGrainWeight).toBe("off");
    expect(PIXEL_CHART_VISUALS.bloomWeight).toBe("off");
    expect(PIXEL_CHART_VISUALS.envReflectionWeight).toBe("off");
  });

  it("leaves the solid and the plain board as printed sheets", () => {
    expect(SOLID_VISUALS.enableFauxPixelMap).toBe(false);
    expect(PLAIN_VISUALS.enableFauxPixelMap).toBe(false);
    expect(pixieLook(PLAIN_VISUALS, FIT, MAX)).toBeNull();
  });
});

describe("the texel grid at a zoom", () => {
  it("is nothing with the chart off", () => {
    expect(pixieLook({ ...DEFAULT_VISUALS, enableFauxPixelMap: false }, MAX, MAX)).toBeNull();
    setVisual("enableFauxPixelMap", false);
    expect(pixieLook(mapVisuals, FIT, MAX)).toBeNull();
  });

  it("is the set density at the closest zoom, all on the one grid", () => {
    const look = pixieLook(DEFAULT_VISUALS, MAX, MAX)!;
    expect(look.coarse).toBeCloseTo(DEFAULT_VISUALS.pixelTexelDensity, 9);
    expect(look.share).toBe(0);
  });

  it("nests the fine grid in the coarse one, at twice the density, at every zoom", () => {
    for (let i = 0; i <= 60; i++) {
      const k = FIT * (MAX / FIT) ** (i / 60);
      const look = pixieLook(DEFAULT_VISUALS, k, MAX)!;
      expect(look.fine).toBe(look.coarse * 2);
      // Every grid is the set density halved a whole number of times, so its lines stay where they were.
      const halvings = Math.log2(DEFAULT_VISUALS.pixelTexelDensity / look.coarse);
      expect(halvings).toBeCloseTo(Math.round(halvings), 9);
      expect(look.share).toBeGreaterThanOrEqual(0);
      expect(look.share).toBeLessThanOrEqual(1);
    }
  });

  it("hands over from one density to the next with no jump", () => {
    // One halving above the closest zoom.
    const edge = MAX * 2 ** (-1 / PIXIE_ZOOM_FOLLOW);
    const further = pixieLook(DEFAULT_VISUALS, edge * 0.999, MAX)!;
    const closer = pixieLook(DEFAULT_VISUALS, edge * 1.001, MAX)!;
    // Coming down to the step, every coarse texel has split. Past it, the grid they split into is the coarse one, whole.
    expect(further.share).toBe(1);
    expect(closer.share).toBe(0);
    expect(closer.coarse).toBeCloseTo(further.fine, 9);
  });

  it("splits more texels the closer the camera comes, inside one step", () => {
    let previous = -1;
    for (let i = 1; i < 20; i++) {
      const k = MAX * 2 ** ((-1 + i / 20) / PIXIE_ZOOM_FOLLOW);
      const look = pixieLook(DEFAULT_VISUALS, k, MAX)!;
      expect(look.share).toBeGreaterThanOrEqual(previous);
      previous = look.share;
    }
    expect(previous).toBe(1);
  });

  it("keeps a texel a few pixels across from the fitted board to the closest zoom", () => {
    for (let i = 0; i <= 60; i++) {
      const k = FIT * (MAX / FIT) ** (i / 60);
      const look = pixieLook(DEFAULT_VISUALS, k, MAX)!;
      // The size most texels are drawn at: the fine grid once half of them have split.
      const texel = k / (look.share >= 0.5 ? look.fine : look.coarse);
      expect(texel).toBeGreaterThan(1.5);
      expect(texel).toBeLessThan(6);
    }
  });

  it("never draws a texel smaller than a pixel and a half at the closest zoom", () => {
    const look = pixieLook({ ...DEFAULT_VISUALS, pixelTexelDensity: 6 }, MAX, MAX)!;
    expect(MAX / look.coarse).toBeCloseTo(PIXIE_MIN_TEXEL_PX, 9);
  });

  it("stays finite above the fitted board and past the closest zoom", () => {
    const high = pixieLook(DEFAULT_VISUALS, 1e-9, MAX)!;
    expect(high.coarse).toBeGreaterThan(0);
    expect(Number.isFinite(high.coarse)).toBe(true);
    const near = pixieLook(DEFAULT_VISUALS, MAX * 4, MAX)!;
    expect(near.coarse).toBeCloseTo(DEFAULT_VISUALS.pixelTexelDensity, 9);
    expect(Number.isFinite(pixieLook(DEFAULT_VISUALS, FIT, 0)!.coarse)).toBe(true);
  });

  it("softens the land with the zoom and by nothing else", () => {
    const at = (k: number) => landSoftness(DEFAULT_VISUALS, k);
    expect(at(1)).toBe(0);
    // The icon tokens hold the full pixel chart: nothing softens before the sprites arrive at 5.216.
    expect(at(5.2)).toBe(0);
    expect(at(5.216)).toBe(0);
    expect(at(DEFAULT_VISUALS.softLandFrom)).toBe(0);
    expect(at(DEFAULT_VISUALS.softLandTo)).toBe(1);
    expect(at(NEAR)).toBe(1);
    let last = 0;
    for (let k = 1; k <= NEAR; k += 0.1) {
      expect(at(k)).toBeGreaterThanOrEqual(last);
      last = at(k);
    }
    expect(landSoftness({ ...DEFAULT_VISUALS, enableSoftLand: false }, NEAR)).toBe(0);
  });

  it("hands the soft land's keeps to the shader and leaves the shared numbers alone, so the ranges stay pixelated", () => {
    const far = pixieLook(DEFAULT_VISUALS, 1.5, NEAR)!;
    const near = pixieLook(DEFAULT_VISUALS, NEAR, NEAR)!;
    expect(far.soft).toBe(0);
    expect(far.brush).toBe(0);
    expect(near.soft).toBe(1);
    expect(near.brush).toBeCloseTo(DEFAULT_VISUALS.softLandBrush, 9);
    for (const look of [far, near]) {
      expect(look.dither).toBe(DEFAULT_VISUALS.pixelDitherStrength);
      expect(look.saturation).toBe(DEFAULT_VISUALS.pixelPaletteSaturation);
      expect(look.contrast).toBe(DEFAULT_VISUALS.pixelHillshadeContrast);
      expect(look.softDither).toBe(DEFAULT_VISUALS.softLandDither);
      expect(look.softSat).toBe(DEFAULT_VISUALS.softLandSaturation);
      expect(look.softBand).toBe(DEFAULT_VISUALS.softLandValueBand);
    }
  });

  it("passes the weights through, with the tones and the sea bands as whole numbers", () => {
    const look = pixieLook({ ...DEFAULT_VISUALS, pixelShadowSteps: 2.6, seaContourSteps: 3.4, pixelDitherStrength: 0.25, coastRimIntensity: 0.5 }, FIT, NEAR)!;
    expect(look.steps).toBe(3);
    expect(look.seaSteps).toBe(3);
    expect(look.dither).toBe(0.25);
    expect(look.rim).toBe(0.5);
    expect(look.contrast).toBe(DEFAULT_VISUALS.pixelHillshadeContrast);
    expect(look.saturation).toBe(DEFAULT_VISUALS.pixelPaletteSaturation);
    expect(look.regional).toBe(true);
    expect(pixieLook({ ...DEFAULT_VISUALS, regionalPaletteDetail: false }, FIT, MAX)!.regional).toBe(false);
  });
});

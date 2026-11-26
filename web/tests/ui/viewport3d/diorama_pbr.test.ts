import { describe, expect, it } from "vitest";
import { DEFAULT_VISUALS, VISUAL_RANGES } from "../../../src/ui/map/mapVisualConfig";
import { BOARD_SKINS } from "../../../src/ui/viewport3d/skins/boardSkin";
import { DIORAMA_FROM, DIORAMA_GLSL, DIORAMA_TO, dioramaFade, SAND_CEILING, SNOW_PEAK } from "../../../src/ui/viewport3d/skins/dioramaPbr";

describe("the diorama surface", () => {
  it("is nothing below the diorama zoom and whole above the cross-fade", () => {
    expect(dioramaFade(1)).toBe(0);
    expect(dioramaFade(DIORAMA_FROM)).toBe(0);
    expect(dioramaFade(DIORAMA_TO)).toBe(1);
    expect(dioramaFade(9)).toBe(1);
    const mid = dioramaFade((DIORAMA_FROM + DIORAMA_TO) / 2);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
  });
  it("keeps sand under the bloom and lets only snow past white, by a hair", () => {
    expect(SAND_CEILING).toBeLessThanOrEqual(0.92);
    expect(SNOW_PEAK).toBeGreaterThan(1);
    expect(SNOW_PEAK).toBeLessThanOrEqual(1.05);
  });
  it("has the four sets", () => {
    for (const name of ["dioFetch", "dioMix", "dioSoft", "dioRock"]) {
      expect(DIORAMA_GLSL).toContain(name);
    }
  });
  it("is registered with its sliders, and owned by the pixel skin", () => {
    for (const key of ["dioramaPbrBlend", "dioramaTileScale", "dioramaNormalStrength", "albedoDetailStrength", "snowColdTint", "desertHeatHaze", "forestUnderstoryTint", "windStrength", "terrainHillRelief"] as const) {
      expect(DEFAULT_VISUALS[key]).toBeGreaterThan(0);
      expect(VISUAL_RANGES[key]).toBeDefined();
      expect(BOARD_SKINS.pixel.owns).toContain(key);
    }
  });
});

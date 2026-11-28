import { describe, expect, it } from "vitest";
import { cameraDistance, cameraTier, DISTANCE_K, microAlpha, microSpriteLean, zoomForDistance } from "../../../src/ui/map/boardTune";
import { maxZoomK } from "../../../src/ui/map/viewMath";
import { DEFAULT_VISUALS } from "../../../src/ui/map/mapVisualConfig";
import { dioramaFade } from "../../../src/ui/viewport3d/skins/dioramaPbr";

describe("camera distance and its tiers", () => {
  it("makes the diorama cross-fade run over distance 4.3 to 3.8, and the camera keeps its own distances", () => {
    expect(cameraDistance(3.8)).toBeCloseTo(4.3, 9);
    expect(cameraDistance(4.3)).toBeCloseTo(3.8, 9);
    // The diorama's own cross-fade is set apart from the camera's distance now: it runs over zoom 6.245 to 7.07.
    expect(dioramaFade(6.245)).toBe(0);
    expect(dioramaFade((6.245 * 4.3) / 3.8)).toBeCloseTo(1, 9);
    expect(zoomForDistance(cameraDistance(2.7))).toBeCloseTo(2.7, 9);
    expect(DISTANCE_K).toBeCloseTo(3.8 * 4.3, 9);
  });
  it("names the tiers by distance", () => {
    expect(cameraTier(zoomForDistance(20))).toBe("strategic");
    expect(cameraTier(zoomForDistance(10))).toBe("icon");
    expect(cameraTier(zoomForDistance(5))).toBe("diorama");
    expect(cameraTier(zoomForDistance(3))).toBe("micro");
  });
  it("ramps uMicroAlpha over distance 3.6 to 2.4, and holds it at 0 and 1 outside", () => {
    expect(microAlpha(zoomForDistance(5))).toBe(0);
    expect(microAlpha(zoomForDistance(3.6))).toBe(0);
    expect(microAlpha(zoomForDistance(3.0))).toBeCloseTo(0.5, 6);
    expect(microAlpha(zoomForDistance(2.4))).toBe(1);
    expect(microAlpha(zoomForDistance(1.5))).toBe(1);
  });
  it("leans the figures back only in the micro tier, and never nearer than the floor", () => {
    expect(microSpriteLean(zoomForDistance(5))).toBe(1);
    expect(microSpriteLean(zoomForDistance(2))).toBeLessThan(1);
    expect(maxZoomK(100, 1)).toBeLessThanOrEqual(zoomForDistance(DEFAULT_VISUALS.levelMinDistance) + 1e-9);
  });
});

import { cliffShadeFade } from "../../../src/ui/map/boardTune";
describe("the cliff shade", () => {
  it("is off at the chart's zoom and comes in slowly over the close zoom", () => {
    expect(cliffShadeFade(2)).toBe(0);
    expect(cliffShadeFade(5.587)).toBe(0);
    expect(cliffShadeFade(9.36)).toBeGreaterThan(0.4);
    expect(cliffShadeFade(9.36)).toBeLessThan(0.6);
    expect(cliffShadeFade(13.14)).toBe(1);
  });
});

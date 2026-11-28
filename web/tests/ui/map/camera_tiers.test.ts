import { describe, expect, it } from "vitest";
import { cameraDistance, cameraTier, DISTANCE_K, microAlpha, microSpriteLean, zoomForDistance } from "../../../src/ui/map/boardTune";
import { maxZoomK } from "../../../src/ui/map/viewMath";
import { dioramaFade } from "../../../src/ui/viewport3d/skins/dioramaPbr";

describe("camera distance and its tiers", () => {
  it("makes the diorama cross-fade run over distance 4.3 to 3.8, as it does over zoom 5.216 to 5.9", () => {
    expect(cameraDistance(5.216)).toBeCloseTo(4.3, 9);
    expect(cameraDistance((5.216 * 4.3) / 3.8)).toBeCloseTo(3.8, 9);
    expect(dioramaFade(zoomForDistance(4.3))).toBeCloseTo(0, 9);
    expect(dioramaFade(zoomForDistance(3.8))).toBeCloseTo(1, 9);
    expect(zoomForDistance(cameraDistance(2.7))).toBeCloseTo(2.7, 9);
    expect(DISTANCE_K).toBeCloseTo(5.216 * 4.3, 9);
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
    expect(maxZoomK(100, 1)).toBeLessThanOrEqual(zoomForDistance(1.35) + 1e-9);
  });
});

import { cliffShadeFade } from "../../../src/ui/map/boardTune";
describe("the cliff shade", () => {
  it("is off at the chart's zoom and comes in slowly over the close zoom", () => {
    expect(cliffShadeFade(2)).toBe(0);
    expect(cliffShadeFade(4.667)).toBe(0);
    expect(cliffShadeFade(7.82)).toBeGreaterThan(0.4);
    expect(cliffShadeFade(7.82)).toBeLessThan(0.6);
    expect(cliffShadeFade(10.98)).toBe(1);
  });
});

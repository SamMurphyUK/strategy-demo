import { describe, expect, it } from "vitest";
import { cameraDistance, cameraTier, DISTANCE_K, microAlpha, microSpriteLean, zoomForDistance } from "../../../src/ui/map/boardTune";
import { maxZoomK } from "../../../src/ui/map/viewMath";
import { dioramaFade } from "../../../src/ui/viewport3d/skins/dioramaPbr";

describe("camera distance and its tiers", () => {
  it("makes the diorama cross-fade run over distance 4.3 to 3.8, as it does over zoom 3.8 to 4.3", () => {
    expect(cameraDistance(3.8)).toBeCloseTo(4.3, 9);
    expect(cameraDistance(4.3)).toBeCloseTo(3.8, 9);
    expect(dioramaFade(zoomForDistance(4.3))).toBeCloseTo(0, 9);
    expect(dioramaFade(zoomForDistance(3.8))).toBeCloseTo(1, 9);
    expect(zoomForDistance(cameraDistance(2.7))).toBeCloseTo(2.7, 9);
    expect(DISTANCE_K).toBeCloseTo(16.34, 9);
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

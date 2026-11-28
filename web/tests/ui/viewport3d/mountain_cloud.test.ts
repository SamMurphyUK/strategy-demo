import { describe, expect, it } from "vitest";
import { placeCaption } from "../../../src/ui/map/facilityBadge";
import { facilityBadgeAlpha } from "../../../src/ui/map/boardTune";
import { flurryEdgeFade } from "../../../src/ui/viewport3d/flurries";
import { CLOUD_POOL, downhill } from "../../../src/ui/viewport3d/mountainCloud";

describe("mountain clouds", () => {
  it("drifts down the slope, and along a default on flat ground", () => {
    const hill = (x: number) => 10 - x * 0.5;
    const way = downhill((x) => hill(x), 5, 0, { x: 0, y: 1 });
    expect(way.x).toBeGreaterThan(0.99);
    const flat = downhill(() => 3, 5, 0, { x: 0, y: 1 });
    expect(flat).toEqual({ x: 0, y: 1 });
    expect(CLOUD_POOL).toBeGreaterThan(10);
  });
});

describe("snow flurries", () => {
  it("is full in the middle of the screen and weak at the edge", () => {
    expect(flurryEdgeFade(0, 0)).toBe(1);
    expect(flurryEdgeFade(1, 0)).toBeCloseTo(0.2, 5);
    expect(flurryEdgeFade(0.2, 0)).toBe(1);
  });
});

describe("place captions", () => {
  it("names a landmark as the region, and a works with its owner", () => {
    expect(placeCaption({ name: "London", owner: "United Kingdom", capital: true, factory: "major", airbase: true, harbour: true })).toEqual({
      landmark: "London (Victory City)",
      works: "Major factory, Airbase, Harbour · United Kingdom",
    });
    expect(placeCaption({ name: "Egypt", owner: "United Kingdom", capital: false, factory: "none", airbase: false, harbour: false })).toEqual({
      landmark: "",
      works: "",
    });
  });
});

describe("facility badges", () => {
  it("fade slowly to nothing as the camera comes in, whole until the sprites arrive", () => {
    expect(facilityBadgeAlpha(2)).toBe(1);
    expect(facilityBadgeAlpha(3.8)).toBe(1);
    const mid = facilityBadgeAlpha(5.4);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
    expect(facilityBadgeAlpha(5)).toBeGreaterThan(facilityBadgeAlpha(6));
    expect(facilityBadgeAlpha(7)).toBe(0);
    expect(facilityBadgeAlpha(9)).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_VISUALS, factionBorderShare, factionTint } from "../../../src/ui/map/mapVisualConfig";
import { COIN_SHARE, emblemLayout, starPoints, STAR_SHARE } from "../../../src/ui/map/regionEmblem";

describe("the faction tint across the zoom tiers", () => {
  it("is the most at the mid zoom, fades with the approach, and is none at the diorama", () => {
    const max = DEFAULT_VISUALS.factionTintMax;
    expect(max).toBeCloseTo(0.45, 6);
    expect(factionTint(0, DEFAULT_VISUALS)).toBeCloseTo(max, 6);
    expect(factionTint(DEFAULT_VISUALS.factionTintFadeFrom, DEFAULT_VISUALS)).toBeCloseTo(max, 6);
    const mid = factionTint((DEFAULT_VISUALS.factionTintFadeFrom + DEFAULT_VISUALS.factionTintFadeTo) / 2, DEFAULT_VISUALS);
    expect(mid).toBeGreaterThan(0.01);
    expect(mid).toBeLessThan(max);
    expect(factionTint(DEFAULT_VISUALS.factionTintFadeTo, DEFAULT_VISUALS)).toBeCloseTo(0, 6);
    expect(factionTint(1, DEFAULT_VISUALS)).toBe(0);
  });

  it("only ever falls as the camera comes in", () => {
    let last = Infinity;
    for (let c = 0; c <= 1.0001; c += 0.05) {
      const now = factionTint(c, DEFAULT_VISUALS);
      expect(now).toBeLessThanOrEqual(last + 1e-9);
      last = now;
    }
  });

  it("ships the per-faction boosts at the mid zoom: USSR +5%, Germany +60%, Japan +15%, USA +70%, Britain +50%", () => {
    expect(DEFAULT_VISUALS.factionBoostUSSR).toBeCloseTo(1.05, 6);
    expect(DEFAULT_VISUALS.factionBoostGER).toBeCloseTo(1.6, 6);
    expect(DEFAULT_VISUALS.factionBoostJAP).toBeCloseTo(1.15, 6);
    expect(DEFAULT_VISUALS.factionBoostUS).toBeCloseTo(1.7, 6);
    expect(DEFAULT_VISUALS.factionBoostUK).toBeCloseTo(1.5, 6);
  });

  it("draws the border darker than the faction's colour, so it reads on the tint", () => {
    expect(DEFAULT_VISUALS.factionBorderBrightness).toBeLessThan(1);
    expect(DEFAULT_VISUALS.factionBorderOpacity).toBe(1);
  });

  it("keeps borders whole past the tint's end, and fainter but never gone at the closest zoom", () => {
    expect(DEFAULT_VISUALS.factionBorderFloor).toBe(0.5);
    // Whole at the mid zoom and where the diorama begins (the tint is gone by 0.42).
    expect(factionBorderShare(0, DEFAULT_VISUALS)).toBeCloseTo(1, 6);
    expect(factionBorderShare(DEFAULT_VISUALS.factionTintFadeTo + 0.05, DEFAULT_VISUALS)).toBeCloseTo(1, 6);
    // Easing to the floor deep in, and holding it.
    expect(factionBorderShare(DEFAULT_VISUALS.factionBorderFadeTo, DEFAULT_VISUALS)).toBeCloseTo(0.5, 6);
    expect(factionBorderShare(1, DEFAULT_VISUALS)).toBeCloseTo(0.5, 6);
    let last = Infinity;
    for (let c = 0; c <= 1.0001; c += 0.05) {
      const now = factionBorderShare(c, DEFAULT_VISUALS);
      expect(now).toBeLessThanOrEqual(last + 1e-9);
      expect(now).toBeGreaterThan(0.45);
      last = now;
    }
  });

  it("ships the border strengths: 35% inside one faction, 70% between two", () => {
    expect(DEFAULT_VISUALS.factionBorderInner).toBe(0.35);
    expect(DEFAULT_VISUALS.factionBorderFrontier).toBe(0.7);
  });
});

describe("the pixel tier's emblem", () => {
  const centre = { x: 200, y: 200 };

  it("tucks the coin smaller than the roundel, down and to its side", () => {
    const { roundel, coin } = emblemLayout(centre, 30, 1, [], false);
    expect(coin.d).toBeCloseTo(30 * COIN_SHARE, 6);
    expect(coin.d).toBeLessThan(roundel.d);
    expect(coin.x).toBeGreaterThan(roundel.x);
    expect(coin.y).toBeGreaterThan(roundel.y);
  });

  it("keeps the coin from riding up into the roundel as the camera tips", () => {
    const flat = emblemLayout(centre, 30, 1, [], false).coin;
    const tipped = emblemLayout(centre, 30, 0.4, [], false).coin;
    expect(tipped.y).toBeLessThan(flat.y);
    expect(tipped.y).toBeGreaterThan(centre.y);
  });

  it("has no star on an ordinary territory and one on a Victory City", () => {
    expect(emblemLayout(centre, 30, 1, [], false).star).toBeNull();
    const star = emblemLayout(centre, 30, 1, [], true).star;
    expect(star?.d).toBeCloseTo(30 * STAR_SHARE, 6);
  });

  it("puts the star where no unit token covers it", () => {
    const north = { x: centre.x, y: centre.y - 30 * 0.92, r: 14 };
    const star = emblemLayout(centre, 30, 1, [north], true).star!;
    const clear = (spot: { x: number; y: number; d: number }) => Math.hypot(spot.x - north.x, spot.y - north.y) >= spot.d / 2 + north.r;
    expect(clear(star)).toBe(true);
  });

  it("draws a five-pointed star with a tip straight up", () => {
    const points = starPoints(10, 10, 5);
    expect(points).toHaveLength(10);
    expect(points[0].x).toBeCloseTo(10, 6);
    expect(points[0].y).toBeCloseTo(5, 6);
  });
});

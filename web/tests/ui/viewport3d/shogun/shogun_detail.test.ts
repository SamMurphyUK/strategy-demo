import { describe, expect, it } from "vitest";
import { bokehShare, DEFAULT_VISUALS, factionWash } from "../../../../src/ui/map/mapVisualConfig";
import { TILT_FULL } from "../../../../src/ui/viewport3d/shogun/boardCamera";
import { DRESS_FULL, DRESS_START, shogunCloseness, shogunDetail } from "../../../../src/ui/viewport3d/shogun/shogunDetail";

const FIT = 2;

describe("how close the Shogun board is", () => {
  it("is 0 at the fitted board and anywhere above it", () => {
    expect(shogunCloseness(FIT, FIT)).toBe(0);
    expect(shogunCloseness(FIT * 0.6, FIT)).toBe(0);
    expect(shogunCloseness(FIT * DRESS_START, FIT)).toBeCloseTo(0, 6);
  });

  it("is 1 once the camera has finished tipping, and stays there", () => {
    expect(DRESS_FULL).toBe(TILT_FULL);
    expect(shogunCloseness(FIT * DRESS_FULL, FIT)).toBeCloseTo(1, 6);
    expect(shogunCloseness(FIT * 24, FIT)).toBe(1);
  });

  it("rises with the zoom and never steps back", () => {
    let previous = 0;
    for (let zoom = 0.6; zoom <= 24; zoom *= 1.07) {
      const next = shogunCloseness(FIT * zoom, FIT);
      expect(next).toBeGreaterThanOrEqual(previous);
      previous = next;
    }
  });

  it("survives a board that has not been fitted yet", () => {
    expect(shogunCloseness(1, 0)).toBe(0);
    expect(Number.isFinite(shogunDetail(0, 0).relief)).toBe(true);
  });
});

describe("what the board shows at a zoom", () => {
  it("is a clean strategic sheet at the fitted board", () => {
    const detail = shogunDetail(FIT, FIT);
    expect(detail).toEqual({ closeness: 0, relief: 0, water: 0, props: 0, smoke: 0, focus: 0 });
    expect(factionWash(detail.closeness, DEFAULT_VISUALS)).toBeCloseTo(0.5, 6);
    expect(bokehShare(detail.focus, DEFAULT_VISUALS)).toBe(0);
  });

  it("is the full diorama on the table", () => {
    const detail = shogunDetail(FIT * DRESS_FULL, FIT);
    expect(detail.relief).toBeCloseTo(1, 6);
    expect(detail.water).toBeCloseTo(1, 6);
    expect(detail.props).toBeCloseTo(1, 6);
    expect(detail.smoke).toBeCloseTo(1, 6);
    expect(detail.focus).toBeCloseTo(1, 6);
    expect(factionWash(detail.closeness, DEFAULT_VISUALS)).toBeCloseTo(0.15, 6);
  });

  it("has no smoke and no lens at the middle of the zoom", () => {
    // A third of the way in: the light and the water have started, and nothing else has.
    const detail = shogunDetail(FIT * DRESS_START * (DRESS_FULL / DRESS_START) ** 0.35, FIT);
    expect(detail.relief).toBeGreaterThan(0.5);
    expect(detail.smoke).toBe(0);
    expect(detail.props).toBe(0);
    expect(detail.focus).toBe(0);
  });

  it("brings the lens in last", () => {
    for (let zoom = 1; zoom <= 8; zoom *= 1.1) {
      const detail = shogunDetail(FIT * zoom, FIT);
      expect(detail.focus).toBeLessThanOrEqual(detail.props + 1e-9);
      expect(detail.props).toBeLessThanOrEqual(detail.water + 1e-9);
    }
  });
});

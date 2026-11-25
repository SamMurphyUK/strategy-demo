import { describe, expect, it } from "vitest";
import { boardAnimates, boardDetail, closeness } from "../../../src/ui/viewport3d/zoomDetail";

describe("zoom detail", () => {
  it("measures closeness from the fitted board to the closest zoom", () => {
    expect(closeness(1.2, 1.2, 8)).toBe(0);
    expect(closeness(0.8, 1.2, 8)).toBe(0);
    expect(closeness(8, 1.2, 8)).toBeCloseTo(1, 12);
    expect(closeness(20, 1.2, 8)).toBe(1);
    // Halfway on a log scale is the geometric mean.
    expect(closeness(Math.sqrt(1.2 * 8), 1.2, 8)).toBeCloseTo(0.5, 12);
  });

  it("is a clean strategic sheet at the fitted board and above it", () => {
    for (const k of [0.72, 1, 1.2]) {
      const detail = boardDetail(k, 1.2, 8);
      expect(detail.flatten).toBe(1);
      expect(detail.props).toBe(0);
      expect(detail.relief).toBe(0);
      expect(detail.water).toBe(0);
      expect(detail.smoke).toBe(0);
      expect(detail.vignette).toBe(0);
      expect(detail.focus).toBe(0);
      expect(boardAnimates(detail)).toBe(false);
    }
  });

  it("is a full diorama at the closest zoom", () => {
    const detail = boardDetail(8, 1.2, 8);
    expect(detail.flatten).toBe(0);
    expect(detail.props).toBe(1);
    expect(detail.relief).toBe(1);
    expect(detail.water).toBe(1);
    expect(detail.smoke).toBe(1);
    expect(detail.vignette).toBe(1);
    expect(detail.focus).toBe(1);
    expect(boardAnimates(detail)).toBe(true);
  });

  it("gives the same picture at the same share of the zoom range on a laptop and a wide monitor", () => {
    const laptop = boardDetail(1.2 * (8 / 1.2) ** 0.4, 1.2, 8);
    const monitor = boardDetail(2 * (8 / 2) ** 0.4, 2, 8);
    expect(monitor.props).toBeCloseTo(laptop.props, 12);
    expect(monitor.focus).toBeCloseTo(laptop.focus, 12);
  });

  it("holds terrain off through the middle of the zoom, and never takes the dressing back", () => {
    const mid = boardDetail(Math.sqrt(1.2 * 8), 1.2, 8);
    expect(mid.closeness).toBeCloseTo(0.5, 12);
    expect(mid.props).toBe(0);
    let previous = boardDetail(1.2, 1.2, 8);
    for (let step = 1; step <= 60; step++) {
      const detail = boardDetail(1.2 * (8 / 1.2) ** (step / 60), 1.2, 8);
      expect(detail.props).toBeGreaterThanOrEqual(previous.props);
      expect(detail.relief).toBeGreaterThanOrEqual(previous.relief);
      expect(detail.focus).toBeGreaterThanOrEqual(previous.focus);
      expect(detail.flatten).toBeLessThanOrEqual(previous.flatten);
      previous = detail;
    }
  });

  it("still reaches the closest zoom when the zoom range is short", () => {
    // A high pixel ratio can leave little room between the fitted board and the sharpest zoom.
    expect(boardDetail(4, 3.6, 4).closeness).toBeLessThan(1);
    expect(boardDetail(5.4, 3.6, 4).closeness).toBe(1);
  });
});

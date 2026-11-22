import { describe, expect, it } from "vitest";
import { GRAPHICS_DEFAULTS, graphicsFromJson, graphicsSettings, setGraphicsSettings } from "../../../src/ui/battle/graphicsSettings";
import { loopOffset, oceanRow } from "../../../src/ui/battle/seaTile";

describe("graphical settings", () => {
  it("starts with the full picture on", () => {
    expect(GRAPHICS_DEFAULTS).toEqual({
      mist: true,
      liveSky: true,
      crispPictures: true,
      animatedSea: true,
      unitLighting: true,
      cinematicCamera: false,
    });
    expect(graphicsFromJson(null)).toEqual(GRAPHICS_DEFAULTS);
  });

  it("keeps a saved switch and ignores anything that is not a switch", () => {
    expect(graphicsFromJson(JSON.stringify({ mist: false, liveSky: "no", extra: 1 }))).toEqual({
      ...GRAPHICS_DEFAULTS,
      mist: false,
    });
    expect(graphicsFromJson(JSON.stringify({ unitLighting: false }))).toEqual({
      ...GRAPHICS_DEFAULTS,
      unitLighting: false,
    });
    expect(graphicsFromJson("not json")).toEqual(GRAPHICS_DEFAULTS);
  });

  it("applies a switch for this visit", () => {
    setGraphicsSettings({ animatedSea: false, crispPictures: false, unitLighting: false });
    try {
      expect(graphicsSettings().animatedSea).toBe(false);
      expect(graphicsSettings().crispPictures).toBe(false);
      expect(graphicsSettings().unitLighting).toBe(false);
    } finally {
      setGraphicsSettings({ animatedSea: true, crispPictures: true, unitLighting: true });
    }
    expect(graphicsSettings()).toEqual(expect.objectContaining(GRAPHICS_DEFAULTS));
  });
});

describe("sea tile", () => {
  it("wraps a scroll into one period, including a negative shift", () => {
    expect(loopOffset(0, 38)).toBe(0);
    expect(loopOffset(38, 38)).toBe(0);
    expect(loopOffset(44, 38)).toBe(6);
    expect(loopOffset(-10, 38)).toBe(28);
  });

  it("scrolls a row by the old swell and speed, and holds still when the scroll is off", () => {
    const moving = oceanRow(3.5, 124, 1, 0.2, true);
    const speed = (14 + ((124 * 7) % 18)) * 1;
    const swell = (Math.sin(3.5 * 2.1 + 124 * 0.045 + 0.2) * 10 + Math.cos(3.5 * 1.4 + 124 * 0.02 + 0.2) * 6) * 1;
    const scroll = (3.5 * speed) % 44;
    expect(moving.shift).toBeCloseTo(scroll + swell);
    expect(moving.foam).toBeCloseTo(scroll * 1.2 + swell);

    const held = oceanRow(3.5, 124, 1, 0.2, false);
    const still = oceanRow(0, 124, 1, 0.2, true);
    expect(held.shift).toBeCloseTo(still.shift);
    expect(held.foam).toBeCloseTo(still.foam);
    expect(held.shift).not.toBeCloseTo(moving.shift);
  });
});

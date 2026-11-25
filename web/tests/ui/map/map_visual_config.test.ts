import { afterEach, describe, expect, it } from "vitest";
import {
  applyVisuals,
  bokehShare,
  DEFAULT_VISUALS,
  factionWash,
  friendlyBorderInk,
  frontlineInk,
  getVisualRev,
  mapVisuals,
  parseVisuals,
  resetVisuals,
  setVisual,
  SOLID_VISUALS,
  subscribeVisuals,
  VISUAL_PRESETS,
  visualPresetJson,
  visualPresetOf,
} from "../../../src/ui/map/mapVisualConfig";

afterEach(() => {
  resetVisuals();
});

describe("the shipped look", () => {
  it("washes the land lightly close in and strongly from altitude", () => {
    expect(DEFAULT_VISUALS.factionWashClose).toBe(0.15);
    expect(DEFAULT_VISUALS.factionWashFar).toBe(0.5);
    expect(factionWash(0, DEFAULT_VISUALS)).toBeCloseTo(0.5, 6);
    expect(factionWash(1, DEFAULT_VISUALS)).toBeCloseTo(0.15, 6);
  });

  it("eases the wash between the two with no step", () => {
    let previous = factionWash(0, DEFAULT_VISUALS);
    for (let i = 1; i <= 20; i++) {
      const next = factionWash(i / 20, DEFAULT_VISUALS);
      expect(next).toBeLessThanOrEqual(previous);
      expect(previous - next).toBeLessThan(0.04);
      previous = next;
    }
  });

  it("keeps smoke thin and the lens pulled back by forty percent", () => {
    expect(DEFAULT_VISUALS.smokeOpacity).toBeLessThanOrEqual(0.22);
    expect(DEFAULT_VISUALS.bokehIntensity).toBeCloseTo(0.6, 6);
    expect(DEFAULT_VISUALS.highlightMode).toBe("click-and-drag");
    expect(DEFAULT_VISUALS.friendlyBorderStyle).toBe("subtle-dashed");
    expect(DEFAULT_VISUALS.frontlineStyle).toBe("dual-ink");
  });
});

describe("derived numbers", () => {
  it("draws a friendly border as a quarter-strength dash, a solid line, or nothing", () => {
    expect(friendlyBorderInk("subtle-dashed")).toEqual({ dashed: 0.25, solid: 0 });
    expect(friendlyBorderInk("solid")).toEqual({ dashed: 0, solid: 0.9 });
    expect(friendlyBorderInk("hidden")).toEqual({ dashed: 0, solid: 0 });
  });

  it("turns on one frontline drawing at a time", () => {
    expect(frontlineInk("dual-ink")).toEqual({ dual: 1, classic: 0 });
    expect(frontlineInk("classic")).toEqual({ dual: 0, classic: 1 });
    expect(frontlineInk("hidden")).toEqual({ dual: 0, classic: 0 });
  });

  it("has no lens at altitude, and none with depth of field off", () => {
    expect(bokehShare(0, DEFAULT_VISUALS)).toBe(0);
    expect(bokehShare(1, DEFAULT_VISUALS)).toBeCloseTo(0.6, 6);
    expect(bokehShare(1, { ...DEFAULT_VISUALS, enableDoF: false })).toBe(0);
  });
});

describe("parsing a preset", () => {
  it("fills gaps from the base and clamps numbers to their range", () => {
    const parsed = parseVisuals({ factionWashClose: 7, smokeOpacity: -1, sunAzimuth: 200, frontlineStyle: "zigzag", showBiomeProps: "yes" });
    expect(parsed.factionWashClose).toBe(1);
    expect(parsed.smokeOpacity).toBe(0);
    expect(parsed.sunAzimuth).toBe(50);
    expect(parsed.frontlineStyle).toBe(DEFAULT_VISUALS.frontlineStyle);
    expect(parsed.showBiomeProps).toBe(DEFAULT_VISUALS.showBiomeProps);
    expect(parsed.factionWashFar).toBe(DEFAULT_VISUALS.factionWashFar);
  });

  it("reads nothing as the shipped look", () => {
    expect(parseVisuals(null)).toEqual({ ...DEFAULT_VISUALS });
    expect(parseVisuals("nonsense")).toEqual({ ...DEFAULT_VISUALS });
  });

  it("copies a preset as JSON that parses back to the same settings", () => {
    const text = visualPresetJson(SOLID_VISUALS);
    expect(parseVisuals(JSON.parse(text))).toEqual({ ...SOLID_VISUALS });
    expect(Object.keys(JSON.parse(text))).toEqual(Object.keys(DEFAULT_VISUALS));
  });

  it("names the preset a config equals", () => {
    for (const name of Object.keys(VISUAL_PRESETS) as (keyof typeof VISUAL_PRESETS)[]) {
      expect(visualPresetOf(VISUAL_PRESETS[name])).toBe(name);
    }
    expect(visualPresetOf({ ...DEFAULT_VISUALS, smokeOpacity: 0.1 })).toBe("custom");
  });
});

describe("the store", () => {
  it("changes the live object in place and tells its listeners once", () => {
    const same = mapVisuals;
    let calls = 0;
    const stop = subscribeVisuals(() => {
      calls += 1;
    });
    const before = getVisualRev();
    setVisual("smokeOpacity", 0.1);
    expect(mapVisuals).toBe(same);
    expect(mapVisuals.smokeOpacity).toBe(0.1);
    expect(getVisualRev()).toBe(before + 1);
    expect(calls).toBe(1);

    // The same value again is no change.
    setVisual("smokeOpacity", 0.1);
    expect(calls).toBe(1);

    stop();
    setVisual("smokeOpacity", 0.2);
    expect(calls).toBe(1);
  });

  it("clamps a value on the way in", () => {
    setVisual("bokehIntensity", 99);
    expect(mapVisuals.bokehIntensity).toBe(1.5);
    setVisual("highlightMode", "sparkle" as never);
    expect(mapVisuals.highlightMode).toBe(DEFAULT_VISUALS.highlightMode);
  });

  it("applies a whole preset and resets to the shipped look", () => {
    applyVisuals(SOLID_VISUALS);
    expect(visualPresetOf(mapVisuals)).toBe("solid");
    resetVisuals();
    expect(visualPresetOf(mapVisuals)).toBe("shogun");
  });
});

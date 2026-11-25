import { describe, expect, it } from "vitest";
import { DEFAULT_VISUALS, VISUAL_RANGES } from "../../../src/ui/map/mapVisualConfig";
import { BOARD_SKINS, DEFAULT_SKIN, skinDefine, skinDisables, skinFor, skinOwner, skinOwns } from "../../../src/ui/viewport3d/skins/boardSkin";

describe("the board's skins", () => {
  it("falls back to the baked skin whenever the pixel chart cannot draw", () => {
    expect(DEFAULT_SKIN).toBe("baked");
    expect(skinFor(DEFAULT_VISUALS, true)).toBe("pixel");
    expect(skinFor(DEFAULT_VISUALS, false)).toBe("baked");
    expect(skinFor({ ...DEFAULT_VISUALS, enableFauxPixelMap: false }, true)).toBe("baked");
  });

  it("picks the shader chunks by one define, and the baked skin sets none", () => {
    expect(skinDefine("pixel")).toEqual({ name: "PIXIE", value: 1 });
    expect(skinDefine("baked")).toEqual({ name: "PIXIE", value: null });
  });

  it("gives each skin a preset that turns the chart on or off to match it", () => {
    expect(BOARD_SKINS.pixel.preset.enableFauxPixelMap).toBe(true);
    expect(BOARD_SKINS.baked.preset.enableFauxPixelMap).toBe(false);
  });

  it("lists only real settings as the pixel skin's own, and none as the baked skin's", () => {
    for (const key of BOARD_SKINS.pixel.owns) {
      expect(key in DEFAULT_VISUALS).toBe(true);
    }
    expect(BOARD_SKINS.baked.owns).toHaveLength(0);
    expect(skinOwns("pixel", "softLandBrush")).toBe(true);
    expect(skinOwns("baked", "softLandBrush")).toBe(false);
    expect(skinOwns("pixel", "seaSheenStrength")).toBe(false);
    expect(Object.keys(VISUAL_RANGES).length).toBeGreaterThan(0);
  });

  it("dims a setting only under a skin that does not own it", () => {
    expect(skinOwner("softLandBrush")).toBe("pixel");
    expect(skinDisables("baked", "softLandBrush")).toBe(true);
    expect(skinDisables("pixel", "softLandBrush")).toBe(false);
    // Settings every skin reads are never dimmed, and neither is the chart switch itself.
    expect(skinOwner("seaSheenStrength")).toBeNull();
    expect(skinDisables("baked", "seaSheenStrength")).toBe(false);
    expect(skinDisables("baked", "enableFauxPixelMap")).toBe(false);
  });
});

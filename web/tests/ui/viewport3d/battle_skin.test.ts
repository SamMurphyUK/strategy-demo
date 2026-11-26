import { describe, expect, it } from "vitest";
import {
  BATTLE_SKINS,
  FADING_16,
  battleSkinDisables,
  battleSkinFor,
  battleSkinOwner,
  battleSkinOwns,
  clampLuma,
  harmonizePixels,
  hexToRgb,
  lumaOf,
  nearestFading,
} from "../../../src/ui/viewport3d/skins/battleSkin";
import { BOARD_SKINS } from "../../../src/ui/viewport3d/skins/boardSkin";
import {
  BATTLE_VISUAL_KEYS,
  DEFAULT_BATTLE_VISUALS,
  battleVisuals,
  getBattleVisualRev,
  parseBattleVisuals,
  setBattleVisual,
} from "../../../src/ui/viewport3d/skins/battleVisualConfig";

describe("battle skin registry", () => {
  it("registers the four exposed sliders on the battle skin and none on the board skins", () => {
    for (const key of ["battleDepthScale", "battleDepthDesat", "battleScatterDensity", "battleSmokeStrength"] as const) {
      expect(BATTLE_SKINS.european.owns).toContain(key);
      expect(BATTLE_VISUAL_KEYS).toContain(key);
      for (const board of Object.values(BOARD_SKINS)) {
        expect((board.owns as readonly string[]).includes(key)).toBe(false);
      }
    }
  });

  it("owns only keys the config defines, and starts from the default preset", () => {
    for (const key of BATTLE_SKINS.european.owns) {
      expect(BATTLE_VISUAL_KEYS).toContain(key);
    }
    expect(BATTLE_SKINS.european.preset).toBe(DEFAULT_BATTLE_VISUALS);
    expect(battleSkinFor("normandy")).toBe("european");
  });

  it("dims settings that belong to a skin other than the active one", () => {
    const registry = {
      european: { id: "european", owns: ["battleDepthScale"] as const },
      desert: { id: "desert", owns: ["battleSmokeStrength"] as const },
    };
    expect(battleSkinOwns("european", "battleDepthScale", registry)).toBe(true);
    expect(battleSkinOwner("battleSmokeStrength", registry)).toBe("desert");
    expect(battleSkinDisables("european", "battleSmokeStrength", registry)).toBe(true);
    expect(battleSkinDisables("european", "battleDepthScale", registry)).toBe(false);
    // A setting no skin owns is read by every skin and is never dimmed.
    expect(battleSkinDisables("european", "battleCameraThud", registry)).toBe(false);
  });

  it("uses the walnut and slate rim colour and the luminance ceilings the brief sets", () => {
    expect(BATTLE_SKINS.european.rim.color).toBe("#1E1B18");
    expect(BATTLE_SKINS.european.grade.groundLumaCeiling).toBeLessThanOrEqual(0.92);
    expect(BATTLE_SKINS.european.grade.smokeLumaCeiling).toBeLessThanOrEqual(0.88);
    expect(BATTLE_SKINS.european.camera.establishing.pitchDeg).toBe(12);
    expect(BATTLE_SKINS.european.camera.establishing.fovDeg).toBe(35);
  });

  it("keeps every palette colour under the ground ceiling", () => {
    for (const p of Object.values(BATTLE_SKINS.european.palettes)) {
      for (const hex of [p.low, p.high, p.worn]) {
        expect(lumaOf(hexToRgb(hex))).toBeLessThanOrEqual(0.92);
      }
    }
  });
});

describe("battle visual config", () => {
  it("clamps to the ranges and fills gaps from the base", () => {
    const c = parseBattleVisuals({ battleDepthScale: 5, battleDepthDesat: -1, battleSmokeStrength: "x" });
    expect(c.battleDepthScale).toBe(1);
    expect(c.battleDepthDesat).toBe(0);
    expect(c.battleSmokeStrength).toBe(DEFAULT_BATTLE_VISUALS.battleSmokeStrength);
  });

  it("publishes a change once, and not at all when the value is the same", () => {
    const before = getBattleVisualRev();
    setBattleVisual("battleScatterDensity", 1.5);
    expect(battleVisuals.battleScatterDensity).toBe(1.5);
    expect(getBattleVisualRev()).toBe(before + 1);
    setBattleVisual("battleScatterDensity", 1.5);
    expect(getBattleVisualRev()).toBe(before + 1);
    setBattleVisual("battleScatterDensity", 1);
  });
});

describe("colour harmony", () => {
  it("clamps luminance without changing hue ratios", () => {
    const c = clampLuma([1, 1, 1], 0.92);
    expect(lumaOf(c)).toBeCloseTo(0.92, 5);
    expect(c[0] / c[1]).toBeCloseTo(1, 5);
    expect(clampLuma([0.2, 0.2, 0.2], 0.92)).toEqual([0.2, 0.2, 0.2]);
  });

  it("snaps an exact palette colour to itself", () => {
    FADING_16.forEach((hex, i) => {
      const c = hexToRgb(hex);
      expect(nearestFading(c[0] * 255, c[1] * 255, c[2] * 255)).toBe(i);
    });
  });

  it("harmonizes pixels toward the palette, leaves transparent ones, and never exceeds the ceiling", () => {
    const px = new Uint8ClampedArray([255, 255, 255, 255, 10, 10, 10, 0, 142, 159, 125, 255]);
    harmonizePixels(px, 1, 0.92);
    expect(px[3]).toBe(255);
    expect(px[4]).toBe(10);
    for (const i of [0, 8]) {
      expect(px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114).toBeLessThanOrEqual(0.92 * 255 + 1);
    }
    // A pixel that is already in the palette stays.
    expect(Array.from(px.slice(8, 11))).toEqual([142, 159, 125]);
  });
});

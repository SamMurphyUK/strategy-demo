import { afterEach, describe, expect, it } from "vitest";
import { MILITARY } from "../../../src/ui/theme/militaryPalette";
import {
  currentTune,
  gradeSaturation,
  groundSquash,
  landColor,
  borderPasses,
  tunedBoard,
  unitLean,
  vanillaTune,
} from "../../../src/ui/map/boardTune";
import { resetBoardTune, setBoardTune } from "../../../src/ui/map/boardTuneStore";
import { FACTION_TINT } from "../../../src/ui/map/mapStyle";
import { cliffDepthScale, projectionScales } from "../../../src/ui/map/viewMath";
import { boardDetail } from "../../../src/ui/viewport3d/zoomDetail";

afterEach(() => {
  resetBoardTune();
});

describe("foreshortening curve", () => {
  it("holds the shipped tip: flat below 1.15, 15% short by 2.2", () => {
    const curve = currentTune().tilt;
    expect(groundSquash(1, curve)).toBe(0);
    expect(groundSquash(1.15, curve)).toBe(0);
    expect(groundSquash(2.2, curve)).toBeCloseTo(0.15, 8);
    expect(groundSquash(4, curve)).toBeCloseTo(0.15, 8);
    expect(groundSquash(1.15 + (2.2 - 1.15) / 2, curve)).toBeCloseTo(0.075, 8);
  });

  it("lets the zoomed-out end and the zoomed-in end differ", () => {
    const curve = { start: 1, end: 3, far: 0.2, near: 0 };
    expect(groundSquash(0.5, curve)).toBeCloseTo(0.2, 8);
    expect(groundSquash(3, curve)).toBeCloseTo(0, 8);
    expect(groundSquash(2, curve)).toBeCloseTo(0.1, 8);
  });

  it("feeds the live curve into the map projection", () => {
    setBoardTune({ ...currentTune(), tilt: { start: 1.15, end: 2.2, far: 0, near: 0 } });
    expect(projectionScales(2.2).sy).toBeCloseTo(2.2, 8);
    expect(cliffDepthScale(2.2)).toBeCloseTo(1, 8);
    resetBoardTune();
    expect(projectionScales(2.2).sy).toBeCloseTo(2.2 * 0.85, 8);
    expect(cliffDepthScale(2.2)).toBeCloseTo(2.6, 8);
  });
});

describe("figure tip", () => {
  it("faces the screen while both angles are 0", () => {
    expect(unitLean(1, currentTune())).toBe(1);
    expect(unitLean(4, currentTune())).toBe(1);
  });

  it("shortens toward the feet as the close angle rises", () => {
    const tune = currentTune();
    tune.unit.near = 40;
    expect(unitLean(1, tune)).toBe(1);
    expect(unitLean(4, tune)).toBeLessThan(0.8);
  });
});

describe("board looks", () => {
  it("keeps the strip colours and the charcoal border on the current set", () => {
    const tune = currentTune();
    expect(landColor("usa", tune)).toBe(MILITARY.olive);
    expect(landColor("ussr", tune)).toBe(MILITARY.crimson);
    expect(borderPasses(tune)[1]?.color).toBe(MILITARY.charcoal);
    expect(gradeSaturation(0, tune)).toBeCloseTo(0.88, 8);
  });

  it("vanilla is a plain desaturated board with the previous colours", () => {
    const tune = vanillaTune();
    const shown = tunedBoard(boardDetail(8, 1.2, 8), tune);
    expect(shown.props).toBe(0);
    expect(shown.relief).toBe(0);
    expect(shown.water).toBe(0);
    expect(shown.smoke).toBe(0);
    expect(shown.vignette).toBe(0);
    expect(shown.focus).toBe(0);
    expect(gradeSaturation(1, tune)).toBeCloseTo(0.62, 8);
    expect(landColor("ussr", tune)).toBe(FACTION_TINT.USSR);
    expect(landColor("usa", tune)).toBe(FACTION_TINT.US);
    expect(borderPasses(tune)[1]?.color).toBe("#2B2620");
  });

  it("a picked colour overrides the set", () => {
    const tune = currentTune();
    tune.colors.USSR = "#112233";
    expect(landColor("soviet", tune)).toBe("#112233");
  });
});

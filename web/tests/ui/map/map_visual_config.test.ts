import { afterEach, describe, expect, it } from "vitest";
import {
  aoLook,
  applyVisuals,
  BLOOM_THRESHOLD,
  bloomLook,
  bokehShare,
  castShadowLook,
  DEFAULT_VISUALS,
  factionWash,
  friendlyBorderInk,
  frontlineInk,
  getVisualRev,
  grainAmount,
  INFANTRY_FIGURE_PX,
  mapVisuals,
  mountainLook,
  outlineLook,
  parseVisuals,
  PLAIN_VISUALS,
  plinthLook,
  resetVisuals,
  riverLook,
  roadLook,
  setVisual,
  SHADOW_OPACITY_UNIT,
  shadowMapSize,
  skySheen,
  SOLID_VISUALS,
  subscribeVisuals,
  sunArcOf,
  sunPace,
  surfaceLook,
  VISUAL_KEYS,
  VISUAL_PRESETS,
  VISUAL_RANGES,
  visualPresetJson,
  visualPresetOf,
  wantsFigureCards,
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

describe("light and lens", () => {
  it("ships the shade, the shadows, and the sky at medium, and the glow and the grain low", () => {
    expect(DEFAULT_VISUALS.aoWeight).toBe("medium");
    expect(DEFAULT_VISUALS.bloomWeight).toBe("low");
    expect(DEFAULT_VISUALS.filmGrainWeight).toBe("low");
    expect(DEFAULT_VISUALS.outlineMode).toBe("units-only");
    expect(DEFAULT_VISUALS.shadowQuality).toBe("medium");
    expect(DEFAULT_VISUALS.envReflectionWeight).toBe("medium");
    expect(DEFAULT_VISUALS.sunCycle).toBe("animated");
  });

  it("turns every one of them off for the plain board", () => {
    expect(aoLook(PLAIN_VISUALS.aoWeight)).toBeNull();
    expect(bloomLook(PLAIN_VISUALS.bloomWeight)).toBeNull();
    expect(grainAmount(PLAIN_VISUALS.filmGrainWeight, 0)).toBe(0);
    expect(outlineLook(PLAIN_VISUALS.outlineMode)).toEqual({ line: 0, wash: 0 });
    expect(shadowMapSize(PLAIN_VISUALS.shadowQuality)).toBe(0);
    expect(skySheen(PLAIN_VISUALS.envReflectionWeight)).toBe(0);
    expect(wantsFigureCards(PLAIN_VISUALS)).toEqual({ shadows: false, outline: false });
  });

  it("has no work for a weight that is off, and more for each step up", () => {
    expect(aoLook("off")).toBeNull();
    expect(bloomLook("off")).toBeNull();
    const weights = ["low", "medium", "high"] as const;
    for (let i = 1; i < weights.length; i++) {
      expect(aoLook(weights[i])!.strength).toBeGreaterThan(aoLook(weights[i - 1])!.strength);
      expect(aoLook(weights[i])!.samples).toBeGreaterThan(aoLook(weights[i - 1])!.samples);
      expect(bloomLook(weights[i])!.strength).toBeGreaterThan(bloomLook(weights[i - 1])!.strength);
      expect(shadowMapSize(weights[i])).toBe(shadowMapSize(weights[i - 1]) * 2);
      expect(skySheen(weights[i])).toBeGreaterThan(skySheen(weights[i - 1]));
      expect(grainAmount(weights[i], 0)).toBeGreaterThan(grainAmount(weights[i - 1], 0));
    }
    expect(shadowMapSize("low")).toBe(1024);
    expect(shadowMapSize("medium")).toBe(2048);
  });

  it("glows only above paper white", () => {
    expect(BLOOM_THRESHOLD).toBeCloseTo(1.05, 6);
  });

  it("grains the strategic sheet more than the table, and never by much", () => {
    for (const weight of ["low", "medium", "high"] as const) {
      expect(grainAmount(weight, 0)).toBeGreaterThan(grainAmount(weight, 1));
      expect(grainAmount(weight, 1)).toBeGreaterThan(0);
      expect(grainAmount(weight, 0)).toBeLessThan(0.08);
    }
  });

  it("draws a line, a wash, both, or nothing round a stack", () => {
    expect(outlineLook("units-only")).toEqual({ line: 1, wash: 0 });
    expect(outlineLook("watercolor-only")).toEqual({ line: 0, wash: 1 });
    expect(outlineLook("both")).toEqual({ line: 1, wash: 1 });
    expect(outlineLook("off")).toEqual({ line: 0, wash: 0 });
  });

  it("asks for the figures' own canvas only when something reads it", () => {
    expect(wantsFigureCards(DEFAULT_VISUALS)).toEqual({ shadows: true, outline: true });
    expect(wantsFigureCards({ ...DEFAULT_VISUALS, shadowQuality: "off" }).shadows).toBe(false);
    // No sun, no cast shadows.
    expect(wantsFigureCards({ ...DEFAULT_VISUALS, sunCycle: "off" }).shadows).toBe(false);
    expect(wantsFigureCards({ ...DEFAULT_VISUALS, outlineMode: "off" }).outline).toBe(false);
  });

  it("reads an unknown weight as the base's", () => {
    const parsed = parseVisuals({ aoWeight: "ultra", outlineMode: "glow", sunCycle: "midnight", shadowQuality: "high" });
    expect(parsed.aoWeight).toBe(DEFAULT_VISUALS.aoWeight);
    expect(parsed.outlineMode).toBe(DEFAULT_VISUALS.outlineMode);
    expect(parsed.sunCycle).toBe(DEFAULT_VISUALS.sunCycle);
    expect(parsed.shadowQuality).toBe("high");
  });

  it("leaves the highlight rule alone, so a territory is never marked by an idle pointer", () => {
    for (const mode of ["units-only", "watercolor-only", "both", "off"] as const) {
      expect(parseVisuals({ outlineMode: mode }).highlightMode).toBe("click-and-drag");
    }
  });
});

describe("the table", () => {
  const SWITCHES = [
    "enableShogunMountains",
    "enableScatteredRocks",
    "enablePbrSurface",
    "enableRivers",
    "enableRoads",
    "enableSunTransit",
    "enableShadows",
    "enableBasePlinths",
    "shadowOnBasesOnly",
  ] as const;
  const NUMBERS = [
    "mountainPeakHeight",
    "mountainRidgeSharpness",
    "mountainSnowLine",
    "mountainSnowBlend",
    "mountainSnowGlow",
    "pbrNormalStrength",
    "pbrRoughness",
    "pbrTilingScale",
    "terrainSaturation",
    "riverWidth",
    "riverDepthShade",
    "riverBankHighlight",
    "roadWidth",
    "roadOpacity",
    "roadWarmth",
    "sunCycleSpeed",
    "sunMinElevation",
    "sunMaxElevation",
    "sunWarmthIntensity",
    "ambientFillIntensity",
    "shadowOpacity",
    "shadowSoftness",
    "shadowNormalBias",
    "plinthRimWidth",
    "plinthRoughness",
    "plinthBrassIntensity",
  ] as const;

  it("gives every part a switch, and every number a range that holds its default", () => {
    for (const key of SWITCHES) {
      expect(typeof DEFAULT_VISUALS[key]).toBe("boolean");
    }
    for (const key of NUMBERS) {
      const [low, high] = VISUAL_RANGES[key];
      expect(low).toBeLessThan(high);
      expect(DEFAULT_VISUALS[key]).toBeGreaterThanOrEqual(low);
      expect(DEFAULT_VISUALS[key]).toBeLessThanOrEqual(high);
      // A number is a number: a pasted word falls back, and a wild one is held to the range.
      expect(parseVisuals({ [key]: "high" })[key]).toBe(DEFAULT_VISUALS[key]);
      expect(parseVisuals({ [key]: 1e9 })[key]).toBe(high);
      expect(parseVisuals({ [key]: -1e9 })[key]).toBe(low);
    }
    expect(VISUAL_KEYS).toEqual(Object.keys(DEFAULT_VISUALS));
  });

  it("ships the ranges, the grain, the moving sun, the shadows, and the bases on, and the rivers and roads off so the borders read", () => {
    expect(DEFAULT_VISUALS.enableShogunMountains).toBe(true);
    expect(DEFAULT_VISUALS.enableScatteredRocks).toBe(false);
    expect(DEFAULT_VISUALS.enablePbrSurface).toBe(true);
    expect(DEFAULT_VISUALS.enableRivers).toBe(false);
    expect(DEFAULT_VISUALS.enableRoads).toBe(false);
    expect(DEFAULT_VISUALS.enableSunTransit).toBe(true);
    expect(DEFAULT_VISUALS.enableShadows).toBe(true);
    expect(DEFAULT_VISUALS.enableBasePlinths).toBe(true);
    expect(DEFAULT_VISUALS.shadowOnBasesOnly).toBe(false);
    expect(DEFAULT_VISUALS.sunMinElevation).toBe(35);
    expect(DEFAULT_VISUALS.sunMaxElevation).toBe(65);
  });

  it("has no work for a part that is off", () => {
    expect(mountainLook({ ...DEFAULT_VISUALS, enableShogunMountains: false }, 1, 8)).toBeNull();
    expect(surfaceLook({ ...DEFAULT_VISUALS, enablePbrSurface: false })).toBeNull();
    expect(riverLook({ ...DEFAULT_VISUALS, enableRivers: false })).toBeNull();
    expect(roadLook({ ...DEFAULT_VISUALS, enableRoads: false }, 1)).toBeNull();
    expect(castShadowLook({ ...DEFAULT_VISUALS, enableShadows: false })).toBeNull();
    expect(castShadowLook({ ...DEFAULT_VISUALS, shadowQuality: "off" })).toBeNull();
    expect(plinthLook({ ...DEFAULT_VISUALS, enableBasePlinths: false })).toBeNull();
    expect(sunPace({ ...DEFAULT_VISUALS, enableSunTransit: false })).toBe(0);
    expect(wantsFigureCards({ ...DEFAULT_VISUALS, enableShadows: false }).shadows).toBe(false);
  });

  it("leaves the plain board as it was: the loose peaks, the shipped arc, a flat base, and none of the rest", () => {
    expect(mountainLook(PLAIN_VISUALS, 1, 8)).toBeNull();
    expect(PLAIN_VISUALS.enableScatteredRocks).toBe(true);
    expect(surfaceLook(PLAIN_VISUALS)).toBeNull();
    expect(riverLook(PLAIN_VISUALS)).toBeNull();
    expect(roadLook(PLAIN_VISUALS, 1)).toBeNull();
    expect(castShadowLook(PLAIN_VISUALS)).toBeNull();
    expect(plinthLook(PLAIN_VISUALS)).toBeNull();
    expect(sunArcOf(PLAIN_VISUALS)).toEqual({ minElevation: 30, maxElevation: 62, warmth: 1, fill: 1 });
    expect(sunPace(PLAIN_VISUALS)).toBe(1);
  });

  it("lets a summit stand as tall as the slider says at every zoom, with no cap", () => {
    for (const k of [1.5, 3, 6, 12, 24]) {
      for (const peak of [0.5, 6, 14]) {
        const look = mountainLook({ ...DEFAULT_VISUALS, mountainPeakHeight: peak }, 1, k)!;
        expect(look.height).toBeCloseTo(peak, 9);
      }
    }
    expect(DEFAULT_VISUALS.mountainPeakHeight).toBeGreaterThanOrEqual(4);
  });

  it("lowers the ranges to nothing as the board climbs to altitude", () => {
    let previous = mountainLook(DEFAULT_VISUALS, 1, 6)!.height;
    for (const relief of [0.8, 0.6, 0.4, 0.2, 0.05]) {
      const look = mountainLook(DEFAULT_VISUALS, relief, 6)!;
      expect(look.height).toBeLessThan(previous);
      expect(look.fade).toBeCloseTo(relief, 9);
      previous = look.height;
    }
    expect(mountainLook(DEFAULT_VISUALS, 0, 6)).toBeNull();
    expect(mountainLook({ ...DEFAULT_VISUALS, mountainPeakHeight: 0 }, 1, 6)).toBeNull();
  });

  it("carries the snow's line, blend, and glow straight through", () => {
    const look = mountainLook({ ...DEFAULT_VISUALS, mountainSnowLine: 0.7, mountainSnowBlend: 0.3, mountainSnowGlow: 0.9, mountainRidgeSharpness: 0.25 }, 1, 6)!;
    expect(look.snowLine).toBe(0.7);
    expect(look.snowBlend).toBe(0.3);
    expect(look.snowGlow).toBe(0.9);
    expect(look.sharpness).toBe(0.25);
    // The blend is never a hard line.
    expect(VISUAL_RANGES.mountainSnowBlend[0]).toBeGreaterThan(0);
  });

  it("gives the grain, the rivers, and the roads their numbers as they are set", () => {
    expect(surfaceLook({ ...DEFAULT_VISUALS, pbrNormalStrength: 1.2, pbrRoughness: 0.4, pbrTilingScale: 30, terrainSaturation: 0.7 })).toEqual({
      normal: 1.2,
      roughness: 0.4,
      tiling: 30,
      saturation: 0.7,
    });
    expect(riverLook({ ...DEFAULT_VISUALS, enableRivers: true, riverWidth: 1, riverDepthShade: 0.3, riverBankHighlight: 0.8 })).toEqual({ halfWidth: 0.5, depth: 0.3, bank: 0.8 });
    expect(roadLook({ ...DEFAULT_VISUALS, enableRoads: true, roadWidth: 0.4, roadOpacity: 0.6, roadWarmth: 0.2 }, 1)).toEqual({ halfWidth: 0.2, opacity: 0.6, warmth: 0.2 });
  });

  it("fades the roads out toward the fitted board, with no step", () => {
    const ROADS_ON = { ...DEFAULT_VISUALS, enableRoads: true };
    expect(roadLook(ROADS_ON, 0)).toBeNull();
    expect(roadLook({ ...ROADS_ON, roadOpacity: 0 }, 1)).toBeNull();
    let previous = 0;
    for (let i = 1; i <= 40; i++) {
      const opacity = roadLook(ROADS_ON, i / 40)?.opacity ?? 0;
      expect(opacity).toBeGreaterThanOrEqual(previous);
      expect(opacity - previous).toBeLessThan(0.2);
      previous = opacity;
    }
    expect(previous).toBeCloseTo(DEFAULT_VISUALS.roadOpacity, 9);
  });

  it("darkens a shadow by its opacity, measured against the shipped tint", () => {
    expect(castShadowLook({ ...DEFAULT_VISUALS, shadowOpacity: SHADOW_OPACITY_UNIT })!.depth).toBeCloseTo(1, 9);
    expect(castShadowLook({ ...DEFAULT_VISUALS, shadowOpacity: 0 })!.depth).toBe(0);
    expect(castShadowLook({ ...DEFAULT_VISUALS, shadowOpacity: 0.72 })!.depth).toBeCloseTo(2, 9);
    const look = castShadowLook({ ...DEFAULT_VISUALS, shadowSoftness: 2, shadowNormalBias: 0.3, shadowOnBasesOnly: true, shadowQuality: "high" })!;
    expect(look).toMatchObject({ size: 4096, softness: 2, normalBias: 0.3, basesOnly: true });
    expect(castShadowLook(DEFAULT_VISUALS)!.size).toBe(2048);
    expect(castShadowLook(DEFAULT_VISUALS)!.basesOnly).toBe(false);
  });

  it("never lets the noon sun stand lower than the dawn sun", () => {
    expect(sunArcOf(DEFAULT_VISUALS)).toEqual({ minElevation: 35, maxElevation: 65, warmth: 1.2, fill: 1 });
    const arc = sunArcOf({ ...DEFAULT_VISUALS, sunMinElevation: 55, sunMaxElevation: 40 });
    expect(arc.maxElevation).toBe(55);
    expect(arc.minElevation).toBe(55);
    expect(sunPace({ ...DEFAULT_VISUALS, sunCycleSpeed: 3 })).toBe(3);
  });

  it("puts a tight bright highlight on a polished rim and a wide faint one on a matt rim", () => {
    const polished = plinthLook({ ...DEFAULT_VISUALS, plinthRoughness: 0 })!;
    const satin = plinthLook({ ...DEFAULT_VISUALS, plinthRoughness: 0.5 })!;
    const matt = plinthLook({ ...DEFAULT_VISUALS, plinthRoughness: 1 })!;
    expect(polished.sheen).toBeGreaterThan(satin.sheen);
    expect(satin.sheen).toBeGreaterThan(matt.sheen);
    expect(matt.sheen).toBe(0);
    expect(polished.sheenArc).toBeLessThan(satin.sheenArc);
    expect(satin.sheenArc).toBeLessThan(matt.sheenArc);
    expect(plinthLook({ ...DEFAULT_VISUALS, plinthRimWidth: 0.3, plinthBrassIntensity: 0.4 })).toMatchObject({ rim: 0.3, brass: 0.4 });
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

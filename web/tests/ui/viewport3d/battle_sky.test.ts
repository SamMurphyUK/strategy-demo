import { describe, expect, it } from "vitest";
import { hourAt, skyAt, skyModeFor, stageWeights, starFade, sunHeightAt } from "../../../src/ui/viewport3d/battle/battleSky";
import { beachHeight, seaBandAt, seaLit, swashReach } from "../../../src/ui/viewport3d/battle/battleSea";
import { convergenceY, hazeAt, recession, rankColumnX, reliefHeight, trenchHalfWidth, trenchLineX, zoneAt } from "../../../src/ui/viewport3d/battle/battleZones";
import { EUROPEAN_LOOK, battleLook, battleLookJson, lookLeaves, resetBattleLook, setBattleLook } from "../../../src/ui/viewport3d/skins/battleVisualConfig";
import { BATTLE_SKINS, hexToRgb } from "../../../src/ui/viewport3d/skins/battleSkin";
import { BOARD_SKINS } from "../../../src/ui/viewport3d/skins/boardSkin";

const look = EUROPEAN_LOOK;
const warmth = (c: readonly number[]) => c[0] - c[2];

describe("sky by hour", () => {
  it("is rich orange and purple at dawn and dusk", () => {
    for (const hour of [6, 18]) {
      const s = skyAt(look, hour);
      expect(warmth(s.low)).toBeGreaterThan(0.25);
      expect(s.mid[0] + s.mid[2]).toBeGreaterThan(s.mid[1] * 2.2);
    }
  });

  it("is soft orange at the horizon rising to blue by day, never fully blue", () => {
    const s = skyAt(look, 12);
    expect(s.low[0]).toBeGreaterThan(s.low[2]);
    expect(s.high[2]).toBeGreaterThan(s.high[0]);
    expect(s.low[2]).toBeLessThan(s.high[2]);
    expect(s.stars).toBe(0);
  });

  it("is cool blue fading to purplish black at night, with the stars full", () => {
    const s = skyAt(look, 0);
    expect(s.high[2]).toBeGreaterThan(s.high[0]);
    expect(Math.max(...s.high)).toBeLessThan(0.2);
    expect(s.stars).toBe(1);
    expect(s.moonStrength).toBeGreaterThan(0.9);
    expect(s.sunStrength).toBe(0);
  });

  it("washes between stages with no snap", () => {
    let prev = skyAt(look, 0);
    for (let h = 0.02; h <= 24; h += 0.02) {
      const s = skyAt(look, h);
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(s.low[i] - prev.low[i])).toBeLessThan(0.05);
        expect(Math.abs(s.high[i] - prev.high[i])).toBeLessThan(0.05);
        expect(Math.abs(s.light[i] - prev.light[i])).toBeLessThan(0.05);
      }
      const w = stageWeights(h);
      expect(w.night + w.dawn + w.day + w.dusk).toBeCloseTo(1, 6);
      prev = s;
    }
  });

  it("fades the stars out as dawn rises and in as dusk falls", () => {
    expect(starFade(0)).toBe(1);
    expect(starFade(12)).toBe(0);
    expect(starFade(5.2)).toBeGreaterThan(starFade(6.2));
    expect(starFade(6.2)).toBeGreaterThan(starFade(7.5));
    expect(starFade(17.2)).toBeLessThan(starFade(18));
    expect(starFade(18)).toBeLessThan(starFade(18.6));
  });

  it("keeps a shadow at every hour, never a shadowless sunset, and a rising and setting sun", () => {
    for (let h = 0; h < 24; h += 0.5) {
      const s = skyAt(look, h);
      expect(s.shadow).toBeGreaterThan(0.1);
      expect(s.lightDir[2]).toBeGreaterThan(0.2);
    }
    expect(sunHeightAt(6)).toBeCloseTo(0, 6);
    expect(sunHeightAt(12)).toBeCloseTo(1, 6);
    expect(skyAt(look, 7).sunDir[0]).toBeGreaterThan(0);
    expect(skyAt(look, 17).sunDir[0]).toBeLessThan(0);
  });

  it("gives a cool dim light at night and a warm one low in the evening", () => {
    const night = skyAt(look, 0);
    const noon = skyAt(look, 12);
    expect(night.light[2]).toBeGreaterThan(night.light[0]);
    expect(night.light[0]).toBeLessThan(noon.light[0] * 0.6);
    expect(warmth(skyAt(look, 17.5).lightColor)).toBeGreaterThan(warmth(noon.lightColor));
  });

  it("holds the clock at midnight for night mode and runs it when auto is on", () => {
    expect(skyModeFor("normandy", "night")).toBe("night");
    expect(skyModeFor("normandy", null)).toBe("day");
    expect(hourAt(look, 600, "night")).toBe(0);
    expect(hourAt(look, 600, "day")).toBe(look.time.hour);
    expect(hourAt({ ...look, time: { ...look.time, auto: true } }, 60, "day")).toBeCloseTo(look.time.hour + look.time.speed, 6);
  });
});

describe("zones and the two trench lines", () => {
  const g = look.pos.trench;

  it("converges toward the horizon, and the two lines mirror each other", () => {
    expect(trenchHalfWidth(g.yFront, g)).toBeCloseTo(g.halfFront, 6);
    expect(trenchHalfWidth(g.yBack, g)).toBeCloseTo(g.halfBack, 6);
    expect(trenchHalfWidth(40, g)).toBeLessThan(trenchHalfWidth(-8, g));
    expect(trenchLineX("attacker", 0, g)).toBe(-trenchLineX("defender", 0, g));
    expect(convergenceY(g)).toBeGreaterThan(g.yBack);
    expect(convergenceY({ ...g, halfBack: g.halfFront })).toBe(Infinity);
  });

  it("names the three zones: the attacker's left of its line, the defender's right of its, no man's land between", () => {
    expect(zoneAt(0, 0, g)).toBe("noMansLandZone");
    expect(zoneAt(-trenchHalfWidth(0, g) - 0.1, 0, g)).toBe("attackerFrontZone");
    expect(zoneAt(trenchHalfWidth(0, g) + 0.1, 0, g)).toBe("defenderFrontZone");
  });

  it("steps the rank columns outward from the line, I nearest, with nobody in no man's land", () => {
    for (const side of ["attacker", "defender"] as const) {
      let last = 0;
      for (const rank of [1, 2, 3, 4]) {
        const x = rankColumnX(side, rank, 0, g, look.pos.columnGap, look.pos.columnOffset);
        expect(Math.abs(x)).toBeGreaterThan(last);
        expect(zoneAt(x, 0, g)).toBe(side === "attacker" ? "attackerFrontZone" : "defenderFrontZone");
        last = Math.abs(x);
      }
    }
  });

  it("hazes and recedes from nothing at the front to full at the far end", () => {
    expect(recession(g.yFront, g)).toBe(0);
    expect(recession(g.yBack, g)).toBe(1);
    expect(hazeAt(g.yFront, g, 0.5)).toBe(0);
    expect(hazeAt(g.yBack, g, 0.5)).toBeCloseTo(0.5, 6);
  });
});

describe("trench relief", () => {
  const g = look.pos.trench;
  const { lipHeight, troughDepth } = look.pos.relief;

  it("raises each trench lip above the field and sinks no man's land into a trough", () => {
    const y = 0;
    const half = trenchHalfWidth(y, g);
    expect(reliefHeight(half, y, g, lipHeight, troughDepth)).toBeGreaterThan(lipHeight * 0.5);
    expect(reliefHeight(0, y, g, lipHeight, troughDepth)).toBeCloseTo(-troughDepth, 2);
    expect(reliefHeight(half + 3, y, g, lipHeight, troughDepth)).toBeCloseTo(0, 2);
    // Each side has the same lip, and the trough lies between them.
    expect(reliefHeight(-half, y, g, lipHeight, troughDepth)).toBeCloseTo(reliefHeight(half, y, g, lipHeight, troughDepth), 6);
    expect(reliefHeight(0, y, g, lipHeight, troughDepth)).toBeLessThan(reliefHeight(half, y, g, lipHeight, troughDepth));
  });

  it("follows the lines as they converge, and is flat at the front lip where the trench starts", () => {
    const far = 80;
    const halfFar = trenchHalfWidth(far, g);
    expect(reliefHeight(halfFar, far, g, lipHeight, troughDepth)).toBeGreaterThan(lipHeight * 0.5);
    expect(reliefHeight(0, g.yFront, g, lipHeight, troughDepth)).toBeCloseTo(0, 6);
    expect(reliefHeight(0, 0, g, 0, 0)).toBe(0);
  });
});

describe("sea and beach", () => {
  const sea = look.sea;

  it("blends three bands: lighter at the coast, mid in the middle, darker at the bottom", () => {
    const lum = (c: readonly number[]) => c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
    const a = seaBandAt(0, sea);
    const b = seaBandAt(0.5, sea);
    const c = seaBandAt(1, sea);
    expect(lum(a)).toBeGreaterThan(lum(b));
    expect(lum(b)).toBeGreaterThan(lum(c));
    expect(a).toEqual(hexToRgb(sea.coast));
    expect(c).toEqual(hexToRgb(sea.deep));
    expect(a[1]).toBeGreaterThan(a[0]);
  });

  it("takes the light's colour, cool at night", () => {
    const night = seaLit(seaBandAt(0.5, sea), skyAt(look, 0).light, sea.lightShare);
    const day = seaLit(seaBandAt(0.5, sea), skyAt(look, 12).light, sea.lightShare);
    expect(night[2] / night[0]).toBeGreaterThan(day[2] / day[0]);
    expect(seaLit([0.5, 0.5, 0.5], [0.2, 0.2, 0.2], 0)).toEqual([0.5, 0.5, 0.5]);
  });

  it("swashes in and out within the beach, and the beach is a gentle slope", () => {
    let low = 1;
    let high = 0;
    for (let t = 0; t < 30; t += 0.25) {
      const r = swashReach(3, t, sea);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
      low = Math.min(low, r);
      high = Math.max(high, r);
    }
    expect(high - low).toBeGreaterThan(0.2);
    expect(swashReach(3, 5, { ...sea, swash: 0 })).toBe(0);
    expect(beachHeight(0)).toBe(0);
    expect(beachHeight(1)).toBeLessThan(0.3);
    expect(beachHeight(0.6)).toBeGreaterThan(beachHeight(0.3));
  });
});

describe("the look config", () => {
  it("is registered in the battle skin and in no board skin, and every leaf has a path", () => {
    expect(BATTLE_SKINS.european.owns.length).toBeGreaterThan(3);
    for (const board of Object.values(BOARD_SKINS)) {
      expect(JSON.stringify(board)).not.toContain("battleLook");
    }
    const leaves = lookLeaves();
    expect(leaves.some((l) => l.path === "sea.swash")).toBe(true);
    expect(leaves.some((l) => l.path === "pos.trench.halfFront")).toBe(true);
    expect(leaves.some((l) => l.path === "sky.dawn.low")).toBe(true);
    for (const path of ["pos.camera.fov", "pos.camera.height", "pos.camera.aim", "pos.relief.lipHeight", "pos.relief.troughDepth", "ground.troughTint"]) {
      expect(leaves.some((l) => l.path === path)).toBe(true);
    }
  });

  it("sets a field by path, ignores a wrong kind, resets, and copies as JSON in its own shape", () => {
    setBattleLook("sea.swash", 0.9);
    expect(battleLook.sea.swash).toBe(0.9);
    setBattleLook("sea.swash", "x");
    expect(battleLook.sea.swash).toBe(0.9);
    setBattleLook("sun.halo.1", "#112233");
    expect(battleLook.sun.halo[1]).toBe("#112233");
    expect(JSON.parse(battleLookJson()).sea.swash).toBe(0.9);
    resetBattleLook();
    expect(battleLook.sea.swash).toBe(EUROPEAN_LOOK.sea.swash);
    expect(Object.keys(JSON.parse(battleLookJson()))).toEqual(Object.keys(EUROPEAN_LOOK));
  });
});

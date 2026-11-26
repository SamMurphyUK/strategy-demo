import { describe, expect, it } from "vitest";
import { BATTLE_SKINS } from "../../../src/ui/viewport3d/skins/battleSkin";
import { SCATTER_VARIANTS, landmarkFor, planScatter, seeded, terrainFor, zoneBounds } from "../../../src/ui/viewport3d/battle/battleScatter";

const skin = BATTLE_SKINS.european;

describe("terrain by territory", () => {
  it("is urban where a city landmark stands", () => {
    for (const [name, landmark] of [
      ["Germany", "berlin"],
      ["France", "paris"],
      ["United Kingdom", "london"],
      ["Italy", "rome"],
      ["Moscow", "moscow"],
      ["Petersburgh", "leningrad"],
      ["Volgads", "stalingrad"],
    ]) {
      expect(landmarkFor({ regionId: name })).toBe(landmark);
      expect(terrainFor({ regionId: name })).toBe("urban");
    }
    expect(landmarkFor({ regionName: "STALINGRAD" })).toBe("stalingrad");
  });

  it("is bocage in Normandy and Western Europe, mountain in the Alps, plains in open steppe", () => {
    expect(terrainFor({ regionName: "NORMANDY", theater: "normandy" })).toBe("bocage");
    expect(terrainFor({ regionName: "Western Europe" })).toBe("bocage");
    expect(terrainFor({ regionName: "Switzerland" })).toBe("mountain");
    expect(terrainFor({ regionName: "Ukraine", scene: { kind: "land", biome: "steppe", culture: "russian", settlement: "village" } })).toBe("plains");
  });

  it("is urban for a city or capital scene even without a landmark", () => {
    expect(terrainFor({ regionName: "Somewhere", scene: { kind: "land", settlement: "city" } })).toBe("urban");
  });

  it("knows no landmark for an unlisted territory", () => {
    expect(landmarkFor({ regionName: "Ukraine" })).toBeNull();
  });
});

describe("scatter placement", () => {
  const count = (items: ReturnType<typeof planScatter>, set: string) => items.filter((p) => p.set === set).length;

  it("is repeatable for a seed and differs between seeds", () => {
    const a = planScatter(skin, "bocage", 1, 7);
    expect(planScatter(skin, "bocage", 1, 7)).toEqual(a);
    expect(planScatter(skin, "bocage", 1, 8)).not.toEqual(a);
  });

  it("raises hedgerows and trees in bocage, and masonry only in cities", () => {
    expect(count(planScatter(skin, "bocage", 1, 3), "hedgerow_segments")).toBeGreaterThan(count(planScatter(skin, "plains", 1, 3), "hedgerow_segments"));
    for (const terrain of ["plains", "bocage", "mountain"] as const) {
      expect(count(planScatter(skin, terrain, 2, 5), "ruined_masonry")).toBe(0);
    }
    expect(count(planScatter(skin, "urban", 1, 3), "ruined_masonry")).toBeGreaterThan(4);
  });

  it("stands the frontline cover sets in the cover zone and the dressing behind the lines", () => {
    const items = planScatter(skin, "urban", 1, 11);
    const cover = new Set(["sandbag_bunker", "trench_parapet", "wire_obstacles", "anti_tank_obstacles"]);
    for (const p of items) {
      if (p.zone === "cover") {
        expect(cover.has(p.set)).toBe(true);
        expect(p.d).toBeLessThan(0.8);
      }
      if (p.zone === "midground") {
        expect(p.d).toBeGreaterThan(0.75);
      }
    }
    for (const set of cover) {
      expect(count(items, set)).toBeGreaterThan(0);
    }
  });

  it("follows the density slider: none at 0, more at 2 than at 1", () => {
    expect(planScatter(skin, "bocage", 0, 2)).toHaveLength(0);
    expect(planScatter(skin, "bocage", 2, 2).length).toBeGreaterThan(planScatter(skin, "bocage", 1, 2).length);
  });

  it("keeps clear of keepouts, stays on the stage, and picks variants that exist", () => {
    const items = planScatter(skin, "urban", 1.5, 4, [{ x: 0, d: 0.85, r: 2.5 }]);
    for (const p of items) {
      expect(Math.hypot(p.x, (p.d - 0.85) * 24)).toBeGreaterThanOrEqual(2.5);
      expect(Math.abs(p.x)).toBeLessThan(9);
      expect(p.d).toBeGreaterThan(0);
      expect(p.d).toBeLessThan(1);
      expect(p.variant).toBeGreaterThanOrEqual(1);
      expect(p.variant).toBeLessThanOrEqual(SCATTER_VARIANTS[p.set]);
    }
  });

  it("draws far pieces before near ones", () => {
    const items = planScatter(skin, "bocage", 1, 9);
    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1].d).toBeGreaterThanOrEqual(items[i].d);
    }
  });

  it("has zone rectangles on the stage and a generator in range", () => {
    for (const z of ["cover", "midground", "verge"] as const) {
      const b = zoneBounds(z, "field_props");
      expect(b.to).toBeGreaterThan(b.from);
    }
    const r = seeded(1);
    for (let i = 0; i < 50; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  bucketOf,
  EMPTY_TRANSFORMS,
  NO_TRANSFORM,
  parseTransforms,
  presetKey,
  resolveTransform,
  serializeTransforms,
  TRANSFORM_RANGES,
  unitId,
  withPreset,
} from "../../../src/ui/map/unitTransforms";

describe("unit transform presets", () => {
  it("puts every stack size in the one shared bucket", () => {
    expect([0, 1, 2, 3, 9].map(bucketOf)).toEqual([1, 1, 1, 1, 1]);
  });

  it("covers a stack with the most specific preset: the unit type, then the faction, then all units", () => {
    let set = withPreset(EMPTY_TRANSFORMS, presetKey("all", "", 1), { ...NO_TRANSFORM, dx: 1 });
    expect(resolveTransform(set, "GER", "tank", 1).dx).toBe(1);
    set = withPreset(set, presetKey("faction", "GER", 1), { ...NO_TRANSFORM, dx: 2 });
    expect(resolveTransform(set, "GER", "tank", 1).dx).toBe(2);
    expect(resolveTransform(set, "US", "tank", 1).dx).toBe(1);
    set = withPreset(set, presetKey("archetype", "tank", 1), { ...NO_TRANSFORM, dx: 3 });
    expect(resolveTransform(set, "GER", "tank", 1).dx).toBe(3);
    expect(resolveTransform(set, "GER", "infantry", 1).dx).toBe(2);
  });

  it("shares one preset across every stack size", () => {
    const set = withPreset(EMPTY_TRANSFORMS, presetKey("all", "", 1), { ...NO_TRANSFORM, dy: 4 });
    for (const count of [1, 2, 3, 5]) {
      expect(resolveTransform(set, "GER", "tank", count).dy).toBe(4);
    }
  });

  it("folds presets saved per size into the shared one, the single unit's first", () => {
    const set = parseTransforms({ presets: { "all||3": { dx: 9 }, "all||1": { dx: 2 }, "faction|GER|2": { dy: 5 } } });
    expect(set.presets["all||1"].dx).toBe(2);
    expect(set.presets["faction|GER|1"].dy).toBe(5);
    expect(Object.keys(set.presets).every((k) => k.endsWith("|1"))).toBe(true);
  });

  it("drops a preset that moves nothing, and holds the others inside their ranges", () => {
    let set = withPreset(EMPTY_TRANSFORMS, "all||1", { ...NO_TRANSFORM, rot: 500, dz: -999 });
    expect(set.presets["all||1"].rot).toBe(TRANSFORM_RANGES.rot[1]);
    expect(set.presets["all||1"].dz).toBe(TRANSFORM_RANGES.dz[0]);
    set = withPreset(set, "all||1", NO_TRANSFORM);
    expect(Object.keys(set.presets)).toHaveLength(0);
  });

  it("round-trips, and reads a damaged file as far as it can without throwing", () => {
    const set = withPreset(withPreset(EMPTY_TRANSFORMS, "faction|GER|1", { ...NO_TRANSFORM, tilt: 10 }), "archetype|tank|1", { ...NO_TRANSFORM, dx: -2 });
    expect(parseTransforms(JSON.parse(JSON.stringify(serializeTransforms(set))))).toEqual(serializeTransforms(set));
    expect(parseTransforms(null)).toEqual(EMPTY_TRANSFORMS);
    const damaged = parseTransforms({ presets: { "bad key": { dx: 1 }, "all||9": { dx: 1 }, "all||2": { dx: "x", dy: 3 } } });
    expect(Object.keys(damaged.presets)).toEqual(["all||1"]);
    expect(damaged.presets["all||1"]).toMatchObject({ dx: 0, dy: 3 });
  });
});

describe("per faction, per unit", () => {
  it("keeps a preset for one faction's one unit type, ahead of the type's and the faction's", () => {
    let set = withPreset(EMPTY_TRANSFORMS, presetKey("archetype", "tank", 1), { ...NO_TRANSFORM, dx: 1 });
    set = withPreset(set, presetKey("unit", unitId("GER", "tank"), 1), { ...NO_TRANSFORM, dx: 7 });
    expect(resolveTransform(set, "GER", "tank", 3).dx).toBe(7);
    expect(resolveTransform(set, "US", "tank", 3).dx).toBe(1);
    expect(parseTransforms(JSON.parse(JSON.stringify(set))).presets["unit|GER:tank|1"].dx).toBe(7);
  });
});

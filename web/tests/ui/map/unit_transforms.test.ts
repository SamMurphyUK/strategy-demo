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
  withPreset,
} from "../../../src/ui/map/unitTransforms";

describe("unit transform presets", () => {
  it("sorts a stack into one, two, or three and more", () => {
    expect([0, 1, 2, 3, 9].map(bucketOf)).toEqual([1, 1, 2, 3, 3]);
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

  it("keeps a separate preset for each stack size", () => {
    const set = withPreset(EMPTY_TRANSFORMS, presetKey("all", "", 2), { ...NO_TRANSFORM, dy: 4 });
    expect(resolveTransform(set, "GER", "tank", 2).dy).toBe(4);
    expect(resolveTransform(set, "GER", "tank", 1)).toEqual(NO_TRANSFORM);
    expect(resolveTransform(set, "GER", "tank", 5)).toEqual(NO_TRANSFORM);
  });

  it("drops a preset that moves nothing, and holds the others inside their ranges", () => {
    let set = withPreset(EMPTY_TRANSFORMS, "all||1", { ...NO_TRANSFORM, rot: 500, dz: -999 });
    expect(set.presets["all||1"].rot).toBe(TRANSFORM_RANGES.rot[1]);
    expect(set.presets["all||1"].dz).toBe(TRANSFORM_RANGES.dz[0]);
    set = withPreset(set, "all||1", NO_TRANSFORM);
    expect(Object.keys(set.presets)).toHaveLength(0);
  });

  it("round-trips, and reads a damaged file as far as it can without throwing", () => {
    const set = withPreset(withPreset(EMPTY_TRANSFORMS, "faction|GER|3", { ...NO_TRANSFORM, tilt: 10 }), "archetype|tank|1", { ...NO_TRANSFORM, dx: -2 });
    expect(parseTransforms(JSON.parse(JSON.stringify(serializeTransforms(set))))).toEqual(serializeTransforms(set));
    expect(parseTransforms(null)).toEqual(EMPTY_TRANSFORMS);
    const damaged = parseTransforms({ presets: { "bad key": { dx: 1 }, "all||9": { dx: 1 }, "all||2": { dx: "x", dy: 3 } } });
    expect(Object.keys(damaged.presets)).toEqual(["all||2"]);
    expect(damaged.presets["all||2"]).toMatchObject({ dx: 0, dy: 3 });
  });
});

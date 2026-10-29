import { describe, expect, it } from "vitest";
import { loadJson } from "../../../src/engine/content/res";
import { mapIntegrityProblems } from "./map_invariants";
import {
  baseMapRect,
  buildMapGeometry,
  clampPositionsToBounds,
  inferRegionType,
  layoutPositions,
  layoutRegionStacks,
  ownerFill,
  pointInPolygon,
  regionFill,
  type RegionShape,
  stackKey,
  toCss,
} from "../../../src/ui/map/geometry";

describe("layoutPositions", () => {
  it("puts 1-3 icons in one centred row", () => {
    expect(layoutPositions(1)).toEqual([{ x: 0, y: 0 }]);
    expect(layoutPositions(3)).toEqual([
      { x: -36, y: 0 },
      { x: 0, y: 0 },
      { x: 36, y: 0 },
    ]);
  });

  it("uses 3x2 for 4-6 and 3x3 beyond", () => {
    const four = layoutPositions(4);
    expect(four).toHaveLength(4);
    expect(four[0]).toEqual({ x: -36, y: -18 });
    expect(four[3]).toEqual({ x: -36, y: 18 });
    const nine = layoutPositions(9);
    expect(nine[0]).toEqual({ x: -36, y: -36 });
    expect(nine[8]).toEqual({ x: 36, y: 36 });
    expect(layoutPositions(12)).toHaveLength(9);
  });

  it("returns nothing for zero", () => {
    expect(layoutPositions(0)).toEqual([]);
  });
});

describe("clampPositionsToBounds", () => {
  it("keeps offsets inside the shrunken bounds", () => {
    const bounds = { x: 0, y: 0, w: 100, h: 100 };
    const out = clampPositionsToBounds([{ x: -80, y: 0 }, { x: 80, y: 0 }], { x: 50, y: 50 }, bounds);
    expect(out).toEqual([
      { x: -30, y: 0 },
      { x: 30, y: 0 },
    ]);
  });

  it("pins to the far edge when the region is narrower than twice the margin", () => {
    const out = clampPositionsToBounds([{ x: 0, y: 0 }], { x: 5, y: 5 }, { x: 0, y: 0, w: 10, h: 10 });
    expect(out).toEqual([{ x: -15, y: -15 }]);
  });

  it("leaves offsets alone for empty bounds", () => {
    const pos = [{ x: 7, y: 9 }];
    expect(clampPositionsToBounds(pos, { x: 0, y: 0 }, { x: 0, y: 0, w: 0, h: 0 })).toBe(pos);
  });
});

describe("layoutRegionStacks", () => {
  const region: RegionShape = {
    id: "r",
    type: "land",
    ipc: 1,
    hasFactory: false,
    points: [],
    bounds: { x: -500, y: -500, w: 1000, h: 1000 },
    centroid: { x: 0, y: 0 },
    anchor: { x: 0, y: 0 },
  };

  it("sorts slots by key and folds duplicate keys", () => {
    const placed = layoutRegionStacks(region, [
      { unit_type_id: "tank", faction_id: "allies", count: 1 },
      { unit_type_id: "infantry", faction_id: "allies", count: 2 },
      { unit_type_id: "tank", faction_id: "allies", count: 5 },
    ]);
    expect(placed.map((p) => p.key)).toEqual(["infantry|allies", "tank|allies"]);
    expect(placed[1].entry.count).toBe(1);
    expect(placed[0].position).toEqual({ x: -18, y: 0 });
  });

  it("keys instances separately", () => {
    expect(stackKey({ unit_type_id: "transport", faction_id: "axis", count: 1, instance_id: "t1" })).toBe(
      "transport|axis|t1",
    );
  });
});

describe("region type", () => {
  it("prefers the explicit type", () => {
    expect(inferRegionType("Sea Zone 1", { type: "land" }, 0)).toBe("land");
  });

  it("treats sea names and empty, factoryless regions as sea", () => {
    expect(inferRegionType("North Sea Zone", {}, 3)).toBe("sea");
    expect(inferRegionType("Nowhere", {}, 0)).toBe("sea");
    expect(inferRegionType("Nowhere", { factory: true }, 0)).toBe("land");
    expect(inferRegionType("Germany", {}, 5)).toBe("land");
  });
});

describe("fills", () => {
  it("matches _owner_color", () => {
    expect(ownerFill("allies")).toEqual({ r: 0.5, g: 0.85, b: 0.5, a: 0.5 });
    expect(ownerFill("Axis")).toEqual({ r: 0.6, g: 0.6, b: 0.6, a: 0.5 });
    expect(ownerFill("")).toEqual({ r: 0.5, g: 0.5, b: 0.5, a: 0.35 });
  });

  it("highlights move targets red and dims the rest", () => {
    const mode = { kind: "move" as const, from: "a", legal: ["b"], hover: "" };
    expect(regionFill("b", "axis", mode)).toEqual({ r: 0.95, g: 0.15, b: 0.12, a: 0.52 });
    expect(regionFill("b", "axis", { ...mode, hover: "b" }).a).toBe(0.68);
    const dim = regionFill("c", "axis", mode);
    expect(dim.a).toBe(0.18);
    expect(dim.r).toBeCloseTo(0.33);
    expect(regionFill("a", "axis", mode).r).toBeCloseTo(0.648);
  });

  it("keeps owner colour on mobilize targets", () => {
    const mode = { kind: "mobilize" as const, legal: ["b"], hover: "b" };
    expect(regionFill("b", "allies", mode)).toEqual({ r: 0.5, g: 0.85, b: 0.5, a: 0.62 });
  });

  it("formats CSS rgba", () => {
    expect(toCss({ r: 1, g: 0, b: 0.5, a: 0.35 })).toBe("rgba(255, 0, 128, 0.35)");
  });
});

describe("demomap01", () => {
  const map = buildMapGeometry(loadJson("res://demomap01.json"));

  it("is a sound map: unique ids, real outlines, anchors and symmetric neighbors", () => {
    expect(mapIntegrityProblems(loadJson("res://demomap01.json"))).toEqual([]);
  });

  it("loads every region of the world scenario", () => {
    expect(map.baseMap).toBe("");
    const ids = map.regions.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(map.regions.some((r) => r.type === "land")).toBe(true);
    expect(map.regions.some((r) => r.type === "sea")).toBe(true);
    for (const region of map.regions) {
      expect(region.points.length).toBeGreaterThanOrEqual(3);
      expect(region.bounds.w).toBeGreaterThan(0);
    }
  });

  it("hit-tests every region somewhere inside its bounds", () => {
    // Land and sea polygons overlap on purpose, and some are concave, so sample each polygon on its own.
    for (const region of map.regions) {
      let found = false;
      for (let i = 1; i < 20 && !found; i++) {
        for (let j = 1; j < 20 && !found; j++) {
          const p = { x: region.bounds.x + (region.bounds.w * i) / 20, y: region.bounds.y + (region.bounds.h * j) / 20 };
          found = pointInPolygon(p, region.points);
        }
      }
      expect(found, region.id).toBe(true);
    }
  });

  it("lies inside the land SVG viewBox", () => {
    expect(map.bounds.x).toBeGreaterThanOrEqual(0);
    expect(map.bounds.y).toBeGreaterThanOrEqual(0);
    expect(map.bounds.x + map.bounds.w).toBeLessThanOrEqual(800);
    expect(map.bounds.y + map.bounds.h).toBeLessThanOrEqual(504);
  });

  it("centres a sprite on the map origin", () => {
    expect(baseMapRect(3000, 2139)).toEqual({ x: -1500, y: -1068.5, w: 3000, h: 2139 });
  });
});

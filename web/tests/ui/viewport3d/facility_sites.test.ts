import { describe, expect, it } from "vitest";
import { FACILITY_SCALE, facilityGeometry } from "../../../src/ui/viewport3d/facilityModels";
import { airbaseSite, harborSite, shoreFrom } from "../../../src/ui/viewport3d/facilitySites";
import { facilityId, facilityKindOf, landmarkKey, placeFacilities } from "../../../src/ui/viewport3d/placements";

// Land is everything west of x = 50. The coast runs north to south at x = 50.
const isLand = (p: { x: number; y: number }) => p.x < 50;
const all = () => true;

describe("harbors and airbases", () => {
  it("finds the nearest coast and stands the harbor's back at the cliff, piers seaward", () => {
    const shore = shoreFrom({ x: 44, y: 30 }, isLand, all)!;
    expect(shore.shore.x).toBeGreaterThan(49);
    expect(shore.dir.x).toBeGreaterThan(0.9);
    const site = harborSite("Japan", { x: 44, y: 30 }, isLand, all)!;
    expect(site.x).toBeGreaterThan(50);
    expect(site.turn).toBeCloseTo(0, 1);
    expect(harborSite("Inland", { x: 300, y: 30 }, isLand, all)).toBeNull();
  });
  it("keeps a harbor to its own territory's coast", () => {
    expect(harborSite("Other", { x: 44, y: 30 }, isLand, () => false)).toBeNull();
  });
  it("places them as landmarks that the editor can move, the harbor lifted down to the water", () => {
    const sites = [harborSite("Japan", { x: 44, y: 30 }, isLand, all)!, airbaseSite("Germany", { x: 10, y: 10 })];
    const placed = placeFacilities(sites, { [landmarkKey("harbor:Japan")]: { dx: 2, dy: 0, dz: 0, mult: 1, dturn: 0, locked: false } }, 6.9);
    expect(placed.map((item) => item.id)).toEqual(["harbor:Japan", "airbase:Germany"]);
    expect(placed[0].instance.lift).toBeCloseTo(-6.9, 6);
    expect(placed[0].instance.x).toBeCloseTo(sites[0].x + 2, 6);
    expect(placed[1].instance.lift).toBe(0);
    expect(facilityKindOf(facilityId("harbor", "X"))).toBe("harbor");
    expect(facilityKindOf("paris")).toBeNull();
    expect(placed[0].instance.scale).toBe(FACILITY_SCALE.harbor);
  });
  it("builds both models, with the reveal height", () => {
    for (const kind of ["harbor", "airbase"] as const) {
      const model = facilityGeometry(kind);
      expect(model.getAttribute("position").count).toBeGreaterThan(100);
      expect(model.getAttribute("aNormY")).toBeDefined();
      expect(model.getAttribute("aPart")).toBeDefined();
      model.dispose();
    }
  });
});

import { describe, expect, it } from "vitest";
import type { Vec2 } from "../../../src/ui/map/geometry";
import type { Biome, MountainRange } from "../../../src/ui/viewport3d/geography";
import { lonLatToMap } from "../../../src/ui/viewport3d/geography";
import {
  cellHash,
  COAST_MARGIN,
  PEAK_CLEARANCE,
  PEAK_RISE,
  peakClearance,
  planProps,
  type PlanInput,
  PROP_KINDS,
  type PropInstance,
  townSites,
  TREE_CLEARANCE,
} from "../../../src/ui/viewport3d/propPlan";

const BOUNDS = { x: 0, y: 0, w: 800, h: 504 };
/** A square island in the middle of the sheet. */
const ISLAND = { x0: 300, y0: 150, x1: 420, y1: 270 };
const onIsland = (p: Vec2) => p.x >= ISLAND.x0 && p.x <= ISLAND.x1 && p.y >= ISLAND.y0 && p.y <= ISLAND.y1;

function input(biome: Biome, extra: Partial<PlanInput> = {}): PlanInput {
  return { bounds: BOUNDS, isLand: onIsland, keepClear: [], towns: [], ranges: [], biomeAt: () => biome, ...extra };
}

function all(plan: ReturnType<typeof planProps>): PropInstance[] {
  return PROP_KINDS.flatMap((kind) => plan.props[kind]);
}

describe("prop plan", () => {
  it("hashes a cell to the same number every time, inside [0, 1)", () => {
    expect(cellHash(12, 34, 5)).toBe(cellHash(12, 34, 5));
    expect(cellHash(12, 34, 5)).not.toBe(cellHash(12, 35, 5));
    for (let i = 0; i < 200; i++) {
      const value = cellHash(i, i * 7, 3);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("grows the same forest twice", () => {
    expect(planProps(input("taiga"))).toEqual(planProps(input("taiga")));
  });

  it("keeps every prop on land and off the coast", () => {
    const props = all(planProps(input("temperate")));
    expect(props.length).toBeGreaterThan(50);
    for (const prop of props) {
      expect(prop.x).toBeGreaterThanOrEqual(ISLAND.x0 + COAST_MARGIN);
      expect(prop.x).toBeLessThanOrEqual(ISLAND.x1 - COAST_MARGIN);
      expect(prop.y).toBeGreaterThanOrEqual(ISLAND.y0 + COAST_MARGIN);
      expect(prop.y).toBeLessThanOrEqual(ISLAND.y1 - COAST_MARGIN);
    }
  });

  it("keeps clear of the points the pieces use", () => {
    const keepClear = [
      { x: 330, y: 180 },
      { x: 360, y: 210 },
      { x: 390, y: 240 },
    ];
    const props = all(planProps(input("jungle", { keepClear })));
    expect(props.length).toBeGreaterThan(50);
    for (const prop of props) {
      for (const point of keepClear) {
        expect(Math.hypot(prop.x - point.x, prop.y - point.y)).toBeGreaterThanOrEqual(TREE_CLEARANCE);
      }
    }
  });

  it("dresses each biome with its own trees", () => {
    const taiga = planProps(input("taiga")).props;
    expect(taiga.pine.length).toBeGreaterThan(taiga.broadleaf.length * 4);
    expect(taiga.palm).toHaveLength(0);
    const desert = planProps(input("desert")).props;
    expect(desert.dune.length).toBeGreaterThan(0);
    expect(desert.pine).toHaveLength(0);
    const savanna = planProps(input("savanna")).props;
    expect(savanna.acacia.length).toBeGreaterThan(0);
    const jungle = planProps(input("jungle")).props;
    expect(jungle.palm.length).toBeGreaterThan(0);
    expect(jungle.broadleaf.length).toBeGreaterThan(jungle.palm.length);
  });

  it("leaves forest in patches, and the dry lands mostly bare", () => {
    // The island is 120 by 120: about 2,100 grid cells.
    const count = (biome: Biome) => all(planProps(input(biome))).length;
    expect(count("taiga")).toBeLessThan(1300);
    expect(count("taiga")).toBeGreaterThan(count("steppe") * 3);
    expect(count("desert")).toBeLessThan(320);
    expect(count("ice")).toBeLessThan(120);
  });

  it("raises peaks along a range, clear of the pieces, tallest and snowed in the middle", () => {
    const a = { lon: 62, lat: 30 };
    const b = { lon: 80, lat: 30 };
    const range: MountainRange = { name: "Test", crest: [[a.lon, a.lat], [b.lon, b.lat]], spread: 2, height: 5, snowline: 0.8 };
    const from = lonLatToMap(a.lon, a.lat);
    const to = lonLatToMap(b.lon, b.lat);
    const middle = { x: (from.x + to.x) / 2, y: from.y };
    const island = (p: Vec2) => Math.abs(p.y - from.y) < 30 && p.x > from.x - 30 && p.x < to.x + 30;
    const blocked = { x: from.x + 6, y: from.y };
    const plan = planProps(input("ice", { isLand: island, ranges: [range], keepClear: [blocked] }));
    const peaks = plan.props.peak;
    expect(peaks.length).toBeGreaterThan(8);
    for (const peak of peaks) {
      expect(Math.abs(peak.y - from.y)).toBeLessThanOrEqual(2.001);
      expect(Math.hypot(peak.x - blocked.x, peak.y - blocked.y)).toBeGreaterThanOrEqual(peakClearance(peak.scale));
      expect(peak.height).toBeLessThanOrEqual(5 * PEAK_RISE);
      // A ridge, not a spike: no taller than its foot is wide.
      expect(peak.height).toBeLessThan(peak.scale);
    }
    const tallest = peaks.reduce((best, peak) => (peak.height > best.height ? peak : best));
    expect(Math.abs(tallest.x - middle.x)).toBeLessThan((to.x - from.x) / 3);
    expect(peaks.some((peak) => peak.snow === 1)).toBe(true);
    expect(peaks.filter((peak) => peak.snow === 1).every((peak) => peak.height >= 5 * 0.8 * PEAK_RISE - 1e-9)).toBe(true);
    // The forest floor stays off the massif.
    for (const rock of plan.props.rock) {
      for (const peak of peaks) {
        expect(Math.hypot(rock.x - peak.x, rock.y - peak.y)).toBeGreaterThan(peak.scale * 0.27);
      }
    }
  });

  it("builds a town with its factory and gives each chimney a smoke stack", () => {
    const plan = planProps(input("steppe", { towns: [{ x: 360, y: 210, houses: 6, factory: 2 }] }));
    expect(plan.props.factory).toHaveLength(1);
    expect(plan.props.factory[0].snow).toBe(1);
    expect(plan.chimneys).toHaveLength(2);
    expect(plan.props.house.length).toBeGreaterThanOrEqual(4);
    for (const house of plan.props.house) {
      expect(Math.hypot(house.x - 360, house.y - 210)).toBeLessThan(8);
    }
    for (const stack of plan.chimneys) {
      expect(Math.hypot(stack.x - 360, stack.y - 210)).toBeLessThan(2);
      expect(stack.z).toBeGreaterThan(2);
    }
    const minor = planProps(input("steppe", { towns: [{ x: 360, y: 210, houses: 2, factory: 1 }] }));
    expect(minor.chimneys).toHaveLength(1);
    expect(minor.props.factory[0].snow).toBe(0);
  });

  it("does not build on water", () => {
    const plan = planProps(input("steppe", { towns: [{ x: 100, y: 100, houses: 6, factory: 2 }] }));
    expect(plan.props.factory).toHaveLength(0);
    expect(plan.props.house).toHaveLength(0);
    expect(plan.chimneys).toHaveLength(0);
  });

  it("sites a town inside its territory, away from the anchor, for industry or income", () => {
    const anchor = { x: 360, y: 210 };
    const region = (id: string, ipc: number, factory: 0 | 1 | 2) => ({ id, ipc, factory, anchor, contains: onIsland });
    const sites = townSites([region("rich", 6, 0), region("poor", 1, 0), region("works", 0, 2)], onIsland, [anchor]);
    expect(sites).toHaveLength(2);
    for (const site of sites) {
      expect(onIsland(site)).toBe(true);
      expect(Math.hypot(site.x - anchor.x, site.y - anchor.y)).toBeGreaterThan(PEAK_CLEARANCE);
    }
    expect(sites[0].factory).toBe(0);
    expect(sites[0].houses).toBeGreaterThan(sites[1].houses - 1);
    expect(sites[1].factory).toBe(2);
  });

  it("finds no site in a territory too small to hold one", () => {
    const anchor = { x: 360, y: 210 };
    const tiny = (p: Vec2) => Math.hypot(p.x - anchor.x, p.y - anchor.y) < 4;
    expect(townSites([{ id: "islet", ipc: 5, factory: 2, anchor, contains: tiny }], tiny, [anchor])).toHaveLength(0);
  });
});

describe("theater canopy tints", () => {
  it("puts the Pacific and Africa in their own colours, and leaves the rest alone", async () => {
    const { theaterOf, theaterTint } = await import("../../../src/ui/viewport3d/propPlan");
    expect(theaterOf(120, 5)).toBe("pacific");
    expect(theaterOf(-170, 0)).toBe("pacific");
    expect(theaterOf(30, -5)).toBe("africa");
    expect(theaterOf(10, 50)).toBe("other");
    const own: [number, number, number] = [0.4, 0.4, 0.4];
    expect(theaterTint(own, "other", 0.5, 1)).toEqual(own);
    expect(theaterTint(own, "pacific", 0.5, 0)).toEqual(own);
    const jade = theaterTint(own, "pacific", 0, 1);
    const gold = theaterTint(own, "africa", 1, 1);
    expect(jade[1]).toBeGreaterThan(jade[0]);
    expect(jade[1]).toBeGreaterThan(jade[2]);
    expect(gold[0]).toBeGreaterThan(gold[2]);
  });
});

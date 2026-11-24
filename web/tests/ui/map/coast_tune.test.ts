import { describe, expect, it } from "vitest";
import {
  CLIFF_BIG_SPAN,
  CLIFF_SMALL_LIFT,
  CLIFF_TINY_LIFT,
  CLIFF_TINY_SPAN,
  SHIPPED_SURF,
  SURF_GRAIN_PX,
  SURF_PERIOD_S,
  SURF_REACH_PX,
  SURF_WAVELENGTH,
  surfLocalPx,
  surfScreenPx,
} from "../../../src/ui/map/coastRelief";
import {
  applyShoreLifts,
  cliffSweepEdges,
  coastTuneSortOrigin,
  effectiveCliffLift,
  parseCoastTune,
  planCliffStamps,
  SHIPPED_BLOOM_ALPHA,
  SHIPPED_BLOOM_BLUR_PX,
  SHIPPED_BLOOM_BRUSH_PX,
  SHIPPED_BLOOM_REST_PX,
  SHIPPED_CLIFF_LIP,
  SHIPPED_COAST_TUNE,
  sortLandRegionsByProximity,
} from "../../../src/ui/map/coastTune";
import { pointInMultiPolygon, type MultiPolygon } from "../../../src/ui/map/regionClip";
import type { SurfSample } from "../../../src/ui/map/coastRelief";

describe("coast tune defaults", () => {
  it("matches the shipped swell, bloom and cliff numbers", () => {
    expect(SHIPPED_COAST_TUNE.reachPx).toBe(SURF_REACH_PX);
    expect(SHIPPED_COAST_TUNE.reachPx).toBe(1.5);
    expect(SHIPPED_COAST_TUNE.periodS).toBe(SURF_PERIOD_S);
    expect(SHIPPED_COAST_TUNE.periodS).toBeCloseTo(Math.PI * 2, 8);
    expect(SHIPPED_COAST_TUNE.wavelength).toBe(SURF_WAVELENGTH);
    expect(SHIPPED_COAST_TUNE.wavelength).toBe(56);
    expect(SHIPPED_COAST_TUNE.grainPx).toBe(SURF_GRAIN_PX);
    expect(SHIPPED_COAST_TUNE.grainPx).toBeCloseTo(0.12, 8);
    expect(SHIPPED_COAST_TUNE.bloomRestPx).toBe(SHIPPED_BLOOM_REST_PX);
    expect(SHIPPED_COAST_TUNE.bloomRestPx).toBe(10);
    expect(SHIPPED_COAST_TUNE.bloomBrushPx).toBe(SHIPPED_BLOOM_BRUSH_PX);
    expect(SHIPPED_COAST_TUNE.bloomBrushPx).toBe(14);
    expect(SHIPPED_COAST_TUNE.bloomBlurPx).toBe(SHIPPED_BLOOM_BLUR_PX);
    expect(SHIPPED_COAST_TUNE.bloomBlurPx).toBe(7);
    expect(SHIPPED_COAST_TUNE.bloomAlpha).toBe(SHIPPED_BLOOM_ALPHA);
    expect(SHIPPED_COAST_TUNE.bloomAlpha).toBeCloseTo(0.42, 8);
    expect(SHIPPED_COAST_TUNE.cliffLip).toBe(SHIPPED_CLIFF_LIP);
    expect(SHIPPED_COAST_TUNE.cliffLip).toBeCloseTo(0.68, 8);
    expect(SHIPPED_COAST_TUNE.cliffOverrides).toEqual({});
    expect(surfScreenPx(0)).toBeCloseTo(-SURF_REACH_PX, 5);
  });

  it("lets a larger reach move the same swell, and keeps grain fixed in time", () => {
    expect(surfScreenPx(0, { ...SHIPPED_SURF, reachPx: 16 })).toBeCloseTo(-16, 5);
    const grainy = { ...SHIPPED_SURF, grainPx: 0.5 };
    const delta = (time: number) => surfLocalPx(time, 10, 1, grainy) - surfLocalPx(time, 10, -1, grainy);
    expect(delta(0.2)).toBeCloseTo(1, 5);
    expect(delta(3.5)).toBeCloseTo(delta(0.2), 5);
  });
});

describe("cliff height overrides", () => {
  it("replaces the size lift for that region and leaves the others on size", () => {
    expect(effectiveCliffLift(CLIFF_BIG_SPAN, "germany", {})).toBe(1);
    expect(effectiveCliffLift(CLIFF_TINY_SPAN, "borneo", {})).toBe(CLIFF_SMALL_LIFT);
    expect(effectiveCliffLift(CLIFF_TINY_SPAN - 1, "speck", {})).toBe(CLIFF_TINY_LIFT);
    expect(effectiveCliffLift(CLIFF_BIG_SPAN, "germany", { germany: 0.25 })).toBe(0.25);
    expect(effectiveCliffLift(CLIFF_TINY_SPAN, "borneo", { borneo: 1.4 })).toBe(1.4);
    expect(effectiveCliffLift(4, "speck", { speck: 0 })).toBe(0);
    expect(effectiveCliffLift(CLIFF_BIG_SPAN, "france", { germany: 0.25 })).toBe(1);
  });

  it("keeps one landmass stamp until an override splits it into territory shapes", () => {
    const land: MultiPolygon = [[[[0, 0], [120, 0], [120, 80], [0, 80]]]];
    const west = { id: "west", polygons: [[[[0, 0], [50, 0], [50, 80], [0, 80]]]] as MultiPolygon };
    const east = { id: "east", polygons: [[[[50, 0], [120, 0], [120, 80], [50, 80]]]] as MultiPolygon };

    const kept = planCliffStamps(land, [west, east], {});
    expect(kept).toHaveLength(1);
    expect(kept[0].lift).toBe(1);
    expect(kept[0].polygons).toEqual(land);

    const split = planCliffStamps(land, [west, east], { east: 0.3 });
    expect(split).toHaveLength(2);
    const byLift = new Map(split.map((stamp) => [stamp.lift, stamp]));
    expect(byLift.get(1)?.polygons).toEqual(west.polygons);
    expect(byLift.get(0.3)?.polygons).toEqual(east.polygons);
    for (const stamp of split) {
      for (const poly of stamp.polygons) {
        const xs = poly[0].map((point) => point[0]);
        expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(120);
      }
    }

    const shared = planCliffStamps(land, [west, east], { west: 0.4, east: 0.4 });
    expect(shared).toHaveLength(1);
    expect(shared[0].lift).toBe(0.4);
    expect(shared[0].polygons).toHaveLength(2);
  });

  it("stamps a small island and a speck at their size lift until an override replaces it", () => {
    const island: MultiPolygon = [[[[0, 0], [30, 0], [30, 10], [0, 10]]]];
    const speck: MultiPolygon = [[[[0, 0], [8, 0], [8, 4], [0, 4]]]];
    expect(planCliffStamps(island, [{ id: "borneo", polygons: island }], {})[0].lift).toBeCloseTo(CLIFF_SMALL_LIFT, 5);
    expect(planCliffStamps(speck, [{ id: "dot", polygons: speck }], {})[0].lift).toBeCloseTo(CLIFF_TINY_LIFT, 5);
    expect(planCliffStamps(speck, [{ id: "dot", polygons: speck }], { dot: 1 })[0].lift).toBe(1);
  });

  it("uses the same override on the shore sample the knockout would drop", () => {
    const west = { id: "west", polygons: [[[[0, 0], [50, 0], [50, 80], [0, 80]]]] as MultiPolygon };
    const east = { id: "east", polygons: [[[[50, 0], [120, 0], [120, 80], [50, 80]]]] as MultiPolygon };
    const at = (x: number, y: number, nx: number, ny: number): SurfSample => ({
      x,
      y,
      nx,
      ny,
      along: 0,
      jitter: 0,
      lift: 1,
    });
    const runs = [[at(120, 40, 1, 0), at(0, 40, -1, 0)]];
    applyShoreLifts(runs, [west, east], { east: 0.3 });
    expect(runs[0][0].lift).toBe(0.3);
    expect(runs[0][1].lift).toBe(1);
  });
});

describe("cliff sweep", () => {
  it("runs every edge left to right and leaves the upright ones out", () => {
    const square: MultiPolygon = [[[[0, 0], [10, 0], [10, 10], [0, 10]]]];
    expect(Array.from(cliffSweepEdges(square))).toEqual([0, 0, 10, 0, 0, 10, 10, 10]);
  });

  it("covers what a silhouette stamped on every step of the drop covers", () => {
    // A notched coast with a lake, and an island shorter than the drop.
    const land: MultiPolygon = [
      [
        [[0, 0], [20, 0], [26, 6], [26, 20], [14, 20], [14, 12], [6, 12], [0, 18]],
        [[4, 3], [10, 3], [10, 8], [4, 8]],
      ],
      [[[30, 2], [34, 2], [32, 5]]],
    ];
    const drop = 4;
    const edges = cliffSweepEdges(land);
    const onFace = (x: number, y: number): boolean => {
      for (let i = 0; i < edges.length; i += 4) {
        if (x < edges[i] || x > edges[i + 2]) {
          continue;
        }
        const top = edges[i + 1] + ((edges[i + 3] - edges[i + 1]) * (x - edges[i])) / (edges[i + 2] - edges[i]);
        if (y >= top && y <= top + drop) {
          return true;
        }
      }
      return false;
    };
    const onLand = (x: number, y: number) => pointInMultiPolygon({ x, y }, land);
    let faceOnly = 0;
    for (let x = -1.63; x < 36; x += 1) {
      for (let y = -1.79; y < 26; y += 0.5) {
        let stamped = false;
        for (let step = 0; step <= 256 && !stamped; step += 1) {
          stamped = onLand(x, y - (drop * step) / 256);
        }
        const ends = onLand(x, y) || onLand(x, y - drop);
        expect(ends || onFace(x, y), `at ${x}, ${y}`).toBe(stamped);
        if (stamped && !ends) {
          faceOnly += 1;
        }
      }
    }
    // The island is shorter than the drop, so part of its cliff is in neither silhouette.
    expect(faceOnly).toBeGreaterThan(0);
  });
});

describe("coast tuner region order", () => {
  it("sorts by proximity, not by name, and stays on the first selected region", () => {
    const regions = [
      { id: "Alpha", x: 100, y: 0 },
      { id: "Bravo", x: 10, y: 0 },
      { id: "Minsk", x: 70, y: 0 },
      { id: "Zulu", x: 0, y: 0 },
    ];
    const names = (origin: { x: number; y: number }) => sortLandRegionsByProximity(regions, origin).map((region) => region.id);
    const fromView = names(coastTuneSortOrigin(regions, { x: 0, y: 0 }, null));
    expect(fromView).toEqual(["Zulu", "Bravo", "Minsk", "Alpha"]);
    expect(fromView).not.toEqual(["Alpha", "Bravo", "Minsk", "Zulu"]);

    const fromMinsk = names(coastTuneSortOrigin(regions, { x: 0, y: 0 }, "Minsk"));
    expect(fromMinsk).toEqual(["Minsk", "Alpha", "Bravo", "Zulu"]);
    expect(fromMinsk).not.toEqual(fromView);
    expect(fromMinsk).not.toEqual(["Alpha", "Bravo", "Minsk", "Zulu"]);
  });

  it("reads a partial tune back onto the shipped numbers", () => {
    const parsed = parseCoastTune({ cliffOverrides: { germany: 0.25 } });
    expect(parsed).not.toBeNull();
    expect(parsed?.reachPx).toBe(SURF_REACH_PX);
    expect(parsed?.cliffLip).toBeCloseTo(0.68, 8);
    expect(effectiveCliffLift(CLIFF_BIG_SPAN, "germany", parsed?.cliffOverrides ?? {})).toBe(0.25);
    expect(parseCoastTune({ reachPx: "wide" })).toBeNull();
  });
});

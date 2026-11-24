import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  biomeAt,
  BOARD_PROJECTION,
  crestPoints,
  lonLatToMap,
  mapToLonLat,
  MOUNTAIN_RANGES,
  WORLD_WIDTH,
} from "../../../src/ui/viewport3d/geography";

const MAP = JSON.parse(readFileSync(resolve(__dirname, "../../../../demomap01.json"), "utf8")) as {
  projection: { type: string; lon_0: number; px_per_degree: number; origin: [number, number] };
};

describe("board geography", () => {
  it("uses the projection the map file declares", () => {
    expect(MAP.projection.type).toBe("mercator");
    expect(BOARD_PROJECTION.lon0).toBe(MAP.projection.lon_0);
    expect(BOARD_PROJECTION.pxPerDegree).toBe(MAP.projection.px_per_degree);
    expect([BOARD_PROJECTION.originX, BOARD_PROJECTION.originY]).toEqual(MAP.projection.origin);
  });

  it("puts the central meridian and the equator on the origin", () => {
    const origin = lonLatToMap(60, 0);
    expect(origin.x).toBeCloseTo(400, 9);
    expect(origin.y).toBeCloseTo(355, 9);
  });

  it("runs east to the right and north up the sheet, stretching toward the pole", () => {
    expect(lonLatToMap(70, 0).x - lonLatToMap(60, 0).x).toBeCloseTo(22.2, 9);
    const step = (lat: number) => lonLatToMap(60, lat).y - lonLatToMap(60, lat + 10).y;
    expect(step(0)).toBeGreaterThan(0);
    expect(step(50)).toBeGreaterThan(step(0));
  });

  it("splits the world at the meridian opposite the centre", () => {
    expect(lonLatToMap(-119.9, 0).x).toBeLessThan(1);
    expect(lonLatToMap(-120.1, 0).x).toBeGreaterThan(WORLD_WIDTH - 1);
  });

  it("round-trips a place through the sheet", () => {
    for (const [lon, lat] of [
      [2.3, 48.9],
      [139.7, 35.7],
      [-74, 40.7],
      [-58.4, -34.6],
    ]) {
      const back = mapToLonLat(lonLatToMap(lon, lat));
      expect(back.lon).toBeCloseTo(lon, 9);
      expect(back.lat).toBeCloseTo(lat, 9);
    }
  });

  it("knows the world's ground cover", () => {
    expect(biomeAt(10, 24)).toBe("desert"); // Sahara
    expect(biomeAt(46, 22)).toBe("desert"); // Arabia
    expect(biomeAt(134, -25)).toBe("desert"); // Australian interior
    expect(biomeAt(100, 62)).toBe("taiga"); // Siberia
    expect(biomeAt(-100, 58)).toBe("taiga"); // Canada
    expect(biomeAt(-62, -4)).toBe("jungle"); // Amazon
    expect(biomeAt(22, 0)).toBe("jungle"); // Congo
    expect(biomeAt(114, 0)).toBe("jungle"); // Borneo
    expect(biomeAt(10, 51)).toBe("temperate"); // Germany
    expect(biomeAt(-80, 38)).toBe("temperate"); // Eastern United States
    expect(biomeAt(35, 48)).toBe("steppe"); // Ukraine
    expect(biomeAt(15, 40)).toBe("scrub"); // Southern Italy
    expect(biomeAt(36, -3)).toBe("savanna"); // East Africa
    expect(biomeAt(-40, 72)).toBe("ice"); // Greenland
    expect(biomeAt(100, 73)).toBe("tundra"); // Taymyr
  });

  it("names the Alps and the Hindu Kush, where the Swiss and the Afghans live", () => {
    const names = MOUNTAIN_RANGES.map((range) => range.name);
    expect(names).toContain("Alps");
    expect(names).toContain("Hindu Kush");
    const alps = MOUNTAIN_RANGES.find((range) => range.name === "Alps")!;
    const swiss = lonLatToMap(8.2, 46.8);
    expect(crestPoints(alps, 2).some((p) => Math.hypot(p.x - swiss.x, p.y - swiss.y) < 4)).toBe(true);
    const kush = MOUNTAIN_RANGES.find((range) => range.name === "Hindu Kush")!;
    const kabul = lonLatToMap(69.2, 34.5);
    expect(crestPoints(kush, 2).some((p) => Math.hypot(p.x - kabul.x, p.y - kabul.y) < 5)).toBe(true);
  });

  it("keeps every range low and narrow", () => {
    for (const range of MOUNTAIN_RANGES) {
      expect(range.crest.length).toBeGreaterThanOrEqual(2);
      expect(range.height).toBeLessThanOrEqual(6);
      expect(range.spread).toBeLessThanOrEqual(3);
    }
  });

  it("walks a crest in even steps, tallest in the middle", () => {
    const himalaya = MOUNTAIN_RANGES.find((range) => range.name === "Himalaya")!;
    const points = crestPoints(himalaya, 2);
    expect(points.length).toBeGreaterThan(10);
    for (let i = 1; i < points.length; i++) {
      expect(Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)).toBeLessThan(3.5);
    }
    const middle = points[Math.floor(points.length / 2)];
    expect(middle.crown).toBeGreaterThan(points[0].crown);
    expect(middle.crown).toBeGreaterThan(points[points.length - 1].crown);
  });

  it("carries a range across the seam the short way", () => {
    // The Rockies cross 120 degrees west, where the sheet is cut.
    const rockies = MOUNTAIN_RANGES.find((range) => range.name === "Rockies")!;
    const points = crestPoints(rockies, 2);
    for (let i = 1; i < points.length; i++) {
      expect(Math.abs(points[i].x - points[i - 1].x)).toBeLessThan(10);
    }
  });
});
